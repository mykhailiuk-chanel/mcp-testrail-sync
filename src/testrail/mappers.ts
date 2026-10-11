import type { CaseFormat } from './scope.js';
import type { Section, TestCase } from './types.js';

const isoDate = (unix?: number) => (unix ? new Date(unix * 1000).toISOString() : undefined);

/** Short row for list views: keeps the AI context small. Use tests_get for the full case. */
export function compactCase(c: TestCase) {
  return {
    id: c.id,
    title: c.title,
    section_id: c.section_id,
    template_id: c.template_id,
    type_id: c.type_id,
    priority_id: c.priority_id,
    refs: c.refs || undefined,
    labels: c.labels?.length ? c.labels.map((l) => l.title) : undefined,
    updated_on: isoDate(c.updated_on),
  };
}

export interface SectionNode {
  id: number;
  name: string;
  path: string;
  description?: string;
  case_count?: number;
  children: SectionNode[];
}

/** Turns TestRail's flat section list (parent_id + display_order) into a nested tree with "A > B > C" paths. */
export function buildSectionTree(sections: Section[], caseCounts?: Map<number, number>): SectionNode[] {
  const nodes = new Map<number, SectionNode>();
  const sorted = [...sections].sort((a, b) => a.display_order - b.display_order);
  for (const s of sorted) {
    nodes.set(s.id, {
      id: s.id,
      name: s.name,
      path: s.name,
      description: s.description || undefined,
      case_count: caseCounts ? (caseCounts.get(s.id) ?? 0) : undefined,
      children: [],
    });
  }
  const roots: SectionNode[] = [];
  for (const s of sorted) {
    const node = nodes.get(s.id)!;
    const parent = s.parent_id ? nodes.get(s.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setPaths = (list: SectionNode[], prefix: string) => {
    for (const n of list) {
      n.path = prefix ? `${prefix} > ${n.name}` : n.name;
      setPaths(n.children, n.path);
    }
  };
  setPaths(roots, '');
  return roots;
}

export function flattenTree(nodes: SectionNode[]): Omit<SectionNode, 'children'>[] {
  return nodes.flatMap(({ children, ...rest }) => [rest, ...flattenTree(children)]);
}

export interface NewCaseInput {
  section_id: number;
  title: string;
  preconditions?: string;
  steps?: { content: string; expected?: string }[];
  expected?: string;
  type_id?: number;
  priority_id?: number;
  refs?: string;
  estimate?: string;
  labels?: (string | number)[];
  custom_fields?: Record<string, unknown>;
}

/** Keys that must never be overridden through custom_fields. */
const PROTECTED_KEYS = new Set(['section_id', 'suite_id', 'project_id', 'id']);

/** Maps our AI-friendly case shape onto the TestRail add_case body, honouring the project's steps template. */
export function toAddCaseBody(input: NewCaseInput, format: CaseFormat): Record<string, unknown> {
  const body: Record<string, unknown> = { title: input.title };
  if (format.templateId !== undefined) body.template_id = format.templateId;
  if (input.type_id !== undefined) body.type_id = input.type_id;
  if (input.priority_id !== undefined) body.priority_id = input.priority_id;
  if (input.refs) body.refs = input.refs;
  if (input.estimate) body.estimate = input.estimate;
  if (input.labels?.length) body.labels = input.labels;
  if (input.preconditions) body.custom_preconds = input.preconditions;

  if (input.steps?.length) {
    if (format.mode === 'separated') {
      body.custom_steps_separated = input.steps.map((s) => ({ content: s.content, expected: s.expected ?? '' }));
    } else {
      body.custom_steps = input.steps.map((s, i) => `${i + 1}. ${s.content}`).join('\n');
      const expected = input.steps
        .map((s, i) => (s.expected ? `${i + 1}. ${s.expected}` : ''))
        .filter(Boolean)
        .join('\n');
      body.custom_expected = [expected, input.expected].filter(Boolean).join('\n') || undefined;
    }
  } else if (input.expected) {
    body.custom_expected = input.expected;
  }

  for (const [key, value] of Object.entries(input.custom_fields ?? {})) {
    if (!PROTECTED_KEYS.has(key)) body[key] = value;
  }
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  return body;
}
