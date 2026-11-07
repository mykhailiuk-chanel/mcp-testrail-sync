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
        "milestones_list",
        "runs_get",
        "runs_list",
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
    expect(data.tools).toHaveLength(15);
    expect(data.statuses).toContainEqual({ id: 5, label: 'Failed' });
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


describe('runs and milestones (progress reports)', () => {
  it('runs_list returns standalone + plan runs of the suite with totals; other suites are excluded', async () => {
    const { call, fake } = await startTestServer();
    const { data } = await call('runs_list', { milestone_id: 50 });
    expect(fake.calls.find((c) => c.endpoint.startsWith('get_runs'))!.query).toMatchObject({ suite_id: '10', milestone_id: '50' });
    expect(data.runs.map((r: any) => r.id).sort()).toEqual([700, 702]);
    expect(data.runs.find((r: any) => r.id === 702).plan_name).toBe('Release plan');
    // run 700: 10 tests, plan run 702: 5 tests (incl. 1 custom "Skipped")
    expect(data.totals).toMatchObject({ total: 15, passed: 8, failed: 2, blocked: 1, untested: 3, custom: { Skipped: 1 } });
    expect(data.runs.find((r: any) => r.id === 700).summary).toMatchObject({ executed: 9, executed_pct: 90, pass_rate_pct: 60 });
  });

  it('runs_list date window: open runs stay in, runs completed before "from" drop out', async () => {
    const { call, fake } = await startTestServer();
    // window Nov 2023: run 700 (open, created 2023-11-14) matches; run 704 (completed Jul 2023) does not
    const nov = await call('runs_list', { from: '2023-11-01', to: '2023-11-30' });
    expect(nov.data.runs.map((r: any) => r.id)).toContain(700);
    expect(nov.data.runs.map((r: any) => r.id)).not.toContain(704);
    // bare "to" date covers the whole day
    expect(fake.calls.find((c) => c.endpoint.startsWith('get_runs'))!.query.created_before).toBe(String(Math.floor(Date.parse('2023-11-30') / 1000) + 86399));
    // window July 2023: only the old completed run
    const jul = await call('runs_list', { from: '2023-07-01', to: '2023-07-31' });
    expect(jul.data.runs.map((r: any) => r.id)).toEqual([704]);
  });

  it('runs_list state filters completed vs open runs', async () => {
    const { call } = await startTestServer();
    expect((await call('runs_list', { state: 'completed' })).data.runs.map((r: any) => r.id)).toEqual([704]);
    const open = (await call('runs_list', { state: 'open' })).data.runs.map((r: any) => r.id).sort();
    expect(open).toEqual([700, 702]);
  });

  it('runs_list group_by milestone gives a progress table; include_runs=false returns numbers only', async () => {
    const { call } = await startTestServer();
    const { data } = await call('runs_list', { group_by: 'milestone', include_runs: false });
    expect(data.runs).toBeUndefined();
    const m50 = data.by_milestone.find((g: any) => g.milestone_id === 50);
    expect(m50).toMatchObject({ milestone: 'Release 1.0', runs_count: 2 });
    expect(m50.summary.total).toBe(15);
    expect(data.by_milestone.find((g: any) => g.milestone_id === 51).summary.failed).toBe(1);
  });

  it('runs_list search_text matches run or plan name', async () => {
    const { call } = await startTestServer();
    expect((await call('runs_list', { search_text: 'sprint' })).data.runs.map((r: any) => r.id)).toEqual([700]);
    expect((await call('runs_list', { search_text: 'release plan' })).data.runs.map((r: any) => r.id)).toEqual([702]);
  });

  it('runs_get lists failed/blocked tests with the NEWEST comment by default', async () => {
    const { call, fake } = await startTestServer();
    const { data } = await call('runs_get', { run_id: 'R700' });
    expect(fake.calls.find((c) => c.endpoint.startsWith('get_tests'))!.query.status_id).toBe('5,2,4');
    expect(data.run.summary.failed).toBe(2);
    expect(data.tests.map((t: any) => t.case_id)).toEqual([500, 502]);
    expect(data.tests[0]).toMatchObject({ status: 'Failed', last_comment: 'newest failure', defects: 'BUG-1' });
  });

  it('runs_get accepts status names, rejects unknown ones and runs of another suite', async () => {
    const { call, fake } = await startTestServer();
    await call('runs_get', { run_id: 700, status: ['Passed'], include_comments: false });
    expect(fake.calls.at(-1)!.query.status_id).toBe('1');
    expect((await call('runs_get', { run_id: 700, status: ['nope'] })).data.error).toMatch(/Unknown status/);
    const other = await call('runs_get', { run_id: 701 });
    expect(other.isError).toBe(true);
    expect(other.data.error).toMatch(/another suite/);
  });

  it('milestones_list filters by state, window and name', async () => {
    const { call } = await startTestServer();
    expect((await call('milestones_list')).data.milestones.map((m: any) => m.id)).toEqual([51, 50]);
    expect((await call('milestones_list', { state: 'open' })).data.milestones.map((m: any) => m.id)).toEqual([50]);
    expect((await call('milestones_list', { search_text: '0.9' })).data.milestones.map((m: any) => m.id)).toEqual([51]);
    // 51 is due 2023-11-14, 50 is due 2027 -> window Nov 2023 keeps only 51 (50 has no start date, so it is kept too)
    const win = await call('milestones_list', { from: '2028-01-01' });
    expect(win.data.milestones).toHaveLength(0);
  });

  it('runs_list pages over run rows while totals still cover every matched run', async () => {
    const { call } = await startTestServer();
    const p1 = (await call('runs_list', { limit: 2 })).data;
    expect(p1).toMatchObject({ matched: 3, count: 2, offset: 0, limit: 2, has_more: true, next_offset: 2 });
    expect(p1.totals.total).toBe(25); // 10 + 5 + 10, not just the 2 rows on the page
    const p2 = (await call('runs_list', { limit: 2, offset: p1.next_offset })).data;
    expect(p2).toMatchObject({ count: 1, has_more: false });
    expect(p2.next_offset).toBeUndefined();
    expect([...p1.runs, ...p2.runs].map((r: any) => r.id).sort()).toEqual([700, 702, 704]);
  });

  it('runs_list reports what it scanned', async () => {
    const { data } = await (await startTestServer()).call('runs_list', { include_runs: false });
    expect(data.scan).toEqual({ standalone_runs: 2, plans_found: 1, plans_opened: 1 });
    expect(data.has_more).toBeUndefined();
  });

  it('runs_list warns when plans were not all opened', async () => {
    const { data } = await (await startTestServer()).call('runs_list', { max_plans: 1, milestone_id: 50 });
    expect(data.warnings).toBeUndefined(); // 1 plan, 1 opened: complete
    const fake = await startTestServer(undefined, {
      'get_plans/1': () => ({ _links: { next: null }, plans: [{ id: 800, name: 'a', project_id: 1 }, { id: 800, name: 'b', project_id: 1 }] }),
    });
    const res = await fake.call('runs_list', { max_plans: 1 });
    expect(res.data.warnings[0]).toMatch(/Only 1 of 2 test plans/);
  });

  it('runs_list warns when TestRail has more rows than the safety limit', async () => {
    // every page claims there is a next page -> the client hits its page cap
    const { call } = await startTestServer(undefined, {
      'get_runs/1': () => ({ _links: { next: 'more' }, runs: [{ id: 700, name: 'x', suite_id: 10, project_id: 1 }] }),
    });
    const { data } = await call('runs_list', { include_runs: false });
    expect(data.warnings.join(' ')).toMatch(/more than 10,000/);
  });

  it('milestones_list is paged', async () => {
    const { call } = await startTestServer();
    const p1 = (await call('milestones_list', { limit: 1 })).data;
    expect(p1).toMatchObject({ matched: 2, count: 1, limit: 1, has_more: true, next_offset: 1 });
    expect(p1.milestones[0].id).toBe(51);
    const p2 = (await call('milestones_list', { limit: 1, offset: 1 })).data;
    expect(p2.milestones[0].id).toBe(50);
    expect(p2.has_more).toBe(false);
  });

  it('runs_get is paged and echoes limit', async () => {
    const { data } = await (await startTestServer()).call('runs_get', { run_id: 700, limit: 1 });
    expect(data).toMatchObject({ count: 2, offset: 0, limit: 1 });
  });

  it('report tools never write', async () => {
    const { call, fake } = await startTestServer();
    await call('runs_list', { group_by: 'milestone' });
    await call('runs_get', { run_id: 700 });
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
