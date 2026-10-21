import type { Exercise } from '../vendor/protocol';

const EXERCISE_LABELS: Record<Exercise, string> = {
  squat: 'Squat',
  jumping_jack: 'Jumping jack',
};

const FAULT_LABELS: Record<string, string> = {
  shallow_depth: 'Shallow depth',
  knees_caving: 'Knees caving',
  torso_lean: 'Torso lean',
  heels_rising: 'Heels rising',
  arms_not_overhead: 'Arms not overhead',
  feet_not_wide: 'Feet not wide',
};

export function exerciseLabel(exercise: Exercise | null | undefined): string {
  return exercise ? EXERCISE_LABELS[exercise] : 'Exercise';
}

/** Human label for a Fault id; unknown ids (newer pose-reps) degrade to a readable fallback. */
export function faultLabel(id: string): string {
  const known = FAULT_LABELS[id];
  if (known) return known;
  const words = id.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Fault';
}
