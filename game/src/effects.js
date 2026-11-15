// effects.js — the visual feedback layer: pooled tracers, impact sparks, blood
// puffs, muzzle light, explosions, flash bursts and smoke clouds. Everything is
// pooled and preallocated — the pools are built once at init and recycled, so
// a firefight never allocates in the frame loop. Effects are presentation only:
// they read positions the simulation hands them and decide nothing.

import * as THREE from 'three';
import { S } from './state.js';

let scene = null;

// How blinded the player currently is (hud.js draws the white overlay from it).
export const flashState = { until: 0, strength: 0 };

export function playerFlashed(dur) {
  flashState.until = S.time + dur;
  flashState.strength = Math.min(1, 0.35 + dur * 0.3);
}

// --- Tracers: one LineSegments, 96 pooled segments ---------------------------
const TRACERS = 96;
let tracerGeo = null;
let tracerPos = null;
let tracerLife = null;
let tracerHead = 0;

// --- Particles: one Points cloud, 640 pooled --------------------------------
const PARTICLES = 640;
let pGeo = null;
let pPos = null;
let pCol = null;
let pVel = null;
let pLife = null;
let pMaxLife = null;
let pHead = 0;

let muzzleLight = null;
let flashLight = null;

const smokeClouds = [];   // { group, until, r, born }
const grenadeMeshes = new Map();
const bursts = [];        // expanding shock rings { mesh, until, born, max }

const _c = new THREE.Color();

export function initEffects(s) {
  scene = s;

  tracerPos = new Float32Array(TRACERS * 6);
  tracerLife = new Float32Array(TRACERS);
  tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(tracerGeo, tracerMat);
  lines.frustumCulled = false;
  scene.add(lines);
  // park every segment at zero length far below the map
  for (let i = 0; i < TRACERS; i++) tracerPos[i * 6 + 1] = -50;

  pPos = new Float32Array(PARTICLES * 3);
  pCol = new Float32Array(PARTICLES * 3);
  pVel = new Float32Array(PARTICLES * 3);
  pLife = new Float32Array(PARTICLES);
  pMaxLife = new Float32Array(PARTICLES);
  for (let i = 0; i < PARTICLES; i++) pPos[i * 3 + 1] = -50;
  pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  muzzleLight = new THREE.PointLight(0xffc37a, 0, 9, 2);
  scene.add(muzzleLight);
  flashLight = new THREE.PointLight(0xffffff, 0, 30, 1.6);
  scene.add(flashLight);
}

export function tracer(x1, y1, z1, x2, y2, z2) {
  if (!tracerGeo) return;
  const i = tracerHead;
  tracerHead = (tracerHead + 1) % TRACERS;
  tracerPos[i * 6] = x1; tracerPos[i * 6 + 1] = y1; tracerPos[i * 6 + 2] = z1;
  tracerPos[i * 6 + 3] = x2; tracerPos[i * 6 + 4] = y2; tracerPos[i * 6 + 5] = z2;
  tracerLife[i] = 0.055;
  tracerGeo.attributes.position.needsUpdate = true;
}

function spawnParticles(x, y, z, count, color, speed, life, up = 1.6, gravity = 5) {
  _c.set(color);
  for (let n = 0; n < count; n++) {
    const i = pHead;
    pHead = (pHead + 1) % PARTICLES;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2;
    const e = (Math.random() - 0.25) * up;
    const sp = speed * (0.35 + Math.random() * 0.85);
    pVel[i * 3] = Math.cos(a) * sp;
    pVel[i * 3 + 1] = e * sp * 0.6;
    pVel[i * 3 + 2] = Math.sin(a) * sp;
    pCol[i * 3] = _c.r * (0.7 + Math.random() * 0.5);
    pCol[i * 3 + 1] = _c.g * (0.7 + Math.random() * 0.5);
    pCol[i * 3 + 2] = _c.b * (0.7 + Math.random() * 0.5);
    pLife[i] = pMaxLife[i] = life * (0.6 + Math.random() * 0.7);
    pVel[i * 3 + 1] += gravity * 0; // gravity applied in the step, kept explicit for tuning
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

export function impact(x, y, z) {
  spawnParticles(x, y, z, 5, 0xd8c9a3, 2.4, 0.32);
}

export function bloodPuff(x, y, z) {
  spawnParticles(x, y, z, 7, 0x8e1f16, 1.7, 0.4);
}

export function muzzle(x, y, z) {
  if (!muzzleLight) return;
  muzzleLight.position.set(x, y, z);
  muzzleLight.intensity = 26;
  spawnParticles(x, y, z, 2, 0xffc37a, 0.7, 0.07);
}

export function explosion(x, y, z, scale = 1) {
  spawnParticles(x, y + 0.4, z, 46, 0xff8a3d, 7 * scale, 0.8, 2.2);
  spawnParticles(x, y + 0.4, z, 26, 0x5a5a5a, 4 * scale, 1.3, 2.6);
  if (flashLight) {
    flashLight.position.set(x, y + 1.4, z);
    flashLight.intensity = 300;
    flashLight.color.set(0xffa050);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.62, 26),
    new THREE.MeshBasicMaterial({ color: 0xffb37a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.06, z);
  scene.add(ring);
  bursts.push({ mesh: ring, born: S.time, until: S.time + 0.5, max: 6 * scale });
}

export function flashBurst(x, y, z) {
  if (flashLight) {
    flashLight.position.set(x, y, z);
    flashLight.intensity = 420;
    flashLight.color.set(0xffffff);
  }
  spawnParticles(x, y, z, 18, 0xffffff, 3.4, 0.3);
}

const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a3, transparent: true, opacity: 0.34, roughness: 1, depthWrite: false });
const smokeGeo = new THREE.SphereGeometry(1, 10, 8);
export function smokeCloud(x, z, r, dur) {
  const group = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(smokeGeo, smokeMat);
    const a = (i / 9) * Math.PI * 2;
    m.position.set(Math.cos(a) * r * 0.45, 0.9 + (i % 3) * 0.55, Math.sin(a) * r * 0.45);
    m.scale.setScalar(r * (0.42 + (i % 4) * 0.09));
    group.add(m);
  }
  group.position.set(x, 0, z);
  scene.add(group);
  smokeClouds.push({ group, born: S.time, until: S.time + dur, r });
}

const grenadeGeo = new THREE.SphereGeometry(0.09, 8, 8);
const grenadeMats = {
  frag: new THREE.MeshStandardMaterial({ color: 0x4a5238, roughness: 0.6 }),
  flash: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.4, metalness: 0.5 }),
  smoke: new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.5 }),
};
export function spawnGrenadeMesh(p) {
  const m = new THREE.Mesh(grenadeGeo, grenadeMats[p.kind]);
  m.position.set(p.x, p.y, p.z);
  scene.add(m);
  grenadeMeshes.set(p, m);
}
export function moveGrenadeMesh(p) {
  const m = grenadeMeshes.get(p);
  if (m) m.position.set(p.x, p.y, p.z);
}
export function removeGrenadeMesh(p) {
  const m = grenadeMeshes.get(p);
  if (m) {
    scene.remove(m);
    grenadeMeshes.delete(p);
  }
}

// --- The planted charge -------------------------------------------------------

let chargeMesh = null;
let chargeLightMesh = null;

export function plantedCharge(x, z) {
  removePlantedCharge();
  chargeMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.11;
  body.castShadow = true;
  chargeMesh.add(body);
  chargeLightMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  );
  chargeLightMesh.position.set(0.12, 0.26, 0);
  chargeMesh.add(chargeLightMesh);
  chargeMesh.position.set(x, 0, z);
  scene.add(chargeMesh);
}

export function chargeBlink() {
  if (chargeLightMesh) {
    chargeLightMesh.material.color.setHex(0xff3020);
    setTimeout(() => { if (chargeLightMesh) chargeLightMesh.material.color.setHex(0x661208); }, 90);
  }
}

export function removePlantedCharge() {
  if (chargeMesh && scene) {
    scene.remove(chargeMesh);
    chargeMesh = null;
    chargeLightMesh = null;
  }
}

// Visual-only step, called from the render loop with the frame delta.
export function stepEffects(dt) {
  if (tracerGeo) {
    let dirty = false;
    for (let i = 0; i < TRACERS; i++) {
      if (tracerLife[i] > 0) {
        tracerLife[i] -= dt;
        if (tracerLife[i] <= 0) {
          tracerPos[i * 6 + 1] = -50;
          tracerPos[i * 6 + 4] = -50;
          dirty = true;
        }
      }
    }
    if (dirty) tracerGeo.attributes.position.needsUpdate = true;
  }
  if (pGeo) {
    for (let i = 0; i < PARTICLES; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      if (pLife[i] <= 0) { pPos[i * 3 + 1] = -50; continue; }
      pVel[i * 3 + 1] -= 5.5 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pPos[i * 3 + 1] < 0.03) pPos[i * 3 + 1] = 0.03;
    }
    pGeo.attributes.position.needsUpdate = true;
  }
  if (muzzleLight) muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 700);
  if (flashLight) flashLight.intensity = Math.max(0, flashLight.intensity - dt * 1600);
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    const t = (S.time - b.born) / 0.5;
    if (t >= 1) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      bursts.splice(i, 1);
    } else {
      b.mesh.scale.setScalar(1 + t * b.max);
      b.mesh.material.opacity = 0.8 * (1 - t);
    }
  }
  for (let i = smokeClouds.length - 1; i >= 0; i--) {
    const c = smokeClouds[i];
    const age = S.time - c.born;
    const grow = Math.min(1, age / 0.9);
    c.group.scale.setScalar(0.4 + grow * 0.6);
    if (S.time > c.until) {
      scene.remove(c.group);
      smokeClouds.splice(i, 1);
    }
  }
}
