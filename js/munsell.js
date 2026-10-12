// munsell.js
// Munsell (Hue / Value / Chroma) -> sRGB conversion.
//
// Approach (approximate, for visualization) via CIELAB:
//   1. Munsell Value V (0..10) -> CIE lightness L*  (L* = 10 * sqrt(Y%),
//        a close approximation to the Munsell value scale).
//   2. Munsell Hue -> CIELAB hue angle h (degrees); Munsell Chroma ->
//        CIELAB chroma C* (C* ~= 5 * Munsell chroma). Then
//        a* = C* cos(h), b* = C* sin(h).
//   3. L*a*b* (D65) -> XYZ -> linear sRGB -> gamma-encoded sRGB.
//
// Going through CIELAB keeps hues perceptually correct (reds look red, yellows
// yellow) with an exact Lab->sRGB step. This is NOT a measurement-grade
// transform, but it reproduces the color character and the characteristic
// asymmetric shape of the Munsell solid for teaching / exploration.

// --- Hue handling -----------------------------------------------------------
// The 100-step Munsell hue circle. Principal hues at steps 5, 15, 25, ...
// Order (increasing hue number): R, YR, Y, GY, G, BG, B, PB, P, RP.
export const HUE_FAMILIES = ["R", "YR", "Y", "GY", "G", "BG", "B", "PB", "P", "RP"];

// Convert a hue family + number (e.g. "5R") to a position 0..100 on the circle.
export function hueToStep(number, family) {
  const familyIndex = HUE_FAMILIES.indexOf(family);
  if (familyIndex < 0) throw new Error("Unknown hue family: " + family);
  // Each family spans 10 steps; "5R" is the center of the R band.
  return familyIndex * 10 + number;
}

// Convert a 0..100 hue step to { number, family }, e.g. 5 -> {5, "R"}.
export function stepToHue(step) {
  step = ((step % 100) + 100) % 100;
  let familyIndex = Math.floor(step / 10);
  let number = step - familyIndex * 10;
  if (number === 0) {
    // 0R is written as 10 of the previous family (e.g. 0R == 10RP).
    number = 10;
    familyIndex = (familyIndex + 9) % 10;
  }
  return { number: number, family: HUE_FAMILIES[familyIndex] };
}

// Format a hue step + value + chroma as standard Munsell notation.
export function formatMunsell(step, value, chroma) {
  if (chroma <= 0.001) {
    // Neutral (achromatic).
    return "N " + value.toFixed(1) + "/";
  }
  const h = stepToHue(step);
  const num = Number.isInteger(h.number) ? h.number : h.number.toFixed(1);
  return `${num}${h.family} ${value.toFixed(1)}/${chroma.toFixed(1)}`;
}

// --- Value -> CIE lightness L* (0..100) -------------------------------------
// Munsell value maps closely to L* = 10 * sqrt(Y%), where Y% itself follows
// the Newhall-Nickerson-Judd quintic. Equivalently we can approximate the
// Munsell value scale directly; here we compute Y% then L*.
export function valueToY(V) {
  const Ypct =
    1.2219 * V -
    0.23111 * V * V +
    0.23951 * V * V * V -
    0.021009 * V * V * V * V +
    0.0008404 * V * V * V * V * V;
  return Math.max(0, Math.min(1, Ypct / 100));
}

function valueToL(V) {
  const Ypct = valueToY(V) * 100;
  return 10 * Math.sqrt(Math.max(0, Ypct)); // L* ~= 10*sqrt(Y%)
}

// --- Hue -> CIELAB hue angle (degrees) --------------------------------------
// Approximate CIELAB hue angles for the ten Munsell principal hues (at the
// band center, e.g. 5R). Values follow the generally accepted placement of
// Munsell hues in the a*b* plane. Index matches HUE_FAMILIES order.
const HUE_LAB_ANGLE = [
  34,   // 5R   - red
  52,   // 5YR  - orange
  86,   // 5Y   - yellow
  120,  // 5GY  - yellow-green
  160,  // 5G   - green
  198,  // 5BG  - cyan/teal
  242,  // 5B   - blue
  292,  // 5PB  - violet-blue
  330,  // 5P   - purple
  358,  // 5RP  - magenta/red-purple
];

// Interpolate the CIELAB hue angle for an arbitrary hue step (0..100),
// handling wraparound along the shortest arc.
function hueToLabAngle(step) {
  step = ((step % 100) + 100) % 100;
  const t = step / 10 - 0.5; // continuous family index, centered on principal hues
  const i0 = ((Math.floor(t) % 10) + 10) % 10;
  const i1 = (i0 + 1) % 10;
  const frac = t - Math.floor(t);

  let a0 = HUE_LAB_ANGLE[i0];
  let a1 = HUE_LAB_ANGLE[i1];
  let delta = a1 - a0;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  let angle = a0 + delta * frac;
  return ((angle % 360) + 360) % 360;
}

// CIELAB chroma per unit of Munsell chroma. One Munsell chroma step is roughly
// 5 CIELAB C* units.
const CHROMA_TO_LAB = 5.2;

// --- Full conversion: Munsell HVC -> sRGB -----------------------------------
// Returns { r, g, b (0..255), inGamut (bool), hex }.
export function munsellToSRGB(step, value, chroma) {
  const L = valueToL(value);
  const Cstar = chroma * CHROMA_TO_LAB;
  const h = (hueToLabAngle(step) * Math.PI) / 180;
  const a = Cstar * Math.cos(h);
  const b = Cstar * Math.sin(h);
  return labToSRGB(L, a, b);
}

// --- Color space plumbing: CIELAB (D65) -> sRGB -----------------------------
// D65 reference white.
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

function labToSRGB(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const X = Xn * labInv(fx);
  const Y = Yn * labInv(fy);
  const Z = Zn * labInv(fz);

  let rLin = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let gLin = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let bLin = 0.0557 * X - 0.204 * Y + 1.057 * Z;

  const inGamut =
    rLin >= -0.001 && rLin <= 1.001 &&
    gLin >= -0.001 && gLin <= 1.001 &&
    bLin >= -0.001 && bLin <= 1.001;

  rLin = clamp01(rLin);
  gLin = clamp01(gLin);
  bLin = clamp01(bLin);

  const r = Math.round(gamma(rLin) * 255);
  const g = Math.round(gamma(gLin) * 255);
  const b2 = Math.round(gamma(bLin) * 255);

  return { r, g, b: b2, inGamut, hex: rgbToHex(r, g, b2) };
}

function labInv(f) {
  const f3 = f * f * f;
  return f3 > 0.008856 ? f3 : (f - 16 / 116) / 7.787;
}

function gamma(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

// ============================================================================
// Reverse conversion: sRGB -> Munsell (Hue step / Value / Chroma), approximate.
// This inverts the CIELAB-based forward model above so that a color picked
// from an HTML color input can be expressed on the Munsell axes and fed to the
// color-harmony generator.
// ============================================================================

// Inverse of HUE_LAB_ANGLE: given a CIELAB hue angle (deg), find the Munsell
// hue step (0..100). We scan the principal-hue angle table and interpolate.
function labAngleToStep(angleDeg) {
  angleDeg = ((angleDeg % 360) + 360) % 360;
  // Principal hues sit at steps 5, 15, 25, ... 95 (band centers).
  for (let i = 0; i < HUE_LAB_ANGLE.length; i++) {
    const i1 = (i + 1) % HUE_LAB_ANGLE.length;
    let a0 = HUE_LAB_ANGLE[i];
    let a1 = HUE_LAB_ANGLE[i1];
    let delta = a1 - a0;
    if (delta <= 0) delta += 360; // angles increase around the wheel
    // Normalize the target relative to a0.
    let rel = angleDeg - a0;
    rel = ((rel % 360) + 360) % 360;
    if (rel <= delta) {
      const frac = delta === 0 ? 0 : rel / delta;
      // Step at band center i is i*10 + 5; next center is i1*10 + 5.
      const step = (i * 10 + 5) + frac * 10;
      return ((step % 100) + 100) % 100;
    }
  }
  return 5; // fallback
}

// sRGB (0..255) -> { step, value, chroma, inGamut:true, hex }.
export function srgbToMunsell(r, g, b) {
  const lab = srgbToLab(r, g, b);
  const L = lab.L;
  const a = lab.a;
  const bb = lab.b;

  const Cstar = Math.sqrt(a * a + bb * bb);
  const value = lToValue(L);
  const chroma = Cstar / CHROMA_TO_LAB;

  let step;
  if (Cstar < 1e-3) {
    step = 0; // neutral; hue undefined
  } else {
    const angle = (Math.atan2(bb, a) * 180) / Math.PI;
    step = labAngleToStep(angle);
  }

  return {
    step,
    value,
    chroma,
    hex: rgbToHex(Math.round(r), Math.round(g), Math.round(b)),
  };
}

// Inverse of valueToL: solve L* = 10*sqrt(Y%) for Munsell value via the
// Newhall quintic. We invert numerically with a short bisection on V.
function lToValue(L) {
  const targetY = Math.pow(L / 10, 2); // Y% from L*
  let lo = 0,
    hi = 10;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const y = valueToY(mid) * 100;
    if (y < targetY) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// sRGB (0..255) -> CIELAB (D65).
function srgbToLab(r, g, b) {
  const rl = invGamma(r / 255);
  const gl = invGamma(g / 255);
  const bl = invGamma(b / 255);

  // linear sRGB -> XYZ (D65)
  const X = 0.4124 * rl + 0.3576 * gl + 0.1805 * bl;
  const Y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const Z = 0.0193 * rl + 0.1192 * gl + 0.9505 * bl;

  const fx = labF(X / Xn);
  const fy = labF(Y / Yn);
  const fz = labF(Z / Zn);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function invGamma(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ============================================================================
// Color harmony / scheme generation.
// Works on the Munsell axes {step (0..100), value (0..10), chroma (0..~)} and
// returns, for each scheme, an array of color objects:
//   { step, value, chroma, label (Munsell notation), hex, rgb:[r,g,b], role }
// Each scheme returns the base color first, then its companion colors, for a
// total of 4 entries (per the app's "base + 4 colors" layout we return 4).
// ============================================================================

const HUE_FULL = 100; // full hue circle in Munsell steps

function makeSwatch(step, value, chroma, role) {
  // Clamp to sensible ranges.
  value = Math.max(0, Math.min(10, value));
  chroma = Math.max(0, chroma);
  const col = munsellToSRGB(step, value, chroma);
  return {
    step: ((step % HUE_FULL) + HUE_FULL) % HUE_FULL,
    value,
    chroma,
    role,
    label: formatMunsell(((step % HUE_FULL) + HUE_FULL) % HUE_FULL, value, chroma),
    hex: col.hex,
    rgb: [col.r, col.g, col.b],
    inGamut: col.inGamut,
  };
}

// Available scheme keys and human-readable (Japanese) names.
export const SCHEMES = [
  { key: "complementary", name: "補色" },
  { key: "analogous", name: "類似色" },
  { key: "triad", name: "トライアド" },
  { key: "tetrad", name: "テトラード" },
  { key: "monochromatic", name: "モノクロマティック" },
  { key: "shade", name: "シェード" },
  { key: "tint", name: "ティント" },
];

// Generate a scheme. base = { step, value, chroma }. Returns 4 swatches
// (base color first). Hue is manipulated in Munsell steps; value/chroma in
// Munsell units.
export function generateScheme(key, base) {
  const s = base.step;
  const v = base.value;
  const c = base.chroma;

  switch (key) {
    case "complementary":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 50, v, c, "補色"),
        makeSwatch(s, Math.min(10, v + 2), c, "ベース(明)"),
        makeSwatch(s + 50, Math.min(10, v + 2), c, "補色(明)"),
      ];

    case "analogous":
      return [
        makeSwatch(s - 20, v, c, "類似 -2"),
        makeSwatch(s - 10, v, c, "類似 -1"),
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 10, v, c, "類似 +1"),
      ];

    case "triad":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 100 / 3, v, c, "トライアド 2"),
        makeSwatch(s + 200 / 3, v, c, "トライアド 3"),
        makeSwatch(s, Math.min(10, v + 2), Math.max(0, c - 2), "ベース(淡)"),
      ];

    case "tetrad":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 25, v, c, "テトラード 2"),
        makeSwatch(s + 50, v, c, "テトラード 3"),
        makeSwatch(s + 75, v, c, "テトラード 4"),
      ];

    case "monochromatic":
      // Same hue, varying value & chroma.
      return [
        makeSwatch(s, Math.max(1, v - 3), Math.max(1, c - 2), "暗く低彩度"),
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s, Math.min(9, v + 2), c, "明るく"),
        makeSwatch(s, Math.min(9.5, v + 3.5), Math.max(1, c - 3), "明るく低彩度"),
      ];

    case "shade":
      // Base hue/chroma, progressively lower value (toward black).
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s, Math.max(0, v - 1.5), c, "シェード 1"),
        makeSwatch(s, Math.max(0, v - 3), c, "シェード 2"),
        makeSwatch(s, Math.max(0, v - 4.5), c, "シェード 3"),
      ];

    case "tint":
      // Base hue, progressively higher value and lower chroma (toward white).
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s, Math.min(10, v + 1.5), c * 0.8, "ティント 1"),
        makeSwatch(s, Math.min(10, v + 3), c * 0.6, "ティント 2"),
        makeSwatch(s, Math.min(10, v + 4.5), c * 0.4, "ティント 3"),
      ];

    default:
      return [makeSwatch(s, v, c, "ベース")];
  }
}

// ============================================================================
// System descriptor (common interface used by solid.js / main.js).
// Mirrors pccsSystem so the viewer can switch color systems uniformly.
// ============================================================================
export const munsellSystem = {
  id: "munsell",
  name: "マンセル",
  hueCount: 100,            // 100-step hue circle (continuous)
  hueSamples: 40,           // 40 angular samples (every 2.5 steps)
  hueMax: 100,              // hue circle length for distance math
  valueMin: 1,
  valueMax: 9,
  valueStep: 1,
  chromaMin: 2,
  chromaMax: 26,
  chromaStep: 2,
  radiusPerChroma: 0.18,
  valueCenter: 5,
  labels: { value: "明度", chroma: "彩度", hue: "色相" },
  // sample index 0..39 -> hue step 0..100
  sampleToStep: (i) => (i / 40) * 100,
  toSRGB: munsellToSRGB,
  fromSRGB: srgbToMunsell,
  format: formatMunsell,
  SCHEMES,
  generateScheme,
  // Short explanation shown in the viewer's info box.
  description: `
    <p>アメリカの美術教師 A. H. マンセルが考案し、のちに測色的に整備された表色系です。見た目の差が各段階でそろう「知覚的等歩度」を重視します。</p>
    <ul>
      <li><b>色相 (Hue)</b>: R・YR・Y・GY・G・BG・B・PB・P・RP の10色相を各10分割した100段階。中心が <code>5</code>（例 <code>5R</code>）。</li>
      <li><b>明度 (Value)</b>: 0（黒）〜10（白）。</li>
      <li><b>彩度 (Chroma)</b>: 無彩色の0から。上限は色相・明度で変わり、鮮やかな赤などは14以上に伸びる。</li>
      <li><b>表記</b>: <code>色相 明度/彩度</code>（例 <code>5R 4/14</code>）。無彩色は <code>N 5/</code>。</li>
    </ul>
    <p>彩度の上限が一定でないため色立体は非対称になります。塗料・土壌・品質基準など、色の正確な記述・管理に広く使われます。</p>`,
};
