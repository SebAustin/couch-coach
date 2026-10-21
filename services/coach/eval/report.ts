import type { CheckName, CheckResult } from './checks';

export interface CueRecord {
  run: number;
  caseId: string;
  raw: string | null;
  cue: string | null;
  ms: number;
  error?: string;
  checks: CheckResult[];
}

export interface Summary {
  cues: number;
  passed: number;
  passRate: number;
  perRun: Array<{ run: number; cues: number; passed: number; passRate: number }>;
  failuresByCheck: Partial<Record<CheckName | 'error', number>>;
  p50Ms: number;
  p95Ms: number;
}

export const cuePassed = (r: CueRecord): boolean => !r.error && r.checks.every((c) => c.pass);

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

export function summarize(records: readonly CueRecord[]): Summary {
  const runs = [...new Set(records.map((r) => r.run))].sort((a, b) => a - b);
  const failuresByCheck: Summary['failuresByCheck'] = {};
  for (const r of records) {
    if (r.error) failuresByCheck.error = (failuresByCheck.error ?? 0) + 1;
    for (const c of r.checks.filter((x) => !x.pass)) failuresByCheck[c.name] = (failuresByCheck[c.name] ?? 0) + 1;
  }
  const passed = records.filter(cuePassed).length;
  const ms = records.filter((r) => !r.error).map((r) => r.ms);
  return {
    cues: records.length,
    passed,
    passRate: records.length ? passed / records.length : 0,
    perRun: runs.map((run) => {
      const rs = records.filter((r) => r.run === run);
      const p = rs.filter(cuePassed).length;
      return { run, cues: rs.length, passed: p, passRate: rs.length ? p / rs.length : 0 };
    }),
    failuresByCheck,
    p50Ms: percentile(ms, 50),
    p95Ms: percentile(ms, 95),
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function formatReport(records: readonly CueRecord[], summary: Summary): string {
  const lines = [
    '',
    '=== Coach Cue eval ===',
    `Pass rate: ${summary.passed}/${summary.cues} = ${pct(summary.passRate)}`,
    ...summary.perRun.map((r) => `  run ${r.run}: ${r.passed}/${r.cues} = ${pct(r.passRate)}`),
    `Latency (Bedrock): p50 ${summary.p50Ms} ms, p95 ${summary.p95Ms} ms`,
    'Failures by check:',
    ...(Object.keys(summary.failuresByCheck).length === 0
      ? ['  (none)']
      : Object.entries(summary.failuresByCheck).map(([name, n]) => `  ${name}: ${n}`)),
    '',
    'Cues:',
  ];
  for (const r of records) {
    const mark = cuePassed(r) ? 'PASS' : 'FAIL';
    lines.push(`[${mark}] run ${r.run} ${r.caseId}: ${r.error ? `ERROR ${r.error}` : r.cue}`);
    for (const c of r.checks.filter((x) => !x.pass)) lines.push(`        x ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
  }
  return lines.join('\n');
}
