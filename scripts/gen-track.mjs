// Generates src/data/track-rustmere.json from a corner-circle layout.
// Each corner is a circle with a guaranteed minimum radius; consecutive
// circles are joined by common tangent lines (Dubins-style), so the track
// can never be tighter than the radius specified for each corner.
import { writeFileSync } from 'fs';

// Corner apexes traced from the F1 reference map (world meters).
// r = corner radius, w = track width at the corner, y = elevation.
// Radii are inflated ~40% over the desired driven radius because the
// Catmull-Rom spline undercuts circular arcs where they meet straights.
const CORNERS = [
  { x: 718, z: 634, r: 110, w: 52, y: 1 },  // T01 hairpin at end of start straight
  { x: 718, z: 284, r: 115, w: 46, y: 2 },  // T02
  { x: 1026, z: 74, r: 120, w: 42, y: 3 },  // T03
  { x: 1113, z: -42, r: 90, w: 40, y: 4 },  // T04
  { x: 1250, z: -126, r: 90, w: 40, y: 5 }, // T05
  { x: 1360, z: -315, r: 90, w: 40, y: 5 }, // T06
  { x: 1600, z: -210, r: 85, w: 40, y: 6 }, // T07
  { x: 1755, z: -390, r: 90, w: 38, y: 6 }, // T08 esses
  { x: 1990, z: -185, r: 95, w: 38, y: 7 }, // T09 esses
  { x: 2233, z: -294, r: 150, w: 46, y: 7 },// T10 onto climb
  { x: 2664, z: -837, r: 150, w: 50, y: 9 },// T11 top-right corner
  { x: 860, z: -690, r: 105, w: 48, y: 3 }, // T12 end of back straight
  { x: 1061, z: -347, r: 100, w: 40, y: 4 },// T13 chicane hairpin
  { x: 575, z: -600, r: 100, w: 38, y: 6 },// T15 loop-back hairpin
  { x: 851, z: -203, r: 110, w: 38, y: 5 }, // T16 sector-3 sweep
  { x: 455, z: 21, r: 115, w: 40, y: 3 },   // T18 left kink
  { x: 270, z: -455, r: 120, w: 40, y: 2 }, // T19
  { x: -280, z: -242, r: 125, w: 44, y: 1 } // T20 onto start straight
];

const rot90 = v => ({ x: -v.z, z: v.x });   // +90deg (CCW in atan2 terms)
const rotM90 = v => ({ x: v.z, z: -v.x });  // -90deg
const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const len = v => Math.hypot(v.x, v.z);
const norm = v => { const l = len(v); return { x: v.x / l, z: v.z / l }; };
const cross = (a, b) => a.x * b.z - a.z * b.x;

// Build circle for each corner: center sits on the interior bisector at
// distance r, so the arc passes through the traced apex.
const n = CORNERS.length;
const circles = CORNERS.map((c, i) => {
  const prev = CORNERS[(i - 1 + n) % n];
  const next = CORNERS[(i + 1) % n];
  const u = norm(sub(c, prev));
  const v = norm(sub(next, c));
  const s = Math.sign(cross(u, v)) || 1;
  const w = norm(sub(v, u)); // interior bisector
  return { cx: c.x + w.x * c.r, cz: c.z + w.z * c.r, r: c.r, s, w: c.w, y: c.y };
});

// Common tangent line from circle a to circle b respecting turn senses.
function tangent(a, b) {
  const D = { x: b.cx - a.cx, z: b.cz - a.cz };
  const rho = len(D);
  const k = b.s * b.r - a.s * a.r;
  if (Math.abs(k) > rho) throw new Error(`no tangent: rho=${rho.toFixed(1)} k=${k}`);
  const phi0 = Math.atan2(D.z, D.x);
  for (const theta of [phi0 + Math.asin(-k / rho), phi0 + Math.PI - Math.asin(-k / rho)]) {
    const t = { x: Math.cos(theta), z: Math.sin(theta) };
    const na = rotM90(t); // radial = s * rot-90(travel dir)
    const T1 = { x: a.cx + a.s * na.x * a.r, z: a.cz + a.s * na.z * a.r };
    const T2 = { x: b.cx + b.s * na.x * b.r, z: b.cz + b.s * na.z * b.r };
    const seg = sub(T2, T1);
    if (seg.x * t.x + seg.z * t.z > 0 && Math.abs(cross(norm(seg), t)) < 1e-6) {
      return { T1, T2, len: len(seg) };
    }
  }
  throw new Error('tangent selection failed');
}

// Build the ideal path as a dense polyline (~6 m steps), then resample it
// uniformly so the Catmull-Rom spline gets evenly spaced control points.
const dense = [];
let startDenseIndex = -1;

for (let i = 0; i < n; i++) {
  const c = circles[i];
  const nextC = circles[(i + 1) % n];
  const tin = tangent(circles[(i - 1 + n) % n], c).T2;  // arrival tangent point
  const tg = tangent(c, nextC);                          // departure tangent + straight

  // Arc from tin to tg.T1 around this circle, in turn sense c.s.
  const aIn = Math.atan2(tin.z - c.cz, tin.x - c.cx);
  const aOut = Math.atan2(tg.T1.z - c.cz, tg.T1.x - c.cx);
  let sweep = (aOut - aIn) * c.s;
  while (sweep < 0) sweep += Math.PI * 2;
  while (sweep >= Math.PI * 2) sweep -= Math.PI * 2;
  const arcSteps = Math.max(2, Math.ceil((sweep * c.r) / 6));
  for (let j = 0; j < arcSteps; j++) {
    const a = aIn + c.s * sweep * (j / arcSteps);
    dense.push({ x: c.cx + Math.cos(a) * c.r, y: c.y, z: c.cz + Math.sin(a) * c.r, width: c.w });
  }

  // Straight to the next circle. Widths flare out mid-straight.
  const isStartStraight = i === n - 1; // T20 -> T01 carries the start/finish line
  const straightSteps = Math.max(1, Math.ceil(tg.len / 6));
  const wideW = isStartStraight ? 90 : Math.min(88, Math.max(c.w, nextC.w) + 28);
  for (let j = 0; j < straightSteps; j++) {
    const f = j / straightSteps;
    const flare = Math.min(1, Math.min(f, 1 - f) * 4); // 0 at ends, 1 mid
    const wA = c.w + (wideW - c.w) * flare;
    const wB = nextC.w + (wideW - nextC.w) * flare;
    dense.push({
      x: tg.T1.x + (tg.T2.x - tg.T1.x) * f,
      y: c.y + (nextC.y - c.y) * f,
      z: tg.T1.z + (tg.T2.z - tg.T1.z) * f,
      width: f < 0.5 ? wA : wB
    });
    if (isStartStraight && startDenseIndex < 0 && f >= 0.38) startDenseIndex = dense.length - 1;
  }
}

// Rotate so the start/finish sits at the head, then resample every ~35 m.
const rot = dense.slice(startDenseIndex).concat(dense.slice(0, startDenseIndex));
const SPACING = 35;
const points = [];
let acc = SPACING; // force first dense point to be emitted
for (let i = 0; i < rot.length; i++) {
  const prev = rot[(i - 1 + rot.length) % rot.length];
  acc += Math.hypot(rot[i].x - prev.x, rot[i].z - prev.z);
  if (acc >= SPACING) {
    acc = 0;
    points.push({
      x: Math.round(rot[i].x),
      y: Math.round(rot[i].y * 10) / 10,
      z: Math.round(rot[i].z),
      width: Math.round(rot[i].width)
    });
  }
}
const rotated = points;

const data = { name: 'Rustmere Marina', laps: 3, checkpoints: 8, points: rotated };
writeFileSync(new URL('../src/data/track-rustmere.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log('points:', rotated.length);
