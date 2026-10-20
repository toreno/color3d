// cielab.js
// CIELAB color solid, shown via its cylindrical form CIE LCh:
//   - Lightness L*   0..100  -> height.
//   - Chroma    C*   0..~130 -> radius.
//   - Hue       h    0..360  -> angle around the axis.
// Lab <-> sRGB is EXACT here (D65). Only colors inside the sRGB gamut are
// shown by default; because the Lab solid is much larger than sRGB, the
// visible shape is the true sRGB gamut (quite asymmetric).

const VALUE_MIN = 10;      // L*
const VALUE_MAX = 95;
const VALUE_STEP = 4;      // finer lightness steps so the solid reads clearly
const CHROMA_MIN = 10;     // C*
const CHROMA_MAX = 130;
const CHROMA_STEP = 10;
const HUE_COUNT = 360;

// D65 reference white.
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

// --- Forward: LCh -> Lab -> sRGB --------------------------------------------
// L in 0..100, C in 0..~130, h in degrees.
export function lchToSRGB(L, C, hDeg) {
  const h = (((hDeg % 360) + 360) % 360) * (Math.PI / 180);
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  return labToSRGB(L, a, b);
}

// Note the argument order for the solid: (hueStep, value, chroma).
export function cielabToSRGB(hueStep, value, chroma) {
  return lchToSRGB(value, chroma, hueStep);
}

// --- Reverse: sRGB -> LCh ---------------------------------------------------
export function srgbToCielab(r, g, b) {
  const lab = srgbToLab(r, g, b);
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  h = ((h % 360) + 360) % 360;
  return {
    step: h,            // hue angle
    value: lab.L,       // L*
    chroma: C,          // C*
    hex: rgbToHex(Math.round(r), Math.round(g), Math.round(b)),
  };
}

// --- Formatting -------------------------------------------------------------
export function formatCielab(hueStep, value, chroma) {
  if (chroma <= 0.5) {
    return `L*${value.toFixed(0)}（無彩色）`;
  }
  return `L*${value.toFixed(0)} C*${chroma.toFixed(0)} h${Math.round(((hueStep % 360) + 360) % 360)}`;
}

// ============================================================================
// Scheme generation on LCh axes. Hue in degrees; value=L*, chroma=C*.
// ============================================================================
export const SCHEMES = [
  { key: "complementary", name: "補色" },
  { key: "analogous", name: "類似色" },
  { key: "triad", name: "トライアド" },
  { key: "tetrad", name: "テトラード" },
  { key: "monochromatic", name: "モノクロマティック" },
  { key: "shade", name: "シェード" },
  { key: "tint", name: "ティント" },
];

function wrapHue(h) {
  return ((h % 360) + 360) % 360;
}

function makeSwatch(h, L, C, role) {
  L = Math.max(0, Math.min(100, L));
  C = Math.max(0, C);
  const col = lchToSRGB(L, C, h);
  const hw = wrapHue(h);
  return {
    step: hw,
    value: L,
    chroma: C,
    role,
    label: formatCielab(hw, L, C),
    hex: col.hex,
    rgb: [col.r, col.g, col.b],
    inGamut: col.inGamut,
  };
}

export function generateScheme(key, base) {
  const h = base.step;    // hue deg
  const L = base.value;   // L*
  const C = base.chroma;  // C*

  switch (key) {
    case "complementary":
      return [
        makeSwatch(h, L, C, "ベース"),
        makeSwatch(h + 180, L, C, "補色"),
        makeSwatch(h, Math.min(100, L + 15), C, "ベース(明)"),
        makeSwatch(h + 180, Math.min(100, L + 15), C, "補色(明)"),
      ];
    case "analogous":
      return [
        makeSwatch(h - 60, L, C, "類似 -2"),
        makeSwatch(h - 30, L, C, "類似 -1"),
        makeSwatch(h, L, C, "ベース"),
        makeSwatch(h + 30, L, C, "類似 +1"),
      ];
    case "triad":
      return [
        makeSwatch(h, L, C, "ベース"),
        makeSwatch(h + 120, L, C, "トライアド 2"),
        makeSwatch(h + 240, L, C, "トライアド 3"),
        makeSwatch(h, Math.min(100, L + 15), Math.max(0, C - 20), "ベース(淡)"),
      ];
    case "tetrad":
      return [
        makeSwatch(h, L, C, "ベース"),
        makeSwatch(h + 90, L, C, "テトラード 2"),
        makeSwatch(h + 180, L, C, "テトラード 3"),
        makeSwatch(h + 270, L, C, "テトラード 4"),
      ];
    case "monochromatic":
      return [
        makeSwatch(h, Math.max(10, L - 30), Math.max(10, C - 20), "暗く低彩度"),
        makeSwatch(h, L, C, "ベース"),
        makeSwatch(h, Math.min(95, L + 20), C, "明るく"),
        makeSwatch(h, Math.min(95, L + 30), Math.max(10, C - 30), "明るく低彩度"),
      ];
    case "shade":
      return [
        makeSwatch(h, L, C, "ベース"),
        makeSwatch(h, Math.max(10, L - 20), C, "シェード 1"),
        makeSwatch(h, Math.max(10, L - 40), C, "シェード 2"),
        makeSwatch(h, Math.max(10, L - 55), C, "シェード 3"),
      ];
    case "tint":
      return [
        makeSwatch(h, L, C, "ベース"),
        makeSwatch(h, Math.min(100, L + 15), C * 0.75, "ティント 1"),
        makeSwatch(h, Math.min(100, L + 25), C * 0.5, "ティント 2"),
        makeSwatch(h, Math.min(100, L + 35), C * 0.3, "ティント 3"),
      ];
    default:
      return [makeSwatch(h, L, C, "ベース")];
  }
}

// --- Color space plumbing: CIELAB (D65) <-> sRGB ----------------------------
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

function srgbToLab(r, g, b) {
  const rl = invGamma(r / 255);
  const gl = invGamma(g / 255);
  const bl = invGamma(b / 255);

  const X = 0.4124 * rl + 0.3576 * gl + 0.1805 * bl;
  const Y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const Z = 0.0193 * rl + 0.1192 * gl + 0.9505 * bl;

  const fx = labF(X / Xn);
  const fy = labF(Y / Yn);
  const fz = labF(Z / Zn);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function labInv(f) {
  const f3 = f * f * f;
  return f3 > 0.008856 ? f3 : (f - 16 / 116) / 7.787;
}
function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}
function invGamma(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
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
// System descriptor.
// ============================================================================
export const cielabSystem = {
  id: "cielab",
  name: "CIELAB",
  hueCount: HUE_COUNT,
  hueSamples: 36,            // every 10 degrees
  hueMax: 360,
  valueMin: VALUE_MIN,
  valueMax: VALUE_MAX,
  valueStep: VALUE_STEP,
  chromaMin: CHROMA_MIN,
  chromaMax: CHROMA_MAX,
  chromaStep: CHROMA_STEP,
  radiusPerChroma: 0.035,    // C* up to ~130 -> radius up to ~4.5
  valueCenter: 50,           // center height at L*=50
  // L* spans 0..100, so use a small per-value height (span 85 * 0.085 ~= 7.2).
  heightPerValue: 0.085,
  labels: { value: "明度(L*)", chroma: "彩度(C*)", hue: "色相(h)" },
  // sample index 0..35 -> hue 0..360
  sampleToStep: (i) => (i / 36) * 360,
  toSRGB: cielabToSRGB,
  fromSRGB: srgbToCielab,
  format: formatCielab,
  SCHEMES,
  generateScheme,
  description: `
    <p>CIE が定めた<b>知覚的に均等</b>な色空間です。人の見た目の差と数値の差が近くなるよう設計され、色差(ΔE)の計算などに使われます。本アプリでは円柱形の <b>LCh</b> 表示（明度 L*・彩度 C*・色相 h）で見せています。</p>
    <ul>
      <li><b>明度 (L*)</b>: 0（黒）〜100（白）。</li>
      <li><b>彩度 (C*)</b>: 0（無彩色）から。鮮やかなほど大きい。</li>
      <li><b>色相 (h)</b>: 0〜360°。</li>
      <li><b>表記</b>: <code>L*.. C*.. h..</code>（例 <code>L*60 C*40 h210</code>）。</li>
    </ul>
    <p>Lab→sRGB は<b>厳密</b>です。表示される立体は sRGB で表せる範囲（＝実際の画面で出せる色の形）で、色相や明度ごとに出せる彩度が違うため非対称になります。</p>`,
};
