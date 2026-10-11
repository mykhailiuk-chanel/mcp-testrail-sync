import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { compactCase, toAddCaseBody, type NewCaseInput } from '../testrail/mappers.js';
import type { TestCase } from '../testrail/types.js';
import { safe } from './respond.js';

interface TestsListArgs {
  section_id?: number;
  search_text?: string;
  priority_id?: number;
  type_id?: number;
  label_id?: number;
  limit?: number;
  offset?: number;
}

interface CasesPage {
  offset?: number;
  limit?: number;
  size?: number;
  _links?: { next: string | null };
  cases?: TestCase[];
}

/** One page of cases from the configured suite. Shared by tests_list and tests_search. */
export async function listTests(ctx: AppContext, args: TestsListArgs) {
  const { scope, client } = ctx;
  if (args.section_id !== undefined) await scope.assertSectionInScope(args.section_id);

  const limit = args.limit ?? 50;
  const offset = args.offset ?? 0;
  const res = await client.get<CasesPage | TestCase[]>(`get_cases/${scope.project.id}`, {
    suite_id: scope.suite.id,
    section_id: args.section_id,
    filter: args.search_text,
    priority_id: args.priority_id,
    type_id: args.type_id,
    label_id: args.label_id,
    limit,
    offset,
  });

  const cases = Array.isArray(res) ? res : (res.cases ?? []);
  const hasMore = Array.isArray(res) ? false : Boolean(res._links?.next);
  return {
    suite: { id: scope.suite.id, name: scope.suite.name },
    count: cases.length,
    offset,
    limit,
    has_more: hasMore,
    next_offset: hasMore ? offset + cases.length : undefined,
    tests: cases.map(compactCase),
  };
}

const caseInputSchema = z.object({
  section_id: z.number().int().positive().describe('Target section id inside the configured suite (see sections_list).'),
  title: z.string().min(1).max(250).describe('Test case title.'),
  preconditions: z.string().optional().describe('Preconditions text (custom_preconds).'),
  steps: z
    .array(
      z.object({
        content: z.string().min(1).describe('Step action.'),
        expected: z.string().optional().describe('Expected result for this step.'),
      }),
    )
    .optional()
    .describe('Ordered steps. Sent as separated steps or as text, depending on the project template.'),
  expected: z.string().optional().describe('Overall expected result (used when there are no per-step results).'),
  priority_id: z.number().int().positive().optional().describe('TestRail priority id.'),
  type_id: z.number().int().positive().optional().describe('TestRail case type id.'),
  refs: z.string().optional().describe('Comma-separated references, e.g. "JIRA-123, JIRA-124".'),
  estimate: z.string().optional().describe('Estimate, e.g. "30s", "5m", "1h 30m".'),
  labels: z
    .array(z.union([z.string(), z.number().int()]))
    .optional()
    .describe('Label titles or ids (TestRail 10.5+). See labels_list.'),
  custom_fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Extra custom fields by system name, e.g. {"custom_automation_type": 1}. Use for project-required fields.'),
});

export function registerTestTools(server: McpServer, ctx: AppContext) {
  const listShape = {
    section_id: z.number().int().positive().optional().describe('Only cases from this section (not including subsections).'),
    search_text: z.string().optional().describe('Only cases whose title contains this text.'),
    priority_id: z.number().int().positive().optional().describe('Filter by priority id.'),
    type_id: z.number().int().positive().optional().describe('Filter by case type id.'),
    label_id: z.number().int().positive().optional().describe('Filter by label id (TestRail 10.5+).'),
    limit: z.number().int().min(1).max(250).optional().describe('Page size, 1-250. Default 50.'),
    offset: z.number().int().min(0).optional().describe('Rows to skip, for paging. Use next_offset from the previous page.'),
  };

  server.registerTool(
    'tests_list',
    {
      title: 'List test cases',
      description:
        'List test cases in the configured suite, with optional filters. Returns short rows (id, title, section, priority, labels); ' +
        'use tests_get for full steps. Paged: if has_more is true, call again with offset=next_offset.',
      inputSchema: listShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe((args) => listTests(ctx, args)),
  );

  server.registerTool(
    'tests_get',
    {
      title: 'Get test case',
      description: 'Get one test case with all fields, including steps and expected results. Accepts 123 or "C123".',
      inputSchema: {
        test_id: z.union([z.number().int().positive(), z.string().regex(/^[Cc]?\d+$/)]).describe('Case id, e.g. 123 or "C123".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ test_id }) => {
      const id = typeof test_id === 'number' ? test_id : Number(test_id.replace(/^[Cc]/, ''));
      const testCase = await ctx.client.get<TestCase>(`get_case/${id}`);
      ctx.scope.assertCaseInScope(testCase);
      return testCase;
    }),
  );

  server.registerTool(
    'tests_search',
    {
      title: 'Search test cases',
      description: 'Search test cases in the configured suite by title text. Delegates to tests_list with search_text.',
      inputSchema: {
        query: z.string().min(1).describe('Text to search for in case titles.'),
        section_id: listShape.section_id,
        limit: listShape.limit,
        offset: listShape.offset,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(({ query, ...rest }) => listTests(ctx, { ...rest, search_text: query })),
  );

  server.registerTool(
    'tests_create',
    {
      title: 'Create test cases',
      description:
        'Create 1-50 test cases in sections of the configured suite. Each case needs section_id and title; steps are optional ' +
        'and are sent in the format the project template expects. Cases are created one by one; the result lists created ' +
        'cases (id, title, url) and any failures. Check existing cases with tests_search first to avoid duplicates. ' +
        'Cannot update or delete existing cases.',
      inputSchema: {
        cases: z.array(caseInputSchema).min(1).max(50).describe('Test cases to create.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    safe(({ cases }) => createTests(ctx, cases)),
  );
}

export async function createTests(ctx: AppContext, cases: NewCaseInput[]) {
  const { scope, client, config } = ctx;

  // Validate all target sections before creating anything, so a bad id doesn't leave a half-created batch.
  const sectionIds = [...new Set(cases.map((c) => c.section_id))];
  const sectionNames = new Map<number, string>();
  for (const id of sectionIds) sectionNames.set(id, (await scope.assertSectionInScope(id)).name);

  const created: { id: number; title: string; section: string | undefined; url: string }[] = [];
  const failed: { title: string; section_id: number; error: string }[] = [];

  for (const input of cases) {
    try {
      const res = await client.addCase<TestCase>(input.section_id, toAddCaseBody(input, scope.caseFormat));
      created.push({
        id: res.id,
        title: res.title,
        section: sectionNames.get(input.section_id),
        url: `${config.url}/index.php?/cases/view/${res.id}`,
      });
    } catch (err) {
      failed.push({ title: input.title, section_id: input.section_id, error: (err as Error).message });
    }
  }

  return {
    suite: { id: scope.suite.id, name: scope.suite.name },
    steps_mode: scope.caseFormat.mode,
    summary: { requested: cases.length, created: created.length, failed: failed.length },
    created,
    failed: failed.length ? failed : undefined,
  };
}
