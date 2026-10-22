import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { ModelVariant } from './logic/session-params';

const WASM_BASE = 'mediapipe/wasm';
const GOOGLE_MODELS = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

/**
 * Set explicitly instead of relying on MediaPipe's defaults (all 0.5). The stricter tracking threshold makes
 * the model re-detect the person more often rather than hold on to a bad lock-on (seen in the first ~2 s).
 */
export const LANDMARKER_CONFIDENCE = {
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.6,
} as const;

export interface LoadedLandmarker {
  landmarker: PoseLandmarker;
  delegate: 'GPU' | 'CPU';
  variant: ModelVariant;
}

/** Load order for a model variant: the self-hosted copy, then Google's public URL; GPU first, then CPU. */
export function landmarkerAttempts(variant: ModelVariant): { delegate: 'GPU' | 'CPU'; model: string }[] {
  const file = `pose_landmarker_${variant}.task`;
  const local = `models/${file}`;
  const google = `${GOOGLE_MODELS}/pose_landmarker_${variant}/float16/latest/${file}`;
  return [
    { delegate: 'GPU', model: local },
    { delegate: 'CPU', model: local },
    { delegate: 'GPU', model: google },
    { delegate: 'CPU', model: google },
  ];
}

/**
 * Create a Pose Landmarker (`lite` or `full`, VIDEO mode, one person). The MediaPipe bundle is imported
 * lazily so it stays out of the initial JS. See `landmarkerAttempts` for the delegate and model fallbacks.
 */
export async function loadPoseLandmarker(variant: ModelVariant): Promise<LoadedLandmarker> {
  const { FilesetResolver, PoseLandmarker: Landmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  let lastError: unknown;
  for (const { delegate, model } of landmarkerAttempts(variant)) {
    try {
      const landmarker = await Landmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        ...LANDMARKER_CONFIDENCE,
      });
      return { landmarker, delegate, variant };
    } catch (err) {
      lastError = err;
      console.warn(`pose landmarker: ${delegate} with ${model} failed`, err);
    }
  }
  throw new Error(`Could not load the pose model: ${(lastError as Error)?.message ?? lastError}`);
}
