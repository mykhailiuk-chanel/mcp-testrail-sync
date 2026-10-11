import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, parseArgs } from '../src/config.js';

const env = {
  TESTRAIL_URL: 'https://demo.testrail.io/',
  TESTRAIL_USERNAME: 'qa@example.com',
  TESTRAIL_API_KEY: 'key',
  TESTRAIL_SUITE: 'test1',
};

describe('parseArgs', () => {
  it('supports "--flag value" and "--flag=value"', () => {
    expect(parseArgs(['--project', 'demo-name', '--suite=Smoke'])).toEqual({ project: 'demo-name', suite: 'Smoke' });
  });
});

describe('loadConfig', () => {
  it('reads --project from args and the rest from env, trimming the trailing slash', () => {
    expect(loadConfig(['--project', 'demo-name'], env)).toEqual({
      url: 'https://demo.testrail.io',
      username: 'qa@example.com',
      apiKey: 'key',
      project: 'demo-name',
      suite: 'test1',
    });
  });

  it('lets --suite override TESTRAIL_SUITE', () => {
    expect(loadConfig(['--project', 'p', '--suite', 'Smoke'], env).suite).toBe('Smoke');
  });

  it('lists every missing value in one clear error', () => {
    try {
      loadConfig([], {});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const msg = (err as Error).message;
      expect(msg).toContain('TESTRAIL_URL is required');
      expect(msg).toContain('TESTRAIL_USERNAME is required');
      expect(msg).toContain('TESTRAIL_API_KEY is required');
      expect(msg).toContain('--project');
      expect(msg).toContain('TESTRAIL_SUITE');
    }
  });

  it('rejects a URL without a scheme', () => {
    expect(() => loadConfig(['--project', 'p'], { ...env, TESTRAIL_URL: 'demo.testrail.io' })).toThrow(/full URL/);
  });
});
