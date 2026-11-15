[![threejs-fps-02 bounty](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Dhanzganz/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Dhanzganz/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02)

# SLAGWORKS — a tactical three.js FPS

An original round-based tactical shooter set in a dusk foundry, built with
three.js. The **Wardens** (attack, amber) carry a breach charge to one of two
sites — the Furnace Hall (A) or the Casting Yard (B) — plant it, and hold.
The **Breakers** (defend, crimson) hold the sites or defuse. First to 6
rounds wins the match (11 max). It is not a clone of any commercial game:
the map, factions, weapons and names are original to this entry.

Bounty: https://make.fun/bounty/threejs-fps-02

## Play it

```sh
node serve.ts --port 8123   # then open http://localhost:8123/
```

`serve.ts` and `main.ts` are Node scripts (Node 22+, standard library only).
`main.ts` assembles the submission dossier in `/output` (or
`$MAKEFUN_OUTPUT_DIR`). The game itself is static ES modules — no build
step, no network calls; three.js 0.187.0 is vendored under `game/vendor/`.

You fight alongside two Warden bots against four Breaker bots.

## Controls

| Input | Action |
| --- | --- |
| WASD / Shift / Ctrl / Space | Move / walk / crouch / jump |
| Mouse / click | Look / fire (hold for automatics) |
| Right-click | Scope (Longshot .50) |
| R | Reload |
| 1 / 2 / 3 | Primary / sidearm / knife |
| 4, Q | Grenade in hand, cycle grenade type |
| B | Buy menu during the buy phase (or click items) |
| E (hold) | Plant the charge in a site / defuse it |
| Esc | Release the mouse (pause) |

## What is in the game

- **Complete FPS loop** — pointer-lock mouse look, acceleration movement
  with crouch/jump, weapons that fire, reload and run dry, bots that move,
  see, hear and shoot back, rounds that end and restart, a match that ends.
- **Gunplay** — headshots deal bonus damage; recoil and spread grow while
  moving and bloom across a burst; crouching tightens both; armor and helmets
  absorb damage; damage falls off with range.
- **Tactics** — a plant/defuse objective with a 35 s detonation timer, a
  full economy (kill/plant/win/loss rewards, loss streaks) and a buy menu:
  five weapons (P9 Sidearm, Ripper-9 SMG, Mule 12G shotgun, VK-7 Carbine,
  Longshot .50 scoped bolt-action), armor, helmet, and frag / flash / smoke
  grenades. Smoke genuinely blocks bot vision; flashes blind bots and the
  player; footsteps and gunfire are heard by bots.
- **Bot AI** — waypoint-graph navigation (BFS) with per-site entry routes,
  defenders who take posts and rotate to the plant, attackers who commit to
  a site and guard the charge, a designated defuser, burst-fire combat with
  strafing and crouching, and reactions to sight and sound.
- **Original map & look** — "Slagworks": a two-site foundry with a central
  core splitting mid into two corridors, back-door flanks, and low-wall site
  cover, dressed in a fixed dusk palette (rust, amber, slate) with a glowing
  furnace, yard lamps, dust and a painted ground plan.
- **HUD** — health + armor, ammo and grenades, money, round timer, team
  scores and alive counts, killfeed, hitmarker with a headshot tick,
  directional damage indicator, plant/defuse progress, and a live minimap.

## Code layout

One job per module under `game/src/`, simulation on a fixed 60 Hz step,
rendering kept separate, game state in a single object (`state.js`), and
pooled effects so the hot loop does not allocate:

`rng` · `palette` · `state` · `input` · `audio` (all-synthesized WebAudio
SFX) · `map` (geometry data + waypoint graph) · `collision` · `world`
(scene building) · `weapons` · `effects` · `player` · `bots` · `rounds`
(phases, economy, buy menu data) · `hud` · `shotmode` (deterministic staged
scenes used to produce the screenshots) · `main`.

The screenshots in `screenshots/` are real renders of this code, produced
with the `?shot=` scenes in `shotmode.js`.

## License

MIT — see `LICENSE`. Copyright (c) 2026 Dhanzganz.
