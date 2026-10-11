// stdout is reserved for MCP protocol messages (JSON-RPC over stdio).
// Anything written there that is not protocol breaks the client, so every log goes to stderr.
const write = (level: string, msg: string) => process.stderr.write(`[mcp-testrail-sync] ${level} ${msg}\n`);

export const logger = {
  info: (msg: string) => write('INFO', msg),
  warn: (msg: string) => write('WARN', msg),
  error: (msg: string) => write('ERROR', msg),
  debug: (msg: string) => {
    if (process.env.TESTRAIL_DEBUG === 'true') write('DEBUG', msg);
  },
};
