import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { buildSectionTree, flattenTree } from '../testrail/mappers.js';
import type { Section } from '../testrail/types.js';
import { safe } from './respond.js';

export function registerSectionTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    'sections_list',
    {
      title: 'List sections',
      description:
        'List the sections and subsections (folders) of the configured suite. Returns a nested tree with "Parent > Child" paths ' +
        'by default, or a flat list with flat=true. Use it to find the section_id for tests_create or the parent_id for sections_create.',
      inputSchema: {
        flat: z.boolean().optional().describe('Return a flat list instead of a nested tree. Default false.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ flat }) => {
      const tree = buildSectionTree(await ctx.scope.getSections(true));
      return {
        suite: { id: ctx.scope.suite.id, name: ctx.scope.suite.name },
        sections: flat ? flattenTree(tree) : tree,
      };
    }),
  );

  server.registerTool(
    'sections_create',
    {
      title: 'Create section',
      description:
        'Create a section in the configured suite. Pass parent_id to create a subsection inside an existing section ' +
        '(get ids from sections_list). Cannot create sections in other suites or projects.',
      inputSchema: {
        name: z.string().min(1).max(250).describe('Section name, e.g. "User registration".'),
        description: z.string().optional().describe('Optional section description.'),
        parent_id: z.number().int().positive().optional().describe('Parent section id to create a subsection. Omit for a top-level section.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    safe(async ({ name, description, parent_id }) => {
      let parentPath: string | undefined;
      if (parent_id !== undefined) {
        const parent = await ctx.scope.assertSectionInScope(parent_id);
        parentPath = parent.name;
      }
      const created = await ctx.client.addSection<Section>(ctx.scope.project.id, {
        name,
        description,
        suite_id: ctx.scope.suite.id,
        parent_id,
      });
      ctx.scope.rememberSection(created);
      return {
        created: { id: created.id, name: created.name, parent_id: created.parent_id, depth: created.depth },
        parent: parentPath,
        suite: { id: ctx.scope.suite.id, name: ctx.scope.suite.name },
      };
    }),
  );
}
