import type { Config } from './config.js';
import type { TestRailClient } from './testrail/client.js';
import type { Scope } from './testrail/scope.js';

/** Everything a tool needs: config (for display), the API client and the locked scope. */
export interface AppContext {
  config: Config;
  client: TestRailClient;
  scope: Scope;
  version: string;
}
