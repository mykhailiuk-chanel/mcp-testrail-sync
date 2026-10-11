import { describe, expect, it } from 'vitest';
import { TestRailClient } from '../src/testrail/client.js';
import { Scope, ScopeError } from '../src/testrail/scope.js';
import { createFakeTestRail, testConfig } from './fake-testrail.js';

const resolve = (project: string, suite: string) => {
  const fake = createFakeTestRail();
  const client = new TestRailClient({ ...testConfig, fetchImpl: fake.fetchImpl });
  return Scope.resolve(client, { ...testConfig, project, suite });
};

describe('Scope.resolve', () => {
  it('resolves project and suite by name (case-insensitive)', async () => {
    const scope = await resolve('demo', 'regression');
    expect(scope.project.id).toBe(1);
    expect(scope.suite.id).toBe(10);
  });

  it('resolves project and suite by numeric id', async () => {
    const scope = await resolve('1', '11');
    expect(scope.suite.name).toBe('Smoke');
  });

  it('fails clearly for an unknown project and lists what is available', async () => {
    await expect(resolve('Nope', 'Regression')).rejects.toThrow(/Project "Nope" not found.*"Demo" \(id 1\)/);
  });

  it('fails clearly for an unknown suite', async () => {
    await expect(resolve('Demo', 'Nope')).rejects.toThrow(/Suite "Nope" not found in project "Demo"/);
  });

  it('detects the Steps template and project-required fields', async () => {
    const scope = await resolve('Demo', 'Regression');
    expect(scope.caseFormat).toEqual({
      mode: 'separated',
      templateId: 2,
      templateName: 'Test Case (Steps)',
      requiredFields: ['custom_automation'],
    });
  });

  it('falls back to text steps when the project has no separated-steps field', async () => {
    const fake = createFakeTestRail({ get_case_fields: () => [] });
    const client = new TestRailClient({ ...testConfig, fetchImpl: fake.fetchImpl });
    const scope = await Scope.resolve(client, testConfig);
    expect(scope.caseFormat.mode).toBe('text');
    expect(scope.caseFormat.templateName).toBe('Test Case (Text)');
  });
});

describe('Scope guards', () => {
  it('accepts sections of the configured suite and rejects others', async () => {
    const scope = await resolve('Demo', 'Regression');
    await expect(scope.assertSectionInScope(101)).resolves.toMatchObject({ name: 'User registration' });
    await expect(scope.assertSectionInScope(300)).rejects.toBeInstanceOf(ScopeError);
  });

  it('rejects cases and suites from other suites', async () => {
    const scope = await resolve('Demo', 'Regression');
    expect(() => scope.assertCaseInScope({ id: 1, title: 'x', section_id: 300, suite_id: 11 })).toThrow(ScopeError);
    expect(() => scope.assertSuiteInScope(11)).toThrow(ScopeError);
    expect(() => scope.assertSuiteInScope(10)).not.toThrow();
  });
});
