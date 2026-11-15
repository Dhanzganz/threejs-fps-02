// collision.js — all spatial tests in one place, run against the box list from
// map.js. Movement is a circle sliding along axis-aligned boxes; bullets and
// sight lines are rays tested with the slab method against the same boxes
// (each box spans y 0..h, so a low wall genuinely hides a crouched body and a
// standing shot genuinely clears it). No three.js objects are involved: the
// simulation stays pure math, and rendering just draws the result.

import { WALLS, BOUNDS } from './map.js';

// Does the circle at (x, z) with radius r overlap any wall footprint?
function overlaps(x, z, r) {
  for (const w of WALLS) {
    if (x > w.minX - r && x < w.maxX + r && z > w.minZ - r && z < w.maxZ + r) return w;
  }
  return null;
}

// Move a circle by (dx, dz), sliding along whatever it hits. Axis-separated:
// try x, then z, so a diagonal run along a wall keeps its free component.
export function slideMove(pos, dx, dz, r) {
  let nx = pos.x + dx;
  if (overlaps(nx, pos.z, r)) {
    nx = dx > 0 ? Math.min(nx, pos.x) : Math.max(nx, pos.x);
    // clamp flush against the nearest blocking face
    for (const w of WALLS) {
      if (pos.z > w.minZ - r && pos.z < w.maxZ + r) {
        if (dx > 0 && nx > w.minX - r && pos.x <= w.minX - r + 0.001) nx = Math.min(nx, w.minX - r);
        if (dx < 0 && nx < w.maxX + r && pos.x >= w.maxX + r - 0.001) nx = Math.max(nx, w.maxX + r);
      }
    }
    if (overlaps(nx, pos.z, r)) nx = pos.x;
  }
  let nz = pos.z + dz;
  if (overlaps(nx, nz, r)) {
    for (const w of WALLS) {
      if (nx > w.minX - r && nx < w.maxX + r) {
        if (dz > 0 && nz > w.minZ - r && pos.z <= w.minZ - r + 0.001) nz = Math.min(nz, w.minZ - r);
        if (dz < 0 && nz < w.maxZ + r && pos.z >= w.maxZ + r - 0.001) nz = Math.max(nz, w.maxZ + r);
      }
    }
    if (overlaps(nx, nz, r)) nz = pos.z;
  }
  pos.x = Math.max(BOUNDS.minX + r, Math.min(BOUNDS.maxX - r, nx));
  pos.z = Math.max(BOUNDS.minZ + r, Math.min(BOUNDS.maxZ - r, nz));
}

// Ray vs the wall boxes. o = origin {x,y,z}, d = unit direction. Returns the
// nearest hit { t, nx, ny, nz } or null. Boxes span y 0..h.
export function rayWalls(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null;
  for (const w of WALLS) {
    let tmin = 0;
    let tmax = maxDist;
    let axis = -1;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < w.minX || ox > w.maxX) continue;
    } else {
      let t1 = (w.minX - ox) / dx;
      let t2 = (w.maxX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; axis = 0; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab (box from ground to h)
    if (Math.abs(dy) < 1e-9) {
      if (oy < 0 || oy > w.h) continue;
    } else {
      let t1 = (0 - oy) / dy;
      let t2 = (w.h - oy) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; axis = 1; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < w.minZ || oz > w.maxZ) continue;
    } else {
      let t1 = (w.minZ - oz) / dz;
      let t2 = (w.maxZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; axis = 2; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (!best || tmin < best.t) {
      const n = { x: 0, y: 0, z: 0 };
      if (axis === 0) n.x = dx > 0 ? -1 : 1;
      else if (axis === 1) n.y = dy > 0 ? -1 : 1;
      else if (axis === 2) n.z = dz > 0 ? -1 : 1;
      best = { t: tmin, nx: n.x, ny: n.y, nz: n.z };
    }
  }
  return best;
}

// Ground plane hit for downward rays (impacts, grenade bounces use y=0 too).
export function rayGround(oy, dy, maxDist) {
  if (dy >= -1e-9) return null;
  const t = -oy / dy;
  return t <= maxDist ? t : null;
}

// Line of sight between two points at given heights: false if any wall box
// crosses the segment below its top.
export function losClear(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const hit = rayWalls(x1, y1, z1, dx / dist, dy / dist, dz / dist, dist);
  return hit === null;
}

// 2D segment vs the walls a ground actor cannot step over (taller than the
// step height). Used to pick a reachable graph entry node: the Euclidean
// nearest node can sit on the far side of a wall.
export function segmentBlocked2D(x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  for (const w of WALLS) {
    if (w.maxY <= 0.55) continue;
    const ex = 0.3;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    if (Math.abs(dx) < 1e-9) {
      if (x0 < w.minX - ex || x0 > w.maxX + ex) ok = false;
    } else {
      let ta = (w.minX - ex - x0) / dx;
      let tb = (w.maxX + ex - x0) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) ok = false;
    }
    if (!ok) continue;
    if (Math.abs(dz) < 1e-9) {
      if (z0 < w.minZ - ex || z0 > w.maxZ + ex) ok = false;
    } else {
      let ta = (w.minZ - ex - z0) / dz;
      let tb = (w.maxZ + ex - z0) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) ok = false;
    }
    if (ok) return true;
  }
  return false;
}

// Does the 2D segment pass through a circle (smoke cloud)?
export function segmentHitsCircle(x1, z1, x2, z2, cx, cz, r) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  let t = 0;
  if (len2 > 1e-9) t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cz - z1) * dz) / len2));
  const px = x1 + dx * t - cx;
  const pz = z1 + dz * t - cz;
  return px * px + pz * pz <= r * r;
}
