/**
 * Records the final picture (camera + 3D layer) together with the microphone.
 * MediaRecorder can only record ONE canvas, so every frame we composite the
 * video and the Three.js canvas onto a hidden 2D canvas and record that.
 * @module recorder
 */

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4', // Safari
];

/** First container/codec this browser can record, or '' to let it choose. */
function pickMimeType() {
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Timestamp for file names, e.g. 2026-11-25T12-09-30. */
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * @param {object} opts
 * @param {HTMLVideoElement} opts.video camera feed
 * @param {HTMLCanvasElement} opts.sceneCanvas the Three.js canvas
 * @param {MediaStream|null} opts.micStream microphone audio (null = record without sound)
 */
export function createRecorder({ video, sceneCanvas, micStream }) {
  const out = document.createElement('canvas');
  out.width = video.videoWidth;
  out.height = video.videoHeight;
  const ctx = out.getContext('2d');

  let rec = null;
  let chunks = [];
  let startedAt = 0;

  /** Composite one frame. Call right after renderer.render() while recording. */
  function drawFrame() {
    ctx.save();
    ctx.translate(out.width, 0); // mirror, same as what the user sees on screen
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, out.width, out.height);
    ctx.drawImage(sceneCanvas, 0, 0, out.width, out.height);
    ctx.restore();
  }

  /** Download the recorded chunks as a video file. */
  function save(mimeType) {
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `planet-head-${stamp()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    chunks = [];
  }

  /** Start recording (no-op if already recording). */
  function start() {
    if (rec) return;
    drawFrame(); // make sure the first frame is not empty
    const stream = out.captureStream(30);
    micStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 4000000,
    });
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { save(recorder.mimeType || mimeType); rec = null; };
    recorder.start(1000);
    rec = recorder;
    startedAt = performance.now();
  }

  /** Stop recording; the browser downloads the file. */
  function stop() {
    if (rec && rec.state !== 'inactive') rec.stop();
  }

  return {
    start,
    stop,
    drawFrame,
    isRecording: () => rec !== null && rec.state === 'recording',
    /** Seconds since recording started. */
    elapsed: () => (rec ? (performance.now() - startedAt) / 1000 : 0),
  };
}
