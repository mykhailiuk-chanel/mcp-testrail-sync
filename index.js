#!/usr/bin/env node
// Thin entry shim so MCP clients can run `node node_modules/@mcp-testrail-sync/mcp/index.js`.
// All logic lives in the compiled TypeScript under dist/.
import { main } from './dist/cli.js';

main(process.argv.slice(2));
