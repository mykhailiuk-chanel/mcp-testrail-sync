import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { addTallies, resolveStatusIds, summarize, tallyRun } from '../testrail/progress.js';
import { collectRuns, compactMilestone, compactRun, flag, loadRun, runTests, toUnix, toUnixEnd } from '../testrail/runs.js';
import type { Milestone } from '../testrail/types.js';
import { safe } from './respond.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

const date = (what: string) =>
  z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Use a date like 2026-11-01 or 2026-11-01T09:00:00Z')
    .describe(what);

const runId = z
  .union([z.number().int().positive(), z.string().regex(/^[Rr]?\d+$/)])
  .describe('Run id, e.g. 123 or "R123".')
  .transform((v) => (typeof v === 'number' ? v : Number(v.replace(/^[Rr]/, ''))));

const PROBLEM = ['failed', 'blocked', 'retest'];

export function registerRunTools(server: McpServer, ctx: AppContext) {
  const { client, scope } = ctx;

  server.registerTool(
    'runs_list',
    {
      title: 'List test runs with progress numbers',
      description:
        'THE tool for progress reports. Returns every run of the configured suite (standalone runs AND runs inside test plans), each with a status ' +
        'summary, plus `totals` over ALL matched runs (not just the page).\n' +
        'Summary fields: total, passed, failed, blocked, retest, untested, custom (e.g. Skipped), executed, executed_pct, pass_rate_pct (passed/total), pass_rate_of_executed_pct.\n' +
        'Filters: from/to = date window; a run matches if it was active at any time in it (created before "to" AND still open or completed after "from"), ' +
        'so both in-progress and completed runs are found. state = open | completed | all. milestone_id, search_text. Dates in the output are UTC.\n' +
        'group_by="milestone" adds one totals row per milestone (progress table); include_runs=false returns numbers only (cheapest).\n' +
        'Without from/to/milestone_id it scans the whole history, which is slow on big projects: prefer a window. ' +
        'Paged over the run rows (newest first): if has_more is true, call again with offset=next_offset. Use runs_get for the failing tests of one run.',
      inputSchema: {
        from: date('Window start, e.g. 2026-11-01. Runs completed before this date are excluded.').optional(),
        to: date('Window end, e.g. 2026-11-30 (a bare date includes the whole day). Runs created after this are excluded.').optional(),
        state: z.enum(['open', 'completed', 'all']).optional().describe('open = in progress, completed = closed. Default all.'),
        milestone_id: z.number().int().positive().optional().describe('Only runs of this milestone (see milestones_list).'),
        search_text: z.string().optional().describe('Only runs (or plans) whose name contains this text.'),
        group_by: z.enum(['milestone']).optional().describe('Add per-milestone totals.'),
        include_runs: z.boolean().optional().describe('Return the run rows. Default true; set false for totals/groups only.'),
        limit: z.number().int().min(1).max(500).optional().describe('Max run rows returned, newest first. Default 100. Totals always cover all matched runs.'),
        offset: z.number().int().min(0).optional().describe('Rows to skip, for paging.'),
        max_plans: z.number().int().min(1).max(200).optional().describe('Max test plans to open (one API call each). Default 50.'),
      },
      annotations: READ_ONLY,
    },
    safe(async (a) => {
      const statuses = await scope.getStatuses();
      const c = await collectRuns(ctx, a);
      const limit = a.limit ?? 100;
      const offset = a.offset ?? 0;
      const rows = a.include_runs === false ? [] : c.runs.slice(offset, offset + limit);

      let groups: unknown;
      if (a.group_by === 'milestone') {
        const names = new Map<number, string>(
          (await client.getAll<Milestone>(`get_milestones/${scope.project.id}`, 'milestones')).map((m) => [m.id, m.name]),
        );
        const buckets = new Map<number | null, typeof c.runs>();
        for (const r of c.runs) {
          const key = r.run.milestone_id ?? null;
          buckets.set(key, [...(buckets.get(key) ?? []), r]);
        }
        groups = [...buckets.entries()].map(([id, list]) => ({
          milestone_id: id ?? undefined,
          milestone: id === null ? '(no milestone)' : (names.get(id) ?? `#${id}`),
          runs_count: list.length,
          summary: summarize(addTallies(list.map(({ run }) => tallyRun(run, statuses)))),
        }));
      }

      const next = offset + rows.length;
      const warnings: string[] = [];
      if (c.plans_truncated) warnings.push(`Only ${c.plans_scanned} of ${c.plans_found} test plans were opened; totals may be incomplete. Narrow the dates or raise max_plans.`);
      if (c.lists_truncated) warnings.push('TestRail returned more than 10,000 runs/plans; totals are incomplete. Narrow the dates or filter by milestone.');
      return {
        suite: { id: scope.suite.id, name: scope.suite.name },
        filters: { from: a.from, to: a.to, state: a.state ?? 'all', milestone_id: a.milestone_id, search_text: a.search_text },
        scan: { standalone_runs: c.standalone_runs_scanned, plans_found: c.plans_found, plans_opened: c.plans_scanned },
        matched: c.runs.length,
        totals: summarize(addTallies(c.runs.map(({ run }) => tallyRun(run, statuses)))),
        by_milestone: groups,
        count: rows.length,
        offset,
        limit,
        has_more: a.include_runs === false ? undefined : next < c.runs.length,
        next_offset: a.include_runs !== false && next < c.runs.length ? next : undefined,
        runs: a.include_runs === false ? undefined : rows.map(({ run, plan_name }) => compactRun(ctx, run, statuses, { plan_name })),
        warnings: warnings.length ? warnings : undefined,
      };
    }),
  );

  server.registerTool(
    'runs_get',
    {
      title: 'Get a run with its tests',
      description:
        'One run: status summary plus its tests with CURRENT status and, by default, the latest result comment and defects. ' +
        'By default lists only failed, blocked and retest tests; pass status to see others (e.g. ["passed"] or ["untested"]). ' +
        'Accepts 123 or "R123". Paged: if has_more is true, call again with offset=next_offset.',
      inputSchema: {
        run_id: runId,
        status: z
          .array(z.union([z.string(), z.number().int()]))
          .optional()
          .describe('Statuses to list: names/labels or ids. Default ["failed","blocked","retest"]. Custom statuses (e.g. "Skipped") work by label; see system_ping -> statuses.'),
        include_comments: z.boolean().optional().describe('Add latest comment, defects and date per test (one extra call). Default true.'),
        limit: z.number().int().min(1).max(250).optional().describe('Page size, 1-250. Default 50.'),
        offset: z.number().int().min(0).optional().describe('Rows to skip, for paging.'),
      },
      annotations: READ_ONLY,
    },
    safe(async (a) => {
      const run = await loadRun(ctx, a.run_id);
      const statuses = await scope.getStatuses();
      const statusIds = resolveStatusIds(statuses, a.status?.length ? a.status : PROBLEM);
      const limit = a.limit ?? 50;
      const offset = a.offset ?? 0;
      const page = await runTests(ctx, run, statuses, { statusIds, limit, offset, withComments: a.include_comments !== false });
      return {
        run: compactRun(ctx, run, statuses),
        listed_statuses: statusIds.map((id) => statuses.find((s) => s.id === id)?.label ?? id),
        count: page.tests.length,
        offset,
        limit,
        has_more: page.has_more,
        next_offset: page.has_more ? offset + page.tests.length : undefined,
        tests: page.tests,
      };
    }),
  );

  server.registerTool(
    'milestones_list',
    {
      title: 'List milestones',
      description:
        'List milestones of the project (name, description, state, start/due/completed dates in UTC, parent_id). Filter by state, by date window ' +
        '(from/to: milestones active at any time in the window) or by name. Paged: if has_more is true, call again with offset=next_offset. ' +
        'No pass/fail numbers here: for progress per milestone call runs_list with group_by="milestone".',
      inputSchema: {
        state: z.enum(['open', 'completed', 'all']).optional().describe('open = not completed yet. Default all.'),
        from: date('Window start, e.g. 2026-11-01.').optional(),
        to: date('Window end, e.g. 2026-11-30 (a bare date includes the whole day).').optional(),
        search_text: z.string().optional().describe('Only milestones whose name contains this text.'),
        limit: z.number().int().min(1).max(500).optional().describe('Max rows returned, earliest due date first. Default 100.'),
        offset: z.number().int().min(0).optional().describe('Rows to skip, for paging. Use next_offset from the previous page.'),
      },
      annotations: READ_ONLY,
    },
    safe(async (a) => {
      const from = toUnix(a.from);
      const to = toUnixEnd(a.to);
      const state = a.state ?? 'all';
      const needle = a.search_text?.toLowerCase();
      const all = await client.getAll<Milestone>(`get_milestones/${scope.project.id}`, 'milestones', {
        is_completed: state === 'all' ? undefined : flag(state === 'completed'),
      });
      const rows = all
        .filter((m) => {
          const start = m.started_on ?? m.start_on ?? undefined;
          const end = m.completed_on ?? m.due_on ?? undefined;
          return (to === undefined || start === undefined || start <= to) && (from === undefined || end === undefined || end >= from);
        })
        .filter((m) => !needle || m.name.toLowerCase().includes(needle))
        .sort((x, y) => (x.due_on ?? Infinity) - (y.due_on ?? Infinity));
      const limit = a.limit ?? 100;
      const offset = a.offset ?? 0;
      const page = rows.slice(offset, offset + limit);
      const hasMore = offset + page.length < rows.length;
      return {
        matched: rows.length,
        count: page.length,
        offset,
        limit,
        has_more: hasMore,
        next_offset: hasMore ? offset + page.length : undefined,
        milestones: page.map((m) => ({ ...compactMilestone(m), description: m.description || undefined })),
      };
    }),
  );
}
