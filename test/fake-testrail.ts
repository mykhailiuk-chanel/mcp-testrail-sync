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

  const counts = (p: number, f: number, b: number, r: number, u: number, c1 = 0) => ({
    passed_count: p,
    failed_count: f,
    blocked_count: b,
    retest_count: r,
    untested_count: u,
    custom_status1_count: c1,
  });
  const run700 = { id: 700, name: 'Sprint 12 regression', project_id: 1, suite_id: 10, milestone_id: 50, is_completed: false, created_on: 1700000000, ...counts(6, 2, 1, 0, 1) };
  const run704 = { id: 704, name: 'Old release regression', project_id: 1, suite_id: 10, milestone_id: 51, is_completed: true, created_on: 1689000000, completed_on: 1690000000, ...counts(9, 1, 0, 0, 0) };
  const run701 = { id: 701, name: 'Smoke run', project_id: 1, suite_id: 11, milestone_id: 50, ...counts(5, 0, 0, 0, 0) };
  const run702 = { id: 702, name: 'Plan run', project_id: 1, suite_id: 10, milestone_id: 50, plan_id: 800, created_on: 1700000000, ...counts(2, 0, 0, 0, 2, 1) };
  const plan800 = {
    id: 800,
    name: 'Release plan',
    project_id: 1,
    milestone_id: 50,
    created_on: 1700000000,
    entries: [
      { id: 'a', suite_id: 10, runs: [run702] },
      { id: 'b', suite_id: 11, runs: [{ ...run701, id: 703, plan_id: 800 }] },
    ],
  };

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
    'get_suites/1': () => ({
      offset: 0,
      limit: 250,
      size: 2,
      _links: { next: null, prev: null },
      suites: [
        { id: 10, name: 'Regression', project_id: 1 },
        { id: 11, name: 'Smoke', project_id: 1 },
      ],
    }),
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
    get_statuses: () => [
      { id: 1, name: 'passed', label: 'Passed', is_system: true },
      { id: 2, name: 'blocked', label: 'Blocked', is_system: true },
      { id: 3, name: 'untested', label: 'Untested', is_system: true },
      { id: 4, name: 'retest', label: 'Retest', is_system: true },
      { id: 5, name: 'failed', label: 'Failed', is_system: true },
      { id: 6, name: 'custom_status1', label: 'Skipped', is_system: false },
    ],
    // Runs: 700 standalone (milestone 50), 701 standalone of another suite, 702 inside plan 800.
    'get_runs/1': (call) => {
      const all = [run700, run701, run704].filter((r) => !call.query.suite_id || String(r.suite_id) === call.query.suite_id);
      const rows = all
        .filter((r) => !call.query.milestone_id || String(r.milestone_id) === call.query.milestone_id)
        .filter((r) => call.query.is_completed === undefined || Boolean((r as any).is_completed) === (call.query.is_completed === '1'));
      return { offset: 0, limit: 250, size: rows.length, _links: { next: null, prev: null }, runs: rows };
    },
    'get_run/700': () => run700,
    'get_run/701': () => run701,
    'get_plans/1': (call) => ({
      _links: { next: null, prev: null },
      plans: !call.query.milestone_id || call.query.milestone_id === '50' ? [{ id: 800, name: 'Release plan', project_id: 1, milestone_id: 50 }] : [],
    }),
    'get_plan/800': () => plan800,
    'get_plan/801': () => ({ id: 801, name: 'Smoke only', project_id: 1, entries: [{ id: 'e', suite_id: 11, runs: [run701] }] }),
    'get_milestones/1': (call) => {
      const all = [
        { id: 50, name: 'Release 1.0', project_id: 1, due_on: 1800000000, is_completed: false },
        { id: 51, name: 'Release 0.9', project_id: 1, due_on: 1700000000, is_completed: true },
      ];
      const want = call.query.is_completed;
      return { _links: { next: null, prev: null }, milestones: want === undefined ? all : all.filter((m) => m.is_completed === (want === '1')) };
    },
    'get_milestone/50': () => ({
      id: 50,
      name: 'Release 1.0',
      project_id: 1,
      description: 'First release',
      milestones: [{ id: 52, name: 'RC', project_id: 1, parent_id: 50 }],
    }),
    'get_milestone/52': () => ({ id: 52, name: 'RC', project_id: 1, parent_id: 50 }),
    'get_milestone/99': () => ({ id: 99, name: 'Foreign', project_id: 2 }),
    'get_tests/700': (call) => {
      const tests = [
        { id: 9001, case_id: 500, run_id: 700, status_id: 5, title: 'Register with valid email' },
        { id: 9002, case_id: 501, run_id: 700, status_id: 1, title: 'Register with taken email' },
        { id: 9003, case_id: 502, run_id: 700, status_id: 2, title: 'Pay by card' },
      ];
      const wanted = call.query.status_id?.split(',');
      const rows = wanted ? tests.filter((t) => wanted.includes(String(t.status_id))) : tests;
      return { _links: { next: null, prev: null }, tests: rows };
    },
    'get_results_for_run/700': () => ({
      _links: { next: null, prev: null },
      results: [
        { id: 3, test_id: 9001, status_id: 5, comment: 'newest failure', defects: 'BUG-1', created_on: 1700000100 },
        { id: 1, test_id: 9001, status_id: 5, comment: 'older failure', created_on: 1700000000 },
        { id: 2, test_id: 9003, status_id: 2, comment: 'env down', created_on: 1700000050 },
      ],
    }),
    'get_test/9001': () => ({ id: 9001, case_id: 500, run_id: 700, status_id: 5, title: 'Register with valid email' }),
    'get_test/9999': () => ({ id: 9999, case_id: 900, run_id: 701, status_id: 1, title: 'Smoke case' }),
    'get_results/9001': () => ({ _links: { next: null, prev: null }, results: [{ id: 3, test_id: 9001, status_id: 5, comment: 'newest failure' }] }),
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
