import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ApiError } from '../testrail/client.js';
import { ScopeError } from '../testrail/scope.js';
import type { Label } from '../testrail/types.js';
import { safe } from './respond.js';

/** Labels arrived in TestRail 10.5. On older instances the endpoint is missing, so explain that clearly. */
function explainUnsupported(err: unknown): never {
  if (err instanceof ApiError && (err.status === 404 || (err.status === 400 && /unknown method/i.test(err.message)))) {
    throw new ApiError('Labels are not supported by this TestRail instance (requires TestRail 10.5+).', err.status, err.endpoint);
  }
  throw err;
}

async function allLabels(ctx: AppContext): Promise<Label[]> {
  try {
    return await ctx.client.getAll<Label>(`get_labels/${ctx.scope.project.id}`, 'labels');
  } catch (err) {
    explainUnsupported(err);
  }
}

export function registerLabelTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    'labels_list',
    {
      title: 'List labels',
      description: 'List the labels of the configured project (TestRail 10.5+). Optionally filter by title text.',
      inputSchema: {
        search_text: z.string().optional().describe('Only labels whose title contains this text.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ search_text }) => {
      let labels = await allLabels(ctx);
      if (search_text) {
        const needle = search_text.toLowerCase();
        labels = labels.filter((l) => l.title.toLowerCase().includes(needle));
      }
      return { project: ctx.scope.project.name, count: labels.length, labels: labels.map(({ id, title }) => ({ id, title })) };
    }),
  );

  server.registerTool(
    'labels_get',
    {
      title: 'Get label',
      description: 'Get one label of the configured project by id or by exact title (case-insensitive). TestRail labels have no slug; the title is used instead.',
      inputSchema: {
        label_id: z.number().int().positive().optional().describe('Label id.'),
        title: z.string().optional().describe('Exact label title, used when label_id is not given.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ label_id, title }) => {
      if (label_id !== undefined) {
        let label: Label;
        try {
          label = await ctx.client.get<Label>(`get_label/${label_id}`);
        } catch (err) {
          explainUnsupported(err);
        }
        if (label.project_id !== undefined && label.project_id !== ctx.scope.project.id) {
          throw new ScopeError(`Label ${label_id} belongs to another project.`);
        }
        return label;
      }
      if (!title) throw new Error('Pass label_id or title.');
      const wanted = title.trim().toLowerCase();
      const label = (await allLabels(ctx)).find((l) => l.title.trim().toLowerCase() === wanted);
      if (!label) throw new Error(`Label "${title}" not found in project "${ctx.scope.project.name}". Use labels_list to see available labels.`);
      return label;
    }),
  );
}
