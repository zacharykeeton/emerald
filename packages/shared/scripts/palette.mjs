// The session palette, chosen by measure rather than by eye (M59). Twelve
// colours on two OKLCH lightness rings, the hues thirty degrees apart
// round the circle from the hue of the old red and alternating between
// the rings, so any two hue neighbours differ in lightness as well; each
// ring takes the largest chroma that stays inside sRGB at every hue, so
// no colour is clipped duller than its ring. OKLab distance is the
// perceptual one: on one ring twelve hues are only 0.064 apart (the old
// eight had 0.077 at their worst pair), while two rings 0.12 apart in
// lightness put the nearest pair at 0.109. The script exists so the
// pick is repeatable and its distances printed, and so a change of
// lightness or count is one number here.
//
//   node packages/shared/scripts/palette.mjs [lightness,lightness] [count]
//
// Prints the hex list to paste into SESSION_COLORS in session.ts, each
// with its OKLCH hue and lightness, then the smallest pairwise OKLab
// distance and which pair it is.

const RINGS = (process.argv[2] ?? '0.66,0.78').split(',').map(Number);
const COUNT = Number(process.argv[3] ?? '12');
// The old palette's red (#e06c75), so the first colour stays a red and
// the names keep their meaning.
const START_HUE = 18;

function toSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// OKLab to linear sRGB (Björn Ottosson's matrices).
function oklabToLinear(lab) {
  const [l, a, b] = lab;
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

function lchToLab(l, c, h) {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

function inGamut(rgb) {
  return rgb.every((v) => v >= -0.0005 && v <= 1.0005);
}

function hex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255).toString(16).padStart(2, '0')).join('');
}

// The largest chroma inside sRGB at this lightness and hue, by bisection.
function maxChroma(l, h) {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinear(lchToLab(l, mid, h)))) lo = mid;
    else hi = mid;
  }
  return lo;
}

// One chroma per ring: the largest inside sRGB at that lightness over
// every hue.
function ringChroma(l) {
  let c = Infinity;
  for (let h = 0; h < 360; h += 1) c = Math.min(c, maxChroma(l, h));
  return c * 0.98;
}

const chroma = RINGS.map(ringChroma);
const step = 360 / COUNT;
const kept = [];
for (let i = 0; i < COUNT; i++) {
  const h = Math.round(START_HUE + i * step) % 360;
  const ring = i % RINGS.length;
  kept.push({ h, ring, lab: lchToLab(RINGS[ring], chroma[ring], h) });
}

const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
let minD = Infinity;
let minPair = '';
for (let i = 0; i < kept.length; i++) {
  for (let j = i + 1; j < kept.length; j++) {
    const d = distance(kept[i].lab, kept[j].lab);
    if (d < minD) {
      minD = d;
      minPair = `hues ${kept[i].h} and ${kept[j].h}`;
    }
  }
}

console.log(`lightness ${RINGS.join(' and ')}, chroma ${chroma.map((c) => c.toFixed(4)).join(' and ')}, ${COUNT} colours`);
for (const k of kept) console.log(`  '${hex(oklabToLinear(k.lab))}', // hue ${k.h}, lightness ${RINGS[k.ring]}`);
console.log(`smallest pairwise OKLab distance ${minD.toFixed(4)} (${minPair})`);
