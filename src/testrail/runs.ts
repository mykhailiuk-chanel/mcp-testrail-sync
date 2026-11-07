import type { AppContext } from '../context.js';
import { summarize, tallyRun, type Tally } from './progress.js';
import type { Milestone, Plan, Run, RunTest, Status, TestResult } from './types.js';

export const toUnix = (iso: string | undefined) => (iso === undefined ? undefined : Math.floor(Date.parse(iso) / 1000));
export const toIso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : undefined);
/** End of window: a bare date (2026-11-30) includes that whole day. */
export const toUnixEnd = (iso: string | undefined) => {
  if (iso === undefined) return undefined;
  const t = Math.floor(Date.parse(iso) / 1000);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso.trim()) ? t + 86399 : t;
};
export const flag = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);

export function compactRun(ctx: AppContext, run: Run, statuses: Status[], extra: { plan_name?: string } = {}) {
  return {
    id: run.id,
    name: run.name,
    url: run.url,
    milestone_id: run.milestone_id ?? undefined,
    plan_id: run.plan_id ?? undefined,
    plan_name: extra.plan_name,
    config: run.config || undefined,
    assignedto_id: run.assignedto_id ?? undefined,
    is_completed: Boolean(run.is_completed),
    created_on: toIso(run.created_on),
    completed_on: toIso(run.completed_on),
    summary: summarize(tallyRun(run, statuses)),
  };
}

export function compactMilestone(m: Milestone) {
  return {
    id: m.id,
    name: m.name,
    parent_id: m.parent_id ?? undefined,
    is_started: m.is_started,
    is_completed: m.is_completed,
    start_on: toIso(m.start_on),
    started_on: toIso(m.started_on),
    due_on: toIso(m.due_on),
    completed_on: toIso(m.completed_on),
    refs: m.refs || undefined,
    url: m.url,
  };
}

export function compactTest(t: RunTest, statuses: Status[]) {
  return {
    test_id: t.id,
    case_id: t.case_id,
    title: t.title,
    status: statuses.find((s) => s.id === t.status_id)?.label ?? t.status_id,
    assignedto_id: t.assignedto_id ?? undefined,
    priority_id: t.priority_id,
  };
}

export function compactResult(r: TestResult, statuses: Status[]) {
  return {
    id: r.id,
    test_id: r.test_id,
    status: r.status_id === null ? undefined : (statuses.find((s) => s.id === r.status_id)?.label ?? r.status_id),
    comment: r.comment || undefined,
    defects: r.defects || undefined,
    version: r.version || undefined,
    elapsed: r.elapsed || undefined,
    created_on: toIso(r.created_on),
    created_by: r.created_by,
    assignedto_id: r.assignedto_id ?? undefined,
  };
}

/** Loads a run and checks it belongs to the configured project + suite. */
export async function loadRun(ctx: AppContext, runId: number): Promise<Run> {
  const run = await ctx.client.get<Run>(`get_run/${runId}`);
  ctx.scope.assertRunInScope(run);
  return run;
}

export type RunState = 'open' | 'completed' | 'all';

export interface CollectFilters {
  milestone_id?: number;
  state?: RunState;
  /** Window start/end. A run matches if it was active at any time in [from, to]: created <= to and (still open or completed >= from). */
  from?: string;
  to?: string;
  search_text?: string;
  max_plans?: number;
}

export interface CollectedRun {
  run: Run;
  plan_name?: string;
}

/**
 * All runs of the configured suite matching the filters: standalone runs (get_runs) plus runs inside test plans (get_plan entries).
 * Plan runs of other suites are dropped. At most `max_plans` plans are opened (one API call each); plans outside the window are skipped without opening.
 */
export async function collectRuns(ctx: AppContext, f: CollectFilters) {
  const { client, scope } = ctx;
  const from = toUnix(f.from);
  const to = toUnixEnd(f.to);
  const state = f.state ?? 'all';
  const needle = f.search_text?.toLowerCase();

  const inWindow = (created: number | undefined, completed: number | null | undefined) =>
    (to === undefined || created === undefined || created <= to) && (from === undefined || !completed || completed >= from);
  const stateOk = (run: Run) => state === 'all' || (state === 'completed') === Boolean(run.is_completed);

  const out: CollectedRun[] = [];

  const standaloneRes = await client.getAllChecked<Run>(`get_runs/${scope.project.id}`, 'runs', {
    suite_id: scope.suite.id,
    milestone_id: f.milestone_id,
    is_completed: state === 'all' ? undefined : flag(state === 'completed'),
    created_before: to,
  });
  const standalone = standaloneRes.rows;
  for (const run of standalone) {
    if (inWindow(run.created_on, run.completed_on) && (!needle || run.name.toLowerCase().includes(needle))) out.push({ run });
  }

  // Plans: an open plan may hold completed runs, so completion is checked per run, not on the plan.
  const plansRes = await client.getAllChecked<Plan>(`get_plans/${scope.project.id}`, 'plans', { milestone_id: f.milestone_id, created_before: to });
  const plans = plansRes.rows.filter((p) => inWindow(p.created_on, p.completed_on));
  const maxPlans = f.max_plans ?? 50;
  const opened = plans.slice(0, maxPlans);
  for (let i = 0; i < opened.length; i += 5) {
    const full = await Promise.all(opened.slice(i, i + 5).map((p) => client.get<Plan>(`get_plan/${p.id}`)));
    for (const plan of full) {
      for (const entry of plan.entries ?? []) {
        for (const run of entry.runs ?? []) {
          if (run.suite_id !== scope.suite.id || !stateOk(run)) continue;
          if (!inWindow(run.created_on ?? plan.created_on, run.completed_on ?? (run.is_completed ? plan.completed_on : null))) continue;
          if (needle && !run.name.toLowerCase().includes(needle) && !plan.name.toLowerCase().includes(needle)) continue;
          out.push({ run: { ...run, milestone_id: run.milestone_id ?? plan.milestone_id }, plan_name: plan.name });
        }
      }
    }
  }
  out.sort((a, b) => (b.run.created_on ?? 0) - (a.run.created_on ?? 0));
  return {
    runs: out,
    standalone_runs_scanned: standalone.length,
    plans_found: plans.length,
    plans_scanned: opened.length,
    plans_truncated: plans.length > opened.length,
    /** True if TestRail had more rows than the 10,000-row safety limit; totals are then incomplete. */
    lists_truncated: standaloneRes.truncated || plansRes.truncated,
  };
}

export interface TestsPage {
  tests: (ReturnType<typeof compactTest> & { last_comment?: string; defects?: string; last_result_on?: string })[];
  has_more: boolean;
}

/** Tests of one run with current status, optionally with the newest comment/defects from the result history. */
export async function runTests(
  ctx: AppContext,
  run: Run,
  statuses: Status[],
  opts: { statusIds?: number[]; limit: number; offset: number; withComments: boolean },
): Promise<TestsPage> {
  const status_id = opts.statusIds?.join(',');
  const { rows, hasMore } = await ctx.client.getPage<RunTest>(`get_tests/${run.id}`, 'tests', { status_id }, opts.limit, opts.offset);

  const latest = new Map<number, TestResult>();
  if (opts.withComments && rows.length) {
    // Newest first: the first result seen per test is its latest one.
    const results = await ctx.client.getAll<TestResult>(`get_results_for_run/${run.id}`, 'results', { status_id });
    for (const r of results) if (!latest.has(r.test_id)) latest.set(r.test_id, r);
  }
  return {
    has_more: hasMore,
    tests: rows.map((row) => {
      const r = latest.get(row.id);
      return {
        ...compactTest(row, statuses),
        last_comment: r?.comment || undefined,
        defects: r?.defects || undefined,
        last_result_on: toIso(r?.created_on),
      };
    }),
  };
}

export type { Tally };
