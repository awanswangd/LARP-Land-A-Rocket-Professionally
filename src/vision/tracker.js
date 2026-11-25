import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

// Keep the wasm version in sync with package.json
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

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
    detect(video, timestampMs) {
      return face.detectForVideo(video, timestampMs);
    },
  };
}

// The tasks-vision API exposes the face mesh as EDGES (start/end pairs).
// A triangle is any 3 landmarks whose 3 edges all exist.
export function getFaceTriangles() {
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const { start, end } of edges) { link(start, end); link(end, start); }

  const tris = [];
  for (const [a, nbrs] of adj) {
    for (const b of nbrs) {
      if (b <= a) continue;
      for (const c of adj.get(b)) {
        if (c <= b) continue;
        if (adj.get(a).has(c)) tris.push(a, b, c);
      }
    }
  }
  return tris; // flat [a,b,c, a,b,c, ...]
}
