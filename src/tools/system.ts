import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../context.js';
import type { Project } from '../testrail/types.js';
import { safe } from './respond.js';

const SUITE_MODES: Record<number, string> = {
  1: 'single suite',
  2: 'single suite + baselines',
  3: 'multiple suites',
};

const maskKey = (key: string) => (key.length <= 4 ? '****' : `${'*'.repeat(8)}${key.slice(-4)}`);

export function registerSystemTools(server: McpServer, ctx: AppContext, toolNames: () => string[]) {
  server.registerTool(
    'system_ping',
    {
      title: 'Ping server',
      description:
        'Check that the server can reach TestRail and show the active configuration: the locked project and suite, ' +
        'how test steps are sent, required case fields, and the list of available tools. Call this first if unsure.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async () => {
      const { scope, config } = ctx;
      const started = Date.now();
      const project = await ctx.client.get<Project>(`get_project/${scope.project.id}`);
      return {
        status: 'ok',
        latency_ms: Date.now() - started,
        server: { name: 'mcp-testrail-sync', version: ctx.version },
        testrail: { url: config.url, username: config.username, api_key: maskKey(config.apiKey) },
        scope: {
          project: { id: project.id, name: project.name, suite_mode: SUITE_MODES[project.suite_mode] ?? project.suite_mode },
          suite: { id: scope.suite.id, name: scope.suite.name },
          writes_allowed: ['tests_create', 'sections_create'],
          updates_and_deletes: 'disabled in v1',
        },
        case_format: {
          steps_mode: scope.caseFormat.mode,
          template: scope.caseFormat.templateName
            ? { id: scope.caseFormat.templateId, name: scope.caseFormat.templateName }
            : 'TestRail default',
          required_fields: scope.caseFormat.requiredFields,
        },
        tools: toolNames(),
      };
    }),
  );
}
