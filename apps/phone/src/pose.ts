import type { PoseLandmarker } from '@mediapipe/tasks-vision';

const WASM_BASE = 'mediapipe/wasm';
const LOCAL_MODEL = 'models/pose_landmarker_lite.task';
const GOOGLE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

export interface LoadedLandmarker {
  landmarker: PoseLandmarker;
  delegate: 'GPU' | 'CPU';
}

/**
 * Create a Pose Landmarker (lite, VIDEO mode, one person). The MediaPipe bundle is imported
 * lazily so it stays out of the initial JS. GPU is tried first, then CPU; the model comes from
 * the self-hosted copy, then Google's public URL.
 */
export async function loadPoseLandmarker(): Promise<LoadedLandmarker> {
  const { FilesetResolver, PoseLandmarker: Landmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const attempts: { delegate: 'GPU' | 'CPU'; model: string }[] = [
    { delegate: 'GPU', model: LOCAL_MODEL },
    { delegate: 'CPU', model: LOCAL_MODEL },
    { delegate: 'GPU', model: GOOGLE_MODEL },
    { delegate: 'CPU', model: GOOGLE_MODEL },
  ];
  let lastError: unknown;
  for (const { delegate, model } of attempts) {
    try {
      const landmarker = await Landmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      return { landmarker, delegate };
    } catch (err) {
      lastError = err;
      console.warn(`pose landmarker: ${delegate} with ${model} failed`, err);
    }
  }
  throw new Error(`Could not load the pose model: ${(lastError as Error)?.message ?? lastError}`);
}
