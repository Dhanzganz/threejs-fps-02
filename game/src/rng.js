// rng.js — a small seeded random number generator (mulberry32) so a match, and the
// staged screenshot scenes, play out the same way every time for a given seed.
// The live game seeds from the clock; shot mode seeds from the URL, which is what
// makes the screenshots reproducible renders of the game's own code.

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function rngPick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}
