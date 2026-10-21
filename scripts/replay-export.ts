/**
 * Replays a phone "Export last 30 s" file through pose-reps and prints, per Rep, the faults plus the
 * raw measurements behind heels_rising and shallow_depth, so thresholds can be tuned on real movement.
 *
 * Usage: npx tsx replay-export.ts <export.json> [exercise] [option=value ...]
 *   e.g. npx tsx replay-export.ts ~/Downloads/couch-coach-landmarks-123.json squat heelRiseRatio=0.2
 */
import { readFileSync } from 'node:fs';
import { decodeFrame, Exercise, PoseFrame, type Landmark } from '@couch-coach/protocol';
import { createCounter, type CounterOptions } from 'pose-reps';
import { z } from 'zod';

const ExportFile = z.object({
  format: z.literal('couch-coach-landmarks/1'),
  exercise: Exercise.nullable(),
  aspect: z.number().positive().nullable(),
  frames: z.array(PoseFrame),
});

/** MediaPipe indices for one body side. */
type SideIds = Record<'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'foot', number>;
const SIDES: Record<'left' | 'right', SideIds> = {
  left: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, foot: 31 },
  right: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, foot: 32 },
};
const VISIBLE = 0.5;

const [file, exerciseArg, ...optionArgs] = process.argv.slice(2);
if (!file) {
  console.error('usage: npx tsx replay-export.ts <export.json> [exercise] [option=value ...]');
  process.exit(1);
}
const data = ExportFile.parse(JSON.parse(readFileSync(file, 'utf8')));
const exercise = Exercise.parse(exerciseArg ?? data.exercise ?? 'squat');
const aspect = data.aspect ?? 1;
const overrides = Object.fromEntries(optionArgs.map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
const options: Partial<CounterOptions> = { aspectRatio: aspect, ...overrides };

const frames = data.frames.map(decodeFrame).sort((a, b) => a.t - b.t);
const dist = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** The same raw measurements pose-reps' squat engine uses, on the more visible side. */
function measure(pose: readonly Landmark[]) {
  const score = (s: SideIds) => Object.values(s).reduce((sum, i) => sum + pose[i]!.visibility, 0);
  const s = score(SIDES.left) >= score(SIDES.right) ? SIDES.left : SIDES.right;
  const [hip, knee, ankle, heel, foot] = [s.hip, s.knee, s.ankle, s.heel, s.foot].map((i) => pose[i]!) as Landmark[];
  if ([hip, knee, ankle].some((p) => p!.visibility < VISIBLE)) return null;
  const thigh = dist(hip!, knee!);
  const shin = dist(knee!, ankle!);
  return {
    hipAboveKnee: thigh > 0 ? (knee!.y - hip!.y) / thigh : 0,
    heelRise: heel!.visibility >= VISIBLE && foot!.visibility >= VISIBLE && shin > 0 ? (foot!.y - heel!.y) / shin : null,
  };
}

const counter = createCounter(exercise, options);
const fmt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '  -  ' : n.toFixed(3));
const stats = (xs: number[]) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: NaN, max: NaN });

console.log(`${frames.length} frames over ${((frames.at(-1)!.t - frames[0]!.t) / 1000).toFixed(1)} s, aspect ${aspect.toFixed(3)}, exercise ${exercise}`);
console.log(`options ${JSON.stringify(options)}\n`);
console.log('rep  score  faults                          hipAboveKnee(min)  heelRise standing→max');

let repStartIndex = 0;
frames.forEach(({ t, pose }, i) => {
  const rep = counter.push(pose, t);
  if (!rep) return;
  const window = frames.slice(repStartIndex, i + 1).map((f) => measure(f.pose)).filter((m) => m !== null);
  repStartIndex = i + 1;
  const depth = stats(window.map((m) => m.hipAboveKnee));
  const heels = window.map((m) => m.heelRise).filter((h): h is number => h !== null);
  const standing = heels.length ? heels[0]! : null;
  console.log(
    `${String(rep.index + 1).padStart(3)}  ${String(rep.score).padStart(5)}  ${rep.faults.join(',').padEnd(32)}${fmt(depth.min).padStart(17)}  ${fmt(standing)} → ${fmt(stats(heels).max)}`,
  );
});
console.log(`\n${counter.reps().length} reps, set score ${counter.setScore().toFixed(1)}`);
