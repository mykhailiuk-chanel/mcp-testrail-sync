import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from './context.js';
import { registerLabelTools } from './tools/labels.js';
import { registerSectionTools } from './tools/sections.js';
import { registerSuiteTools } from './tools/suites.js';
import { registerSystemTools } from './tools/system.js';
import { registerTestTools } from './tools/tests.js';

export const SERVER_INSTRUCTIONS =
  'TestRail MCP server locked to ONE project and ONE suite (see system_ping). ' +
  'Hierarchy: suite > sections > subsections > test cases. ' +
  'Typical flow to add cases: suites_search or sections_list to find the section_id (sections_create if it does not exist), ' +
  'tests_search to avoid duplicates, then tests_create with a batch of cases. Updates and deletes are not available.';

/** Builds the MCP server and registers every tool. Kept separate from cli.ts so tests can create it without stdio. */
export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: 'mcp-testrail-sync', version: ctx.version },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  // Record tool names as they are registered, so system_ping can report them.
  const toolNames: string[] = [];
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, ...rest: unknown[]) => {
    toolNames.push(name);
    return (register as (...a: unknown[]) => unknown)(name, ...rest);
  }) as typeof server.registerTool;

  registerSystemTools(server, ctx, () => [...toolNames]);
  registerTestTools(server, ctx);
  registerLabelTools(server, ctx);
  registerSectionTools(server, ctx);
  registerSuiteTools(server, ctx);

  return server;
}
