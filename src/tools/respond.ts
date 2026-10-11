import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError } from '../testrail/client.js';
import { ScopeError } from '../testrail/scope.js';

/** Every tool returns JSON as a single text block. Compact JSON keeps the AI context small. */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function hintFor(err: unknown): string | undefined {
  if (err instanceof ScopeError) return 'This MCP server is locked to one project and suite by its config. Stay inside that suite.';
  if (!(err instanceof ApiError)) return undefined;
  switch (err.status) {
    case 0:
      return 'Check TESTRAIL_URL and your network/VPN.';
    case 400:
      return 'TestRail rejected the input. Check required fields (see system_ping -> case_format.required_fields) and ids.';
    case 401:
      return 'Check TESTRAIL_USERNAME / TESTRAIL_API_KEY, and that the API is enabled (Admin > Site Settings > API).';
    case 403:
      return 'Your TestRail user lacks permission for this project or action.';
    case 404:
      return 'Not found. The id may be wrong, or this TestRail version does not support the endpoint.';
    case 429:
      return 'TestRail rate limit hit. Wait a little and retry.';
    default:
      return undefined;
  }
}

export function fail(err: unknown): CallToolResult {
  const payload: Record<string, unknown> = {
    error: err instanceof Error ? err.message : String(err),
  };
  if (err instanceof ApiError) {
    payload.status = err.status;
    payload.endpoint = err.endpoint;
  }
  const hint = hintFor(err);
  if (hint) payload.hint = hint;
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/** Wraps a tool handler so any thrown error becomes a readable tool error instead of a protocol failure. */
export function safe<A>(handler: (args: A) => Promise<unknown>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return ok(await handler(args));
    } catch (err) {
      return fail(err);
    }
  };
}
