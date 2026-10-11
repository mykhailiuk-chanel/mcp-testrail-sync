import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigurationError, loadConfig } from './config.js';
import { logger } from './logger.js';
import { createServer } from './server.js';
import { TestRailClient } from './testrail/client.js';
import { Scope } from './testrail/scope.js';
import { packageVersion } from './version.js';

const HELP = `mcp-testrail-sync - MCP server for TestRail, locked to one project and one suite

Usage (normally started by your MCP client, not by hand):
  node node_modules/@mcp-testrail-sync/mcp/index.js --project <name|id> [--suite <name|id>]

Environment:
  TESTRAIL_URL        https://your-instance.testrail.io
  TESTRAIL_USERNAME   your TestRail login email
  TESTRAIL_API_KEY    TestRail > My Settings > API Keys
  TESTRAIL_SUITE      suite name or id (or pass --suite)
  TESTRAIL_DEBUG      "true" to log every API call to stderr
`;

export async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(HELP);
    return;
  }
  const version = packageVersion();
  if (argv.includes('--version')) {
    process.stderr.write(`${version}\n`);
    return;
  }

  try {
    const config = loadConfig(argv);
    const client = new TestRailClient(config);
    const scope = await Scope.resolve(client, config);
    const server = createServer({ config, client, scope, version });

    await server.connect(new StdioServerTransport());
    logger.info(`v${version} ready on stdio`);

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    const prefix = err instanceof ConfigurationError ? '' : 'Startup failed: ';
    logger.error(`${prefix}${(err as Error).message}`);
    process.exit(1);
  }
}
