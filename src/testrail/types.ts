// Only the fields we actually use. TestRail returns more; extra keys are passed through untouched.

export interface Project {
  id: number;
  name: string;
  suite_mode: number; // 1 = single suite, 2 = single suite + baselines, 3 = multiple suites
  is_completed?: boolean;
  url?: string;
}

export interface Suite {
  id: number;
  name: string;
  description?: string | null;
  project_id: number;
  is_master?: boolean;
  is_baseline?: boolean;
  is_completed?: boolean;
  url?: string;
}

export interface Section {
  id: number;
  name: string;
  description?: string | null;
  suite_id: number;
  parent_id: number | null;
  depth: number;
  display_order: number;
}

export interface Label {
  id: number;
  title: string;
  project_id?: number;
}

export interface TestCase {
  id: number;
  title: string;
  section_id: number;
  suite_id: number;
  template_id?: number;
  type_id?: number;
  priority_id?: number;
  milestone_id?: number | null;
  refs?: string | null;
  estimate?: string | null;
  labels?: Label[];
  created_on?: number;
  updated_on?: number;
  [key: string]: unknown;
}

export interface Template {
  id: number;
  name: string;
  is_default: boolean;
}

export interface CaseField {
  id: number;
  name: string;
  system_name: string;
  label: string;
  is_active: boolean;
  type_id: number;
  template_ids?: number[];
  configs: {
    context: { is_global: boolean; project_ids: number[] | null };
    options: { is_required?: boolean; [key: string]: unknown };
  }[];
}
