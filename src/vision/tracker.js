import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

// Keep the wasm version in sync with package.json
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Load the MediaPipe FaceLandmarker (478 landmarks, blendshapes, head-pose matrix).
 * @returns {Promise<{detect: function(HTMLVideoElement, number): object}>}
 */
export async function createTracker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const face = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true, // used later for jawOpen (meteor storm)
    outputFacialTransformationMatrixes: true, // head rotation (pitch/yaw/roll)
  });

  return {
    /**
     * Run face detection on the current video frame.
     * @param {HTMLVideoElement} video
     * @param {number} timestampMs must increase on every call
     */
    detect(video, timestampMs) {
      return face.detectForVideo(video, timestampMs);
    },
  };
}
