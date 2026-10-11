import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { buildSectionTree, flattenTree, type SectionNode } from '../testrail/mappers.js';
import type { Suite, TestCase } from '../testrail/types.js';
import { safe } from './respond.js';

interface SuitesListArgs {
  search_text?: string;
  include_case_counts?: boolean;
}

/**
 * The configured suite as a tree: suite -> sections -> subsections.
 * With search_text, returns only the sections whose name matches (with their full path).
 */
export async function listSuiteTree(ctx: AppContext, { search_text, include_case_counts }: SuitesListArgs) {
  const { scope, client } = ctx;
  const [suite, sections] = await Promise.all([client.get<Suite>(`get_suite/${scope.suite.id}`), scope.getSections(true)]);

  let counts: Map<number, number> | undefined;
  if (include_case_counts) {
    const cases = await client.getAll<TestCase>(`get_cases/${scope.project.id}`, 'cases', { suite_id: scope.suite.id });
    counts = new Map();
    for (const c of cases) counts.set(c.section_id, (counts.get(c.section_id) ?? 0) + 1);
  }

  const tree = buildSectionTree(sections, counts);
  const header = { id: suite.id, name: suite.name, description: suite.description || undefined, url: suite.url };

  if (search_text) {
    const needle = search_text.toLowerCase();
    const matches = flattenTree(tree).filter((n) => n.name.toLowerCase().includes(needle));
    return { suite: header, search_text, matches };
  }
  return { suite: { ...header, section_count: sections.length, sections: tree as SectionNode[] } };
}

export function registerSuiteTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    'suites_list',
    {
      title: 'Show suite tree',
      description:
        'Show the configured suite as a tree: suite > sections > subsections. This server is locked to one suite, ' +
        'so this is the full structure you can work in. Set include_case_counts=true to add the number of cases per section (slower on big suites).',
      inputSchema: {
        search_text: z.string().optional().describe('Optional: only return sections whose name contains this text.'),
        include_case_counts: z.boolean().optional().describe('Add case counts per section. Default false.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe((args) => listSuiteTree(ctx, args)),
  );

  server.registerTool(
    'suites_get',
    {
      title: 'Get suite',
      description: 'Get details of the configured suite. suite_id is optional; any id other than the configured suite is rejected.',
      inputSchema: {
        suite_id: z.number().int().positive().optional().describe('Suite id. Defaults to the configured suite.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ suite_id }) => {
      if (suite_id !== undefined) ctx.scope.assertSuiteInScope(suite_id);
      return ctx.client.get<Suite>(`get_suite/${ctx.scope.suite.id}`);
    }),
  );

  server.registerTool(
    'suites_search',
    {
      title: 'Search suite sections',
      description:
        'Search section and subsection names inside the configured suite by text and return the matching paths, ' +
        'e.g. "Auth > User registration". Delegates to suites_list with search_text.',
      inputSchema: {
        query: z.string().min(1).describe('Text to look for in section names (case-insensitive).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(({ query }) => listSuiteTree(ctx, { search_text: query })),
  );
}
