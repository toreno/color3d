// solid.js
// Builds a color solid (Munsell or PCCS) as Three.js meshes, driven by a
// "system descriptor" so the same code renders either system.
//
// Layout (both systems):
//   - value   -> vertical Y axis (height).
//   - hue     -> angle around the vertical axis.
//   - chroma  -> radial distance from the axis.
// Each chip is a small box colored by system.toSRGB(step, value, chroma).
// Only chips inside the sRGB gamut are shown unless includeOutOfGamut is set.

import * as THREE from "three";

// Default vertical scale (used when a system does not specify its own).
const HEIGHT_PER_VALUE = 0.9;
const CHIP_SIZE = 0.42;

// Build the solid for a given color system.
//   system: descriptor from munsell.js / pccs.js
//   options: { includeOutOfGamut }
export function buildSolid(system, options = {}) {
  const includeOutOfGamut = !!options.includeOutOfGamut;
  const radiusPerChroma = system.radiusPerChroma;
  const valueCenter = system.valueCenter;
  // Systems with wide value ranges (HSV 0..100, CIELAB 0..95) set a smaller
  // heightPerValue so the solid is not stretched vertically.
  const heightPerValue =
    typeof system.heightPerValue === "number"
      ? system.heightPerValue
      : HEIGHT_PER_VALUE;

  const group = new THREE.Group();
  const chipData = [];
  const defs = [];

  for (let v = system.valueMin; v <= system.valueMax; v += system.valueStep) {
    for (let hi = 0; hi < system.hueSamples; hi++) {
      const step = system.sampleToStep(hi);
      const angle = (hi / system.hueSamples) * Math.PI * 2;
      for (
        let c = system.chromaMin;
        c <= system.chromaMax;
        c += system.chromaStep
      ) {
        const col = system.toSRGB(step, v, c);
        if (!col.inGamut && !includeOutOfGamut) break;
        const radius = c * radiusPerChroma;
        const y = (v - valueCenter) * heightPerValue;
        defs.push({
          x: radius * Math.cos(angle),
          y,
          z: radius * Math.sin(angle),
          color: col,
          step,
          value: v,
          chroma: c,
        });
        if (!col.inGamut) break;
      }
    }
  }

  // Neutral axis down the center.
  for (let v = system.valueMin; v <= system.valueMax; v += system.valueStep) {
    const col = system.toSRGB(system.sampleToStep(0), v, 0);
    defs.push({
      x: 0,
      y: (v - valueCenter) * heightPerValue,
      z: 0,
      color: col,
      step: system.sampleToStep(0),
      value: v,
      chroma: 0,
      neutral: true,
    });
  }

  const geometry = new THREE.BoxGeometry(CHIP_SIZE, CHIP_SIZE, CHIP_SIZE);
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.65,
    metalness: 0.0,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, defs.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  defs.forEach((d, i) => {
    dummy.position.set(d.x, d.y, d.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setRGB(
      srgbToLinear(d.color.r / 255),
      srgbToLinear(d.color.g / 255),
      srgbToLinear(d.color.b / 255)
    );
    mesh.setColorAt(i, color);

    chipData.push({
      index: i,
      value: d.value,
      chroma: d.chroma,
      step: d.step,
      neutral: !!d.neutral,
      hex: d.color.hex,
      rgb: [d.color.r, d.color.g, d.color.b],
      label: d.neutral
        ? neutralLabel(system, d.value)
        : system.format(d.step, d.value, d.chroma),
      position: new THREE.Vector3(d.x, d.y, d.z),
    });
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  group.add(mesh);

  return {
    group,
    mesh,
    chips: chipData,
    valueRange: [system.valueMin, system.valueMax],
    heightPerValue,
  };
}

function neutralLabel(system, value) {
  // Both systems format a zero-chroma color as their neutral notation.
  return system.format(system.sampleToStep(0), value, 0);
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const SOLID_CONFIG = {
  HEIGHT_PER_VALUE,
};
