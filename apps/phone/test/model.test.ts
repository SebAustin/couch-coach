import { describe, expect, it } from 'vitest';
import { LANDMARKER_CONFIDENCE, landmarkerAttempts } from '../src/pose';
import { parseModelVariant } from '../src/logic/session-params';

describe('parseModelVariant (?model=full)', () => {
  it('keeps the lite model by default', () => {
    expect(parseModelVariant('')).toBe('lite');
    expect(parseModelVariant(`?s=${'a'.repeat(32)}&t=tok`)).toBe('lite');
  });

  it('opts into the full model with model=full', () => {
    expect(parseModelVariant(`?s=${'a'.repeat(32)}&t=tok&model=full`)).toBe('full');
  });

  it.each(['?model=FULL', '?model=heavy', '?model=', '?model=lite'])('falls back to lite for %j', (search) => {
    expect(parseModelVariant(search)).toBe('lite');
  });
});

describe('landmarkerAttempts', () => {
  it('tries the self-hosted model before Google, GPU before CPU, for the chosen variant', () => {
    const google =
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
    expect(landmarkerAttempts('full')).toEqual([
      { delegate: 'GPU', model: 'models/pose_landmarker_full.task' },
      { delegate: 'CPU', model: 'models/pose_landmarker_full.task' },
      { delegate: 'GPU', model: google },
      { delegate: 'CPU', model: google },
    ]);
  });

  it('points the lite variant at the lite files', () => {
    expect(landmarkerAttempts('lite').map((a) => a.model)).toEqual([
      'models/pose_landmarker_lite.task',
      'models/pose_landmarker_lite.task',
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
    ]);
  });
});

describe('LANDMARKER_CONFIDENCE', () => {
  it('sets the thresholds explicitly, with a stricter tracking threshold so a bad lock-on is re-detected', () => {
    expect(LANDMARKER_CONFIDENCE).toEqual({
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.6,
    });
  });
});
