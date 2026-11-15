// bots.js — the other seven fighters. Each bot is a box-built soldier in team
// colours with a brain that runs on a simple loop: perceive (sight through a
// field-of-view cone with line of sight, hearing for gunfire and footsteps),
// remember, decide, move along the waypoint graph, and fight in bursts with
// strafing and crouching. Defenders hold the sites and rotate on information;
// attackers run two different lanes to the called site and cover the plant;
// after a plant the defenders converge and one of them works the defuse while
// the others cover. Aim is honest: a reaction delay, an aim point that wanders
// by distance and target speed, and the same weapon spread the player obeys.

import * as THREE from 'three';
import { S, PHASE, makeActor } from './state.js';
import { NODES, PLACES, findPath, nearestNode } from './map.js';
import { slideMove, segmentBlocked2D } from './collision.js';
import { currentWeapon, tryFire, startReload, visionBlocked } from './weapons.js';
import { TEAM } from './palette.js';

const PERCEPTION_EVERY = 0.12;
const DECIDE_EVERY = 0.22;

const bodyMats = {
  attack: new THREE.MeshStandardMaterial({ color: TEAM.attack.color, roughness: 0.8 }),
  defend: new THREE.MeshStandardMaterial({ color: TEAM.defend.color, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.9 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc9a189, roughness: 0.7 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.5 }),
};

function buildBotMesh(team) {
  const g = new THREE.Group();
  const mat = bodyMats[team];
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.78, 0.2), bodyMats.dark);
  legL.position.set(-0.12, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), mat);
  torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), bodyMats.skin);
  head.position.y = 1.58;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.36), bodyMats.dark);
  helmet.position.y = 1.76;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), bodyMats.gun);
  gun.position.set(0.18, 1.32, 0.3);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.14), bodyMats.dark);
  pack.position.set(0, 1.12, -0.22);
  for (const m of [legL, legR, torso, head, helmet, gun, pack]) {
    m.castShadow = true;
    g.add(m);
  }
  g.userData = { legL, legR, torso, head, gun };
  return g;
}

export function createBot(team, scene) {
  const actor = makeActor(team, false);
  actor.grounded = true;
  actor.vy = 0;
  actor.recoilPitch = 0;
  actor.skill = 0.85 + S.rng() * 0.3;
  actor.mesh = buildBotMesh(team);
  actor.brain = {
    state: 'idle',
    path: [],
    pathI: 0,
    moveX: 0, moveZ: 0,
    holdNode: null,
    memory: null,          // { actor, x, z, at }
    seenAt: -99,
    reactAt: 0,
    burstLeft: 0,
    nextBurstAt: 0,
    strafeDir: 1,
    strafeFlipAt: 0,
    perceiveAt: S.rng() * PERCEPTION_EVERY,
    decideAt: S.rng() * DECIDE_EVERY,
    lastX: 0, lastZ: 0, stuckAt: 0,
    channel: null,         // 'defuse'
    planSite: null,
  };
  scene.add(actor.mesh);
  S.actors.push(actor);
  S.bots.push(actor);
  return actor;
}

// --- Perception ---------------------------------------------------------------

function canSee(bot, target) {
  if (!target.alive) return false;
  if (bot.flashUntil > S.time) return false;
  const dx = target.x - bot.x;
  const dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 62) return false;
  if (dist > 3.6) {
    const fx = Math.sin(bot.yaw);
    const fz = Math.cos(bot.yaw);
    const dot = (dx * fx + dz * fz) / (dist || 1);
    if (dot < 0.24) return false; // ~76 degree half-angle cone
  }
  const eyeY = bot.crouching ? 1.14 : 1.62;
  const chestY = target.crouching ? 0.95 : 1.3;
  return !visionBlocked(bot.x, eyeY, bot.z, target.x, chestY, target.z);
}

function perceive(bot) {
  const brain = bot.brain;
  // Sight.
  let best = null;
  let bestDist = Infinity;
  for (const a of S.actors) {
    if (a.team === bot.team || !a.alive) continue;
    if (canSee(bot, a)) {
      const d = Math.hypot(a.x - bot.x, a.z - bot.z);
      if (d < bestDist) { bestDist = d; best = a; }
    }
  }
  if (best) {
    if (!brain.memory || brain.memory.actor !== best) {
      brain.reactAt = S.time + (0.34 + S.rng() * 0.22) / bot.skill;
    }
    brain.memory = { actor: best, x: best.x, z: best.z, at: S.time };
    brain.seenAt = S.time;
  }
  // Hearing: enemy shots and steps inside their loudness radius give a
  // position to investigate, but not a target to shoot.
  for (const e of S.events) {
    if (e.team === bot.team) continue;
    const d = Math.hypot(e.x - bot.x, e.z - bot.z);
    if (d <= e.loud) {
      if (!brain.memory || S.time - brain.memory.at > 1.2) {
        brain.memory = { actor: null, x: e.x, z: e.z, at: S.time };
      }
    }
  }
}

// --- Movement -----------------------------------------------------------------

function setPath(bot, toNode) {
  // Entry node: the nearest graph node reachable in a straight line. The
  // Euclidean nearest can be across a wall (defender spawn vs the A posts),
  // which would steer the bot into the wall face forever.
  let from = nearestNode(bot.x, bot.z);
  let best = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const d = Math.hypot(bot.x - NODES[i][0], bot.z - NODES[i][1]);
    if (d < best && !segmentBlocked2D(bot.x, bot.z, NODES[i][0], NODES[i][1])) {
      best = d;
      from = i;
    }
  }
  bot.brain.path = findPath(from, toNode);
  bot.brain.pathI = 0;
}

// Steer toward a point; returns true on arrival. Speed in m/s.
function moveToward(bot, tx, tz, speed, dt) {
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.55) {
    bot.vx = 0;
    bot.vz = 0;
    return true;
  }
  const want = Math.min(speed, dist / Math.max(dt, 0.001));
  const ux = dx / dist;
  const uz = dz / dist;
  bot.vx += (ux * want - bot.vx) * Math.min(1, 14 * dt);
  bot.vz += (uz * want - bot.vz) * Math.min(1, 14 * dt);
  slideMove(bot, bot.vx * dt, bot.vz * dt, bot.radius);
  if (Math.hypot(bot.vx, bot.vz) > 0.4) {
    const targetYaw = Math.atan2(bot.vx, bot.vz);
    bot.yaw = turnToward(bot.yaw, targetYaw, dt * 9);
  }
  // Stuck recovery: barely moved while trying — sidestep once.
  const brain = bot.brain;
  if (S.time - brain.stuckAt > 0.85) {
    const moved = Math.hypot(bot.x - brain.lastX, bot.z - brain.lastZ);
    if (moved < 0.12 && speed > 0) {
      slideMove(bot, -uz * 0.7, ux * 0.7, bot.radius);
    }
    brain.lastX = bot.x;
    brain.lastZ = bot.z;
    brain.stuckAt = S.time;
  }
  return false;
}

function followPath(bot, speed, dt) {
  const brain = bot.brain;
  if (brain.pathI >= brain.path.length) return true;
  const node = NODES[brain.path[brain.pathI]];
  if (moveToward(bot, node[0], node[1], speed, dt)) {
    brain.pathI++;
    return brain.pathI >= brain.path.length;
  }
  return false;
}

function turnToward(yaw, target, maxStep) {
  let d = target - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return yaw + Math.sign(d) * maxStep;
}

// --- Combat -------------------------------------------------------------------

function botDir(bot, aimX, aimY, aimZ) {
  return (spread) => {
    let dx = aimX - bot.x;
    let dy = aimY - (bot.crouching ? 1.14 : 1.62);
    let dz = aimZ - bot.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const a = S.rng() * Math.PI * 2;
    const r = spread * Math.sqrt(S.rng());
    const rx = dz;
    const rz = -dx;
    const rl = Math.hypot(rx, rz) || 1;
    dx += (rx / rl) * Math.cos(a) * r;
    dz += (rz / rl) * Math.cos(a) * r;
    dy += Math.sin(a) * r;
    const l2 = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / l2, y: dy / l2, z: dz / l2 };
  };
}

function fight(bot, dt) {
  const brain = bot.brain;
  const mem = brain.memory;
  const target = mem.actor;
  const dist = Math.hypot(target.x - bot.x, target.z - bot.z);
  // Face the target.
  const targetYaw = Math.atan2(target.x - bot.x, target.z - bot.z);
  bot.yaw = turnToward(bot.yaw, targetYaw, dt * 11);
  // Strafe in short jolts; crouch for longer shots; close distance if far.
  if (S.time > brain.strafeFlipAt) {
    brain.strafeDir = S.rng() > 0.5 ? 1 : -1;
    brain.strafeFlipAt = S.time + 0.6 + S.rng() * 0.9;
  }
  const fx = Math.sin(bot.yaw);
  const fz = Math.cos(bot.yaw);
  const sx = fz * brain.strafeDir;
  const sz = -fx * brain.strafeDir;
  let mx = sx;
  let mz = sz;
  let speed = 2.7;
  if (dist > 26) { mx = fx * 0.8 + sx * 0.4; mz = fz * 0.8 + sz * 0.4; speed = 4.4; }
  bot.crouching = dist > 13 && brain.burstLeft <= 0;
  slideMove(bot, mx * speed * dt, mz * speed * dt, bot.radius);
  bot.vx = mx * speed;
  bot.vz = mz * speed;

  const w = currentWeapon(bot);
  if (!w) return;
  if (w.mag === 0 && w.reloadEnd <= S.time) startReload(bot);
  if (S.time < brain.reactAt) return;
  if (brain.burstLeft <= 0) {
    if (S.time < brain.nextBurstAt) return;
    brain.burstLeft = w.def.pellets > 1 ? 1 : 2 + Math.floor(S.rng() * 3);
    brain.nextBurstAt = S.time + (60 / w.def.rpm) * brain.burstLeft + 0.24 + S.rng() * 0.3;
  }
  // Aim point: the target's chest/head line with an error that grows with
  // distance, target speed and the bot's own movement.
  const err = (0.17 + dist * 0.006 + target.speedSeen * 0.05) / bot.skill;
  const aimX = target.x + (S.rng() - 0.5) * 2 * err;
  const aimZ = target.z + (S.rng() - 0.5) * 2 * err;
  const aimY = (target.crouching ? 0.95 : 1.3) + (S.rng() - 0.5) * err * 0.7;
  const eyeY = bot.crouching ? 1.14 : 1.62;
  const res = tryFire(bot, bot.x, eyeY, bot.z, botDir(bot, aimX, aimY, aimZ));
  if (res === 'fired') brain.burstLeft--;
}

// --- Decisions ------------------------------------------------------------------

function decide(bot) {
  const brain = bot.brain;
  const mem = brain.memory;
  const fresh = mem && S.time - mem.at < 2.6;
  const canFight = mem && mem.actor && mem.actor.alive && S.time - mem.at < 0.5 && canSee(bot, mem.actor);

  if (canFight) {
    brain.state = 'engage';
    return;
  }

  if (S.phase === PHASE.PLANTED && bot.team === 'defend') {
    // Converge on the plant site; the nearest defender works the defuse.
    const charge = S.charge;
    const d = Math.hypot(bot.x - charge.x, bot.z - charge.z);
    const nearest = S.bots
      .filter((b) => b.team === 'defend' && b.alive)
      .every((b) => b === bot || Math.hypot(b.x - charge.x, b.z - charge.z) >= d);
    if (d < 1.6 && nearest) {
      brain.state = 'defuse';
      brain.channel = 'defuse';
      return;
    }
    brain.state = 'toCharge';
    brain.channel = null;
    setPath(bot, charge.site === 'A' ? PLACES.aSite : PLACES.bSite);
    return;
  }

  if (fresh && mem.actor && mem.actor.alive) {
    brain.state = 'hunt'; // last seen position: push it
    brain.moveX = mem.x;
    brain.moveZ = mem.z;
    return;
  }
  if (fresh && !mem.actor) {
    brain.state = 'investigate';
    brain.moveX = mem.x;
    brain.moveZ = mem.z;
    return;
  }

  if (bot.team === 'defend') {
    // Still travelling to the post: don't let the hold logic cut in (it steers
    // in a straight line and would pin the bot against the strip wall).
    if (brain.state === 'advancePost') return;
    brain.state = 'hold';
    return;
  }

  // Attackers.
  if (S.phase === PHASE.PLANTED) {
    brain.state = 'holdSite'; // guard the charge from the nearest cover node
    return;
  }
  if (S.charge && S.charge.state === 'lost') {
    brain.state = 'huntAll';
    return;
  }
  brain.state = 'advance';
}

// --- Main step ------------------------------------------------------------------

export function stepBots(dt) {
  const active = S.phase === PHASE.LIVE || S.phase === PHASE.PLANTED;
  for (const bot of S.bots) {
    if (!bot.alive) continue;
    const brain = bot.brain;
    bot.crouching = false;
    if (!active) {
      bot.vx = 0;
      bot.vz = 0;
      continue;
    }
    brain.perceiveAt -= dt;
    if (brain.perceiveAt <= 0) {
      brain.perceiveAt = PERCEPTION_EVERY;
      perceive(bot);
    }
    brain.decideAt -= dt;
    if (brain.decideAt <= 0) {
      brain.decideAt = DECIDE_EVERY;
      decide(bot);
    }
    const mem = brain.memory;
    if (mem && mem.actor) mem.actor.speedSeen = Math.hypot(mem.actor.vx, mem.actor.vz);

    switch (brain.state) {
      case 'engage':
        if (mem && mem.actor && mem.actor.alive) fight(bot, dt);
        break;
      case 'advance': {
        if (brain.path.length === 0 && brain.planNode !== undefined) setPath(bot, brain.planNode);
        if (followPath(bot, 4.9, dt)) {
          brain.state = 'holdSite';
          brain.holdNode = brain.planNode;
        }
        break;
      }
      case 'advancePost': {
        if (followPath(bot, 5.0, dt)) brain.state = 'hold';
        break;
      }
      case 'hold': {
        const node = NODES[brain.holdNode ?? PLACES.defSpawn];
        const dHold = Math.hypot(bot.x - node[0], bot.z - node[1]);
        if (dHold > 3) {
          // Too far to steer in a straight line (a wall may be in the way —
          // after an investigation, say): path back to the post.
          if (brain.pathI >= brain.path.length) setPath(bot, brain.holdNode);
          followPath(bot, 4.9, dt);
          break;
        }
        if (!moveToward(bot, node[0], node[1], 4.9, dt)) break;
        // Settled: watch the lane the post covers.
        bot.yaw = turnToward(bot.yaw, brain.holdYaw ?? 0, dt * 3);
        bot.vx = 0;
        bot.vz = 0;
        break;
      }
      case 'toCharge':
        followPath(bot, 5.1, dt);
        break;
      case 'defuse': {
        const charge = S.charge;
        if (Math.hypot(bot.x - charge.x, bot.z - charge.z) > 1.6) {
          moveToward(bot, charge.x, charge.z, 4.6, dt);
        } else {
          bot.vx = 0;
          bot.vz = 0;
          bot.yaw = turnToward(bot.yaw, Math.atan2(charge.x - bot.x, charge.z - bot.z), dt * 8);
        }
        break;
      }
      case 'hunt':
      case 'investigate':
        if (moveToward(bot, brain.moveX, brain.moveZ, brain.state === 'hunt' ? 5.0 : 4.2, dt)) {
          brain.memory = null;
          brain.state = 'hold';
          // Defenders keep their assigned post; attackers hold where they stand.
          if (bot.team !== 'defend') brain.holdNode = nearestNode(bot.x, bot.z);
          brain.holdYaw = bot.yaw;
        }
        break;
      case 'huntAll': {
        // No charge in play: push the nearest defender post and clear it.
        const post = bot.team === 'attack'
          ? (Math.hypot(bot.x - NODES[PLACES.aSite][0], bot.z - NODES[PLACES.aSite][1]) <
             Math.hypot(bot.x - NODES[PLACES.bSite][0], bot.z - NODES[PLACES.bSite][1]) ? PLACES.aSite : PLACES.bSite)
          : PLACES.atkSpawn;
        if (brain.pathI >= brain.path.length) setPath(bot, post);
        followPath(bot, 5.0, dt);
        break;
      }
      case 'holdSite': {
        const node = NODES[brain.holdNode ?? nearestNode(bot.x, bot.z)];
        moveToward(bot, node[0], node[1], 4.4, dt);
        break;
      }
      default:
        bot.vx = 0;
        bot.vz = 0;
    }
    // Reload discipline outside a fight.
    const w = currentWeapon(bot);
    if (w && brain.state !== 'engage' && w.mag <= Math.floor(w.def.mag * 0.3) && w.reloadEnd <= S.time) {
      startReload(bot);
    }
  }
}

// Assign round plans; called by rounds.js when a round goes live. Attackers
// only — defenders keep the paths assignDefenders gave them.
export function assignPlans(site, routes) {
  for (const bot of S.bots) {
    if (bot.team !== 'attack') continue;
    const brain = bot.brain;
    brain.memory = null;
    brain.path = [];
    brain.pathI = 0;
    brain.channel = null;
    brain.planSite = site;
    brain.planNode = routes[bot.id % routes.length];
    brain.holdNode = site === 'A' ? PLACES.aHold1 : PLACES.bHold1;
    brain.state = 'advance';
  }
}

export function assignDefenders() {
  const defs = S.bots.filter((b) => b.team === 'defend');
  const posts = [
    { node: PLACES.aHold1, yaw: 0.7 },    // A1 watches the south door lane
    { node: PLACES.aHold2, yaw: 0.9 },    // A2 watches the east door
    { node: PLACES.bHold1, yaw: -0.7 },   // B1 watches the south door lane
    { node: PLACES.bHold2, yaw: -0.9 },   // B2 watches the west door
  ];
  defs.forEach((bot, i) => {
    const p = posts[i % posts.length];
    bot.brain.holdNode = p.node;
    bot.brain.holdYaw = p.yaw;
    bot.brain.state = 'hold';
    setPath(bot, p.node);
    bot.brain.state = 'advancePost';
  });
}

// Render-side: pose the meshes from the simulation state.
export function syncBotMeshes() {
  for (const bot of S.bots) {
    const m = bot.mesh;
    if (!m) continue;
    m.position.set(bot.x, 0, bot.z);
    m.rotation.y = bot.yaw;
    const u = m.userData;
    if (!bot.alive) {
      m.rotation.x = Math.max(-Math.PI / 2, m.rotation.x - 0.09);
      m.position.y = 0.12;
      continue;
    }
    m.rotation.x = 0;
    const speed = Math.hypot(bot.vx, bot.vz);
    const swing = Math.sin(S.time * 10) * Math.min(1, speed / 4) * 0.5;
    u.legL.rotation.x = swing;
    u.legR.rotation.x = -swing;
    const crouchDrop = bot.crouching ? 0.34 : 0;
    u.torso.position.y = 1.1 - crouchDrop;
    u.head.position.y = 1.58 - crouchDrop;
    u.gun.position.y = 1.32 - crouchDrop;
    u.gun.rotation.x = -(bot.pitch || 0);
  }
}
