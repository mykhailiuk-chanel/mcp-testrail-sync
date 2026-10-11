import { describe, expect, it } from 'vitest';
import { ApiError, TestRailClient } from '../src/testrail/client.js';

const opts = { url: 'https://demo.testrail.io/', username: 'qa@example.com', apiKey: 'key' };

describe('TestRailClient', () => {
  it('builds index.php?/api/v2 URLs with &-joined params and skips empty values', () => {
    const client = new TestRailClient(opts);
    expect(client.buildUrl('get_cases/1', { suite_id: 10, filter: 'log in', section_id: undefined })).toBe(
      'https://demo.testrail.io/index.php?/api/v2/get_cases/1&suite_id=10&filter=log%20in',
    );
  });

  it('sends basic auth with username:apiKey', async () => {
    let auth = '';
    const client = new TestRailClient({
      ...opts,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        auth = (init.headers as Record<string, string>).Authorization;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await client.get('get_project/1');
    expect(auth).toBe('Basic ' + Buffer.from('qa@example.com:key').toString('base64'));
  });

  it('follows _links.next until the last page', async () => {
    const offsets: string[] = [];
    const client = new TestRailClient({
      ...opts,
      fetchImpl: (async (url: string) => {
        const offset = Number(/offset=(\d+)/.exec(url)![1]);
        offsets.push(String(offset));
        const rows = offset === 0 ? Array.from({ length: 250 }, (_, i) => ({ id: i })) : [{ id: 250 }];
        return new Response(JSON.stringify({ _links: { next: offset === 0 ? 'more' : null }, cases: rows }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const rows = await client.getAll('get_cases/1', 'cases');
    expect(rows).toHaveLength(251);
    expect(offsets).toEqual(['0', '250']);
  });

  it('accepts legacy bare-array responses', async () => {
    const client = new TestRailClient({
      ...opts,
      fetchImpl: (async () => new Response('[{"id":1}]', { status: 200 })) as unknown as typeof fetch,
    });
    expect(await client.getAll('get_sections/1', 'sections')).toEqual([{ id: 1 }]);
  });

  it('turns TestRail errors into ApiError with status and message', async () => {
    const client = new TestRailClient({
      ...opts,
      fetchImpl: (async () => new Response('{"error":"Field :title is required"}', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(client.addCase(1, {})).rejects.toMatchObject({ name: 'ApiError', status: 400, message: 'Field :title is required' });
  });

  it('has no update or delete methods (v1 safety)', () => {
    const methods = Object.getOwnPropertyNames(TestRailClient.prototype);
    expect(methods.filter((m) => /update|delete|remove|move/i.test(m))).toEqual([]);
    expect(ApiError).toBeDefined();
  });
});
