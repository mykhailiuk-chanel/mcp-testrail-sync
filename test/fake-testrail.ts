import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Config } from '../src/config.js';
import { createServer } from '../src/server.js';
import { TestRailClient } from '../src/testrail/client.js';
import { Scope } from '../src/testrail/scope.js';

export interface Call {
  method: string;
  endpoint: string;
  query: Record<string, string>;
  body?: any;
}

/** Splits `.../index.php?/api/v2/get_cases/1&suite_id=10` into endpoint + query. */
export function parseTestRailUrl(url: string) {
  const [endpoint, ...params] = url.split('/api/v2/')[1].split('&');
  const query = Object.fromEntries(params.map((p) => p.split('=').map(decodeURIComponent)));
  return { endpoint, query };
}

/**
 * A tiny in-memory TestRail. Project "Demo" (1) has suites "Regression" (10) and "Smoke" (11).
 * Suite 10 has sections Auth (100) > User registration (101).
 */
export function createFakeTestRail(overrides: Partial<Record<string, (call: Call) => unknown>> = {}) {
  const calls: Call[] = [];
  let nextCaseId = 1000;
  let nextSectionId = 200;

  const sections: any[] = [
    { id: 100, name: 'Auth', suite_id: 10, parent_id: null, depth: 0, display_order: 1 },
    { id: 101, name: 'User registration', suite_id: 10, parent_id: 100, depth: 1, display_order: 2 },
    { id: 102, name: 'Checkout', suite_id: 10, parent_id: null, depth: 0, display_order: 3 },
  ];
  const otherSuiteSections: any[] = [{ id: 300, name: 'Smoke root', suite_id: 11, parent_id: null, depth: 0, display_order: 1 }];

  const routes: Record<string, (call: Call) => unknown> = {
    get_projects: () => ({
      offset: 0,
      limit: 250,
      size: 2,
      _links: { next: null, prev: null },
      projects: [
        { id: 1, name: 'Demo', suite_mode: 3 },
        { id: 2, name: 'Other', suite_mode: 1 },
      ],
    }),
    'get_project/1': () => ({ id: 1, name: 'Demo', suite_mode: 3 }),
    'get_suites/1': () => [
      { id: 10, name: 'Regression', project_id: 1 },
      { id: 11, name: 'Smoke', project_id: 1 },
    ],
    'get_suite/10': () => ({ id: 10, name: 'Regression', project_id: 1, description: 'Main suite' }),
    'get_templates/1': () => [
      { id: 1, name: 'Test Case (Text)', is_default: true },
      { id: 2, name: 'Test Case (Steps)', is_default: false },
    ],
    get_case_fields: () => [
      {
        id: 1,
        name: 'steps_separated',
        system_name: 'custom_steps_separated',
        label: 'Steps',
        is_active: true,
        type_id: 10,
        template_ids: [2],
        configs: [{ context: { is_global: true, project_ids: null }, options: { is_required: false } }],
      },
      {
        id: 2,
        name: 'automation',
        system_name: 'custom_automation',
        label: 'Automation',
        is_active: true,
        type_id: 6,
        template_ids: [],
        configs: [{ context: { is_global: false, project_ids: [1] }, options: { is_required: true } }],
      },
    ],
    'get_sections/1': (call) => ({
      _links: { next: null, prev: null },
      sections: call.query.suite_id === '10' ? sections : otherSuiteSections,
    }),
    'get_cases/1': (call) => {
      const all = [
        { id: 500, title: 'Register with valid email', section_id: 101, suite_id: 10, priority_id: 2, labels: [{ id: 1, title: 'smoke' }] },
        { id: 501, title: 'Register with taken email', section_id: 101, suite_id: 10, priority_id: 3 },
        { id: 502, title: 'Pay by card', section_id: 102, suite_id: 10, priority_id: 2 },
      ];
      let cases = all;
      if (call.query.filter) cases = cases.filter((c) => c.title.toLowerCase().includes(call.query.filter.toLowerCase()));
      if (call.query.section_id) cases = cases.filter((c) => String(c.section_id) === call.query.section_id);
      const limit = Number(call.query.limit ?? 250);
      const offset = Number(call.query.offset ?? 0);
      const page = cases.slice(offset, offset + limit);
      return {
        offset,
        limit,
        size: page.length,
        _links: { next: offset + limit < cases.length ? 'next' : null, prev: null },
        cases: page,
      };
    },
    'get_case/500': () => ({ id: 500, title: 'Register with valid email', section_id: 101, suite_id: 10, custom_steps_separated: [] }),
    'get_case/900': () => ({ id: 900, title: 'Smoke case', section_id: 300, suite_id: 11 }),
    'get_labels/1': () => ({
      _links: { next: null, prev: null },
      labels: [
        { id: 1, title: 'smoke' },
        { id: 2, title: 'regression' },
      ],
    }),
    'get_label/1': () => ({ id: 1, title: 'smoke', project_id: 1 }),
    'get_label/9': () => ({ id: 9, title: 'foreign', project_id: 2 }),
    add_case: (call) => ({ id: nextCaseId++, title: call.body.title, section_id: Number(call.endpoint.split('/')[1]), suite_id: 10 }),
    add_section: (call) => {
      const created = { id: nextSectionId++, suite_id: 10, depth: call.body.parent_id ? 1 : 0, display_order: 99, ...call.body };
      sections.push(created);
      return created;
    },
    ...overrides,
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const { endpoint, query } = parseTestRailUrl(url);
    const call: Call = { method: init?.method ?? 'GET', endpoint, query, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const route = routes[endpoint] ?? routes[endpoint.split('/')[0]];
    if (!route) return new Response(JSON.stringify({ error: `Unknown method '${endpoint}'` }), { status: 400 });
    try {
      return new Response(JSON.stringify(route(call)), { status: 200 });
    } catch (err) {
      const e = err as Error & { status?: number };
      return new Response(JSON.stringify({ error: e.message }), { status: e.status ?? 500 });
    }
  }) as typeof fetch;

  return { fetchImpl, calls, sections };
}

export const testConfig: Config = {
  url: 'https://example.testrail.io',
  username: 'qa@example.com',
  apiKey: 'secret-key-1234',
  project: 'Demo',
  suite: 'Regression',
};

/** Starts the real MCP server against the fake TestRail and returns a connected MCP client. */
export async function startTestServer(config: Config = testConfig, overrides?: Parameters<typeof createFakeTestRail>[0]) {
  const fake = createFakeTestRail(overrides);
  const client = new TestRailClient({ ...config, fetchImpl: fake.fetchImpl });
  const scope = await Scope.resolve(client, config);
  const server = createServer({ config, client, scope, version: '0.0.0-test' });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res: any = await mcp.callTool({ name, arguments: args });
    return { isError: Boolean(res.isError), data: JSON.parse(res.content[0].text) };
  };
  return { mcp, call, fake, scope };
}
