import { createTracker, getFaceTriangles } from './vision/tracker.js';
import { createScene } from './graphics/scene3D.js';
import { createHeadPlanet } from './graphics/headPlanet.js';
import { createFaceMask } from './graphics/faceMask.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const stage = $('stage');
const mirror = $('mirror');
const overlay = $('overlay');
const statusEl = $('status');
const hud = $('hud');

/** Ask for camera, load the face model, build the scene and run the loop. */
async function start() {
  $('startBtn').disabled = true;

  statusEl.textContent = 'Requesting camera...';
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const aspect = video.videoWidth / video.videoHeight;

  statusEl.textContent = 'Loading face model...';
  const tracker = await createTracker();

  const { renderer, scene, camera, resize } = createScene(mirror, aspect);
  const planet = createHeadPlanet(aspect);
  const mask = createFaceMask(getFaceTriangles(), aspect);
  scene.add(planet.object, mask.object);

  let active = planet; // F switches between planet and face mask
  const inactive = () => (active === planet ? mask : planet);

  // fit the video+canvas inside the window, keeping the video's aspect ratio
  function fit() {
    const w = Math.min(window.innerWidth, window.innerHeight * aspect);
    stage.style.width = `${w}px`;
    stage.style.height = `${w / aspect}px`;
    resize(w, w / aspect);
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'm') { planet.togglePalette(); mask.togglePalette(); }
    if (key === 'f') { inactive().hide(); active = inactive(); }
  });

  overlay.style.display = 'none';

  let lastVideoTime = -1;
  let lastFrame = performance.now();
  let renderFrames = 0, detections = 0;
  let renderFps = 0, detectFps = 0;
  let windowStart = lastFrame;

  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;

    // only run detection when the camera produced a new frame
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = tracker.detect(video, now);
      detections++;
      if (res.faceLandmarks.length) {
        const matrix = res.facialTransformationMatrixes?.[0]?.data;
        active.update(res.faceLandmarks[0], matrix);
      } else {
        active.hide();
      }
    }
    active.tick(dt);
    renderer.render(scene, camera);

    renderFrames++;
    if (now - windowStart >= 1000) {
      renderFps = renderFrames; detectFps = detections;
      renderFrames = 0; detections = 0; windowStart = now;
    }
    const roll = planet.state.visible && active === planet
      ? ` · roll ${planet.state.rollDeg.toFixed(0)}°` : '';
    hud.textContent = `render ${renderFps} FPS · detect ${detectFps} FPS${roll}`;
  }
  loop();
}

$('startBtn').addEventListener('click', () => {
  start().catch((err) => {
    console.error(err);
    statusEl.textContent = `Error: ${err.message}`;
    $('startBtn').disabled = false;
  });
});
