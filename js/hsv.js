// hsv.js
// HSV (Hue / Saturation / Value) color solid. Unlike Munsell/PCCS/CIELAB this
// is a direct, EXACT transform to/from sRGB (no CIELAB approximation), so the
// colors are precise. The solid is a full cylinder:
//   - Hue (色相)       0..360 deg  -> angle around the axis.
//   - Value (明度)     0..100 (%)  -> height.
//   - Saturation (彩度) 0..100 (%) -> radius.

// --- Axis ranges / sampling -------------------------------------------------
// Value sampled 10..100 in steps of 10 (keep 0 off: it is pure black for all
// hues and would collapse to a point). Saturation sampled 20..100 step 20.
const VALUE_MIN = 10;
const VALUE_MAX = 100;
const VALUE_STEP = 5;      // finer value steps so the solid reads clearly
const SAT_MIN = 20;
const SAT_MAX = 100;
const SAT_STEP = 20;
const HUE_COUNT = 360;

// --- Forward: HSV -> sRGB (exact) -------------------------------------------
// h in degrees (0..360), s and v in 0..100.
export function hsvToSRGB(h, v, s) {
  const H = (((h % 360) + 360) % 360) / 60;
  const S = Math.max(0, Math.min(1, s / 100));
  const V = Math.max(0, Math.min(1, v / 100));

  const c = V * S;
  const x = c * (1 - Math.abs((H % 2) - 1));
  const m = V - c;

  let r1 = 0, g1 = 0, b1 = 0;
  if (H < 1) [r1, g1, b1] = [c, x, 0];
  else if (H < 2) [r1, g1, b1] = [x, c, 0];
  else if (H < 3) [r1, g1, b1] = [0, c, x];
  else if (H < 4) [r1, g1, b1] = [0, x, c];
  else if (H < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  // HSV always maps into sRGB, so every chip is in gamut.
  return { r, g, b, inGamut: true, hex: rgbToHex(r, g, b) };
}

// --- Reverse: sRGB -> HSV ---------------------------------------------------
export function srgbToHSV(r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  h = ((h % 360) + 360) % 360;

  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  return { step: h, value: v, chroma: s, hex: rgbToHex(Math.round(r), Math.round(g), Math.round(b)) };
}

// --- Formatting -------------------------------------------------------------
export function formatHSV(h, v, s) {
  if (s <= 0.5) {
    // Achromatic: only value matters.
    return `V${Math.round(v)}（無彩色）`;
  }
  return `H${Math.round(((h % 360) + 360) % 360)} S${Math.round(s)} V${Math.round(v)}`;
}

// ============================================================================
// Scheme generation on HSV axes. Hue in degrees; value=V, chroma=S.
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

function makeSwatch(h, v, s, role) {
  v = Math.max(0, Math.min(100, v));
  s = Math.max(0, Math.min(100, s));
  const col = hsvToSRGB(h, v, s);
  const hw = wrapHue(h);
  return {
    step: hw,
    value: v,
    chroma: s,
    role,
    label: formatHSV(hw, v, s),
    hex: col.hex,
    rgb: [col.r, col.g, col.b],
    inGamut: col.inGamut,
  };
}

export function generateScheme(key, base) {
  const h = base.step;    // hue deg
  const v = base.value;   // V
  const s = base.chroma;  // S

  switch (key) {
    case "complementary":
      return [
        makeSwatch(h, v, s, "ベース"),
        makeSwatch(h + 180, v, s, "補色"),
        makeSwatch(h, Math.min(100, v + 15), s, "ベース(明)"),
        makeSwatch(h + 180, Math.min(100, v + 15), s, "補色(明)"),
      ];
    case "analogous":
      return [
        makeSwatch(h - 60, v, s, "類似 -2"),
        makeSwatch(h - 30, v, s, "類似 -1"),
        makeSwatch(h, v, s, "ベース"),
        makeSwatch(h + 30, v, s, "類似 +1"),
      ];
    case "triad":
      return [
        makeSwatch(h, v, s, "ベース"),
        makeSwatch(h + 120, v, s, "トライアド 2"),
        makeSwatch(h + 240, v, s, "トライアド 3"),
        makeSwatch(h, Math.min(100, v + 15), Math.max(0, s - 20), "ベース(淡)"),
      ];
    case "tetrad":
      return [
        makeSwatch(h, v, s, "ベース"),
        makeSwatch(h + 90, v, s, "テトラード 2"),
        makeSwatch(h + 180, v, s, "テトラード 3"),
        makeSwatch(h + 270, v, s, "テトラード 4"),
      ];
    case "monochromatic":
      return [
        makeSwatch(h, Math.max(10, v - 30), Math.max(20, s - 20), "暗く低彩度"),
        makeSwatch(h, v, s, "ベース"),
        makeSwatch(h, Math.min(100, v + 20), s, "明るく"),
        makeSwatch(h, Math.min(100, v + 30), Math.max(20, s - 30), "明るく低彩度"),
      ];
    case "shade":
      return [
        makeSwatch(h, v, s, "ベース"),
        makeSwatch(h, Math.max(10, v - 20), s, "シェード 1"),
        makeSwatch(h, Math.max(10, v - 40), s, "シェード 2"),
        makeSwatch(h, Math.max(10, v - 60), s, "シェード 3"),
      ];
    case "tint":
      return [
        makeSwatch(h, v, s, "ベース"),
        makeSwatch(h, Math.min(100, v + 10), s * 0.75, "ティント 1"),
        makeSwatch(h, Math.min(100, v + 15), s * 0.5, "ティント 2"),
        makeSwatch(h, Math.min(100, v + 20), s * 0.3, "ティント 3"),
      ];
    default:
      return [makeSwatch(h, v, s, "ベース")];
  }
}

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

// ============================================================================
// System descriptor (common interface used by solid.js / main.js).
// ============================================================================
export const hsvSystem = {
  id: "hsv",
  name: "HSV",
  hueCount: HUE_COUNT,
  hueSamples: 36,            // every 10 degrees
  hueMax: 360,
  valueMin: VALUE_MIN,
  valueMax: VALUE_MAX,
  valueStep: VALUE_STEP,
  chromaMin: SAT_MIN,
  chromaMax: SAT_MAX,
  chromaStep: SAT_STEP,
  radiusPerChroma: 0.045,    // S up to 100 -> radius up to ~4.5
  valueCenter: 50,           // center height at V=50
  // Value spans 0..100, so use a small per-value height to keep the solid
  // from stretching vertically (span 90 * 0.08 ~= 7.2, like Munsell/PCCS).
  heightPerValue: 0.08,
  labels: { value: "明度(V)", chroma: "彩度(S)", hue: "色相(H)" },
  // sample index 0..35 -> hue 0..360
  sampleToStep: (i) => (i / 36) * 360,
  toSRGB: hsvToSRGB,
  fromSRGB: srgbToHSV,
  format: formatHSV,
  SCHEMES,
  generateScheme,
  description: `
    <p>コンピューターで広く使われる色の表し方です。色相(Hue)・彩度(Saturation)・明度(Value/Brightness)の3つで表します。sRGB と相互に<b>正確に</b>変換できます。</p>
    <ul>
      <li><b>色相 (H)</b>: 0〜360°。0=赤, 120=緑, 240=青。</li>
      <li><b>彩度 (S)</b>: 0〜100%。0でグレー、100で最も鮮やか。</li>
      <li><b>明度 (V)</b>: 0〜100%。0で黒。</li>
      <li><b>表記</b>: 本アプリでは <code>H.. S.. V..</code>（例 <code>H210 S80 V90</code>）。</li>
    </ul>
    <p>色立体はきれいな<b>円柱</b>になります（マンセル/PCCSの非対称な形と見比べると違いが分かります）。Webやデザインツールの色指定に向いています。</p>`,
};
