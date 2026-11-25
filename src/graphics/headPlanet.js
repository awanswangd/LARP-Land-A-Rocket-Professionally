import * as THREE from 'three';

/** Planet radius as a fraction of the (3D) forehead-to-chin distance. Raise to cover more hair. */
const PLANET_SCALE = 0.7;
/** 1 = no smoothing, lower = steadier but laggier. */
const SMOOTH = 0.45;
/** Surface spin around the head's vertical axis, radians per second. */
const SPIN_SPEED = 0.35;

const PALETTES = {
  moon: { base: [0.66, 0.66, 0.68], dark: [0.26, 0.26, 0.3] },
  mars: { base: [0.8, 0.38, 0.22], dark: [0.38, 0.15, 0.09] },
};

/** Small seeded RNG so the craters are identical on every load. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a low-poly icosphere (320 triangles) with crater dents.
 * Returns the geometry plus per-triangle data used to colour it.
 */
function buildPlanetGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 3); // non-indexed: each triangle owns its vertices
  const pos = geo.attributes.position;
  const rand = mulberry32(7);

  const craters = [];
  for (let i = 0; i < 14; i++) {
    craters.push({
      dir: new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(),
      radius: 0.35 + rand() * 0.35, // angular radius in radians
      depth: 0.04 + rand() * 0.05,
    });
  }

  const triCount = pos.count / 3;
  const craterFactor = new Float32Array(triCount); // 0 = no crater, 1 = crater centre
  const level = new Float32Array(triCount);        // stepped brightness 0..1
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const centroid = new THREE.Vector3();
  const angleTo = (v, c) => Math.acos(Math.min(1, Math.max(-1, v.dot(c.dir))));

  for (let t = 0; t < triCount; t++) {
    centroid.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      const v = tri[k].fromBufferAttribute(pos, t * 3 + k).normalize();
      centroid.add(v);
      let disp = 0;
      for (const c of craters) {
        const a = angleTo(v, c);
        if (a < c.radius) {
          const u = a / c.radius;
          disp -= c.depth * (1 - u * u); // bowl-shaped dent
        }
      }
      // displacement depends only on the vertex position, so shared corners never tear
      pos.setXYZ(t * 3 + k, v.x * (1 + disp), v.y * (1 + disp), v.z * (1 + disp));
    }
    centroid.normalize();
    let f = 0;
    for (const c of craters) {
      const a = angleTo(centroid, c);
      if (a < c.radius) f = Math.max(f, 1 - a / c.radius);
    }
    craterFactor[t] = f;
    level[t] = Math.round(rand() * 4) / 4; // 5 brightness steps
  }

  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  return { geo, craterFactor, level, triCount };
}

/**
 * Round low-poly planet that sits over the user's head.
 * Position/size come from face landmarks, orientation from the head-pose matrix.
 * A small landing pad sits on the planet's "north pole" and tilts with the head.
 *
 * @param {number} aspect video width / height (scene x spans 0..aspect, y spans 0..1)
 */
export function createHeadPlanet(aspect) {
  const { geo, craterFactor, level, triCount } = buildPlanetGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 1, metalness: 0,
  });
  const planetMesh = new THREE.Mesh(geo, material);

  // pad prototype (the rocket will land here later)
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.34, 0.07, 8),
    new THREE.MeshStandardMaterial({ color: 0xf2b134, flatShading: true, roughness: 0.6 }),
  );
  pad.position.y = 1.02;

  const spin = new THREE.Group();   // rotates the surface only
  spin.add(planetMesh);
  const root = new THREE.Group();   // follows the head (position, size, tilt)
  root.add(spin, pad);
  root.frustumCulled = false;
  root.visible = false;

  let paletteName = 'moon';
  function paint(name) {
    paletteName = name;
    const { base, dark } = PALETTES[name];
    const col = geo.attributes.color.array;
    for (let t = 0; t < triCount; t++) {
      const k = 0.8 + level[t] * 0.4;
      const m = Math.min(1, craterFactor[t] * 1.3); // darker toward crater centres
      for (let v = 0; v < 3; v++) {
        const i = (t * 3 + v) * 3;
        for (let c = 0; c < 3; c++) col[i + c] = (base[c] + (dark[c] - base[c]) * m) * k;
      }
    }
    geo.attributes.color.needsUpdate = true;
  }
  paint('moon');

  // --- tracking state (smoothed) ---
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();
  let radius = 0.2;
  let hasPrev = false;
  const m4 = new THREE.Matrix4();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const up = new THREE.Vector3();

  /** Head orientation from MediaPipe's 4x4 matrix. Handles either memory layout. */
  function readQuaternion(data, out) {
    m4.fromArray(data);
    // column-major affine => bottom row (indices 3, 7, 11) is zero; otherwise transpose
    if (Math.abs(data[3]) + Math.abs(data[7]) + Math.abs(data[11]) > 1e-6) m4.transpose();
    m4.decompose(tmpPos, out, tmpScale);
  }

  /** Values other modules read (pad position, head roll). */
  const state = { visible: false, x: 0, y: 0, radius: 0, topX: 0, topY: 0, rollDeg: 0 };

  /**
   * @param {{x:number,y:number,z:number}[]} landmarks 478 normalized face landmarks
   * @param {ArrayLike<number>|undefined} matrixData head-pose matrix (16 numbers)
   */
  function update(landmarks, matrixData) {
    const a = landmarks[10];   // top of forehead
    const b = landmarks[152];  // chin
    const dx = (a.x - b.x) * aspect;
    const dy = a.y - b.y;
    const dz = (a.z - b.z) * aspect;
    const r = Math.hypot(dx, dy, dz) * PLANET_SCALE;
    const cx = ((a.x + b.x) / 2) * aspect;
    const cy = 1 - (a.y + b.y) / 2;

    const newQuat = new THREE.Quaternion();
    if (matrixData) readQuaternion(matrixData, newQuat);

    if (!hasPrev) {
      targetPos.set(cx, cy, 0);
      radius = r;
      targetQuat.copy(newQuat);
      hasPrev = true;
    } else {
      targetPos.x += (cx - targetPos.x) * SMOOTH;
      targetPos.y += (cy - targetPos.y) * SMOOTH;
      radius += (r - radius) * SMOOTH;
      targetQuat.slerp(newQuat, SMOOTH);
    }

    root.position.copy(targetPos);
    root.scale.setScalar(radius);
    root.quaternion.copy(targetQuat);
    root.visible = true;

    up.set(0, 1, 0).applyQuaternion(targetQuat);
    state.visible = true;
    state.x = targetPos.x;
    state.y = targetPos.y;
    state.radius = radius;
    state.topX = targetPos.x + up.x * radius;
    state.topY = targetPos.y + up.y * radius;
    state.rollDeg = (Math.atan2(up.x, up.y) * 180) / Math.PI; // + = leaning to image-right
  }

  function hide() {
    root.visible = false;
    state.visible = false;
    hasPrev = false;
  }

  /** Call every render frame so the spin stays smooth between detections. */
  function tick(dt) {
    spin.rotation.y += SPIN_SPEED * dt;
  }

  function togglePalette() {
    paint(paletteName === 'moon' ? 'mars' : 'moon');
  }

  return { object: root, update, hide, tick, togglePalette, state };
}
