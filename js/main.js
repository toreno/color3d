// main.js
// Scene setup, interaction, and UI wiring for the Munsell color solid viewer.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildSolid } from "./solid.js";
import { munsellSystem } from "./munsell.js";
import { pccsSystem } from "./pccs.js";

// Available color systems, keyed by id.
const SYSTEMS = { munsell: munsellSystem, pccs: pccsSystem };
// The active system descriptor (set in initSystemUI / switchSystem).
let system = munsellSystem;

const canvasHost = document.getElementById("viewer");
const infoPanel = document.getElementById("info");
const valueButtonsHost = document.getElementById("valueButtons");
const valueLabel = document.getElementById("valueLabel");
const sliceToggle = document.getElementById("sliceToggle");
const chromaButtonsHost = document.getElementById("chromaButtons");
const chromaLabel = document.getElementById("chromaLabel");
const chromaSliceToggle = document.getElementById("chromaSliceToggle");
const gamutToggle = document.getElementById("gamutToggle");

// System switch (header).
const systemSelect = document.getElementById("systemSelect");

// Harmony UI elements.
const baseColorInput = document.getElementById("baseColor");
const useSelectedBtn = document.getElementById("useSelected");
const schemeSelect = document.getElementById("schemeSelect");
const schemeResult = document.getElementById("schemeResult");
const schemeFilterToggle = document.getElementById("schemeFilterToggle");

let renderer, scene, camera, controls;
let solid = null;        // { group, mesh, chips }
let highlightMesh = null;
let schemeOutlines = []; // outline boxes marking the active scheme's chips

// Current base color on the active system's axes { step, value, chroma }.
let baseMunsell = null;
let lastSelectedChip = null;
// Chip indices that the active scheme maps onto the solid (one per scheme color).
let schemeChipIndices = [];
// Value levels currently selected for the slice (multi-select). Empty = none.
let selectedValues = new Set();
// Chroma levels currently selected for the chroma slice (multi-select).
let selectedChromas = new Set();

init();
initSystemUI();
rebuildSolid();
initHarmonyUI();
animate();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d23);

  const { clientWidth: w, clientHeight: h } = canvasHost;
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  camera.position.set(10, 6, 14);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasHost.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  // Lighting: mostly ambient so chip colors read true, plus a soft key light.
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.5);
  key.position.set(8, 12, 10);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-8, -4, -10);
  scene.add(fill);

  // Vertical value axis guide (sized to the active system's value range).
  const axisH = (system.valueMax - system.valueMin + 2) * 0.9;
  const axisGeo = new THREE.CylinderGeometry(0.03, 0.03, axisH, 8);
  const axisMat = new THREE.MeshBasicMaterial({ color: 0x555860 });
  scene.add(new THREE.Mesh(axisGeo, axisMat));

  // Highlight marker for the selected chip (a wireframe cube).
  const hlGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const hlMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
  });
  highlightMesh = new THREE.Mesh(hlGeo, hlMat);
  highlightMesh.visible = false;

  // Outline boxes that mark the active scheme's chips in the solid. We create
  // a small reusable pool (one per scheme color) using crisp cube edges.
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 0.62, 0.62));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 8; i++) {
    const outline = new THREE.LineSegments(edgeGeo, edgeMat);
    outline.visible = false;
    outline.renderOrder = 2;
    schemeOutlines.push(outline);
    scene.add(outline);
  }
  scene.add(highlightMesh);

  // Events.
  window.addEventListener("resize", onResize);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);

  sliceToggle.addEventListener("change", () => {
    // Slice and scheme filter are mutually exclusive; turning one on clears
    // the other for clarity.
    if (sliceToggle.checked && schemeFilterToggle.checked) {
      schemeFilterToggle.checked = false;
    }
    // When enabling the slice with nothing chosen, start from the middle value
    // (like a single slice); the user can then add/remove levels.
    if (sliceToggle.checked && selectedValues.size === 0) {
      selectedValues.add(system.valueCenter);
    }
    syncValueButtons();
    onSliceChange();
  });

  chromaSliceToggle.addEventListener("change", () => {
    if (chromaSliceToggle.checked && schemeFilterToggle.checked) {
      schemeFilterToggle.checked = false;
    }
    // When enabling with nothing chosen, start from the lowest chroma present.
    if (chromaSliceToggle.checked && selectedChromas.size === 0) {
      const chromas = availableChromas();
      if (chromas.length) selectedChromas.add(chromas[0]);
    }
    syncChromaButtons();
    onSliceChange();
  });

  gamutToggle.addEventListener("change", rebuildSolid);
}

function rebuildSolid() {
  if (solid) {
    scene.remove(solid.group);
    solid.mesh.geometry.dispose();
    solid.mesh.material.dispose();
  }
  solid = buildSolid(system, { includeOutOfGamut: gamutToggle.checked });
  scene.add(solid.group);
  highlightMesh.visible = false;
  // Chroma buttons depend on which chroma values actually exist in the solid,
  // so (re)build them whenever the solid changes.
  buildChromaButtons();
  // A rebuilt solid has new chip indices; recompute the scheme mapping.
  updateSchemeChipMapping();
  applyVisibility();
}

// --- Color system switching -------------------------------------------------
function initSystemUI() {
  Object.values(SYSTEMS).forEach((sys) => {
    const opt = document.createElement("option");
    opt.value = sys.id;
    opt.textContent = sys.name;
    systemSelect.appendChild(opt);
  });
  systemSelect.value = system.id;
  systemSelect.addEventListener("change", () => switchSystem(systemSelect.value));
  updateSystemInfo();
  buildValueButtons();
}

// --- Value slice buttons (multi-select) -------------------------------------
// Build one toggle button per value level of the active system. Clicking a
// button adds/removes that value from the slice selection.
function buildValueButtons() {
  valueButtonsHost.innerHTML = "";
  // Keep only selections that are valid in the current system's range.
  const valid = new Set();
  for (let v = system.valueMin; v <= system.valueMax; v += system.valueStep) {
    valid.add(v);
  }
  selectedValues = new Set([...selectedValues].filter((v) => valid.has(v)));

  for (let v = system.valueMin; v <= system.valueMax; v += system.valueStep) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "value-btn";
    btn.textContent = String(v);
    btn.dataset.value = String(v);
    btn.addEventListener("click", () => toggleValue(v));
    valueButtonsHost.appendChild(btn);
  }
  syncValueButtons();
}

function toggleValue(v) {
  // Interacting with a value implies the slice should be active.
  if (!sliceToggle.checked) {
    sliceToggle.checked = true;
    if (schemeFilterToggle.checked) schemeFilterToggle.checked = false;
  }
  if (selectedValues.has(v)) selectedValues.delete(v);
  else selectedValues.add(v);
  syncValueButtons();
  onSliceChange();
}

// Reflect selection state (and enabled/disabled look) on the buttons.
function syncValueButtons() {
  const on = sliceToggle.checked;
  valueButtonsHost
    .querySelectorAll(".value-btn")
    .forEach((btn) => {
      const v = parseInt(btn.dataset.value, 10);
      btn.classList.toggle("selected", on && selectedValues.has(v));
      btn.classList.toggle("dimmed", !on);
    });
}

// --- Chroma slice buttons (multi-select) ------------------------------------
// Distinct chroma values that actually exist in the current solid (method A:
// only real chips, so no empty buttons). Neutral axis (chroma 0) is excluded.
function availableChromas() {
  if (!solid) return [];
  const set = new Set();
  solid.chips.forEach((chip) => {
    if (!chip.neutral && chip.chroma > 0) set.add(chip.chroma);
  });
  return [...set].sort((a, b) => a - b);
}

// Build one toggle button per chroma value present in the solid.
function buildChromaButtons() {
  chromaButtonsHost.innerHTML = "";
  const chromas = availableChromas();

  // Drop any selected chroma that no longer exists (e.g. after a gamut/system
  // change shrinks the solid).
  const valid = new Set(chromas);
  selectedChromas = new Set([...selectedChromas].filter((c) => valid.has(c)));

  chromas.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "value-btn";
    // Chromas may be non-integer in theory; show a compact label.
    btn.textContent = Number.isInteger(c) ? String(c) : c.toFixed(1);
    btn.dataset.chroma = String(c);
    btn.addEventListener("click", () => toggleChroma(c));
    chromaButtonsHost.appendChild(btn);
  });
  syncChromaButtons();
}

function toggleChroma(c) {
  if (!chromaSliceToggle.checked) {
    chromaSliceToggle.checked = true;
    if (schemeFilterToggle.checked) schemeFilterToggle.checked = false;
  }
  if (selectedChromas.has(c)) selectedChromas.delete(c);
  else selectedChromas.add(c);
  syncChromaButtons();
  onSliceChange();
}

function syncChromaButtons() {
  const on = chromaSliceToggle.checked;
  chromaButtonsHost.querySelectorAll(".value-btn").forEach((btn) => {
    const c = parseFloat(btn.dataset.chroma);
    btn.classList.toggle("selected", on && selectedChromas.has(c));
    btn.classList.toggle("dimmed", !on);
  });
}

// Fill the collapsible "<system>とは" info box with the active system's text.
function updateSystemInfo() {
  const title = document.getElementById("systemInfoTitle");
  const body = document.getElementById("systemInfoBody");
  if (title) title.textContent = system.name + "とは";
  if (body) body.innerHTML = system.description || "";
}

function switchSystem(id) {
  const next = SYSTEMS[id];
  if (!next || next === system) return;
  system = next;

  // Rebuild the value-slice buttons for the new system's range.
  buildValueButtons();

  // Rebuild axis-dependent UI, the solid, and the harmony panel.
  updateAxisLabels();
  updateSystemInfo();
  rebuildSolid();
  // Re-express the current base color on the new system's axes.
  setBaseFromHex(baseColorInput.value);
  refreshSchemeOptions();
  onSliceChange();
}

function updateAxisLabels() {
  // Reflect axis names in the slice controls if present.
  const vLabel = document.getElementById("valueAxisName");
  if (vLabel) vLabel.textContent = system.labels.value;
  const cLabel = document.getElementById("chromaAxisName");
  if (cLabel) cLabel.textContent = system.labels.chroma;
}

// --- Slice label refresh + visibility ---------------------------------------
function onSliceChange() {
  // Value slice label.
  if (!sliceToggle.checked) {
    valueLabel.textContent = "すべて";
  } else if (selectedValues.size === 0) {
    valueLabel.textContent = system.labels.value + "を選択してください";
  } else {
    const vs = [...selectedValues].sort((a, b) => a - b);
    valueLabel.textContent = system.labels.value + " = " + vs.join(", ");
  }

  // Chroma slice label.
  if (!chromaSliceToggle.checked) {
    chromaLabel.textContent = "すべて";
  } else if (selectedChromas.size === 0) {
    chromaLabel.textContent = system.labels.chroma + "を選択してください";
  } else {
    const cs = [...selectedChromas].sort((a, b) => a - b);
    chromaLabel.textContent = system.labels.chroma + " = " + cs.join(", ");
  }

  applyVisibility();
}

// --- Unified visibility -----------------------------------------------------
// Decides which chips are shown.
//   1. Scheme filter ON -> show only the chips matching the active scheme.
//   2. Otherwise        -> apply the value and chroma slices (AND). A slice
//      that is off does not constrain. Neutral (chroma 0) chips are hidden
//      while the chroma slice is active, since it isolates specific chroma.
function applyVisibility() {
  if (!solid) return;

  const schemeOn = schemeFilterToggle && schemeFilterToggle.checked;
  const valueOn = sliceToggle.checked;
  const chromaOn = chromaSliceToggle.checked;

  const dummy = new THREE.Object3D();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  // Fast lookup for scheme chip membership.
  const schemeSet = schemeOn ? new Set(schemeChipIndices) : null;

  solid.chips.forEach((chip) => {
    let visible;
    if (schemeOn) {
      visible = schemeSet.has(chip.index);
    } else {
      visible = true;
      if (valueOn) visible = visible && selectedValues.has(chip.value);
      if (chromaOn) {
        // Neutral chips (chroma 0) have no chroma button; hide them when the
        // chroma slice is active.
        visible =
          visible && !chip.neutral && selectedChromas.has(chip.chroma);
      }
    }

    if (visible) {
      dummy.position.copy(chip.position);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      solid.mesh.setMatrixAt(chip.index, dummy.matrix);
      chip.hiddenBySlice = false;
    } else {
      solid.mesh.setMatrixAt(chip.index, hidden);
      chip.hiddenBySlice = true;
    }
  });
  solid.mesh.instanceMatrix.needsUpdate = true;

  // Refresh outlines so they hide/show with their chips.
  updateSchemeOutlines();
}

// Find, for each color in the active scheme, the nearest chip in the solid
// (by Munsell step/value/chroma distance). Stores their indices.
function updateSchemeChipMapping() {
  schemeChipIndices = [];
  if (!solid || !baseMunsell) return;

  const key = schemeSelect.value || system.SCHEMES[0].key;
  const swatches = system.generateScheme(key, baseMunsell);

  // Hue circle length depends on the active system (Munsell 100, PCCS 24).
  const hueMax = system.hueMax;
  const half = hueMax / 2;
  // Scale hue distance so it is comparable across systems before weighting.
  const hueScale = 100 / hueMax;

  swatches.forEach((sw) => {
    let best = -1;
    let bestDist = Infinity;
    solid.chips.forEach((chip) => {
      // Hue distance on the circle (shortest arc), normalized across systems.
      let dh = Math.abs(chip.step - sw.step);
      if (dh > half) dh = hueMax - dh;
      dh *= hueScale;
      const dv = chip.value - sw.value;
      const dc = chip.chroma - sw.chroma;
      // Weight hue a bit more so we land on the right color family.
      const dist = (dh * 0.5) ** 2 + dv * dv + dc * dc;
      if (dist < bestDist) {
        bestDist = dist;
        best = chip.index;
      }
    });
    if (best >= 0) schemeChipIndices.push(best);
  });

  updateSchemeOutlines();
}

// Place an outline box on each chip the active scheme maps to, so the four
// scheme colors are identifiable inside the solid. Outlines follow the chips
// and hide along with any chip that the current slice has hidden.
function updateSchemeOutlines() {
  schemeOutlines.forEach((o) => (o.visible = false));
  if (!solid) return;

  schemeChipIndices.forEach((chipIndex, i) => {
    const outline = schemeOutlines[i];
    if (!outline) return;
    const chip = solid.chips[chipIndex];
    if (!chip || chip.hiddenBySlice) return;
    outline.position.copy(chip.position);
    outline.visible = true;
  });
}

// --- Picking ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObject(solid.mesh, false);
  if (hit.length > 0) {
    // Find the closest hit that isn't hidden by the slice.
    for (const h of hit) {
      const chip = solid.chips[h.instanceId];
      if (chip && !chip.hiddenBySlice) {
        selectChip(chip);
        return;
      }
    }
  }
}

function selectChip(chip) {
  highlightMesh.position.copy(chip.position);
  highlightMesh.visible = true;
  lastSelectedChip = chip;

  const [r, g, b] = chip.rgb;
  infoPanel.innerHTML = `
    <div class="swatch" style="background:${chip.hex}"></div>
    <dl>
      <dt>${system.name}値</dt><dd>${chip.label}</dd>
      <dt>sRGB</dt><dd>rgb(${r}, ${g}, ${b})</dd>
      <dt>HEX</dt><dd>${chip.hex.toUpperCase()}</dd>
    </dl>`;
}

// --- Color harmony UI -------------------------------------------------------
function initHarmonyUI() {
  refreshSchemeOptions();

  // Default base from the color picker's initial value.
  setBaseFromHex(baseColorInput.value);

  baseColorInput.addEventListener("input", () => {
    setBaseFromHex(baseColorInput.value);
  });

  useSelectedBtn.addEventListener("click", () => {
    if (!lastSelectedChip) return;
    const [r, g, b] = lastSelectedChip.rgb;
    baseColorInput.value = lastSelectedChip.hex;
    baseMunsell = {
      step: lastSelectedChip.step,
      value: lastSelectedChip.value,
      chroma: lastSelectedChip.chroma,
    };
    renderScheme();
  });

  schemeSelect.addEventListener("change", renderScheme);

  schemeFilterToggle.addEventListener("change", () => {
    // Scheme filter is mutually exclusive with the value/chroma slices.
    if (schemeFilterToggle.checked) {
      if (sliceToggle.checked) {
        sliceToggle.checked = false;
        syncValueButtons();
      }
      if (chromaSliceToggle.checked) {
        chromaSliceToggle.checked = false;
        syncChromaButtons();
      }
      onSliceChange();
    }
    applyVisibility();
  });

  renderScheme();
}

// Rebuild the scheme selector from the active system (keys are shared, but we
// rebuild so a future system could offer different schemes).
function refreshSchemeOptions() {
  const prev = schemeSelect.value;
  schemeSelect.innerHTML = "";
  system.SCHEMES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.name;
    schemeSelect.appendChild(opt);
  });
  // Keep the prior selection if the new system still has it.
  if (prev && system.SCHEMES.some((s) => s.key === prev)) {
    schemeSelect.value = prev;
  }
}

function setBaseFromHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  // Express the picked sRGB color on the active system's axes.
  baseMunsell = system.fromSRGB(rgb[0], rgb[1], rgb[2]);
  renderScheme();
}

function renderScheme() {
  if (!baseMunsell) return;
  const key = schemeSelect.value || system.SCHEMES[0].key;
  const swatches = system.generateScheme(key, baseMunsell);

  // Keep the solid's scheme mapping in sync with what's shown.
  updateSchemeChipMapping();
  if (schemeFilterToggle && schemeFilterToggle.checked) applyVisibility();

  schemeResult.innerHTML = "";
  swatches.forEach((sw, i) => {
    const [r, g, b] = sw.rgb;
    const card = document.createElement("div");
    card.className = "scheme-swatch";
    card.title = "クリックで色立体の該当チップを表示";
    card.innerHTML = `
      <div class="chip" style="background:${sw.hex}"></div>
      <div class="meta">
        <div class="role">${sw.role}</div>
        <div class="munsell">${sw.label}</div>
        <div class="hex">${sw.hex.toUpperCase()}</div>
        <div class="rgb">rgb(${r}, ${g}, ${b})${sw.inGamut ? "" : " ⚠"}</div>
      </div>
      <button class="copy-btn" type="button" title="HEXをコピー">⧉</button>`;

    // Clicking the card (or its swatch) focuses the matching chip in the solid.
    card.addEventListener("click", (e) => {
      if (e.target.closest(".copy-btn")) return; // copy button handled below
      focusSchemeChip(i);
      // Mark the active card.
      schemeResult
        .querySelectorAll(".scheme-swatch")
        .forEach((el) => el.classList.remove("active"));
      card.classList.add("active");
    });

    card.querySelector(".copy-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(sw.hex.toUpperCase());
      const btn = e.currentTarget;
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "⧉"), 900);
    });

    schemeResult.appendChild(card);
  });

  // Auto-highlight the base color's chip so picking a base immediately shows
  // where it sits in the solid.
  const baseIdx = swatches.findIndex((s) => s.role.startsWith("ベース"));
  if (baseIdx >= 0) {
    focusSchemeChip(baseIdx);
    const cards = schemeResult.querySelectorAll(".scheme-swatch");
    if (cards[baseIdx]) cards[baseIdx].classList.add("active");
  }
}

// Focus the solid chip that the i-th scheme color maps to: reveal it (if a
// slice is hiding it), move the camera target onto it, and show it as the
// selected chip (highlight box + info panel).
function focusSchemeChip(i) {
  const chipIndex = schemeChipIndices[i];
  if (chipIndex === undefined || !solid) return;
  const chip = solid.chips[chipIndex];
  if (!chip) return;

  // If a slice is hiding this chip, extend the relevant selection so it
  // becomes visible (keeping other selected levels intact).
  let changed = false;
  if (sliceToggle.checked && !selectedValues.has(chip.value)) {
    selectedValues.add(chip.value);
    syncValueButtons();
    changed = true;
  }
  if (
    chromaSliceToggle.checked &&
    !chip.neutral &&
    !selectedChromas.has(chip.chroma)
  ) {
    selectedChromas.add(chip.chroma);
    syncChromaButtons();
    changed = true;
  }
  if (changed) onSliceChange();

  selectChip(chip);

  // Ease the orbit target toward the chip so it's clearly in view.
  controls.target.copy(chip.position);
  controls.update();
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// --- Loop / resize ----------------------------------------------------------
function onResize() {
  const { clientWidth: w, clientHeight: h } = canvasHost;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
