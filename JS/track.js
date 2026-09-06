// track.js — defines the race circuit and all track-related math.
// The track is a closed loop described as a dense list of centerline points.
// Kart position on the track (progress, offset, on/off track) is found by
// scanning for the nearest centerline point — cheap enough for a handful
// of karts at 60fps.

const TRACK = (() => {
  const TRACK_WIDTH = 190;

  // Stadium-shaped circuit: two straights joined by two constant-radius
  // semicircular turns. A constant turn radius (comfortably bigger than
  // the track's half-width) guarantees the inner and outer edges never
  // get close enough to confuse the nearest-point lookup, which an
  // ellipse's continuously-tightening curvature can't guarantee at its
  // apexes.
  const STRAIGHT_LEN = 650;
  const TURN_RADIUS = 300;
  const STEP = 7.5; // approx spacing between sampled centerline points

  const halfL = STRAIGHT_LEN / 2;
  const points = [];

  function addStraight(x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / STEP));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
    }
  }

  function addArc(cx, cy, r, startAngle, endAngle) {
    const sweep = endAngle - startAngle; // negative = clockwise sweep, as used below
    const n = Math.max(2, Math.round((Math.abs(sweep) * r) / STEP));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = startAngle + sweep * t;
      points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  }

  // Bottom straight: left to right at y = +TURN_RADIUS.
  addStraight(-halfL, TURN_RADIUS, halfL, TURN_RADIUS);
  // Right-hand turn: semicircle around (halfL, 0), sweeping from the
  // bottom straight's end up to the top straight's start.
  addArc(halfL, 0, TURN_RADIUS, Math.PI / 2, -Math.PI / 2);
  // Top straight: right to left at y = -TURN_RADIUS.
  addStraight(halfL, -TURN_RADIUS, -halfL, -TURN_RADIUS);
  // Left-hand turn: semicircle around (-halfL, 0), closing the loop.
  addArc(-halfL, 0, TURN_RADIUS, -Math.PI / 2, -Math.PI * 1.5);

  // Gentle S-wiggle on the bottom straight only, for visual interest —
  // amplitude is small relative to TURN_RADIUS so it can't push the
  // straight close enough to the turns to cause overlap.
  const bottomCount = Math.round(STRAIGHT_LEN / STEP);
  for (let i = 0; i < bottomCount; i++) {
    const t = i / bottomCount;
    points[i].y += Math.sin(t * Math.PI * 2) * 45;
  }

  const WIDTH = STRAIGHT_LEN + TURN_RADIUS * 2 + 100;
  const HEIGHT = TURN_RADIUS * 2 + 100;
  const shiftX = WIDTH / 2;
  const shiftY = HEIGHT / 2;
  for (const p of points) {
    p.x += shiftX;
    p.y += shiftY;
  }

  // Precompute cumulative arc length for lap/progress tracking.
  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cumDist.push(cumDist[i - 1] + Math.hypot(dx, dy));
  }
  const closingDx = points[0].x - points[points.length - 1].x;
  const closingDy = points[0].y - points[points.length - 1].y;
  const closingLen = Math.hypot(closingDx, closingDy);
  const totalLength = cumDist[cumDist.length - 1] + closingLen;

  // Item box positions, spread evenly around the loop as fractions of
  // the total point count so they stay valid regardless of exact sampling.
  const itemBoxFractions = [0.08, 0.22, 0.4, 0.55, 0.72, 0.88];
  const itemBoxIndices = itemBoxFractions.map((f) => Math.floor(f * points.length));
  const startIndex = 0;

  function nearestIndex(x, y) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - x;
      const dy = points[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return { index: best, dist: Math.sqrt(bestDist) };
  }

  function pointAt(index) {
    const n = points.length;
    const i0 = ((Math.floor(index) % n) + n) % n;
    return points[i0];
  }

  function headingAt(index) {
    const a = pointAt(index);
    const b = pointAt(index + 1);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  return {
    WIDTH,
    HEIGHT,
    TRACK_WIDTH,
    points,
    cumDist,
    totalLength,
    itemBoxIndices,
    startIndex,
    nearestIndex,
    pointAt,
    headingAt,
  };
})();
