import { describe, expect, it } from 'vitest';
import { startTestServer } from './fake-testrail.js';

describe('tool registry', () => {
  it('exposes exactly the v1 tools (snapshot)', async () => {
    const { mcp } = await startTestServer();
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toMatchInlineSnapshot(`
      [
        "labels_get",
        "labels_list",
        "sections_create",
        "sections_list",
        "suites_get",
        "suites_list",
        "suites_search",
        "system_ping",
        "tests_create",
        "tests_get",
        "tests_list",
        "tests_search",
      ]
    `);
    // no update/delete tools in v1
    expect(tools.some((t) => /update|delete/.test(t.name))).toBe(false);
    // only the two create tools are allowed to write
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort()).toEqual([
      'sections_create',
      'tests_create',
    ]);
  });
});

describe('system_ping', () => {
  it('reports scope, masked key, case format and tools', async () => {
    const { call } = await startTestServer();
    const { isError, data } = await call('system_ping');
    expect(isError).toBe(false);
    expect(data.status).toBe('ok');
    expect(data.testrail.api_key).toBe('********1234');
    expect(data.scope.project).toMatchObject({ id: 1, name: 'Demo', suite_mode: 'multiple suites' });
    expect(data.scope.suite).toEqual({ id: 10, name: 'Regression' });
    expect(data.case_format.required_fields).toEqual(['custom_automation']);
    expect(data.tools).toHaveLength(12);
  });
});

describe('tests_*', () => {
  it('tests_list always filters by the configured suite and returns compact rows', async () => {
    const { call, fake } = await startTestServer();
    const { data } = await call('tests_list', { limit: 2 });
    expect(fake.calls.at(-1)!.query).toMatchObject({ suite_id: '10', limit: '2', offset: '0' });
    expect(data.tests).toHaveLength(2);
    expect(data.has_more).toBe(true);
    expect(data.next_offset).toBe(2);
    expect(data.tests[0]).toEqual({
      id: 500,
      title: 'Register with valid email',
      section_id: 101,
      priority_id: 2,
      labels: ['smoke'],
    });
  });

  it('tests_search delegates to tests_list with filter=query', async () => {
    const { call, fake } = await startTestServer();
    const { data } = await call('tests_search', { query: 'register' });
    expect(fake.calls.at(-1)!.query.filter).toBe('register');
    expect(data.tests.map((t: any) => t.id)).toEqual([500, 501]);
  });

  it('tests_list rejects a section from another suite', async () => {
    const { call } = await startTestServer();
    const { isError, data } = await call('tests_list', { section_id: 300 });
    expect(isError).toBe(true);
    expect(data.error).toMatch(/not part of suite "Regression"/);
    expect(data.hint).toMatch(/locked/);
  });

  it('tests_get accepts "C500" and rejects cases from other suites', async () => {
    const { call } = await startTestServer();
    expect((await call('tests_get', { test_id: 'C500' })).data.id).toBe(500);
    const other = await call('tests_get', { test_id: 900 });
    expect(other.isError).toBe(true);
    expect(other.data.error).toMatch(/belongs to another suite/);
  });
});

describe('tests_create', () => {
  it('creates a batch with separated steps and the Steps template', async () => {
    const { call, fake } = await startTestServer();
    const { isError, data } = await call('tests_create', {
      cases: [
        {
          section_id: 101,
          title: 'Register with valid data',
          preconditions: 'User is logged out',
          steps: [
            { content: 'Open /register', expected: 'Form is shown' },
            { content: 'Submit valid data', expected: 'Account is created' },
          ],
          priority_id: 2,
          labels: ['smoke'],
          custom_fields: { custom_automation: 1, suite_id: 999 },
        },
        { section_id: 101, title: 'Register with empty form' },
      ],
    });
    expect(isError).toBe(false);
    expect(data.summary).toEqual({ requested: 2, created: 2, failed: 0 });
    expect(data.created[0]).toEqual({
      id: 1000,
      title: 'Register with valid data',
      section: 'User registration',
      url: 'https://example.testrail.io/index.php?/cases/view/1000',
    });

    const posts = fake.calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.endpoint)).toEqual(['add_case/101', 'add_case/101']);
    expect(posts[0].body).toEqual({
      title: 'Register with valid data',
      template_id: 2,
      priority_id: 2,
      labels: ['smoke'],
      custom_preconds: 'User is logged out',
      custom_steps_separated: [
        { content: 'Open /register', expected: 'Form is shown' },
        { content: 'Submit valid data', expected: 'Account is created' },
      ],
      custom_automation: 1,
    });
  });

  it('refuses the whole batch if any section is outside the suite (nothing created)', async () => {
    const { call, fake } = await startTestServer();
    const { isError } = await call('tests_create', {
      cases: [
        { section_id: 101, title: 'ok' },
        { section_id: 300, title: 'other suite' },
      ],
    });
    expect(isError).toBe(true);
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('reports per-case failures without stopping the batch', async () => {
    const { call } = await startTestServer(undefined, {
      add_case: (c) => {
        if (c.body.title === 'bad') throw Object.assign(new Error('Field :custom_automation is a required field.'), { status: 400 });
        return { id: 77, title: c.body.title, suite_id: 10 };
      },
    });
    const { data } = await call('tests_create', {
      cases: [
        { section_id: 101, title: 'bad' },
        { section_id: 101, title: 'good' },
      ],
    });
    expect(data.summary).toEqual({ requested: 2, created: 1, failed: 1 });
    expect(data.failed[0]).toMatchObject({ title: 'bad', error: 'Field :custom_automation is a required field.' });
  });

  it('sends text steps when the project has no separated-steps template', async () => {
    const { call, fake } = await startTestServer(undefined, { get_case_fields: () => [] });
    await call('tests_create', {
      cases: [{ section_id: 101, title: 't', steps: [{ content: 'Do A', expected: 'See A' }, { content: 'Do B' }], expected: 'All good' }],
    });
    const body = fake.calls.find((c) => c.method === 'POST')!.body;
    expect(body).toMatchObject({ template_id: 1, custom_steps: '1. Do A\n2. Do B', custom_expected: '1. See A\nAll good' });
  });
});

describe('sections_* and suites_*', () => {
  it('sections_list returns a nested tree with paths', async () => {
    const { call } = await startTestServer();
    const { data } = await call('sections_list');
    expect(data.sections[0]).toMatchObject({ id: 100, name: 'Auth', path: 'Auth' });
    expect(data.sections[0].children[0]).toMatchObject({ id: 101, path: 'Auth > User registration' });
    const flat = await call('sections_list', { flat: true });
    expect(flat.data.sections.map((s: any) => s.path)).toEqual(['Auth', 'Auth > User registration', 'Checkout']);
  });

  it('sections_create creates a subsection in the configured suite only', async () => {
    const { call, fake } = await startTestServer();
    const { data } = await call('sections_create', { name: 'Social login', parent_id: 100 });
    expect(data.created).toMatchObject({ name: 'Social login', parent_id: 100 });
    expect(fake.calls.at(-1)).toMatchObject({ endpoint: 'add_section/1', body: { suite_id: 10, parent_id: 100 } });

    const bad = await call('sections_create', { name: 'x', parent_id: 300 });
    expect(bad.isError).toBe(true);
  });

  it('suites_list shows the configured suite tree with optional case counts', async () => {
    const { call } = await startTestServer();
    const { data } = await call('suites_list', { include_case_counts: true });
    expect(data.suite).toMatchObject({ id: 10, name: 'Regression', section_count: 3 });
    expect(data.suite.sections[0].children[0].case_count).toBe(2);
  });

  it('suites_search finds sections by name and returns paths', async () => {
    const { call } = await startTestServer();
    const { data } = await call('suites_search', { query: 'registr' });
    expect(data.matches.map((m: any) => m.path)).toEqual(['Auth > User registration']);
  });

  it('suites_get rejects other suites', async () => {
    const { call } = await startTestServer();
    expect((await call('suites_get')).data.id).toBe(10);
    expect((await call('suites_get', { suite_id: 11 })).isError).toBe(true);
  });
});

describe('labels_*', () => {
  it('labels_list and labels_get by id or title', async () => {
    const { call } = await startTestServer();
    expect((await call('labels_list')).data.labels).toEqual([
      { id: 1, title: 'smoke' },
      { id: 2, title: 'regression' },
    ]);
    expect((await call('labels_get', { title: 'Smoke' })).data.id).toBe(1);
    expect((await call('labels_get', { label_id: 1 })).data.title).toBe('smoke');
    expect((await call('labels_get', { label_id: 9 })).isError).toBe(true);
  });

  it('explains when the instance does not support labels', async () => {
    const { call } = await startTestServer(undefined, {
      'get_labels/1': () => {
        throw Object.assign(new Error("Unknown method 'get_labels'"), { status: 400 });
      },
    });
    const { isError, data } = await call('labels_list');
    expect(isError).toBe(true);
    expect(data.error).toMatch(/requires TestRail 10.5/);
  });
});
