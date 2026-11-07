import type { Status } from './types.js';

/** TestRail's built-in status ids. Custom statuses are 6..12 (custom_status1..7). */
export const STATUS = { passed: 1, blocked: 2, untested: 3, retest: 4, failed: 5 } as const;

export interface Tally {
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  untested: number;
  /** Custom statuses by label, e.g. {"Skipped": 3}. */
  custom: Record<string, number>;
}

export const emptyTally = (): Tally => ({ passed: 0, failed: 0, blocked: 0, retest: 0, untested: 0, custom: {} });

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

/** Reads the *_count fields of a run (or plan entry run). */
export function tallyRun(run: Record<string, unknown>, statuses: Status[]): Tally {
  const t = emptyTally();
  t.passed = num(run.passed_count);
  t.failed = num(run.failed_count);
  t.blocked = num(run.blocked_count);
  t.retest = num(run.retest_count);
  t.untested = num(run.untested_count);
  for (let n = 1; n <= 7; n++) {
    const count = num(run[`custom_status${n}_count`]);
    if (count > 0) {
      const label = statuses.find((s) => s.id === 5 + n)?.label ?? `custom_status${n}`;
      t.custom[label] = (t.custom[label] ?? 0) + count;
    }
  }
  return t;
}

export function addTallies(list: Tally[]): Tally {
  const sum = emptyTally();
  for (const t of list) {
    sum.passed += t.passed;
    sum.failed += t.failed;
    sum.blocked += t.blocked;
    sum.retest += t.retest;
    sum.untested += t.untested;
    for (const [k, v] of Object.entries(t.custom)) sum.custom[k] = (sum.custom[k] ?? 0) + v;
  }
  return sum;
}

const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

/**
 * Numbers a team wants in a progress report.
 *  - executed_pct:   share of tests that have any result (not untested)
 *  - pass_rate_pct:  passed / total
 *  - pass_rate_of_executed_pct: passed / executed
 */
export function summarize(t: Tally) {
  const customTotal = Object.values(t.custom).reduce((a, b) => a + b, 0);
  const total = t.passed + t.failed + t.blocked + t.retest + t.untested + customTotal;
  const executed = total - t.untested;
  return {
    total,
    passed: t.passed,
    failed: t.failed,
    blocked: t.blocked,
    retest: t.retest,
    untested: t.untested,
    custom: customTotal > 0 ? t.custom : undefined,
    executed,
    executed_pct: pct(executed, total),
    pass_rate_pct: pct(t.passed, total),
    pass_rate_of_executed_pct: pct(t.passed, executed),
  };
}

/** Accepts ids or names/labels ("failed", "Passed", 5) and returns status ids. */
export function resolveStatusIds(statuses: Status[], wanted: (string | number)[]): number[] {
  return [
    ...new Set(
      wanted.map((w) => {
        if (typeof w === 'number' || /^\d+$/.test(w)) return Number(w);
        const lower = w.trim().toLowerCase();
        const hit = statuses.find((s) => s.name.toLowerCase() === lower || s.label.toLowerCase() === lower);
        if (!hit) {
          throw new Error(`Unknown status "${w}". Available: ${statuses.map((s) => `${s.label} (${s.id})`).join(', ')}`);
        }
        return hit.id;
      }),
    ),
  ];
}
