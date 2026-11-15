// weapons.js — the gunplay. Five original weapons with distinct handling, a
// shared hitscan resolver used by the player and every bot (so a bot's rifle
// obeys the same rules as yours), head and body hitboxes with an armour model,
// damage falloff, spread that grows with movement and sustained fire, and
// thrown grenades — frag, flash and smoke — simulated as projectiles.
// Accuracy beats speed here by design: the spread and recoil numbers punish
// firing on the move and reward stopping, crouching and bursting.

import * as THREE from 'three';
import { S } from './state.js';
import { rayWalls, rayGround, losClear, segmentHitsCircle } from './collision.js';
import * as fx from './effects.js';
import { sfx } from './audio.js';

export const WEAPONS = {
  sidearm: {
    name: 'P9 SIDEARM', slot: 'secondary', price: 0, damage: 26, headMult: 4,
    rpm: 380, auto: false, mag: 12, reserve: 60, reload: 1.5, pellets: 1,
    spread: 0.006, spreadMove: 0.030, spreadAir: 0.09, bloom: 0.004,
    recoil: 0.011, falloffStart: 18, falloffEnd: 46, falloffMin: 0.55,
    moveFactor: 1.0, tracer: 0xffd9a0,
  },
  ripper: {
    name: 'RIPPER-9 SMG', slot: 'primary', price: 1300, damage: 21, headMult: 4,
    rpm: 780, auto: true, mag: 32, reserve: 96, reload: 2.1, pellets: 1,
    spread: 0.011, spreadMove: 0.034, spreadAir: 0.10, bloom: 0.0035,
    recoil: 0.008, falloffStart: 10, falloffEnd: 30, falloffMin: 0.42,
    moveFactor: 1.0, tracer: 0xffe9b0,
  },
  mule: {
    name: 'MULE 12G', slot: 'primary', price: 1700, damage: 10, headMult: 2.2,
    rpm: 68, auto: false, mag: 6, reserve: 24, reload: 2.9, pellets: 8,
    spread: 0.045, spreadMove: 0.05, spreadAir: 0.1, bloom: 0.0,
    recoil: 0.05, falloffStart: 6, falloffEnd: 20, falloffMin: 0.25,
    moveFactor: 0.96, tracer: 0xffc98a, pump: true,
  },
  vk7: {
    name: 'VK-7 CARBINE', slot: 'primary', price: 2700, damage: 34, headMult: 4,
    rpm: 620, auto: true, mag: 30, reserve: 90, reload: 2.4, pellets: 1,
    spread: 0.004, spreadMove: 0.038, spreadAir: 0.11, bloom: 0.005,
    recoil: 0.013, falloffStart: 24, falloffEnd: 62, falloffMin: 0.72,
    moveFactor: 0.94, tracer: 0xfff1c4,
  },
  longshot: {
    name: 'LONGSHOT .50', slot: 'primary', price: 3600, damage: 97, headMult: 3,
    rpm: 42, auto: false, mag: 5, reserve: 15, reload: 3.1, pellets: 1,
    spread: 0.001, spreadMove: 0.09, spreadAir: 0.16, bloom: 0.0,
    recoil: 0.075, falloffStart: 40, falloffEnd: 110, falloffMin: 0.9,
    moveFactor: 0.88, tracer: 0xcfe8ff, bolt: true, scoped: true,
  },
};

export const GRENADES = {
  frag: { name: 'FRAG CHARGE', price: 300 },
  flash: { name: 'FLASH CHARGE', price: 200 },
  smoke: { name: 'SMOKE CHARGE', price: 300 },
};

export function makeWeapon(id) {
  const def = WEAPONS[id];
  return { id, def, mag: def.mag, reserve: def.reserve, nextShotAt: 0, reloadEnd: 0, bloom: 0 };
}

export function makeLoadout() {
  return { primary: null, secondary: makeWeapon('sidearm'), current: 'secondary' };
}

export function currentWeapon(actor) {
  const l = actor.loadout;
  if (!l) return null;
  return l.current === 'primary' ? l.primary : l.secondary;
}

// Spread in radians for this actor right now: base, plus moving, plus airborne,
// plus bloom from sustained fire; crouching and standing still cut it down.
export function currentSpread(actor, w) {
  const speed = Math.hypot(actor.vx, actor.vz);
  const speedT = Math.min(1, speed / 4.4);
  let s = w.def.spread + w.def.spreadMove * speedT * speedT + w.bloom;
  if (!actor.grounded) s += w.def.spreadAir;
  if (actor.crouching && actor.grounded) s *= 0.62;
  if (actor.scopedNow) s *= 0.25;
  return s;
}

function falloffMult(def, dist) {
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.falloffMin;
  const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 - (1 - def.falloffMin) * t;
}

// Ray vs one actor's hitboxes: head sphere above a body box. Returns {t, head}.
const _box = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, h: 0 };
function rayActor(ox, oy, oz, dx, dy, dz, a, maxDist) {
  const headY = a.crouching ? 1.06 : 1.58;
  const bodyTop = a.crouching ? 0.98 : 1.44;
  // head sphere
  const cx = a.x - ox;
  const cy = headY - oy;
  const cz = a.z - oz;
  const tca = cx * dx + cy * dy + cz * dz;
  let best = null;
  if (tca > 0) {
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    const r = 0.21;
    if (d2 < r * r) {
      const t = tca - Math.sqrt(r * r - d2);
      if (t > 0 && t < maxDist) best = { t, head: true };
    }
  }
  // body box (reuse the wall slab test by faking a wall entry)
  _box.minX = a.x - 0.34; _box.maxX = a.x + 0.34;
  _box.minZ = a.z - 0.34; _box.maxZ = a.z + 0.34;
  _box.h = bodyTop;
  const saved = rayWallsBox(_box, ox, oy, oz, dx, dy, dz, maxDist);
  if (saved !== null && (!best || saved < best.t)) best = { t: saved, head: false };
  return best;
}

// A single-box version of the slab test (mirrors collision.rayWalls for one box).
function rayWallsBox(w, ox, oy, oz, dx, dy, dz, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  if (Math.abs(dx) < 1e-9) { if (ox < w.minX || ox > w.maxX) return null; }
  else {
    let t1 = (w.minX - ox) / dx; let t2 = (w.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > w.h) return null; }
  else {
    let t1 = (0 - oy) / dy; let t2 = (w.h - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < w.minZ || oz > w.maxZ) return null; }
  else {
    let t1 = (w.minZ - oz) / dz; let t2 = (w.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

// Apply damage with the armour model; records the kill when the actor drops.
// Returns true when the target died.
export function applyDamage(target, rawDamage, head, attacker, weaponId) {
  if (!target.alive) return false;
  let dmg = rawDamage;
  if (head && target.helmet) dmg *= 0.55;
  if (target.armor > 0) {
    const absorbed = dmg * 0.5;
    target.armor = Math.max(0, target.armor - absorbed);
    dmg -= absorbed;
  }
  target.health -= dmg;
  target.lastDamageFrom = attacker;
  target.lastDamageAt = S.time;
  if (target.isPlayer) {
    S.shake = Math.min(0.5, S.shake + 0.12);
    const ang = Math.atan2(attacker.x - target.x, attacker.z - target.z);
    S.hitDirection = { angle: ang, until: S.time + 0.9 };
    sfx.hurt();
  }
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.deaths++;
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.money += 300;
    }
    S.killfeed.push({ attacker, victim: target, weapon: weaponId, headshot: head, at: S.time });
    if (S.killfeed.length > 5) S.killfeed.shift();
    return true;
  }
  return false;
}

// Fire one hitscan shot (one pellet). dir is a unit vector already spread.
// Returns { hitActor, head, dist, px, py, pz } describing the endpoint.
export function resolveShot(shooter, ox, oy, oz, dx, dy, dz, def) {
  const MAX = 220;
  const wall = rayWalls(ox, oy, oz, dx, dy, dz, MAX);
  const ground = rayGround(oy, dy, MAX);
  let limit = MAX;
  if (wall) limit = Math.min(limit, wall.t);
  if (ground !== null) limit = Math.min(limit, ground);
  let bestActor = null;
  let bestHit = null;
  for (const a of S.actors) {
    if (a === shooter || !a.alive) continue;
    const hit = rayActor(ox, oy, oz, dx, dy, dz, a, limit);
    if (hit && (!bestHit || hit.t < bestHit.t)) { bestHit = hit; bestActor = a; }
  }
  if (bestActor) {
    const dmg = def.damage * (bestHit.head ? def.headMult : 1) * falloffMult(def, bestHit.t);
    const died = applyDamage(bestActor, dmg, bestHit.head, shooter, def.id || 'vk7');
    return {
      hitActor: bestActor, head: bestHit.head, died, dist: bestHit.t,
      px: ox + dx * bestHit.t, py: oy + dy * bestHit.t, pz: oz + dz * bestHit.t,
    };
  }
  return {
    hitActor: null, head: false, died: false, dist: limit,
    px: ox + dx * limit, py: oy + dy * limit, pz: oz + dz * limit,
    nx: wall ? wall.nx : 0, ny: wall ? wall.ny : 1, nz: wall ? wall.nz : 0,
  };
}

// Try to fire the actor's current weapon once (rate, mag and reload enforced).
// dirFor(spread) must return a unit direction given a spread angle in radians.
// Returns 'fired' | 'dry' | 'busy'.
export function tryFire(actor, ox, oy, oz, dirFor) {
  const w = currentWeapon(actor);
  if (!w || w.reloadEnd > S.time) return 'busy';
  if (S.time < w.nextShotAt) return 'busy';
  if (w.mag <= 0) {
    w.nextShotAt = S.time + 0.3;
    if (actor.isPlayer) sfx.dry();
    return 'dry';
  }
  w.mag--;
  w.nextShotAt = S.time + 60 / w.def.rpm;
  w.bloom = Math.min(0.03, w.bloom + w.def.bloom);
  const spread = currentSpread(actor, w);
  let anyHit = false;
  let anyHead = false;
  let anyKill = false;
  for (let p = 0; p < w.def.pellets; p++) {
    const d = dirFor(spread);
    const res = resolveShot(actor, ox, oy, oz, d.x, d.y, d.z, { ...w.def, id: w.id });
    fx.tracer(ox, oy, oz, res.px, res.py, res.pz, w.def.tracer);
    if (res.hitActor) {
      anyHit = true;
      anyHead = anyHead || res.head;
      anyKill = anyKill || res.died;
      fx.bloodPuff(res.px, res.py, res.pz);
    } else {
      fx.impact(res.px, res.py, res.pz, res.nx || 0, res.ny || 1, res.nz || 0);
    }
  }
  fx.muzzle(ox, oy, oz, dirFor(0));
  const distToPlayer = actor.isPlayer ? 0 : Math.hypot(S.player.x - actor.x, S.player.z - actor.z);
  sfx.shot(w.def === WEAPONS.longshot ? 'sniper' : w.def === WEAPONS.mule ? 'shotgun' : w.def === WEAPONS.ripper ? 'smg' : w.def === WEAPONS.sidearm ? 'pistol' : 'rifle', actor.isPlayer ? 0 : distToPlayer);
  S.events.push({ type: 'shot', x: actor.x, z: actor.z, team: actor.team, at: S.time, loud: 34 });
  if (actor.isPlayer) {
    if (anyHit) {
      sfx.hit(anyHead);
      S.lastHitAt = S.time;
      S.lastHitHead = anyHead;
    }
    if (anyKill) sfx.kill();
    actor.recoilKick = (actor.recoilKick || 0) + w.def.recoil;
  }
  if (w.def.pump && actor.isPlayer) sfx.pump();
  if (w.def.bolt && actor.isPlayer) sfx.bolt();
  return 'fired';
}

export function startReload(actor) {
  const w = currentWeapon(actor);
  if (!w || w.reloadEnd > S.time || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloadEnd = S.time + w.def.reload;
  if (actor.isPlayer) sfx.reload();
  return true;
}

// Per-step weapon upkeep: finish reloads, decay bloom.
export function stepWeapons(dt) {
  for (const a of S.actors) {
    const w = currentWeapon(a);
    if (!w) continue;
    if (w.reloadEnd && S.time >= w.reloadEnd) {
      const take = Math.min(w.def.mag - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloadEnd = 0;
    }
    w.bloom = Math.max(0, w.bloom - dt * 0.028);
  }
}

// --- Grenades ---------------------------------------------------------------

export const projectiles = [];

export function throwGrenade(actor, kind, dx, dy, dz) {
  if (actor.grenades[kind] <= 0) return false;
  actor.grenades[kind]--;
  projectiles.push({
    kind, team: actor.team, owner: actor,
    x: actor.x + dx * 0.4, y: 1.5, z: actor.z + dz * 0.4,
    vx: dx * 13, vy: 4.6 + dy * 6, vz: dz * 13,
    fuse: kind === 'frag' ? 1.6 : 1.15,
    bounced: false,
  });
  fx.spawnGrenadeMesh(projectiles[projectiles.length - 1]);
  if (actor.isPlayer) sfx.throwIt();
  return true;
}

function detonate(p) {
  if (p.kind === 'frag') {
    sfx.fragBoom(p.owner.isPlayer ? 0 : Math.hypot(S.player.x - p.x, S.player.z - p.z));
    fx.explosion(p.x, p.y, p.z, 2.6);
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d > 4.6) continue;
      if (!losClear(p.x, Math.max(0.6, p.y), p.z, a.x, 1.0, a.z)) continue;
      const dmg = 92 * (1 - d / 5.2);
      if (dmg > 2) applyDamage(a, dmg, false, p.owner, 'frag');
    }
    if (Math.hypot(S.player.x - p.x, S.player.z - p.z) < 7) S.shake = Math.min(0.7, S.shake + 0.3);
  } else if (p.kind === 'flash') {
    sfx.flashPop(p.owner.isPlayer ? 0 : Math.hypot(S.player.x - p.x, S.player.z - p.z));
    fx.flashBurst(p.x, p.y, p.z);
    S.flashes.push({ x: p.x, z: p.z, at: S.time });
    for (const a of S.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d > 17) continue;
      if (!losClear(p.x, Math.max(0.8, p.y), p.z, a.x, a.crouching ? 1.06 : 1.58, a.z)) continue;
      // Facing matters: full effect looking at it, partial with your back turned.
      const fx2 = p.x - a.x;
      const fz2 = p.z - a.z;
      const facing = (fx2 * Math.sin(a.yaw) + fz2 * Math.cos(a.yaw)) / (d || 1);
      const strength = facing > 0.2 ? 1 : facing > -0.4 ? 0.45 : 0.15;
      const dur = (2.6 - d * 0.1) * strength;
      if (dur > 0.25) {
        a.flashUntil = Math.max(a.flashUntil, S.time + dur);
        if (a.isPlayer) fx.playerFlashed(dur);
      }
    }
  } else if (p.kind === 'smoke') {
    sfx.smokeHiss(p.owner.isPlayer ? 0 : Math.hypot(S.player.x - p.x, S.player.z - p.z));
    S.smokes.push({ x: p.x, z: p.z, r: 3.4, until: S.time + 13 });
    fx.smokeCloud(p.x, p.z, 3.4, 13);
  }
}

export function stepGrenades(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.fuse -= dt;
    p.vy -= 16 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    // bounce off walls (2D footprint test at low height) and the ground
    const wallHit = rayWalls(p.x - p.vx * dt, Math.max(0.2, p.y), p.z - p.vz * dt, Math.sign(p.vx) || 1, 0, 0, Math.abs(p.vx * dt) + 0.01);
    if (wallHit && Math.abs(p.vx) > 0.1) { p.vx *= -0.35; p.x += p.vx * dt; }
    if (p.y < 0.12) {
      p.y = 0.12;
      p.vy = Math.abs(p.vy) > 1.4 ? -p.vy * 0.38 : 0;
      p.vx *= 0.72;
      p.vz *= 0.72;
      if (p.kind === 'flash' || p.kind === 'smoke') p.fuse = Math.min(p.fuse, 0.08);
    }
    fx.moveGrenadeMesh(p);
    if (p.fuse <= 0) {
      detonate(p);
      fx.removeGrenadeMesh(p);
      projectiles.splice(i, 1);
    }
  }
}

// Line of sight that also respects smoke: bots and the flash logic use losClear
// for geometry; this adds smoke clouds on top for perception checks.
export function visionBlocked(x1, y1, z1, x2, y2, z2) {
  if (!losClear(x1, y1, z1, x2, y2, z2)) return true;
  for (const s of S.smokes) {
    if (S.time < s.until && segmentHitsCircle(x1, z1, x2, z2, s.x, s.z, s.r)) return true;
  }
  return false;
}
