import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { TestRailClient } from './client.js';
import type { CaseField, Project, Section, Suite, Template, TestCase } from './types.js';

/** Raised when a call tries to touch anything outside the configured project/suite. */
export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

export interface CaseFormat {
  /** How `steps` are sent to add_case. */
  mode: 'separated' | 'text';
  /** Template used for new cases (undefined = TestRail default). */
  templateId?: number;
  templateName?: string;
  /** System names of case fields that this project marks as required. */
  requiredFields: string[];
}

const isNumeric = (value: string) => /^\d+$/.test(value);

function matchByIdOrName<T extends { id: number; name: string }>(items: T[], wanted: string): T[] {
  if (isNumeric(wanted)) return items.filter((i) => i.id === Number(wanted));
  const lower = wanted.toLowerCase();
  return items.filter((i) => i.name.trim().toLowerCase() === lower);
}

/**
 * The single source of truth for "where am I allowed to work".
 * Resolved once at startup; every tool goes through it.
 */
export class Scope {
  private sections: Section[] | null = null;

  constructor(
    private readonly client: TestRailClient,
    public readonly project: Project,
    public readonly suite: Suite,
    public readonly caseFormat: CaseFormat,
  ) {}

  static async resolve(client: TestRailClient, config: Config): Promise<Scope> {
    const projects = await client.getAll<Project>('get_projects', 'projects');
    const projectMatches = matchByIdOrName(projects, config.project);
    if (projectMatches.length === 0) {
      const names = projects.map((p) => `"${p.name}" (id ${p.id})`).slice(0, 20).join(', ');
      throw new ScopeError(`Project "${config.project}" not found or not accessible. Available: ${names || 'none'}`);
    }
    if (projectMatches.length > 1) {
      const ids = projectMatches.map((p) => p.id).join(', ');
      throw new ScopeError(`Project name "${config.project}" is ambiguous (ids ${ids}). Use the numeric id in --project.`);
    }
    const project = projectMatches[0];

    const suites = await client.get<Suite[]>(`get_suites/${project.id}`);
    const suiteMatches = matchByIdOrName(suites, config.suite);
    if (suiteMatches.length === 0) {
      const names = suites.map((s) => `"${s.name}" (id ${s.id})`).join(', ');
      throw new ScopeError(`Suite "${config.suite}" not found in project "${project.name}". Available: ${names || 'none'}`);
    }
    if (suiteMatches.length > 1) {
      const ids = suiteMatches.map((s) => s.id).join(', ');
      throw new ScopeError(`Suite name "${config.suite}" is ambiguous (ids ${ids}). Use the numeric id in TESTRAIL_SUITE.`);
    }
    const suite = suiteMatches[0];

    const caseFormat = await detectCaseFormat(client, project.id);
    logger.info(
      `Scope locked to project "${project.name}" (${project.id}), suite "${suite.name}" (${suite.id}); steps mode: ${caseFormat.mode}`,
    );
    return new Scope(client, project, suite, caseFormat);
  }

  /** All sections of the configured suite (cached; pass refresh=true to reload). */
  async getSections(refresh = false): Promise<Section[]> {
    if (!this.sections || refresh) {
      this.sections = await this.client.getAll<Section>(`get_sections/${this.project.id}`, 'sections', {
        suite_id: this.suite.id,
      });
    }
    return this.sections;
  }

  rememberSection(section: Section) {
    this.sections?.push(section);
  }

  /** Throws unless the section belongs to the configured suite. Reloads the cache once before failing. */
  async assertSectionInScope(sectionId: number): Promise<Section> {
    let found = (await this.getSections()).find((s) => s.id === sectionId);
    if (!found) found = (await this.getSections(true)).find((s) => s.id === sectionId);
    if (!found) {
      throw new ScopeError(
        `Section ${sectionId} is not part of suite "${this.suite.name}" (${this.suite.id}). ` +
          `Use sections_list to find a valid section_id.`,
      );
    }
    return found;
  }

  assertCaseInScope(testCase: TestCase): void {
    if (testCase.suite_id !== this.suite.id) {
      throw new ScopeError(
        `Test case C${testCase.id} belongs to another suite (${testCase.suite_id}); this server is limited to suite "${this.suite.name}" (${this.suite.id}).`,
      );
    }
  }

  assertSuiteInScope(suiteId: number): void {
    if (suiteId !== this.suite.id) {
      throw new ScopeError(
        `Suite ${suiteId} is outside the configured scope; this server is limited to suite "${this.suite.name}" (${this.suite.id}).`,
      );
    }
  }
}

function appliesToProject(field: CaseField, projectId: number) {
  return field.configs.filter((c) => c.context.is_global || (c.context.project_ids ?? []).includes(projectId));
}

/**
 * Decide how to send steps for new cases:
 *  - if the project has the `custom_steps_separated` field, use it with a template that includes it ("Test Case (Steps)")
 *  - otherwise fall back to plain text `custom_steps` / `custom_expected`.
 * Failures here are non-fatal: we fall back to text mode with the TestRail default template.
 */
export async function detectCaseFormat(client: TestRailClient, projectId: number): Promise<CaseFormat> {
  try {
    const [templates, fields] = await Promise.all([
      client.get<Template[]>(`get_templates/${projectId}`),
      client.get<CaseField[]>('get_case_fields'),
    ]);

    const activeFields = fields.filter((f) => f.is_active && appliesToProject(f, projectId).length > 0);
    const requiredFields = activeFields
      .filter((f) => appliesToProject(f, projectId).some((c) => c.options.is_required))
      .map((f) => f.system_name);

    const stepsField = activeFields.find((f) => f.system_name === 'custom_steps_separated');
    if (stepsField) {
      const allowed = stepsField.template_ids?.length
        ? templates.filter((t) => stepsField.template_ids!.includes(t.id))
        : templates;
      const template = allowed.find((t) => /step/i.test(t.name)) ?? allowed[0];
      if (template) {
        return { mode: 'separated', templateId: template.id, templateName: template.name, requiredFields };
      }
    }
    const textTemplate = templates.find((t) => /text/i.test(t.name)) ?? templates.find((t) => t.is_default);
    return { mode: 'text', templateId: textTemplate?.id, templateName: textTemplate?.name, requiredFields };
  } catch (err) {
    logger.warn(`Could not read templates/case fields (${(err as Error).message}); using text steps and default template`);
    return { mode: 'text', requiredFields: [] };
  }
}
