import { logger } from '../logger.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  url: string;
  username: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** Paginated TestRail responses (6.7+) look like `{offset, limit, size, _links: {next, prev}, <key>: [...]}`. */
interface Paginated {
  _links?: { next: string | null; prev: string | null };
  [key: string]: unknown;
}

const PAGE_LIMIT = 250;
const MAX_PAGES = 40; // safety stop: 10,000 rows

/**
 * Thin TestRail API v2 client.
 *
 * SAFETY: by design this client only knows how to GET and to call `add_case` / `add_section`.
 * There is no update or delete method, so no tool can change or remove existing records.
 */
export class TestRailClient {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = `${opts.url.replace(/\/+$/, '')}/index.php?/api/v2/`;
    this.auth = 'Basic ' + Buffer.from(`${opts.username}:${opts.apiKey}`).toString('base64');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** TestRail uses `index.php?/api/v2/<endpoint>&param=value`, so params are joined with `&`. */
  buildUrl(endpoint: string, query: Query = {}): string {
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('');
    return this.baseUrl + endpoint + params;
  }

  async get<T = unknown>(endpoint: string, query: Query = {}): Promise<T> {
    return this.request<T>('GET', endpoint, query);
  }

  /** Unpaginated list endpoint (suites, templates, case fields). Accepts a bare array or a wrapper object like `{suites: [...]}`. */
  async getList<T = unknown>(endpoint: string, key: string): Promise<T[]> {
    const res = await this.get<Paginated | T[]>(endpoint);
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.[key])) return res[key] as T[];
    const arrays = Object.values(res ?? {}).filter(Array.isArray);
    return (arrays.length === 1 ? arrays[0] : []) as T[];
  }

  /** Follows `_links.next` and returns all rows of `key` (e.g. "cases", "sections"). Also accepts legacy plain arrays. */
  async getAll<T = unknown>(endpoint: string, key: string, query: Query = {}): Promise<T[]> {
    const rows: T[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.get<Paginated | T[]>(endpoint, { ...query, limit: PAGE_LIMIT, offset });
      if (Array.isArray(res)) return res; // older TestRail versions return a bare array
      const batch = (res[key] as T[] | undefined) ?? [];
      rows.push(...batch);
      if (!res._links?.next || batch.length === 0) return rows;
      offset += batch.length;
    }
    logger.warn(`getAll(${endpoint}) stopped after ${MAX_PAGES} pages`);
    return rows;
  }

  addCase<T = unknown>(sectionId: number, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', `add_case/${sectionId}`, {}, body);
  }

  addSection<T = unknown>(projectId: number, body: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', `add_section/${projectId}`, {}, body);
  }

  private async request<T>(method: 'GET' | 'POST', endpoint: string, query: Query, body?: unknown): Promise<T> {
    const url = this.buildUrl(endpoint, query);
    logger.debug(`${method} ${url}`);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: this.auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(`Cannot reach TestRail: ${(err as Error).message}`, 0, endpoint);
    }

    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 500) };
      }
    }

    if (!res.ok) {
      const apiMsg = (data as { error?: string } | undefined)?.error;
      throw new ApiError(apiMsg || `TestRail returned HTTP ${res.status}`, res.status, endpoint, data);
    }
    return data as T;
  }
}
