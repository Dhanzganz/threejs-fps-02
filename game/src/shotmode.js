// shotmode.js — staged, deterministic scenes for the entry's screenshots.
// When the game is opened with ?shot=start|play|buy|end&seed=N it does not wait
// for a player: it deals the actors into a composed scene for that moment of a
// match, sets the HUD state a real match would have, and lets the render loop
// draw it. The screenshots are renders of this code running, taken by the
// maker's own capture script — nothing is painted or composited afterwards.

import { S, PHASE, resetMatch } from './state.js';
import { makeLoadout, makeWeapon } from './weapons.js';
import { TEAM } from './palette.js';

const params = new URLSearchParams(window.location.search);
export const shotKind = params.get('shot');
export const isShotMode = shotKind !== null;
export const shotSeed = parseInt(params.get('seed') || '1', 10) || 1;

function pose(actor, x, z, yaw, opts = {}) {
  actor.x = x;
  actor.z = z;
  actor.yaw = yaw;
  actor.pitch = opts.pitch || 0;
  actor.vx = 0;
  actor.vz = 0;
  actor.crouching = !!opts.crouch;
  actor.alive = opts.dead ? false : true;
  if (opts.health !== undefined) actor.health = opts.health;
  if (opts.armor !== undefined) actor.armor = opts.armor;
  if (opts.weapon) {
    actor.loadout = makeLoadout();
    actor.loadout.primary = makeWeapon(opts.weapon);
    actor.loadout.current = 'primary';
    if (opts.mag !== undefined) actor.loadout.primary.mag = opts.mag;
    if (opts.reserve !== undefined) actor.loadout.primary.reserve = opts.reserve;
  }
}

export function stageShot() {
  resetMatch(shotSeed);
  const p = S.player;
  const atk = S.bots.filter((b) => b.team === 'attack');
  const def = S.bots.filter((b) => b.team === 'defend');
  for (const a of S.actors) {
    a.loadout = makeLoadout();
    a.money = 800;
  }
  S.round = 4;

  if (shotKind === 'start') {
    S.phase = PHASE.MENU;
    S.round = 1;
    pose(p, 0, 30, Math.PI * 0.92);
    pose(atk[0], -6, 26, Math.PI, { weapon: 'vk7' });
    pose(atk[1], 7, 24, Math.PI * 1.05, { weapon: 'ripper' });
    pose(def[0], -26, -19, 0.4, { weapon: 'vk7' });
    pose(def[1], 26, -19, -0.4, { weapon: 'vk7' });
    pose(def[2], -17, -32, 1.2, { weapon: 'ripper' });
    pose(def[3], 17, -32, -1.2, { weapon: 'mule' });
    return { camPos: [7, 3.0, 37], camLook: [-18, 1.2, -22] };
  }

  if (shotKind === 'play') {
    S.phase = PHASE.LIVE;
    S.roundTimer = 47;
    S.score.attack = 2;
    S.score.defend = 1;
    S.charge = { state: 'carried', site: null, x: 0, z: 0, timer: 0, channel: 0, by: null };
    pose(p, -24, 9, Math.PI * 1.02, { weapon: 'vk7', mag: 24, reserve: 90, health: 78, armor: 64 });
    p.helmet = true;
    p.money = 1150;
    p.grenades = { frag: 1, flash: 1, smoke: 0 };
    pose(atk[0], -29, 13, Math.PI * 0.9, { weapon: 'ripper' });
    pose(atk[1], 20, 20, Math.PI, { weapon: 'vk7', dead: true });
    pose(def[0], -23.5, -11, 0.15, { weapon: 'vk7' });        // in the player's sights at the A door
    pose(def[1], 26, -19, -0.4, { weapon: 'vk7' });
    pose(def[2], -36, -26, 2.4, { weapon: 'ripper', crouch: true });
    pose(def[3], 4, -24, 3.1, { weapon: 'mule', dead: true });
    S.killfeed = [
      { attacker: atk[0], victim: def[3], weapon: 'ripper', headshot: false, at: S.time },
      { attacker: def[1], victim: atk[1], weapon: 'vk7', headshot: true, at: S.time },
    ];
    return { camPos: null, camLook: null }; // the player's own eyes
  }

  if (shotKind === 'buy') {
    S.phase = PHASE.BUY;
    S.phaseTimer = 9;
    S.score.attack = 2;
    S.score.defend = 2;
    pose(p, 0, 46, Math.PI, { weapon: 'vk7' });
    p.money = 4150;
    p.armor = 100;
    p.helmet = true;
    p.grenades = { frag: 1, flash: 0, smoke: 0 };
    pose(atk[0], -5, 45, Math.PI, { weapon: 'ripper' });
    pose(atk[1], 5, 45, Math.PI, { weapon: 'sidearm' });
    pose(def[0], -20, -47.5, 0, { weapon: 'vk7' });
    pose(def[1], 20, -47.5, 0, { weapon: 'vk7' });
    pose(def[2], -3, -48, 0, { weapon: 'ripper' });
    pose(def[3], 3, -48, 0, { weapon: 'sidearm' });
    return { camPos: [-4.5, 2.6, 39], camLook: [0, 1.4, 20] };
  }

  // end: the round is won, banner up, the site held.
  S.phase = PHASE.ROUND_END;
  S.phaseTimer = 5;
  S.score.attack = 5;
  S.score.defend = 3;
  S.round = 8;
  S.message = 'WARDENS TAKE THE ROUND — DETONATION';
  S.messageUntil = 1e9;
  pose(p, -23, -17, 3.7, { weapon: 'vk7', mag: 17, reserve: 60, health: 52, armor: 30 });
  p.money = 6300;
  pose(atk[0], -33, -27, 2.8, { weapon: 'vk7' });
  pose(atk[1], -20, -19, Math.PI, { weapon: 'ripper', dead: true });
  pose(def[0], -24, -30, 0, { weapon: 'vk7', dead: true });
  pose(def[1], 26, -19, 0, { weapon: 'vk7', dead: true });
  pose(def[2], -38, -40, 0, { weapon: 'ripper', dead: true });
  pose(def[3], 17, -32, 0, { weapon: 'mule', dead: true });
  return { camPos: null, camLook: null };
}

// In shot mode the camera for menu/buy scenes is a slow dolly; play and end use
// the player's own view through the normal camera path.
export function shotCamera(camera, stage, t) {
  if (!stage || !stage.camPos) return false;
  const drift = Math.sin(t * 0.11) * 1.6;
  camera.position.set(stage.camPos[0] + drift, stage.camPos[1], stage.camPos[2]);
  camera.lookAt(stage.camLook[0], stage.camLook[1], stage.camLook[2]);
  return true;
}

export { TEAM };
