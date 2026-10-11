# How MCP works, explained with this repo

A walkthrough for someone who has never written an MCP server. Read it top to bottom once (about 15 minutes). After that you should be able to add your own tool.

---

## 1. The 30-second version

**MCP (Model Context Protocol)** is a standard way for an AI app to call your code.

```
 You ──prompt──▶ AI client (Claude Code, Copilot, Codex, OpenCode)
                      │  starts your server as a child process
                      ▼
               MCP server (this repo, `node index.js`)
                      │  HTTPS + API key
                      ▼
                  TestRail REST API
```

- The **client** is the AI app. It starts your server and shows the model what tools exist.
- The **server** is this repo. It declares **tools** (name + description + input schema) and runs them when asked.
- The **model** decides *which* tool to call and *with what arguments*, based only on the tool names, descriptions and schemas. **Your descriptions are your UI.**

MCP servers can also expose *resources* (readable files/data) and *prompts* (templates). v1 uses **tools only**, which is what most servers do.

## 2. Transport: why "stdio" and why stdout is sacred

The client runs `node index.js --project demo-name` and talks to it over **stdin/stdout**, using JSON-RPC messages, one per line.

That means **anything you `console.log` to stdout corrupts the protocol**, and the client disconnects. So this repo logs only to **stderr** ([src/logger.ts](../src/logger.ts)). Clients show stderr in their MCP logs, which is where you look when something breaks.

## 3. The conversation between client and server

```
client → initialize            server → name, version, capabilities, instructions
client → tools/list            server → [{name, description, inputSchema, annotations}, ...]
   ... user types a prompt; the model picks a tool ...
client → tools/call tests_search {query: "register"}
server → {content: [{type: "text", text: "{...json...}"}]}
```

You never write this JSON-RPC by hand. The SDK (`@modelcontextprotocol/sdk`) does it for you. You only:
1. create an `McpServer`,
2. `registerTool(...)` for each tool,
3. `connect()` it to a `StdioServerTransport`.

That is exactly what [src/server.ts](../src/server.ts) and [src/cli.ts](../src/cli.ts) do.

## 4. Startup, step by step

[src/cli.ts](../src/cli.ts) `main()`:

1. `loadConfig()` ([src/config.ts](../src/config.ts)) reads `--project` and `TESTRAIL_*`, and validates them with **zod**. If anything is missing it prints *all* problems and exits. Fail fast with a clear message: new users only see this message in the client log, so make it count.
2. `new TestRailClient()` ([src/testrail/client.ts](../src/testrail/client.ts)) is a ~100-line `fetch` wrapper:
   - **Auth:** basic auth `username:apiKey`.
   - **URLs:** TestRail's odd `index.php?/api/v2/<endpoint>&param=value` scheme.
   - **Paging:** `getAll()` follows `_links.next`.
   - **No update or delete methods.** That's the first safety layer.
3. `Scope.resolve()` ([src/testrail/scope.ts](../src/testrail/scope.ts)):
   - turns the project/suite **names or ids** into real TestRail objects;
   - detects how the project stores steps (the "Steps" template or plain text) and which fields are required.

   This is the **scope lock**.
4. `createServer()` registers all tools, then `server.connect(new StdioServerTransport())`.

## 5. Anatomy of a tool

From [src/tools/tests.ts](../src/tools/tests.ts), slightly shortened:

```ts
server.registerTool(
  'tests_search',                                   // 1. name: <entity>_<action>
  {
    title: 'Search test cases',
    description: 'Search test cases in the configured suite by title text. ...',  // 2. what the model reads
    inputSchema: {                                  // 3. zod shape, turned into JSON Schema for the model
      query: z.string().min(1).describe('Text to search for in case titles.'),
      limit: z.number().int().min(1).max(250).optional(),
    },
    annotations: { readOnlyHint: true },            // 4. hint to clients: safe, no side effects
  },
  safe(({ query, ...rest }) => listTests(ctx, { ...rest, search_text: query })),   // 5. handler
);
```

1. **Name.** Short, consistent `entity_action`. The model sees all names side by side.
2. **Description.** Say what the tool does, *when to use it*, and what comes back. Mention the next step: "use tests_get for full steps".
3. **Input schema.** zod validates arguments *before* your handler runs. `.describe()` text is shown to the model. Good descriptions mean fewer wrong calls.
4. **Annotations.** `readOnlyHint` / `destructiveHint` let clients decide whether to ask the user for confirmation.
5. **Handler.** Returns `{content: [{type:'text', text: JSON}]}`.
   - `safe()` ([src/tools/respond.ts](../src/tools/respond.ts)) does the wrapping.
   - It also turns thrown errors into `isError: true` results with a **hint**, so the model can recover ("check required fields") instead of the call crashing.

**Pattern: search delegates to list.** `tests_search` is just `tests_list` with `search_text`. Both call the same `listTests()` function. One code path means fewer bugs. (This pattern comes from the testomat.io MCP.)

## 6. The scope lock (the important part)

There are three layers, so the team can't damage other projects:

| Layer | Where | What it prevents |
|---|---|---|
| Client has no update/delete methods | `testrail/client.ts` | Changing or removing anything, ever |
| Every read sends `suite_id = configured suite` | `tools/*.ts` | Seeing other suites |
| Every write/ID is checked against the suite | `Scope.assertSectionInScope`, `assertCaseInScope`, `assertSuiteInScope` | Creating cases/sections elsewhere, reading foreign cases by id |

`tests_create` validates **all** target sections *before* creating anything, so a bad id never leaves a half-created batch.

## 7. How a prompt becomes tool calls

Prompt: *"Use mcp-testrail-sync to create test cases in section "User registration" from test_registration.md"*

What the model typically does:

1. Reads `test_registration.md` (with its own file tools, not ours).
2. `suites_search {query: "User registration"}` → `[{id: 101, path: "Auth > User registration"}]`
3. `tests_search {query: "Register", section_id: 101}`, to check for duplicates.
4. `tests_create {cases: [{section_id: 101, title: "...", steps: [...]}, ...]}` → created ids + links.

The server's **instructions** ([src/server.ts](../src/server.ts) `SERVER_INSTRUCTIONS`) describe this exact flow. The client gives that text to the model at startup.

## 8. Testing an MCP server

- **Unit + tool tests** ([test/](../test)): `test/fake-testrail.ts` is a tiny in-memory TestRail behind a fake `fetch`.
  - `startTestServer()` connects a real MCP `Client` to our server through `InMemoryTransport`.
  - So the tests call tools exactly like Claude would: `call('tests_create', {...})`.
- **Tool list snapshot** (`test/tools.test.ts`): fails if a tool is added or removed by accident, or if any tool other than the two creates stops being read-only.
- **MCP Inspector**: `npm run inspect` opens a web UI where you can call each tool by hand. Great against a sandbox TestRail suite.

## 9. Recipe: adding a tool (example `tests_update` for v2)

1. **Client:** add the API method in `testrail/client.ts`, e.g. `updateCase(id, body)` → `POST update_case/{id}`.
   This deliberately breaks the "no update/delete" test in `test/client.test.ts`. Update that test on purpose.
2. **Scope:** fetch the case first and call `ctx.scope.assertCaseInScope(case)` before updating.
3. **Tool:** register it in `tools/tests.ts`:
   - give it a clear description;
   - use a zod schema with `.describe()` on every field;
   - set `annotations: { readOnlyHint: false, destructiveHint: true }`.
4. **Tests:** add a route to `test/fake-testrail.ts`, write tool tests, and update the inline snapshot (`npx vitest -u`).
5. **Docs:** add the tool to the README table and to `SERVER_INSTRUCTIONS` if it changes the flow.

## 10. Glossary

| Term | Meaning |
|---|---|
| Host / client | The AI app (Claude Code, VS Code, ...) that runs and talks to MCP servers |
| Server | Your program that exposes tools |
| Tool | A function the model can call: name + description + input schema + handler |
| Transport | How messages travel: **stdio** (local child process) or HTTP (remote) |
| JSON-RPC | The message format MCP uses under the hood |
| Annotations | Hints about a tool's behaviour (read-only, destructive, idempotent) |
| Instructions | Server-level text the client shows the model (usage guidance) |
| Scope lock | This repo's rule: one project + one suite, enforced in code |

## Further reading

- MCP spec and concepts: https://modelcontextprotocol.io
- TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- TestRail API v2: https://support.testrail.com/hc/en-us/sections/7077185274644-API-reference
- Reference implementation used for structure: https://github.com/testomatio/mcp
