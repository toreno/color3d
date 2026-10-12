// pccs.js
// PCCS (Practical Color Co-ordinate System, 日本色研配色体系) color solid,
// approximated via CIELAB in the same spirit as munsell.js.
//
// PCCS axes used here:
//   - Hue (色相):      1..24, equally spaced around the circle. 1=pR ... 24=RP.
//   - Lightness (明度): 1.0..9.5 (we sample ~1..9).
//   - Saturation (彩度): 1s..9s (chroma-like, 1..9).
//
// Approach: map Hue -> CIELAB hue angle, Lightness -> L*, Saturation -> C*,
// then CIELAB(D65) -> sRGB (exact). This keeps hues reasonable and reproduces
// the solid's shape. It is an approximation for teaching / exploration, NOT a
// colorimetric PCCS conversion.

// PCCS 24 hues, with their conventional tone-symbol hue names.
export const PCCS_HUE_NAMES = [
  "1:pR", "2:R", "3:yR", "4:rO", "5:O", "6:yO",
  "7:rY", "8:Y", "9:gY", "10:YG", "11:yG", "12:G",
  "13:bG", "14:BG", "15:BG", "16:gB", "17:B", "18:B",
  "19:pB", "20:V", "21:bP", "22:P", "23:rP", "24:RP",
];

export const HUE_COUNT = 24;

// --- Axis ranges / sampling -------------------------------------------------
const VALUE_MIN = 1;      // lightness
const VALUE_MAX = 9;
const VALUE_STEP = 1;
const CHROMA_MIN = 1;     // saturation steps 1s..9s
const CHROMA_MAX = 9;
const CHROMA_STEP = 1;

// --- Hue -> CIELAB angle ----------------------------------------------------
// PCCS hue 1 (pR) sits near red; hues advance R -> O -> Y -> G -> B -> P -> RP.
// We anchor to CIELAB angles that roughly match that progression. PCCS hue 2
// (R) is the "pure red" reference; align it near CIELAB ~34deg (as Munsell 5R).
// Then wrap evenly. The circle direction in CIELAB (a*,b*) goes red(0) ->
// yellow(90) -> green(180) -> blue(270), i.e. increasing angle = R->Y->G->B,
// which matches PCCS hue numbering order, so we can map near-linearly with a
// small set of anchors for better fidelity.
//
// Anchor table: PCCS hue number -> CIELAB hue angle (deg).
const HUE_ANCHORS = [
  { h: 2, a: 34 },    // R  (pure red)
  { h: 5, a: 55 },    // O  (orange)
  { h: 8, a: 90 },    // Y  (yellow)
  { h: 11, a: 125 },  // yG
  { h: 12, a: 150 },  // G
  { h: 14, a: 185 },  // BG
  { h: 17, a: 230 },  // B
  { h: 19, a: 270 },  // pB
  { h: 20, a: 300 },  // V  (violet)
  { h: 22, a: 325 },  // P  (purple)
  { h: 24, a: 352 },  // RP
];

function pccsHueToLabAngle(hue) {
  // Wrap hue into [1,24].
  hue = ((((hue - 1) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT) + 1;

  // Find the two anchors surrounding this hue (circularly) and interpolate the
  // angle along the shorter arc.
  const anchors = HUE_ANCHORS;
  for (let i = 0; i < anchors.length; i++) {
    const cur = anchors[i];
    const nxt = anchors[(i + 1) % anchors.length];

    // Hue span from cur to nxt, going forward around 1..24.
    let hSpan = nxt.h - cur.h;
    if (hSpan <= 0) hSpan += HUE_COUNT;

    let hRel = hue - cur.h;
    if (hRel < 0) hRel += HUE_COUNT;

    if (hRel <= hSpan) {
      const frac = hSpan === 0 ? 0 : hRel / hSpan;
      let aSpan = nxt.a - cur.a;
      if (aSpan <= -180) aSpan += 360;
      if (aSpan > 180) aSpan -= 360;
      // ensure forward (increasing) wrap for the R->Y->G->B->P direction
      if (aSpan < 0) aSpan += 360;
      let angle = cur.a + aSpan * frac;
      return ((angle % 360) + 360) % 360;
    }
  }
  return 34;
}

// Inverse: CIELAB hue angle -> PCCS hue number (1..24).
function labAngleToPccsHue(angleDeg) {
  angleDeg = ((angleDeg % 360) + 360) % 360;
  const anchors = HUE_ANCHORS;
  for (let i = 0; i < anchors.length; i++) {
    const cur = anchors[i];
    const nxt = anchors[(i + 1) % anchors.length];

    let aSpan = nxt.a - cur.a;
    if (aSpan < 0) aSpan += 360;

    let aRel = angleDeg - cur.a;
    if (aRel < 0) aRel += 360;

    if (aRel <= aSpan) {
      const frac = aSpan === 0 ? 0 : aRel / aSpan;
      let hSpan = nxt.h - cur.h;
      if (hSpan <= 0) hSpan += HUE_COUNT;
      let hue = cur.h + hSpan * frac;
      hue = ((((hue - 1) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT) + 1;
      return hue;
    }
  }
  return 2;
}

// --- Lightness <-> L* -------------------------------------------------------
// PCCS lightness ~1..9.5 maps roughly linearly to L* 0..100.
function lightnessToL(V) {
  return Math.max(0, Math.min(100, (V / 9.5) * 100));
}
function lToLightness(L) {
  return Math.max(0, Math.min(9.5, (L / 100) * 9.5));
}

// --- Saturation -> CIELAB chroma --------------------------------------------
// Each PCCS saturation step is ~8 CIELAB C* units.
const SAT_TO_LAB = 8.0;

// --- Forward: PCCS -> sRGB --------------------------------------------------
export function pccsToSRGB(hue, lightness, saturation) {
  const L = lightnessToL(lightness);
  const Cstar = saturation * SAT_TO_LAB;
  const h = (pccsHueToLabAngle(hue) * Math.PI) / 180;
  const a = Cstar * Math.cos(h);
  const b = Cstar * Math.sin(h);
  return labToSRGB(L, a, b);
}

// --- Reverse: sRGB -> PCCS --------------------------------------------------
export function srgbToPccs(r, g, b) {
  const lab = srgbToLab(r, g, b);
  const Cstar = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  const lightness = lToLightness(lab.L);
  const saturation = Cstar / SAT_TO_LAB;
  let hue;
  if (Cstar < 1e-3) {
    hue = 1; // neutral; hue undefined
  } else {
    const angle = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    hue = labAngleToPccsHue(angle);
  }
  return {
    step: hue,
    value: lightness,
    chroma: saturation,
    hex: rgbToHex(Math.round(r), Math.round(g), Math.round(b)),
  };
}

// --- Formatting -------------------------------------------------------------
export function formatPccs(hue, lightness, saturation) {
  if (saturation <= 0.05) {
    // Neutral: PCCS uses nN notation (e.g. n5).
    return "n" + lightness.toFixed(1);
  }
  const h = Math.round(((((hue - 1) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT) + 1);
  const name = PCCS_HUE_NAMES[h - 1] || h;
  return `${name} ${lightness.toFixed(1)}-${saturation.toFixed(1)}s`;
}

// ============================================================================
// Scheme generation (same keys/labels as Munsell), operating on PCCS axes.
// Hue manipulated in PCCS steps (24-step circle). value=lightness,
// chroma=saturation.
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
  return ((((h - 1) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT) + 1;
}

function makeSwatch(hue, lightness, saturation, role) {
  lightness = Math.max(0, Math.min(9.5, lightness));
  saturation = Math.max(0, saturation);
  const col = pccsToSRGB(hue, lightness, saturation);
  const h = wrapHue(hue);
  return {
    step: h,
    value: lightness,
    chroma: saturation,
    role,
    label: formatPccs(h, lightness, saturation),
    hex: col.hex,
    rgb: [col.r, col.g, col.b],
    inGamut: col.inGamut,
  };
}

export function generateScheme(key, base) {
  const s = base.step;        // hue 1..24
  const v = base.value;       // lightness
  const c = base.chroma;      // saturation

  switch (key) {
    case "complementary":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 12, v, c, "補色"),
        makeSwatch(s, Math.min(9.5, v + 2), c, "ベース(明)"),
        makeSwatch(s + 12, Math.min(9.5, v + 2), c, "補色(明)"),
      ];

    case "analogous":
      return [
        makeSwatch(s - 4, v, c, "類似 -2"),
        makeSwatch(s - 2, v, c, "類似 -1"),
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 2, v, c, "類似 +1"),
      ];

    case "triad":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 8, v, c, "トライアド 2"),
        makeSwatch(s + 16, v, c, "トライアド 3"),
        makeSwatch(s, Math.min(9.5, v + 2), Math.max(1, c - 2), "ベース(淡)"),
      ];

    case "tetrad":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s + 6, v, c, "テトラード 2"),
        makeSwatch(s + 12, v, c, "テトラード 3"),
        makeSwatch(s + 18, v, c, "テトラード 4"),
      ];

    case "monochromatic":
      return [
        makeSwatch(s, Math.max(1, v - 3), Math.max(1, c - 2), "暗く低彩度"),
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s, Math.min(9, v + 2), c, "明るく"),
        makeSwatch(s, Math.min(9.5, v + 3), Math.max(1, c - 3), "明るく低彩度"),
      ];

    case "shade":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s, Math.max(1, v - 1.5), c, "シェード 1"),
        makeSwatch(s, Math.max(1, v - 3), c, "シェード 2"),
        makeSwatch(s, Math.max(1, v - 4.5), c, "シェード 3"),
      ];

    case "tint":
      return [
        makeSwatch(s, v, c, "ベース"),
        makeSwatch(s, Math.min(9.5, v + 1.5), c * 0.8, "ティント 1"),
        makeSwatch(s, Math.min(9.5, v + 3), c * 0.6, "ティント 2"),
        makeSwatch(s, Math.min(9.5, v + 4.5), c * 0.4, "ティント 3"),
      ];

    default:
      return [makeSwatch(s, v, c, "ベース")];
  }
}

// ============================================================================
// Color space plumbing: CIELAB (D65) <-> sRGB. (Mirrors munsell.js.)
// ============================================================================
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
// System descriptor (common interface used by solid.js / main.js).
// ============================================================================
export const pccsSystem = {
  id: "pccs",
  name: "PCCS",
  // Sampling / layout parameters for the solid.
  hueCount: HUE_COUNT,       // 24 discrete hues
  hueSamples: HUE_COUNT,     // sample every discrete hue
  hueMax: HUE_COUNT,         // hue "circle length" for distance math
  valueMin: VALUE_MIN,
  valueMax: VALUE_MAX,
  valueStep: VALUE_STEP,
  chromaMin: CHROMA_MIN,
  chromaMax: CHROMA_MAX,
  chromaStep: CHROMA_STEP,
  radiusPerChroma: 0.5,      // saturation 1..9 -> visual radius
  valueCenter: 5,            // center lightness for vertical centering
  labels: { value: "明度", chroma: "彩度", hue: "色相" },
  // Convert a hue sample index (0..hueSamples-1) to a hue "step" value.
  sampleToStep: (i) => i + 1,              // hue 1..24
  toSRGB: pccsToSRGB,
  fromSRGB: srgbToPccs,
  format: formatPccs,
  SCHEMES,
  generateScheme,
  // Short explanation shown in the viewer's info box.
  description: `
    <p>日本色彩研究所が<b>配色</b>のために開発した表色系です。明度と彩度をまとめて捉える「<b>トーン（色調）</b>」が最大の特徴で、配色やデザイン教育で重宝されます。</p>
    <ul>
      <li><b>色相 (Hue)</b>: 24色相を等間隔に配置（1:pR 〜 24:RP）。心理4原色（赤・黄・緑・青）が基準。</li>
      <li><b>明度 (Lightness)</b>: およそ 1.0〜9.5。</li>
      <li><b>彩度 (Saturation)</b>: 1s〜9s の9段階。</li>
      <li><b>トーン</b>: v・b・s・dp・lt・sf・d・dk・p・ltg・g・dkg の12トーンで明度・彩度を整理。「同じトーンで色相だけ変える」配色がしやすい。</li>
      <li><b>表記</b>: 本アプリでは <code>色相 明度-彩度s</code>（例 <code>2:R 4.0-9.0s</code>）。無彩色は <code>n5</code>。</li>
    </ul>
    <p>色を正確に伝えたいならマンセル、色を組み合わせたいなら PCCS が向いています。</p>`,
};
