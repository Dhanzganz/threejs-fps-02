// player.js — the human's body and camera. Movement is acceleration-based with
// ground friction and weak air control, so stopping is fast and aiming while
// strafing is not; crouching trades speed for a smaller, steadier profile.
// Recoil is a pitch offset the weapon adds to and this controller recovers
// from, which is what makes bursting beat spraying. The viewmodel — an
// original low-poly build per weapon — bobs, sways, dips on reload and hides
// when the Longshot's scope comes up.

import * as THREE from 'three';
import { S, PHASE, makeActor } from './state.js';
import { input, keyDown, takeMouse, takeClick, takeWheel } from './input.js';
import { slideMove } from './collision.js';
import { WEAPONS, currentWeapon, tryFire, startReload, throwGrenade } from './weapons.js';
import { sfx } from './audio.js';

const BASE_SPEED = 5.3;
const CROUCH_SPEED = 2.4;
const WALK_SPEED = 3.0;
const GRAVITY = 18;
const JUMP_VEL = 6.4;

let camera = null;
let viewGroup = null;
let viewModels = {};
let grenadeModel = null;
let stepCycle = 0;
let lastStepAt = 0;
let eyeSmooth = 1.62;
let fovSmooth = 74;
let swayX = 0;
let swayY = 0;

const VM_MATS = {
  body: new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.55, metalness: 0.55 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.85, metalness: 0.1 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xc9862b, roughness: 0.5, metalness: 0.3 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x2e7f86, roughness: 0.2, metalness: 0.4 }),
};

function vmBox(w, h, d, x, y, z, mat = VM_MATS.body) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function buildViewModels() {
  viewModels = {};
  // P9 sidearm: compact pistol.
  {
    const g = new THREE.Group();
    g.add(vmBox(0.07, 0.11, 0.24, 0, 0, -0.1));
    g.add(vmBox(0.06, 0.09, 0.1, 0, -0.09, -0.02, VM_MATS.grip));
    g.add(vmBox(0.02, 0.03, 0.02, 0, 0.07, -0.2, VM_MATS.accent));
    viewModels.sidearm = g;
  }
  // Ripper-9: short SMG with a fat suppressor.
  {
    const g = new THREE.Group();
    g.add(vmBox(0.08, 0.12, 0.4, 0, 0, -0.16));
    g.add(vmBox(0.09, 0.09, 0.2, 0, 0.01, -0.44, VM_MATS.grip));
    g.add(vmBox(0.05, 0.16, 0.07, 0, -0.13, -0.1, VM_MATS.grip));
    g.add(vmBox(0.07, 0.07, 0.14, 0, 0.03, 0.1, VM_MATS.grip));
    viewModels.ripper = g;
  }
  // Mule 12G: long pump shotgun.
  {
    const g = new THREE.Group();
    g.add(vmBox(0.08, 0.1, 0.62, 0, 0, -0.26));
    g.add(vmBox(0.07, 0.06, 0.2, 0, -0.06, -0.3, VM_MATS.accent));
    g.add(vmBox(0.09, 0.11, 0.16, 0, -0.02, 0.08, VM_MATS.grip));
    viewModels.mule = g;
  }
  // VK-7 carbine: the standard rifle.
  {
    const g = new THREE.Group();
    g.add(vmBox(0.08, 0.11, 0.52, 0, 0, -0.22));
    g.add(vmBox(0.05, 0.05, 0.3, 0, 0.01, -0.55, VM_MATS.grip));
    g.add(vmBox(0.05, 0.15, 0.08, 0, -0.13, -0.14, VM_MATS.grip));
    g.add(vmBox(0.06, 0.09, 0.1, 0, -0.08, 0.02, VM_MATS.grip));
    g.add(vmBox(0.07, 0.08, 0.16, 0, 0.02, 0.16, VM_MATS.grip));
    g.add(vmBox(0.03, 0.05, 0.1, 0, 0.1, -0.2, VM_MATS.accent));
    viewModels.vk7 = g;
  }
  // Longshot .50: heavy bolt rifle with a scope tube.
  {
    const g = new THREE.Group();
    g.add(vmBox(0.09, 0.12, 0.7, 0, 0, -0.3));
    g.add(vmBox(0.05, 0.05, 0.34, 0, 0.02, -0.72, VM_MATS.grip));
    g.add(vmBox(0.06, 0.16, 0.09, 0, -0.14, -0.16, VM_MATS.grip));
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10), VM_MATS.grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.11, -0.24);
    g.add(scope);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.012, 10), VM_MATS.lens);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.11, -0.37);
    g.add(lens);
    viewModels.longshot = g;
  }
  grenadeModel = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a5238, roughness: 0.6 }),
  );
  grenadeModel.position.set(0, -0.02, -0.14);
}

export function createPlayer(cam, scene) {
  camera = cam;
  const actor = makeActor('attack', true);
  actor.grounded = true;
  actor.vy = 0;
  actor.recoilPitch = 0;
  actor.grenadeInHand = false;
  actor.grenadeKind = 'frag';
  S.player = actor;
  S.actors.push(actor);

  buildViewModels();
  viewGroup = new THREE.Group();
  for (const id of Object.keys(viewModels)) {
    viewModels[id].visible = false;
    viewGroup.add(viewModels[id]);
  }
  grenadeModel.visible = false;
  viewGroup.add(grenadeModel);
  viewGroup.position.set(0.27, -0.25, -0.45);
  camera.add(viewGroup);
  scene.add(camera);
  return actor;
}

export function syncViewmodel(actor) {
  if (!viewGroup) return;
  const w = currentWeapon(actor);
  for (const id of Object.keys(viewModels)) viewModels[id].visible = !!w && w.id === id && !actor.grenadeInHand;
  grenadeModel.visible = !!actor.grenadeInHand;
  if (viewModels[w?.id]) viewModels[w.id].visible = viewModels[w.id].visible && !actor.scopedNow;
}

function forwardOf(actor) {
  return { x: Math.sin(actor.yaw), z: Math.cos(actor.yaw) };
}

// A shot direction for the player: camera forward with a random cone offset.
function playerDir(actor) {
  const pitch = actor.pitch + (actor.recoilPitch || 0);
  return (spread) => {
    const rng = S.rng;
    const a = rng() * Math.PI * 2;
    const r = spread * Math.sqrt(rng());
    const cp = Math.cos(pitch);
    const fx = Math.sin(actor.yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = Math.cos(actor.yaw) * cp;
    // right and up vectors for the cone offset
    const rx = Math.cos(actor.yaw);
    const rz = -Math.sin(actor.yaw);
    const ux = -Math.sin(actor.yaw) * Math.sin(pitch);
    const uy = Math.cos(pitch);
    const uz = -Math.cos(actor.yaw) * Math.sin(pitch);
    const ox = Math.cos(a) * r;
    const oy = Math.sin(a) * r;
    let dx = fx + rx * ox + ux * oy;
    let dy = fy + uy * oy;
    let dz = fz + rz * ox + uz * oy;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  };
}

export function stepPlayer(dt) {
  const a = S.player;
  if (!a) return;
  const m = takeMouse();
  const sens = a.scopedNow ? 0.0011 : 0.0023;
  a.yaw -= m.dx * sens;
  a.pitch -= m.dy * sens;
  a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch));
  swayX = Math.max(-0.03, Math.min(0.03, swayX - m.dx * 0.00004));
  swayY = Math.max(-0.03, Math.min(0.03, swayY + m.dy * 0.00004));

  // Recoil recovery: the kick the weapon added bleeds off, faster when still.
  a.recoilPitch = Math.max(0, (a.recoilPitch || 0) - dt * 0.085);

  const canAct = a.alive && (S.phase === PHASE.LIVE || S.phase === PHASE.PLANTED);
  const canMove = canAct && !a.channeling;

  a.crouching = keyDown('ControlLeft') || keyDown('ControlRight') || keyDown('KeyC');
  const walking = keyDown('ShiftLeft') || keyDown('ShiftRight');
  const w = currentWeapon(a);
  let speed = BASE_SPEED * (w ? w.def.moveFactor : 1);
  if (a.crouching) speed = CROUCH_SPEED;
  else if (walking) speed = WALK_SPEED;

  const f = forwardOf(a);
  let wx = 0;
  let wz = 0;
  if (canMove) {
    if (keyDown('KeyW')) { wx += f.x; wz += f.z; }
    if (keyDown('KeyS')) { wx -= f.x; wz -= f.z; }
    if (keyDown('KeyA')) { wx += f.z; wz -= f.x; }
    if (keyDown('KeyD')) { wx -= f.z; wz += f.x; }
  }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const accel = a.grounded ? 42 : 5;
  a.vx += (wx * speed - a.vx) * Math.min(1, accel * dt / Math.max(1, speed));
  a.vz += (wz * speed - a.vz) * Math.min(1, accel * dt / Math.max(1, speed));
  if (wl === 0 && a.grounded) {
    const fr = Math.max(0, 1 - 11 * dt);
    a.vx *= fr;
    a.vz *= fr;
  }

  // Jump and gravity.
  if (canMove && a.grounded && keyDown('Space')) {
    a.vy = JUMP_VEL;
    a.grounded = false;
  }
  a.vy -= GRAVITY * dt;
  a.y = (a.y || 0) + a.vy * dt;
  if (a.y <= 0) {
    a.y = 0;
    a.vy = 0;
    a.grounded = true;
  }

  slideMove(a, a.vx * dt, a.vz * dt, a.radius);

  // Footsteps: noise the bots can hear, quieter walking, silent crouched.
  const planar = Math.hypot(a.vx, a.vz);
  if (a.grounded && planar > 0.6 && canMove) {
    stepCycle += planar * dt;
    if (stepCycle > 2.3) {
      stepCycle = 0;
      lastStepAt = S.time;
      const loud = a.crouching ? 0 : walking ? 6 : 13;
      if (loud > 0) S.events.push({ type: 'step', x: a.x, z: a.z, team: a.team, at: S.time, loud });
      sfx.step(0);
    }
  }

  // Weapon handling.
  a.scopedNow = false;
  if (canAct) {
    if (keyDown('Digit1') && a.loadout.primary) selectWeapon(a, 'primary');
    if (keyDown('Digit2')) selectWeapon(a, 'secondary');
    if (keyDown('Digit4')) toggleGrenade(a);
    const wheel = takeWheel();
    if (wheel !== 0 && a.loadout.primary) selectWeapon(a, a.loadout.current === 'primary' ? 'secondary' : 'primary');
    if (keyDown('KeyR')) startReload(a);
    if (keyDown('KeyQ') && a.grenadeInHand) cycleGrenade(a);

    const cw = currentWeapon(a);
    if (cw && cw.def.scoped && input.aiming && !a.grenadeInHand) {
      if (!a.wasAiming) sfx.scope();
      a.scopedNow = true;
    }
    a.wasAiming = input.aiming;

    const clicked = takeClick();
    if (a.grenadeInHand) {
      if (clicked) {
        const dir = playerDir(a)(0.12);
        if (throwGrenade(a, a.grenadeKind, dir.x, dir.y, dir.z)) {
          a.grenadeInHand = false;
          syncViewmodel(a);
        }
      }
    } else if (cw) {
      const trigger = cw.def.auto ? input.firing : clicked;
      if (trigger && !a.channeling) {
        const eye = eyePos(a);
        tryFire(a, eye.x, eye.y, eye.z, playerDir(a));
      }
    }
  } else {
    takeClick();
    takeWheel();
  }
  syncViewmodel(a);
}

function selectWeapon(a, slot) {
  if (a.loadout.current === slot) return;
  a.loadout.current = slot;
  a.grenadeInHand = false;
  const w = currentWeapon(a);
  if (w) w.nextShotAt = Math.max(w.nextShotAt, S.time + 0.28);
  syncViewmodel(a);
}

function toggleGrenade(a) {
  if (a.grenadeInHand) {
    a.grenadeInHand = false;
  } else {
    const kind = ['frag', 'flash', 'smoke'].find((k) => a.grenades[k] > 0);
    if (!kind) return;
    a.grenadeKind = kind;
    a.grenadeInHand = true;
  }
  syncViewmodel(a);
}

function cycleGrenade(a) {
  const kinds = ['frag', 'flash', 'smoke'];
  let i = kinds.indexOf(a.grenadeKind);
  for (let n = 0; n < 3; n++) {
    i = (i + 1) % 3;
    if (a.grenades[kinds[i]] > 0) {
      a.grenadeKind = kinds[i];
      return;
    }
  }
}

export function eyePos(a) {
  const target = a.crouching ? 1.14 : 1.62;
  eyeSmooth += (target - eyeSmooth) * 0.35;
  return { x: a.x, y: (a.y || 0) + eyeSmooth, z: a.z };
}

// Render-side camera placement, called once per frame after the fixed steps.
export function syncCamera(dt) {
  const a = S.player;
  if (!a || !camera) return;
  const eye = eyePos(a);
  S.shake = Math.max(0, S.shake - dt * 1.8);
  const shX = (Math.random() - 0.5) * S.shake * 0.05;
  const shY = (Math.random() - 0.5) * S.shake * 0.05;
  const planar = Math.hypot(a.vx, a.vz);
  const bobY = a.grounded && planar > 0.5 ? Math.sin(S.time * 9.2) * 0.028 * Math.min(1, planar / 5) : 0;
  camera.position.set(eye.x + shX, eye.y + bobY + shY, eye.z);
  const pitch = a.pitch + (a.recoilPitch || 0);
  camera.rotation.order = 'YXZ';
  // Our yaw measures forward as (sin yaw, cos yaw); three's camera faces -z,
  // so its Y rotation is our yaw plus a half turn. Pitch carries over directly.
  camera.rotation.y = a.yaw + Math.PI;
  camera.rotation.x = pitch;
  camera.rotation.z = shX * 0.4;

  const targetFov = a.scopedNow ? 26 : 74;
  fovSmooth += (targetFov - fovSmooth) * Math.min(1, dt * 11);
  if (Math.abs(camera.fov - fovSmooth) > 0.05) {
    camera.fov = fovSmooth;
    camera.updateProjectionMatrix();
  }

  // Viewmodel life: bob, sway recovery, reload dip.
  if (viewGroup) {
    swayX *= Math.max(0, 1 - dt * 9);
    swayY *= Math.max(0, 1 - dt * 9);
    const bobX = a.grounded && planar > 0.5 ? Math.sin(S.time * 9.2) * 0.008 : 0;
    const bobYn = a.grounded && planar > 0.5 ? -Math.abs(Math.cos(S.time * 9.2)) * 0.008 : 0;
    const w = currentWeapon(a);
    const reloadDip = w && w.reloadEnd > S.time ? -0.16 : 0;
    viewGroup.position.set(0.27 + swayX + bobX, -0.25 + swayY + bobYn + reloadDip, -0.45);
    viewGroup.rotation.set(reloadDip * 1.4 + (a.recoilPitch || 0) * 0.7, swayX * 1.6, 0);
    viewGroup.visible = a.alive && !a.scopedNow;
  }
}
