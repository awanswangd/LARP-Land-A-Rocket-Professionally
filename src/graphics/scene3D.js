import * as THREE from 'three';

// Orthographic scene in "video units": x in [0, aspect], y in [0, 1] (y up).
// This makes landmark -> scene mapping trivial and keeps the mask aligned with the video.
export function createScene(container, aspect) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, aspect, 1, 0, -5, 5);

  // Flat shading only reads well with a clear key light + low ambient.
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(0.4 * aspect, 1.0, 2);
  scene.add(key);

  function resize(w, h) {
    renderer.setSize(w, h);
  }

  return { renderer, scene, camera, resize };
}
