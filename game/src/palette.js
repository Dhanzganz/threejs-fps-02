// palette.js — the whole look of SLAGWORKS in one place: a dusk foundry lit by
// sodium lamps. Slate and charcoal structures, oxide-red and ochre accents, one
// cold teal for glass and signage. Every material in world.js and every bot
// uniform in bots.js takes its colour from here, so the scene reads as one
// chosen palette instead of a pile of defaults.

export const PALETTE = {
  sky: 0x2b3547,          // dusk blue over the yard
  fog: 0x2b3547,
  ground: 0x434345,       // worn concrete
  groundDark: 0x2e2e30,
  wall: 0x676b70,         // cast concrete block
  wallDark: 0x585c61,
  metal: 0x7d838a,        // galvanised steel
  metalDark: 0x596066,
  rust: 0x9c4a24,         // oxide red-brown, site A accent
  ochre: 0xc9862b,        // sodium-lamp amber, site B accent
  teal: 0x2e7f86,         // signage glass
  crate: 0x7a6748,        // timber crates
  crateDark: 0x5d4f38,
  barrel: 0x74553a,
  furnaceGlow: 0xff7a26,  // molten light inside the furnace hall
  lamp: 0xffb45e,         // sodium lamp colour
  lampCool: 0xbfe3ff,
  molten: 0xffa63d,
};

export const TEAM = {
  // The player's side: the Wardens, who carry the breach charge in.
  attack: { name: 'WARDENS', color: 0xe8a33d, dark: 0x8a5f1e, css: '#e8a33d' },
  // The defending side: the Breakers, who hold the foundry.
  defend: { name: 'BREAKERS', color: 0xc8402e, dark: 0x6e2318, css: '#e05540' },
};

export const SITE_COLORS = { A: 0xd8542e, B: 0xe8a33d };
