import { z } from 'zod';

/**
 * All configuration comes from the MCP client config: CLI args (`--project`, `--suite`)
 * and env vars (`TESTRAIL_*`). No .env files. A CLI arg wins over its env var.
 */
export interface Config {
  url: string;
  username: string;
  apiKey: string;
  /** Project name or numeric id. */
  project: string;
  /** Suite name or numeric id. */
  suite: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const schema = z.object({
  url: z
    .string({ error: 'TESTRAIL_URL is required (e.g. https://your-instance.testrail.io)' })
    .min(1, 'TESTRAIL_URL is required (e.g. https://your-instance.testrail.io)')
    .url('TESTRAIL_URL must be a full URL, e.g. https://your-instance.testrail.io'),
  username: z
    .string({ error: 'TESTRAIL_USERNAME is required (your TestRail login email)' })
    .min(1, 'TESTRAIL_USERNAME is required (your TestRail login email)'),
  apiKey: z
    .string({ error: 'TESTRAIL_API_KEY is required (TestRail > My Settings > API Keys)' })
    .min(1, 'TESTRAIL_API_KEY is required (TestRail > My Settings > API Keys)'),
  project: z
    .string({ error: 'Project is required: pass "--project <name|id>" in the MCP command args' })
    .min(1, 'Project is required: pass "--project <name|id>" in the MCP command args'),
  suite: z
    .string({ error: 'Suite is required: set TESTRAIL_SUITE (name or id) or pass "--suite <name|id>"' })
    .min(1, 'Suite is required: set TESTRAIL_SUITE (name or id) or pass "--suite <name|id>"'),
});

/** Minimal argv parser: supports `--flag value` and `--flag=value`. */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[arg.slice(2)] = argv[++i];
    } else {
      out[arg.slice(2)] = 'true';
    }
  }
  return out;
}

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv = process.env): Config {
  const args = parseArgs(argv);
  const pick = (...values: (string | undefined)[]) => values.find((v) => v !== undefined && v.trim() !== '')?.trim();

  const result = schema.safeParse({
    url: pick(args.url, env.TESTRAIL_URL)?.replace(/\/+$/, ''),
    username: pick(args.username, env.TESTRAIL_USERNAME),
    apiKey: pick(env.TESTRAIL_API_KEY),
    project: pick(args.project, env.TESTRAIL_PROJECT),
    suite: pick(args.suite, env.TESTRAIL_SUITE),
  });

  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new ConfigurationError(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}
