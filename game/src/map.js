// map.js — the Slagworks foundry, described once as data: every wall and prop is
// an axis-aligned box with a height, and the same list drives the three.js
// geometry in world.js, the movement collision and the bullet/line-of-sight
// tests in collision.js. Two plant sites (the Furnace Hall, A, north-west; the
// Casting Yard, B, north-east), three lanes (west yard, mid around the foundry
// core, east yard), and a waypoint graph the bots path over. Nothing here is
// modelled on any existing game's map: the layout, names and palette are ours.

// A box: cx, cz = centre; w, d = footprint; h = height; mat = palette key;
// low = true marks cover a standing shot clears but a crouched body hides behind.
function box(cx, cz, w, d, h, mat, low = false) {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h, mat, low };
}

export const BOUNDS = { minX: -48, maxX: 48, minZ: -52, maxZ: 52 };

export const WALLS = [
  // Perimeter
  box(0, -52.5, 97, 1, 6, 'wallDark'), box(0, 52.5, 97, 1, 6, 'wallDark'),
  box(-48.5, 0, 1, 105, 6, 'wallDark'), box(48.5, 0, 1, 105, 6, 'wallDark'),

  // Furnace Hall (site A): north wall is shared with the defender strip and has
  // a back door at x -40..-36; east wall door at z -34..-30; south wall door at x -28..-24.
  box(-43, -44, 6, 1, 5, 'wall'), box(-25, -44, 22, 1, 5, 'wall'),   // A north, back door at x -40..-36
  box(-8, -44, 12, 1, 5, 'wall'), box(8, -44, 12, 1, 5, 'wall'),     // strip wall, mid door at x -2..2
  box(-46, -30, 1, 28, 5, 'wall'),                                  // A west (perimeter side)
  box(-14, -39.5, 1, 9, 5, 'wall'), box(-14, -23, 1, 14, 5, 'wall'), // A east, door at z -35..-30
  box(-37, -16, 18, 1, 5, 'wall'), box(-19, -16, 10, 1, 5, 'wall'),   // A south, door between

  // Casting Yard (site B): mirrored hall shell, more open inside.
  box(25, -44, 22, 1, 5, 'wall'), box(43, -44, 6, 1, 5, 'wall'),     // B north, back door at x 36..40
  box(46, -30, 1, 28, 5, 'wall'),
  box(14, -39.5, 1, 9, 5, 'wall'), box(14, -23, 1, 14, 5, 'wall'),   // B west, door at z -35..-30
  box(37, -16, 18, 1, 5, 'wall'), box(19, -16, 10, 1, 5, 'wall'),     // B south, door between

  // The foundry core: a solid block mid-map that splits the middle lane in two.
  box(0, 0, 20, 20, 7, 'metalDark'),
  box(0, -10.6, 22, 1.2, 2.2, 'rust'),                               // core trim, north
  box(0, 10.6, 22, 1.2, 2.2, 'rust'),                                // core trim, south

  // Yard cover: low walls and long blocks that make the lanes worth fighting over.
  box(-20, -2, 1, 8, 2.6, 'wall'),
  box(20, -2, 1, 8, 2.6, 'wall'),
  box(-33, -24, 5, 1, 1.1, 'wallDark', true),                         // A site low wall
  box(33, -24, 5, 1, 1.1, 'wallDark', true),                          // B site low wall
  box(-4, 33, 3, 2, 1.0, 'metalDark', true), box(4, 33, 3, 2, 1.0, 'metalDark', true), // slag blocks, plaza
  box(-4, -24, 2, 2, 1.2, 'crate'), box(4, -24, 2, 2, 1.2, 'crate'),  // north-mid crates
  box(-24, -28, 2.4, 2.4, 2.4, 'crate'), box(-20, -40, 2.4, 2.4, 1.2, 'crate'),
  box(24, -38, 3, 3, 2.4, 'crate'), box(38, -22, 2.4, 2.4, 1.2, 'crate'),
  box(-8, 24, 2.4, 2.4, 2.4, 'crate'), box(8, 24, 2.4, 2.4, 2.4, 'crate'),
  box(-34, 6, 2.4, 2.4, 1.2, 'crate'), box(34, 6, 2.4, 2.4, 1.2, 'crate'),
  box(-38, -6, 2, 2, 1.2, 'barrel'), box(38, -6, 2, 2, 1.2, 'barrel'),
  box(16, 30, 2, 2, 1.2, 'barrel'), box(-16, 30, 2, 2, 1.2, 'barrel'),
  box(-39, -35, 5, 5, 5, 'metalDark'),                                // the furnace itself
  box(36, -36, 5, 4, 1.6, 'metal'),                                   // casting mould, B
  box(-13, -30, 1, 6, 3.2, 'metal'),                                  // A door-side pipe stack
  box(13, -30, 1, 6, 3.2, 'metal'),                                   // B door-side pipe stack
];

// Plant sites: standing inside the circle with the charge plants it.
export const SITES = {
  A: { x: -31, z: -31, r: 7.5, name: 'FURNACE HALL' },
  B: { x: 31, z: -31, r: 7.5, name: 'CASTING YARD' },
};

export const SPAWNS = {
  attack: [
    { x: 0, z: 46, yaw: Math.PI },       // the player (yaw PI faces -z, north)
    { x: -5, z: 45, yaw: Math.PI },
    { x: 5, z: 45, yaw: Math.PI },
  ],
  defend: [
    { x: -20, z: -47.5, yaw: 0 },
    { x: 20, z: -47.5, yaw: 0 },
    { x: -3, z: -48, yaw: 0 },
    { x: 3, z: -48, yaw: 0 },
  ],
};

// Waypoint graph: [x, z] nodes and undirected edges. Bots path over this; every
// lane, door and site is on it, and no edge crosses a wall.
export const NODES = [
  [0, 44], [-14, 38], [14, 38], [-24, 24], [0, 26], [24, 24],           // 0-5 south
  [-26, 6], [-14, 0], [14, 0], [26, 6],                                 // 6-9 yards/corridors
  [-26, -10], [26, -10],                                                // 10-11 links
  [-26, -13], [-26, -19], [-32, -30], [-11, -32], [-17, -32],           // 12-16 A doors/site
  [-38, -40],                                                           // 17 A back
  [26, -13], [26, -19], [32, -30], [11, -32], [17, -32],                // 18-22 B doors/site
  [41, -32],                                                            // 23 B back
  [0, -30], [0, -14], [0, -48],                                         // 24-26 north mid / def spawn
  [-36, -26], [-22, -38], [36, -26], [27, -33],                          // 27-30 site holds
  [-34, 30], [34, 30],                                                  // 31-32 spawn links
  [-13, -13], [13, -13],                                                // 33-34 core corners
  [-38, -46], [38, -46],                                                // 35-36 site back doors (in the strip)
];

export const EDGES = [
  [0, 1], [0, 2], [0, 4], [1, 3], [2, 5], [1, 4], [2, 4], [3, 4], [4, 5],
  [3, 6], [5, 9], [3, 31], [31, 1], [5, 32], [32, 2],
  [6, 7], [9, 8], [6, 10], [9, 11], [10, 33], [11, 34],
  [7, 33], [8, 34], [33, 25], [34, 25], [25, 24],
  [10, 12], [12, 13], [13, 14], [14, 16], [16, 15], [15, 24],
  [13, 27], [14, 27], [14, 28], [14, 17], [17, 28], [17, 35], [35, 26],
  [11, 18], [18, 19], [19, 20], [20, 22], [22, 21], [21, 24],
  [19, 29], [20, 29], [20, 30], [20, 23], [23, 30], [23, 36], [36, 26],
  [24, 26],
];

// Named places bots reason about.
export const PLACES = {
  aSite: 14, aHold1: 27, aHold2: 28, aBack: 17,
  bSite: 20, bHold1: 29, bHold2: 30, bBack: 23,
  northMid: 24, defSpawn: 26,
  atkSpawn: 0, westYard: 6, eastYard: 9, plaza: 4,
};

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i][0] - x;
    const dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Breadth-first path over the waypoint graph; returns a list of node indices.
const adjacency = NODES.map(() => []);
for (const [a, b] of EDGES) {
  adjacency[a].push(b);
  adjacency[b].push(a);
}

export function findPath(fromNode, toNode) {
  if (fromNode === toNode) return [fromNode];
  const prev = new Array(NODES.length).fill(-1);
  const queue = [fromNode];
  prev[fromNode] = fromNode;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adjacency[cur]) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === toNode) {
        const path = [toNode];
        let n = toNode;
        while (n !== fromNode) { n = prev[n]; path.push(n); }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [fromNode];
}

export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return key;
  }
  return null;
}
