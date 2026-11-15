// SLAGWORKS — hand-in program (Node 22, standard library only).
//
// The game itself is the static site in game/: ES modules, no build step,
// three.js 0.187.0 vendored under game/vendor/three. This program hands it in
// the way the bounty asks: it copies game/ and screenshots/ from beside this
// file into the output directory and writes dossier.json there with
// buildDossier from the kit's library (vendor/makefun-threejs.ts, unchanged),
// which is the summary the judge reads — the screenshots, then the source.
//
// Run it locally the same way the grader does:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// (MAKEFUN_OUTPUT_DIR stands in for /output outside the grader's container.)
// Play the game with `node serve.ts` and http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps below are the gate's own (the kit's reference/gate.json): the text
// cap shapes what the judge reads; the rest refuse here what the gate would
// refuse there — more than 4 screenshots, one over 256 KiB, more than 993
// entries or 48 MiB under game/.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
