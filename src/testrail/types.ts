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

export interface Status {
  id: number;
  name: string;
  label: string;
  is_system?: boolean;
  is_untested?: boolean;
  is_final?: boolean;
}

/** A run (also used for runs nested in plan entries). Count fields: passed_count ... custom_status7_count. */
export interface Run {
  id: number;
  name: string;
  description?: string | null;
  project_id?: number;
  suite_id: number;
  milestone_id?: number | null;
  plan_id?: number | null;
  config?: string | null;
  assignedto_id?: number | null;
  is_completed?: boolean;
  created_on?: number;
  created_by?: number;
  completed_on?: number | null;
  refs?: string | null;
  url?: string;
  [key: string]: unknown;
}

export interface PlanEntry {
  id: string;
  name: string;
  suite_id: number;
  runs?: Run[];
}

export interface Plan {
  id: number;
  name: string;
  description?: string | null;
  project_id?: number;
  milestone_id?: number | null;
  is_completed?: boolean;
  created_on?: number;
  created_by?: number;
  completed_on?: number | null;
  url?: string;
  entries?: PlanEntry[];
  [key: string]: unknown;
}

export interface Milestone {
  id: number;
  name: string;
  description?: string | null;
  project_id?: number;
  parent_id?: number | null;
  refs?: string | null;
  start_on?: number | null;
  started_on?: number | null;
  due_on?: number | null;
  completed_on?: number | null;
  is_started?: boolean;
  is_completed?: boolean;
  url?: string;
  milestones?: Milestone[];
}

/** A "test" in TestRail = a case inside a run. */
export interface RunTest {
  id: number;
  case_id: number;
  run_id: number;
  status_id: number;
  title: string;
  assignedto_id?: number | null;
  priority_id?: number;
  type_id?: number;
  estimate?: string | null;
  refs?: string | null;
  [key: string]: unknown;
}

export interface TestResult {
  id: number;
  test_id: number;
  status_id: number | null;
  comment?: string | null;
  created_on?: number;
  created_by?: number;
  assignedto_id?: number | null;
  elapsed?: string | null;
  defects?: string | null;
  version?: string | null;
  [key: string]: unknown;
}
