// main.js — boot and the loop. The simulation runs on a fixed 60 Hz step from
// an accumulator, so gameplay is identical at any display rate; rendering,
// effects and the HUD run once per frame after the steps. Pointer lock is the
// match's pause switch: locked means playing, except the buy phase, which
// deliberately unlocks so the menu can be clicked — deploying re-locks.

import { S, PHASE } from './state.js';
import { createWorld, updateWorldVisuals } from './world.js';
import { attachInput, input } from './input.js';
import { initAudio } from './audio.js';
import { createPlayer, stepPlayer, syncCamera } from './player.js';
import { createBot, stepBots, syncBotMeshes } from './bots.js';
import { stepRounds, startMatch } from './rounds.js';
import { stepWeapons, stepGrenades } from './weapons.js';
import { initEffects, stepEffects } from './effects.js';
import { createHud, updateHud } from './hud.js';
import { isShotMode, stageShot, shotCamera } from './shotmode.js';
import * as THREE from 'three';

const STEP = 1 / 60;
const canvas = document.getElementById('game-canvas');
const { renderer, scene, camera } = createWorld(canvas);
initEffects(scene);
const player = createPlayer(camera, scene);
createBot('attack', scene);
createBot('attack', scene);
createBot('defend', scene);
createBot('defend', scene);
createBot('defend', scene);
createBot('defend', scene);

let stage = null;
if (isShotMode) {
  stage = stageShot();
  syncBotMeshes();
}

function startFromMenu() {
  initAudio();
  startMatch((Date.now() % 2147483647) >>> 0);
  if (!isShotMode) canvas.requestPointerLock();
}

createHud({ onPlay: startFromMenu });
attachInput(canvas, () => initAudio());

canvas.addEventListener('click', () => {
  if (isShotMode) return;
  const inMatch = S.phase === PHASE.LIVE || S.phase === PHASE.PLANTED || S.phase === PHASE.ROUND_END;
  if (inMatch && !input.locked && !S.spectate) canvas.requestPointerLock();
});

// The buy phase needs a cursor; the live phases need the lock. Follow the phase.
let wasBuying = false;
function followPhaseLock() {
  const buying = S.phase === PHASE.BUY;
  if (buying && !wasBuying && document.pointerLockElement) document.exitPointerLock();
  wasBuying = buying;
}
document.getElementById('deploy').addEventListener('click', () => {
  if (!isShotMode && (S.phase === PHASE.LIVE || S.phase === PHASE.BUY)) canvas.requestPointerLock();
});

// Spectate: after the player drops, the camera rides a living teammate.
const _spectatePos = new THREE.Vector3();
function spectateCamera(dt) {
  const mate = S.actors.find((a) => a.alive && a.team === player.team && !a.isPlayer) ||
    S.actors.find((a) => a.alive && !a.isPlayer);
  if (!mate) return false;
  const back = 4.2;
  const tx = mate.x - Math.sin(mate.yaw) * back;
  const tz = mate.z - Math.cos(mate.yaw) * back;
  _spectatePos.set(tx, 2.6, tz);
  camera.position.lerp(_spectatePos, Math.min(1, dt * 5));
  camera.lookAt(mate.x + Math.sin(mate.yaw) * 6, 1.3, mate.z + Math.cos(mate.yaw) * 6);
  if (camera.fov !== 74) {
    camera.fov = 74;
    camera.updateProjectionMatrix();
  }
  return true;
}

let last = performance.now();
let accumulator = 0;
let elapsed = 0;
const lockhint = document.getElementById('lockhint');

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  elapsed += dt;

  const simRunning = isShotMode
    ? false
    : input.locked || S.spectate || S.phase === PHASE.BUY || S.phase === PHASE.MENU ||
      S.phase === PHASE.MATCH_END || S.phase === PHASE.ROUND_END;
  if (simRunning && !isShotMode) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      S.time += STEP;
      stepRounds(STEP);
      stepPlayer(STEP);
      stepBots(STEP);
      stepWeapons(STEP);
      stepGrenades(STEP);
      S.events.length = 0;
      accumulator -= STEP;
      steps++;
    }
    if (steps === 5) accumulator = 0;
  }
  followPhaseLock();
  if (lockhint) {
    const needsAim = !isShotMode && !input.locked && !S.spectate &&
      (S.phase === PHASE.LIVE || S.phase === PHASE.PLANTED);
    lockhint.hidden = !needsAim;
  }

  // Camera: shot dolly, spectate ride, or the player's own eyes.
  if (isShotMode && stage && shotCamera(camera, stage, elapsed)) {
    // dolly set the camera
  } else if (S.spectate && S.phase !== PHASE.MENU) {
    if (!spectateCamera(dt)) syncCamera(dt);
  } else {
    syncCamera(dt);
  }

  updateWorldVisuals(scene, elapsed, dt);
  syncBotMeshes();
  stepEffects(dt);
  updateHud();
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
