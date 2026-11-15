// rounds.js — the match itself: a first-to-6 of at most 11 rounds, each round a
// buy phase, a live phase and, when the charge goes down, a planted phase with
// a defuse race. This module owns the phase machine, the economy (round
// awards, loss streaks, the plant bonus), the buy rules the HUD menu calls,
// respawns, and the win checks. Bots get their plans here: defenders to their
// posts, attackers down two lanes to the called site.

import { S, PHASE, resetMatch, resetRoundState } from './state.js';
import { SPAWNS, PLACES, siteAt } from './map.js';
import { WEAPONS, GRENADES, makeLoadout, makeWeapon, projectiles } from './weapons.js';
import { assignPlans, assignDefenders } from './bots.js';
import { keyDown } from './input.js';
import { sfx } from './audio.js';
import * as fx from './effects.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
export const DETONATE_TIME = 35;
export const END_TIME = 5.5;

const AWARD = { win: 3250, winDetonation: 3500, loss: 1400, lossStep: 250, lossMax: 1000 };

let lossStreak = { attack: 0, defend: 0 };
let beepAt = 0;

export const BUY_CATALOG = [
  { id: 'ripper', kind: 'weapon' },
  { id: 'mule', kind: 'weapon' },
  { id: 'vk7', kind: 'weapon' },
  { id: 'longshot', kind: 'weapon' },
  { id: 'armor', kind: 'armor', name: 'KEVLAR VEST', price: 650 },
  { id: 'helmet', kind: 'helmet', name: 'HELMET', price: 350 },
  { id: 'frag', kind: 'grenade' },
  { id: 'flash', kind: 'grenade' },
  { id: 'smoke', kind: 'grenade' },
];

const GRENADE_CAPS = { frag: 1, flash: 2, smoke: 1 };

export function itemPrice(item) {
  if (item.kind === 'weapon') return WEAPONS[item.id].price;
  if (item.kind === 'grenade') return GRENADES[item.id].price;
  return item.price;
}

export function itemName(item) {
  if (item.kind === 'weapon') return WEAPONS[item.id].name;
  if (item.kind === 'grenade') return GRENADES[item.id].name;
  return item.name;
}

export function buyItem(actor, id) {
  const item = BUY_CATALOG.find((i) => i.id === id);
  if (!item || S.phase !== PHASE.BUY) return false;
  const price = itemPrice(item);
  if (actor.money < price) {
    if (actor.isPlayer) sfx.denied();
    return false;
  }
  if (item.kind === 'weapon') {
    if (actor.loadout.primary && actor.loadout.primary.id === id) return false;
    actor.loadout.primary = makeWeapon(id);
    actor.loadout.current = 'primary';
  } else if (item.kind === 'armor') {
    if (actor.armor >= 100) return false;
    actor.armor = 100;
  } else if (item.kind === 'helmet') {
    if (actor.helmet || actor.armor <= 0) return false;
    actor.helmet = true;
  } else if (item.kind === 'grenade') {
    if (actor.grenades[id] >= GRENADE_CAPS[id]) return false;
    actor.grenades[id]++;
  }
  actor.money -= price;
  if (actor.isPlayer) sfx.buy();
  return true;
}

// Bots shop by a simple policy: rifle when rich, SMG when not, armour with
// what's left, a grenade when there's spare change.
function buyForBot(bot) {
  const rng = S.rng;
  if (!bot.loadout.primary) {
    if (bot.money >= 3600 && rng() < 0.3) buyItem(bot, 'longshot');
    else if (bot.money >= 2700) buyItem(bot, 'vk7');
    else if (bot.money >= 1700 && rng() < 0.3) buyItem(bot, 'mule');
    else if (bot.money >= 1300) buyItem(bot, 'ripper');
  }
  if (bot.armor < 100 && bot.money >= 650) buyItem(bot, 'armor');
  if (bot.armor > 0 && !bot.helmet && bot.money >= 350 && rng() < 0.5) buyItem(bot, 'helmet');
  if (bot.money >= 900 && bot.grenades.frag === 0 && rng() < 0.6) buyItem(bot, 'frag');
  if (bot.money >= 700 && bot.grenades.smoke === 0 && rng() < 0.35) buyItem(bot, 'smoke');
  if (bot.money >= 600 && bot.grenades.flash === 0 && rng() < 0.4) buyItem(bot, 'flash');
}

export function startMatch(seed) {
  resetMatch(seed);
  lossStreak = { attack: 0, defend: 0 };
  for (const a of S.actors) {
    a.money = 800;
    a.kills = 0;
    a.deaths = 0;
    a.loadout = makeLoadout();
    a.armor = 0;
    a.helmet = false;
    a.grenades = { frag: 0, flash: 0, smoke: 0 };
  }
  startRound();
}

function startRound() {
  resetRoundState();
  for (const p of projectiles) fx.removeGrenadeMesh(p);
  projectiles.length = 0;
  const byTeam = { attack: 0, defend: 0 };
  for (const a of S.actors) {
    const spawn = SPAWNS[a.team][byTeam[a.team] % SPAWNS[a.team].length];
    byTeam[a.team]++;
    a.x = spawn.x;
    a.z = spawn.z;
    a.y = 0;
    a.vx = 0;
    a.vz = 0;
    a.yaw = spawn.yaw;
    a.pitch = 0;
    a.health = 100;
    a.alive = true;
    a.crouching = false;
    a.flashUntil = 0;
    a.channeling = null;
    if (a.brain) {
      a.brain.memory = null;
      a.brain.path = [];
      a.brain.pathI = 0;
      a.brain.channel = null;
    }
    if (!a.loadout) a.loadout = makeLoadout();
    // A fighter who died last round re-enters with the sidearm and no kit.
    if (a.deaths > 0 && a.wasDead) {
      a.loadout = makeLoadout();
      a.armor = 0;
      a.helmet = false;
      a.grenades = { frag: 0, flash: 0, smoke: 0 };
    }
    a.wasDead = false;
    const w = a.loadout.primary || a.loadout.secondary;
    if (w) { w.mag = w.def.mag; w.reserve = w.def.reserve; w.reloadEnd = 0; }
    if (a.loadout.secondary) {
      a.loadout.secondary.mag = a.loadout.secondary.def.mag;
      a.loadout.secondary.reserve = a.loadout.secondary.def.reserve;
    }
    a.loadout.current = a.loadout.primary ? 'primary' : 'secondary';
  }
  // Phase first: buyItem (used by the bots' shopping below) only sells while
  // the phase is BUY.
  S.phase = PHASE.BUY;
  S.phaseTimer = BUY_TIME;
  S.message = '';
  for (const bot of S.bots) buyForBot(bot);
  assignDefenders();
}

function goLive() {
  const site = S.rng() < 0.5 ? 'A' : 'B';
  const routes = site === 'A' ? [PLACES.aSite, PLACES.aHold2] : [PLACES.bSite, PLACES.bHold2];
  assignPlans(site, routes);
  S.phase = PHASE.LIVE;
  S.roundTimer = ROUND_TIME;
  S.message = site === 'A' ? 'CHARGE IN — TAKE THE FURNACE HALL' : 'CHARGE IN — TAKE THE CASTING YARD';
  S.messageUntil = S.time + 3;
}

function endRound(winner, reason) {
  S.roundWinner = winner;
  S.roundEndReason = reason;
  S.score[winner]++;
  const loser = winner === 'attack' ? 'defend' : 'attack';
  lossStreak[winner] = 0;
  lossStreak[loser]++;
  const winPay = reason === 'detonation' ? AWARD.winDetonation : AWARD.win;
  const lossPay = AWARD.loss + Math.min(AWARD.lossMax, (lossStreak[loser] - 1) * AWARD.lossStep);
  for (const a of S.actors) {
    a.money += a.team === winner ? winPay : lossPay;
    if (!a.alive) a.wasDead = true;
    a.channeling = null;
  }
  if (S.player) sfx.sting(S.player.team === winner);
  S.phase = PHASE.ROUND_END;
  S.phaseTimer = END_TIME;
  S.message = `${winner === 'attack' ? 'WARDENS' : 'BREAKERS'} TAKE THE ROUND — ${reason.toUpperCase()}`;
  S.messageUntil = S.time + END_TIME;
}

function endMatch() {
  S.phase = PHASE.MATCH_END;
  S.winner = S.score.attack === S.score.defend ? null : S.score.attack > S.score.defend ? 'attack' : 'defend';
}

export function stepRounds(dt) {
  const player = S.player;
  switch (S.phase) {
    case PHASE.BUY: {
      S.phaseTimer -= dt;
      if (S.phaseTimer <= 0) goLive();
      break;
    }
    case PHASE.LIVE: {
      S.roundTimer -= dt;
      // The plant: the player holds E inside a site with the charge.
      const charge = S.charge;
      if (player && player.alive && charge && charge.state === 'carried') {
        const site = siteAt(player.x, player.z);
        if (site && keyDown('KeyE') && !player.grenadeInHand) {
          player.channeling = 'plant';
          charge.channel += dt;
          charge.site = site;
          if (charge.channel >= PLANT_TIME) {
            charge.state = 'planted';
            charge.x = player.x;
            charge.z = player.z;
            charge.timer = DETONATE_TIME;
            player.money += 300;
            player.channeling = null;
            S.phase = PHASE.PLANTED;
            S.message = 'CHARGE PLANTED';
            S.messageUntil = S.time + 3;
            sfx.plantDone();
            beepAt = S.time;
            fx.plantedCharge(charge.x, charge.z);
          }
        } else {
          player.channeling = null;
          charge.channel = Math.max(0, charge.channel - dt * 2);
        }
      }
      if (S.phase !== PHASE.LIVE) break;
      const atk = S.actors.filter((a) => a.team === 'attack' && a.alive).length;
      const def = S.actors.filter((a) => a.team === 'defend' && a.alive).length;
      if (player && !player.alive && charge && charge.state === 'carried') charge.state = 'lost';
      if (def === 0) endRound('attack', 'elimination');
      else if (atk === 0) endRound('defend', 'elimination');
      else if (S.roundTimer <= 0) endRound('defend', 'site held');
      break;
    }
    case PHASE.PLANTED: {
      const charge = S.charge;
      charge.timer -= dt;
      // Accelerating beeps as the timer runs down.
      const interval = charge.timer > 20 ? 1 : charge.timer > 10 ? 0.5 : 0.25;
      if (S.time >= beepAt) {
        beepAt = S.time + interval;
        sfx.beep(charge.timer <= 10);
        fx.chargeBlink();
      }
      // Defuse: a defender bot standing on the charge with its channel open.
      let defusing = false;
      for (const bot of S.bots) {
        if (bot.team === 'defend' && bot.alive && bot.brain.channel === 'defuse' &&
            Math.hypot(bot.x - charge.x, bot.z - charge.z) < 1.7) {
          defusing = true;
        }
      }
      if (defusing) {
        charge.defuse = (charge.defuse || 0) + dt;
        if (charge.defuse >= DEFUSE_TIME) {
          fx.removePlantedCharge();
          endRound('defend', 'defused');
          break;
        }
      } else {
        charge.defuse = Math.max(0, (charge.defuse || 0) - dt * 2);
      }
      const defAlive = S.actors.some((a) => a.team === 'defend' && a.alive);
      if (!defAlive) {
        fx.removePlantedCharge();
        endRound('attack', 'elimination');
        break;
      }
      if (charge.timer <= 0) {
        fx.explosion(charge.x, 1, charge.z, 2.2);
        fx.removePlantedCharge();
        sfx.explosion();
        S.shake = 1;
        for (const a of S.actors) {
          if (!a.alive) continue;
          const d = Math.hypot(a.x - charge.x, a.z - charge.z);
          if (d < 9) {
            a.health = 0;
            a.alive = false;
            a.deaths++;
          }
        }
        endRound('attack', 'detonation');
      }
      break;
    }
    case PHASE.ROUND_END: {
      S.phaseTimer -= dt;
      if (S.phaseTimer <= 0) {
        if (S.score.attack >= S.winsNeeded || S.score.defend >= S.winsNeeded || S.round >= S.maxRounds) {
          endMatch();
        } else {
          S.round++;
          startRound();
        }
      }
      break;
    }
    default:
      break;
  }
  if (player && !player.alive && (S.phase === PHASE.LIVE || S.phase === PHASE.PLANTED)) {
    S.spectate = true;
  } else if (player && player.alive) {
    S.spectate = false;
  }
}

// Buy phase can be cut short from the HUD ("READY" button / closing the menu).
export function endBuyEarly() {
  if (S.phase === PHASE.BUY) S.phaseTimer = Math.min(S.phaseTimer, 0.05);
}
