import { createTracker } from './vision/tracker.js';
import { createScene } from './graphics/scene3D.js';
import { createHeadPlanet } from './graphics/headPlanet.js';
import { createRecorder } from './recorder.js';
import { createMetrics } from './metrics.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const stage = $('stage');
const mirror = $('mirror');
const overlay = $('overlay');
const statusEl = $('status');
const hud = $('hud');
const recBtn = $('recBtn');

/** mm:ss from seconds. */
const fmtTime = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Open camera + microphone in one permission prompt.
 * Falls back to camera only if the mic is unavailable.
 * AGC/noise suppression are off so the mic level stays a faithful volume signal.
 * @returns {Promise<MediaStream>}
 */
async function openMedia() {
  const videoConstraints = { width: 1280, height: 720, facingMode: 'user' };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    console.warn('Microphone unavailable, continuing with camera only:', err);
    return navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
  }
}

/** Open the camera/mic, load the face model, build the scene and run the main loop. */
async function start() {
  $('startBtn').disabled = true;

  statusEl.textContent = 'Requesting camera and microphone...';
  const stream = await openMedia();
  video.srcObject = stream;
  await video.play();

  const aspect = video.videoWidth / video.videoHeight;
  const audioTracks = stream.getAudioTracks();
  const micStream = audioTracks.length ? new MediaStream(audioTracks) : null;

  statusEl.textContent = 'Loading face model...';
  const tracker = await createTracker();

  const { renderer, scene, camera, resize } = createScene(mirror, aspect);
  const planet = createHeadPlanet(aspect);
  scene.add(planet.object);
  const recorder = createRecorder({ video, sceneCanvas: renderer.domElement, micStream });
  const metrics = createMetrics();

  // fit the video+canvas inside the window, keeping the video's aspect ratio
  function fit() {
    const w = Math.min(window.innerWidth, window.innerHeight * aspect);
    stage.style.width = `${w}px`;
    stage.style.height = `${w / aspect}px`;
    resize(w, w / aspect);
  }
  fit();
  window.addEventListener('resize', fit);

  function toggleRecording() {
    if (recorder.isRecording()) recorder.stop();
    else recorder.start();
  }
  recBtn.addEventListener('click', toggleRecording);
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'm') planet.togglePalette();
    if (key === 'r') toggleRecording();
    if (key === 'l') {
      // session averages for the README table
      console.table({
        resolution: `${video.videoWidth}x${video.videoHeight}`,
        ...metrics.summary(),
        recording: recorder.isRecording(),
      });
    }
  });

  overlay.style.display = 'none';

  // --- new camera frame detection ---
  // requestVideoFrameCallback tells us exactly when the camera delivered a frame and
  // (in Chrome) when it was captured, which is what the latency number is based on.
  const useRVFC = 'requestVideoFrameCallback' in video;
  let pendingFrame = false;
  let captureTime = performance.now();
  let lastVideoTime = -1; // fallback for browsers without requestVideoFrameCallback
  if (useRVFC) {
    const onFrame = (now, meta) => {
      pendingFrame = true;
      captureTime = meta.captureTime ?? meta.receiveTime ?? now;
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  let lastFrame = performance.now();
  let lastHud = 0;

  /** One iteration per screen refresh. */
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;

    let newFrame = pendingFrame;
    pendingFrame = false;
    if (!useRVFC && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      captureTime = now;
      newFrame = true;
    }

    if (newFrame) {
      const t0 = performance.now();
      const res = tracker.detect(video, t0);
      metrics.detected(now, performance.now() - t0);
      if (res.faceLandmarks.length) {
        planet.update(res.faceLandmarks[0], res.facialTransformationMatrixes?.[0]?.data);
      } else {
        planet.hide();
      }
    }

    planet.tick(dt);
    renderer.render(scene, camera);
    metrics.frameRendered(now);
    if (newFrame) metrics.frameLatency(performance.now() - captureTime);
    if (recorder.isRecording()) recorder.drawFrame();

    if (now - lastHud > 100) {
      lastHud = now;
      const [fpsLine, latencyLine] = metrics.hudLines();
      const roll = planet.state.visible ? ` · roll ${planet.state.rollDeg.toFixed(0)}°` : '';
      hud.textContent = `${fpsLine}\n${latencyLine}${roll}${micStream ? '' : ' · NO MIC'}`;
      const rec = recorder.isRecording();
      recBtn.classList.toggle('recording', rec);
      recBtn.textContent = rec ? `■ Stop ${fmtTime(recorder.elapsed())}` : '● Record';
    }
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
