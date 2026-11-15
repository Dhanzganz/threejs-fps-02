// state.js — the one place match state lives. Every module reads and writes the
// single object S; nothing keeps a private copy of score, timers or the charge,
// so the HUD, the round logic and the bots can never disagree about the game.
// Actors (the player and every bot) share one shape, made by makeActor, so the
// combat code in weapons.js treats a bot and the player exactly alike.

import { makeRng } from './rng.js';

export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  PLANTED: 'planted',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export const S = {
  phase: PHASE.MENU,
  time: 0,               // simulation clock, seconds; only advances in fixed steps
  rng: makeRng(20261115),
  round: 1,
  winsNeeded: 6,
  maxRounds: 11,
  score: { attack: 0, defend: 0 },
  phaseTimer: 0,         // counts down the buy and round-end phases
  roundTimer: 0,         // counts down a live round
  charge: null,          // { state, site, x, z, timer, channel, by }
  actors: [],            // every combatant, player first
  player: null,
  bots: [],
  events: [],            // transient happenings bots can hear: shots, steps, the plant
  killfeed: [],          // { attacker, victim, weapon, headshot, at }
  smokes: [],            // active smoke clouds { x, z, r, until }
  flashes: [],           // active flash fields { x, z, until } for bot vision
  winner: null,          // 'attack' | 'defend' once the match is decided
  roundWinner: null,
  roundEndReason: '',
  message: '',           // centre-screen line the HUD shows (round results, alerts)
  messageUntil: 0,
  shake: 0,              // camera shake impulse, decayed by the player controller
  hitDirection: null,    // { angle, until } — where the last damage came from
  spectate: false,       // player dead: watch the round play out
};

let nextActorId = 1;

export function makeActor(team, isPlayer) {
  return {
    id: nextActorId++,
    team,                       // 'attack' | 'defend'
    isPlayer: !!isPlayer,
    alive: true,
    health: 100,
    armor: 0,                   // 0..100, soaks half of bullet damage while it lasts
    helmet: false,
    x: 0, z: 0, y: 0,           // feet position; y is eye height offset (crouch)
    vx: 0, vz: 0,
    yaw: 0, pitch: 0,           // facing, radians
    radius: 0.35,
    eyeHeight: 1.62,
    crouching: false,
    money: 800,
    weapon: null,               // current weapon instance (weapons.js makeLoadout)
    loadout: null,
    grenades: { frag: 0, flash: 0, smoke: 0 },
    kills: 0, deaths: 0,
    lastDamageFrom: null,
    lastDamageAt: -99,
    flashUntil: 0,              // blinded by a flash charge until this time
    speedSeen: 0,               // speed at last perception tick (bots read this)
  };
}

export function aliveActors(team) {
  return S.actors.filter((a) => a.alive && (team === undefined || a.team === team));
}

export function resetMatch(seed) {
  S.rng = makeRng(seed);
  S.round = 1;
  S.score.attack = 0;
  S.score.defend = 0;
  S.winner = null;
  S.killfeed.length = 0;
  S.events.length = 0;
  S.smokes.length = 0;
  S.flashes.length = 0;
  S.charge = null;
  S.spectate = false;
  nextActorId = 1;
}

export function resetRoundState() {
  S.events.length = 0;
  S.smokes.length = 0;
  S.flashes.length = 0;
  S.charge = { state: 'carried', site: null, x: 0, z: 0, timer: 0, channel: 0, by: null };
  S.roundWinner = null;
  S.roundEndReason = '';
  S.spectate = false;
  S.hitDirection = null;
}
