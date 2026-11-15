// hud.js — everything drawn over the canvas: health and armour, ammunition and
// money, the round timer and score, the killfeed, a minimap, the buy menu, the
// plant/defuse progress, and the full-screen feedback layers (flash white-out,
// scope mask, damage vignette and direction). It reads the state object and
// writes the DOM; it never changes game state except through the buy and
// ready callbacks rounds.js provides.

import { S, PHASE } from './state.js';
import { WALLS, SITES, BOUNDS } from './map.js';
import { WEAPONS, currentWeapon } from './weapons.js';
import { BUY_CATALOG, BUY_TIME, PLANT_TIME, DEFUSE_TIME, buyItem, endBuyEarly, itemName, itemPrice } from './rounds.js';
import { flashState } from './effects.js';
import { TEAM } from './palette.js';

const $ = (id) => document.getElementById(id);
const els = {};
let minimapCtx = null;
let lastKillfeedAt = -1;
let buyButtons = [];

export function createHud({ onPlay }) {
  for (const id of ['health-num', 'health-bar', 'armor-bar', 'ammo-mag', 'ammo-reserve', 'weapon-name',
    'money', 'timer', 'score-line', 'alive-line', 'killfeed', 'message', 'progress', 'progress-fill',
    'progress-label', 'crosshair', 'hitmarker', 'overlay', 'overlay-title', 'overlay-copy', 'play',
    'buymenu', 'buy-money', 'buy-timer', 'flash-overlay', 'vignette', 'dirhit', 'scope', 'minimap',
    'charge-line', 'grenade-line', 'spectate', 'buy-round']) {
    els[id] = $(id);
  }
  minimapCtx = els.minimap ? els.minimap.getContext('2d') : null;

  els.play.addEventListener('click', () => onPlay());

  // Buy menu buttons, one per catalog entry, plus the deploy button.
  const grid = $('buy-grid');
  BUY_CATALOG.forEach((item, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'buy-item';
    b.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${itemName(item)}</span><span class="buy-price">$${itemPrice(item)}</span>`;
    b.addEventListener('click', () => {
      if (S.player) buyItem(S.player, item.id);
    });
    grid.appendChild(b);
    buyButtons.push({ el: b, item });
  });
  $('deploy').addEventListener('click', () => endBuyEarly());

  window.addEventListener('keydown', (e) => {
    if (S.phase !== PHASE.BUY) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= BUY_CATALOG.length && S.player) buyItem(S.player, BUY_CATALOG[n - 1].id);
    if (e.code === 'KeyB' || e.code === 'Enter') endBuyEarly();
  });
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawMinimap() {
  const g = minimapCtx;
  if (!g) return;
  const W = els.minimap.width;
  const H = els.minimap.height;
  const mx = (x) => ((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)) * W;
  const mz = (z) => ((z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ)) * H;
  g.fillStyle = '#17191d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#4a5158';
  for (const w of WALLS) {
    g.fillRect(mx(w.minX), mz(w.minZ), Math.max(1.5, mx(w.maxX) - mx(w.minX)), Math.max(1.5, mz(w.maxZ) - mz(w.minZ)));
  }
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    g.strokeStyle = key === 'A' ? '#d8542e' : '#e8a33d';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(mx(s.x), mz(s.z), s.r * (W / (BOUNDS.maxX - BOUNDS.minX)), 0, 7);
    g.stroke();
  }
  if (S.charge && S.charge.state === 'planted' && Math.floor(S.time * 2) % 2 === 0) {
    g.fillStyle = '#ff4030';
    g.beginPath();
    g.arc(mx(S.charge.x), mz(S.charge.z), 3.4, 0, 7);
    g.fill();
  }
  for (const a of S.actors) {
    if (!a.alive || a.isPlayer) continue;
    if (a.team !== S.player.team) continue; // the map shows your side only
    g.fillStyle = TEAM[a.team].css;
    g.beginPath();
    g.arc(mx(a.x), mz(a.z), 2.4, 0, 7);
    g.fill();
  }
  const p = S.player;
  if (p && p.alive) {
    g.save();
    g.translate(mx(p.x), mz(p.z));
    g.rotate(Math.PI - p.yaw);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -5);
    g.lineTo(3.4, 4);
    g.lineTo(-3.4, 4);
    g.closePath();
    g.fill();
    g.restore();
  }
}

export function updateHud() {
  const p = S.player;
  if (!p) return;
  const inMatch = S.phase !== PHASE.MENU;

  // Overlay: menu and match end.
  if (S.phase === PHASE.MENU || S.phase === PHASE.MATCH_END) {
    els.overlay.hidden = false;
    if (S.phase === PHASE.MATCH_END) {
      const won = S.winner === p.team;
      els['overlay-title'].textContent = S.winner === null ? 'MATCH DRAWN' : won ? 'MATCH WON' : 'MATCH LOST';
      els['overlay-copy'].textContent =
        `Final score — Wardens ${S.score.attack}, Breakers ${S.score.defend}. ` +
        (won ? 'The foundry is yours. ' : 'The Breakers hold the foundry. ') + 'Play again?';
      els.play.textContent = 'Play again';
    } else {
      els['overlay-title'].textContent = 'SLAGWORKS';
      els['overlay-copy'].textContent =
        'A round-based tactical shooter in a dusk foundry. Carry the breach charge to the Furnace Hall or the ' +
        'Casting Yard, plant it, and hold — or wipe the Breakers out. First to 6 rounds.';
      els.play.textContent = 'Click to play';
    }
  } else {
    els.overlay.hidden = true;
  }

  // Buy menu.
  const buying = S.phase === PHASE.BUY;
  els.buymenu.hidden = !buying;
  if (buying) {
    els['buy-round'].textContent = String(S.round);
    els['buy-money'].textContent = `$${p.money}`;
    els['buy-timer'].textContent = `DEPLOYS IN ${Math.ceil(S.phaseTimer)}s`;
    for (const { el, item } of buyButtons) {
      const price = itemPrice(item);
      let owned = false;
      if (item.kind === 'weapon') owned = !!p.loadout.primary && p.loadout.primary.id === item.id;
      if (item.kind === 'armor') owned = p.armor >= 100;
      if (item.kind === 'helmet') owned = p.helmet || p.armor <= 0;
      el.disabled = owned || p.money < price;
      el.classList.toggle('owned', owned);
    }
  }

  // Core readouts.
  els['health-num'].textContent = String(Math.ceil(p.health));
  els['health-bar'].style.width = `${Math.max(0, p.health)}%`;
  els['health-bar'].style.background = p.health <= 30 ? '#e0483a' : '#e9e6df';
  els['armor-bar'].style.width = `${Math.max(0, p.armor)}%`;
  const w = currentWeapon(p);
  if (w) {
    els['ammo-mag'].textContent = String(w.mag);
    els['ammo-reserve'].textContent = `/ ${w.reserve}`;
    els['weapon-name'].textContent = p.grenadeInHand ? `${p.grenadeKind.toUpperCase()} IN HAND — Q TO CYCLE` : w.def.name + (w.reloadEnd > S.time ? ' — RELOADING' : '');
    $('ammo').classList.toggle('empty', w.mag === 0);
  }
  els.money.textContent = `$${p.money}`;
  els['grenade-line'].textContent =
    `FRAG ${p.grenades.frag} · FLASH ${p.grenades.flash} · SMOKE ${p.grenades.smoke}`;

  // Timer and score.
  if (S.phase === PHASE.PLANTED) {
    els.timer.textContent = fmtTime(S.charge.timer);
    els.timer.style.color = '#ff5040';
  } else if (S.phase === PHASE.BUY) {
    els.timer.textContent = fmtTime(S.phaseTimer);
    els.timer.style.color = '';
  } else {
    els.timer.textContent = fmtTime(S.roundTimer);
    els.timer.style.color = '';
  }
  els['score-line'].innerHTML =
    `<b style="color:${TEAM.attack.css}">WARDENS ${S.score.attack}</b>` +
    `<span>ROUND ${S.round}</span>` +
    `<b style="color:${TEAM.defend.css}">${S.score.defend} BREAKERS</b>`;
  const atkAlive = S.actors.filter((a) => a.team === 'attack' && a.alive).length;
  const defAlive = S.actors.filter((a) => a.team === 'defend' && a.alive).length;
  els['alive-line'].textContent = `${atkAlive}v${defAlive}`;

  // Charge status line.
  if (S.phase === PHASE.PLANTED) {
    els['charge-line'].textContent = S.charge.defuse > 0.05 ? 'THEY ARE DEFUSING IT' : 'CHARGE PLANTED — HOLD THE SITE';
    els['charge-line'].hidden = false;
  } else if (S.phase === PHASE.LIVE && S.charge && S.charge.state === 'lost') {
    els['charge-line'].textContent = 'CHARGE LOST — ELIMINATION ONLY';
    els['charge-line'].hidden = false;
  } else {
    els['charge-line'].hidden = true;
  }

  // Centre message.
  if (S.message && S.time < S.messageUntil) {
    els.message.textContent = S.message;
    els.message.hidden = false;
  } else {
    els.message.hidden = true;
  }

  // Progress: planting or defusing.
  let prog = null;
  if (p.channeling === 'plant') prog = { t: S.charge.channel / PLANT_TIME, label: 'PLANTING THE CHARGE' };
  else if (S.phase === PHASE.PLANTED && S.charge.defuse > 0) prog = { t: S.charge.defuse / DEFUSE_TIME, label: 'DEFUSE IN PROGRESS' };
  if (prog) {
    els.progress.hidden = false;
    els['progress-fill'].style.width = `${Math.min(100, prog.t * 100)}%`;
    els['progress-label'].textContent = prog.label;
  } else {
    els.progress.hidden = true;
  }

  // Killfeed.
  if (S.killfeed.length && S.killfeed[S.killfeed.length - 1].at !== lastKillfeedAt) {
    lastKillfeedAt = S.killfeed[S.killfeed.length - 1].at;
    els.killfeed.innerHTML = S.killfeed.slice(-4).map((k) =>
      `<div><b style="color:${TEAM[k.attacker.team].css}">${k.attacker.isPlayer ? 'YOU' : k.attacker.team === 'attack' ? 'WARDEN' : 'BREAKER'}</b>` +
      ` ${k.headshot ? '⌖ ' : ''}[${k.weapon}] ` +
      `<b style="color:${TEAM[k.victim.team].css}">${k.victim.isPlayer ? 'YOU' : k.victim.team === 'attack' ? 'WARDEN' : 'BREAKER'}</b></div>`,
    ).join('');
  }

  // Crosshair spread + hitmarker.
  const spreadPx = w ? 6 + (w.def.spread * 900) + Math.hypot(p.vx, p.vz) * 2.2 + w.bloom * 500 : 8;
  els.crosshair.style.setProperty('--gap', `${Math.min(26, spreadPx)}px`);
  const hitAge = S.time - (S.lastHitAt || -99);
  els.hitmarker.style.opacity = hitAge < 0.14 ? '1' : '0';
  els.hitmarker.style.color = S.lastHitHead ? '#ff5040' : '#e9e6df';

  // Flash, damage vignette and direction, scope mask, spectate note.
  const flashLeft = flashState.until - S.time;
  els['flash-overlay'].style.opacity = flashLeft > 0 ? String(Math.min(1, flashState.strength * Math.min(1, flashLeft))) : '0';
  const dmgAge = S.time - p.lastDamageAt;
  els.vignette.style.opacity = p.alive && dmgAge < 1.1 ? String(0.55 * (1 - dmgAge / 1.1)) : (p.health <= 30 && p.alive ? '0.25' : '0');
  if (S.hitDirection && S.time < S.hitDirection.until) {
    const rel = S.hitDirection.angle - p.yaw;
    els.dirhit.style.opacity = '0.9';
    els.dirhit.style.transform = `translate(-50%, -50%) rotate(${-rel}rad)`;
  } else {
    els.dirhit.style.opacity = '0';
  }
  els.scope.hidden = !(p.scopedNow && p.alive);
  els.spectate.hidden = !S.spectate;
  els.crosshair.style.opacity = p.alive && inMatch && !p.scopedNow ? '1' : '0';

  drawMinimap();
}
