import * as THREE from 'three';

const PALETTES = {
  moon: { base: [0.62, 0.62, 0.64], dark: [0.28, 0.28, 0.31] },
  mars: { base: [0.78, 0.36, 0.2], dark: [0.42, 0.17, 0.1] },
};

// deterministic pseudo-random in [0,1) so the pattern doesn't flicker
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Face-mesh mask: the MediaPipe face mesh painted as a faceted moon (alternate mode).
 * @param {number[]} triangles flat landmark-index triples
 * @param {number} aspect video width / height
 */
export function createFaceMask(triangles, aspect) {
  const vertCount = triangles.length;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,   // each triangle is lit separately = low-poly look
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // geometry changes every frame
  mesh.visible = false;

  let paletteName = 'moon';

  // One flat colour per triangle: stepped brightness + a few dark "maria" patches.
  function paint(name) {
    paletteName = name;
    const { base, dark } = PALETTES[name];
    const col = geometry.attributes.color.array;
    for (let t = 0; t < triangles.length; t += 3) {
      const seed = triangles[t];
      const patch = Math.sin(seed * 0.093) + Math.sin(seed * 0.031 + 1.7) > 1.05;
      const level = Math.round(hash(t) * 4) / 4;      // 5 brightness steps
      const k = 0.78 + level * 0.4;
      const src = patch ? dark : base;
      for (let v = 0; v < 3; v++) {
        const i = (t + v) * 3;
        col[i] = src[0] * k;
        col[i + 1] = src[1] * k;
        col[i + 2] = src[2] * k;
      }
    }
    geometry.attributes.color.needsUpdate = true;
  }
  paint('moon');

  // light low-pass filter on landmarks to kill jitter
  const smooth = new Float32Array(478 * 3);
  let hasPrev = false;
  const SMOOTH = 0.55; // 1 = no smoothing, lower = smoother but laggier

  function update(landmarks) {
    for (let i = 0; i < 478; i++) {
      const lm = landmarks[i];
      const x = lm.x * aspect;
      const y = 1 - lm.y;
      const z = -lm.z * aspect;
      const o = i * 3;
      if (!hasPrev) {
        smooth[o] = x; smooth[o + 1] = y; smooth[o + 2] = z;
      } else {
        smooth[o] += (x - smooth[o]) * SMOOTH;
        smooth[o + 1] += (y - smooth[o + 1]) * SMOOTH;
        smooth[o + 2] += (z - smooth[o + 2]) * SMOOTH;
      }
    }
    hasPrev = true;

    const pos = geometry.attributes.position.array;
    for (let k = 0; k < triangles.length; k++) {
      const s = triangles[k] * 3;
      const d = k * 3;
      pos[d] = smooth[s]; pos[d + 1] = smooth[s + 1]; pos[d + 2] = smooth[s + 2];
    }
    geometry.attributes.position.needsUpdate = true;
    mesh.visible = true;
  }

  function hide() {
    mesh.visible = false;
    hasPrev = false;
  }

  function togglePalette() {
    paint(paletteName === 'moon' ? 'mars' : 'moon');
  }

  return { object: mesh, update, hide, tick() {}, togglePalette };
}
