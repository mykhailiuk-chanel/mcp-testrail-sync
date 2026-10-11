# Roadmap: mcp-testrail-sync

| Step | What | Status |
|---|---|---|
| **1** | Build the PoC v1 (code, tests, docs) | Done |
| **2** | Publish: GitHub (public repo), then npm (following `HOW-TO-PUBLISH.md`) | Next |
| **3** | Verify against a real TestRail: API key, GET requests, then writes | Todo |
| **4** | Team feedback, screenshots, article | Todo |
| **5** | v2 | Backlog |

> **Heads-up on the order:** everything in Step 1 was tested against a **mock** TestRail. If Step 2 happens before Step 3, publish to npm as a **beta** (`0.1.0-beta.1`, `--tag beta`), so nobody gets an unverified build as the default `npm install`. Cut the stable `0.1.0` after Step 3.

---

## Step 1: Build the PoC v1 (done)

**Result:** an MCP server locked to one TestRail project + one suite, read and create only.

- 12 tools: `system_ping`, `tests_list/get/search/create`, `labels_list/get`, `sections_list/create`, `suites_list/get/search`.
- Config only in the MCP client config: `--project` plus `TESTRAIL_URL`, `TESTRAIL_USERNAME`, `TESTRAIL_API_KEY`, `TESTRAIL_SUITE`. Project and suite by name or id.
- Safety: the API client has no update/delete methods; every read is filtered to the suite; every write and id lookup is checked against the suite.
- Steps are sent as separated steps or as text, depending on the project template (detected at startup).
- Tests: 36 passing, against an in-memory fake TestRail. Plus an end-to-end stdio run against a mock HTTP server.
- Docs: `README.md`, `docs/CLIENTS.md` (Claude Code, Claude Desktop, OpenCode, Codex, VS Code), `docs/HOW_MCP_WORKS.md`, `HOW-TO-PUBLISH.md`, `examples/`.
- Git: 2 commits so far. Uncommitted: `.gitignore` (excludes the article drafts), `package.json` author field, this file.

---

## Step 2: Publish

Follow **`HOW-TO-PUBLISH.md`** for the details. Checklist:

### 2a. GitHub (public repo)
- [ ] Commit the pending changes (`.gitignore`, `package.json` author, `ROADMAP.md`).
- [ ] Create the public repo `mcp-testrail-sync` and push (`gh repo create mcp-testrail-sync --public --source=. --push`).
- [ ] Replace the `<org>` placeholders in `README.md` and `docs/CLIENTS.md` with the real GitHub URL.
- [ ] Add `repository`, `homepage`, `bugs` and `publishConfig.access: "public"` to `package.json` (`HOW-TO-PUBLISH.md`, step 3).
- [ ] Share the repo link with the team to collect early feedback.

### 2b. npm
- [ ] Create the npm account and turn on 2FA (`HOW-TO-PUBLISH.md`, step 1).
- [ ] Create the org `mcp-testrail-sync` (or pick another scope and rename the package everywhere) (step 2).
- [ ] Run the pre-publish checks: `npm ci`, `npm test`, `npm run build`, `npm pack --dry-run`, install the packed `.tgz` in an empty folder (step 5).
- [ ] `npm login`, then publish as a **beta**: version `0.1.0-beta.1`, `npm publish --access public --tag beta` (steps 6-7).
- [ ] Verify: `npm view @mcp-testrail-sync/mcp`, `npm install @mcp-testrail-sync/mcp@beta`, run `--help` (step 8).
- [ ] Tag the release in git.

---

## Step 3: Verify against a real TestRail

Do all of this in a **sandbox** project, never in a real team project.

### 3.1 Get access
- [ ] Create a sandbox project with a suite (e.g. project `mcp-sandbox`, suite `test1`).
- [ ] Enable the API: **Admin → Site Settings → API → Enable API**.
- [ ] Create an API key: **My Settings → API Keys → Add Key**. Never commit it.
- [ ] Note the TestRail version (**Help & Feedback → About**). Labels need 10.5+.
- [ ] Start MCP Inspector with the values in your shell:
  ```bash
  export TESTRAIL_URL=https://your-instance.testrail.io
  export TESTRAIL_USERNAME=you@example.com
  export TESTRAIL_API_KEY=...
  export TESTRAIL_SUITE=test1
  npm run build && npx @modelcontextprotocol/inspector node index.js --project mcp-sandbox
  ```

### 3.2 Read-only checks first (GET only, nothing is written)
- [ ] `system_ping`: right project/suite, `steps_mode`, template and `required_fields`.
- [ ] Startup errors: wrong URL, wrong API key (401), unknown project, unknown suite. The messages should be clear.
- [ ] `suites_get`, `suites_list` (with and without `include_case_counts`), `suites_search`.
- [ ] `sections_list`: tree and `flat: true` match what TestRail shows.
- [ ] `tests_list`: filters (`section_id`, `search_text`, `priority_id`, `type_id`, `label_id`) and paging (`has_more` / `next_offset`) on a suite with more than 50 cases.
- [ ] `tests_get`: by `123` and `C123`; a case from **another suite** is rejected.
- [ ] `tests_search` returns the same as `tests_list` with `search_text`.
- [ ] `labels_list` / `labels_get` (by id and by title). On TestRail < 10.5 the "requires 10.5" error shows.

### 3.3 Write checks (sandbox only)
- [ ] `sections_create`: top-level section, then a subsection with `parent_id`. Confirm in the TestRail UI.
- [ ] `tests_create`: one case, then a batch of 3-5 with steps. Confirm the steps look right in TestRail.
- [ ] Required custom fields: does `add_case` fail without them? Does `custom_fields` fix it?
- [ ] Per-case failure: force one bad case in a batch; the rest should still be created and the failure listed.
- [ ] Scope guard on writes: a `section_id` from another suite must be refused **before** any request is sent.
- [ ] Run the example prompt end to end in Claude Code / OpenCode (`examples/prompts.md` with `examples/test_registration.md`).

### 3.4 Details I could not confirm from the docs
- [ ] **`labels` in `add_case`**: accepted at all, and as titles or ids? If not, remove or change it in `src/tools/tests.ts`, `src/testrail/mappers.ts` and the tool description.
- [ ] **`label_id` filter in `get_cases`** (TestRail 10.5+).
- [ ] **`filter` param in `get_cases`**: does it search the title as expected?
- [ ] **`custom_steps_separated`** format, and the template picked by `detectCaseFormat` (`src/testrail/scope.ts`).
- [ ] **Single-suite projects** (`suite_mode` 1 or 2): `get_suites`, `get_sections`, `add_section`, `get_cases` with `suite_id`. The code assumes it works.
- [ ] **`get_projects`** response shape (wrapped vs plain array) and paging on instances with many projects.
- [ ] **Rate limits (HTTP 429)** on a batch of 50 `add_case` calls on TestRail Cloud. Add retry with backoff if needed.

### 3.5 Fix what the real run finds
- [ ] Update `test/fake-testrail.ts` to match any real behaviour that differed from the mock, and add regression tests.
- [ ] Update `README.md` / `docs/CLIENTS.md` if any setup step was wrong.
- [ ] Release the stable version (`npm version` → `0.1.0`, `npm publish`).

---

## Step 4: Team feedback and the article

- [ ] Collect feedback from the team: real prompts, missing tools, confusing setup steps.
- [ ] Add screenshots to `docs/screenshots/` (file list is in that folder's README).
- [ ] Finish the article (`HOW_TO_MCP-flow.txt`, kept out of git): screenshots, repo and npm links, real results and time saved.
- [ ] Turn the feedback into the v2 priority list below.

---

## Step 5: v2 backlog

Ideas in rough priority order. Nothing here is committed to.

- [ ] Duplicate check inside `tests_create` (skip or warn on identical titles in the same section).
- [ ] Read-only mode flag (`--read-only`) that disables the two create tools.
- [ ] Retry with backoff on 429 / 5xx.
- [ ] `tests_update` / `tests_delete` with confirmation (breaks the "no update/delete" safety test on purpose).
- [ ] `suites_create` (needs a decision on the scope lock).
- [ ] Test runs, plans and results.
- [ ] Lookup tools for case fields, priorities and types, so the AI can find valid ids without guessing.
- [ ] Attachments, shared steps, BDD scenarios.
- [ ] GitHub Actions: CI (`npm test`) and publish on release with provenance (`HOW-TO-PUBLISH.md`).
- [ ] HTTP transport for a hosted setup.
- [ ] Common query format across several TMS tools (import/export analysis first).
