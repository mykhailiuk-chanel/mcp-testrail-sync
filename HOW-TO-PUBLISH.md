# How to publish `@mcp-testrail-sync/mcp` to npm

A first-time guide. Follow it top to bottom. Nothing here publishes anything until step 7.

**Current state (checked when this guide was written):**
- The package name `@mcp-testrail-sync/mcp` returned 404 on the registry, so the name is **not taken** (a scope can still be reserved by someone else, so step 2 confirms it).
- This machine is **not logged in** to npm.
- The git repo has **no remote** yet.

---

## 0. Key concepts (2 minutes)

- **Scope:** `@mcp-testrail-sync/...` means the package lives under the scope (namespace) `mcp-testrail-sync`. On npm a scope is either a **user** name or an **organization** name. You need to own it before you can publish into it.
- **Scoped packages are private by default.** Private packages need a paid plan, so the first publish needs `--access public` (or `publishConfig.access = "public"`, see step 3).
- **Versions are permanent.** You can never publish the same version twice, even after unpublishing. Fix mistakes by publishing a new version.
- **`dist/` is not in git** (see `.gitignore`), but it must be in the package. The `prepack` script builds it automatically before `npm publish` / `npm pack`.

---

## 1. Create an npm account and turn on 2FA

1. Sign up at https://www.npmjs.com/signup and verify your email.
2. Turn on two-factor authentication: **Account → Two-Factor Authentication → Enable**. Choose "Authorization and publishing". npm requires 2FA for publishing.

## 2. Create the organization (this gives you the `@mcp-testrail-sync` scope)

1. https://www.npmjs.com/org/create
2. Name: `mcp-testrail-sync`. Choose the **free plan** (unlimited **public** packages).
3. If the name is taken, either pick another org name or publish under your user scope, e.g. `@your-npm-username/mcp-testrail-sync`. In that case you must also change:
   - `package.json` → `name`
   - the path in `README.md`, `docs/CLIENTS.md`, `examples/` and the article (search for `@mcp-testrail-sync/mcp`)

## 3. Prepare `package.json`

Add these fields (they are not there yet):

```json
{
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "git+https://github.com/<you-or-org>/mcp-testrail-sync.git" },
  "homepage": "https://github.com/<you-or-org>/mcp-testrail-sync#readme",
  "bugs": { "url": "https://github.com/<you-or-org>/mcp-testrail-sync/issues" },
  "author": "Vitalii Mykhailiuk"
}
```

Already set and correct: `name`, `version` (`0.1.0`), `description`, `type: module`, `bin` (`mcp-testrail-sync` → `index.js`), `files`, `engines` (Node ≥ 20), `license`, `keywords`, `prepack`.

> **Version number tip:** keep `0.x` while it's a PoC. Use `0.1.0` for the first release. Semver for `0.x`: breaking change → bump the minor (`0.2.0`), fix → bump the patch (`0.1.1`).

## 4. Put the code on GitHub (recommended before publishing)

The `repository` field and the article both point to it, and the README install section assumes it.

```bash
git add -A
git commit -m "feat: mcp-testrail-sync v0.1.0 PoC"
git remote add origin git@github.com:<you-or-org>/mcp-testrail-sync.git
git push -u origin main
```

Before you push, decide whether `HOW_TO_MCP.txt` and `HOW_TO_MCP-flow.txt` (the article drafts) belong in the public repo. They are not included in the npm package (`files` only lists `index.js`, `dist`, `README.md`, `docs`), but they would be visible on GitHub.

## 5. Pre-publish checks (do all of them)

```bash
npm ci                 # clean install from package-lock.json
npm run typecheck
npm test               # all tests must pass
npm run build
npm pack --dry-run     # lists exactly what will be published
```

Check the file list. You should see `index.js`, `dist/**`, `README.md`, `LICENSE`, `package.json` and `docs/**`. You should **not** see `.env`, `test/`, `src/`, `node_modules/` or any secret.

Then test the real package the way a user will get it, in a **separate empty folder**:

```bash
npm pack                              # creates mcp-testrail-sync-mcp-0.1.0.tgz
mkdir /tmp/try-mcp && cd /tmp/try-mcp
npm init -y
npm install /path/to/mcp-testrail-sync-mcp-0.1.0.tgz
node node_modules/@mcp-testrail-sync/mcp/index.js --help
```

`--help` should print the usage text. Running without config should print the list of missing settings (and exit with code 1). This confirms that the exact path from your MCP config works. Delete the `.tgz` file afterwards (it is in `.gitignore`).

> **Best test before publishing:** connect the packed version to a real MCP client and a **sandbox TestRail project**. The tests so far ran against a mock TestRail only.

## 6. Log in

```bash
npm login
npm whoami             # should print your npm username
```

A browser window opens for login and 2FA.

## 7. Publish

First do a dry run:

```bash
npm publish --dry-run
```

Then the real thing:

```bash
npm publish --access public
```

(`--access public` is not needed if you added `publishConfig` in step 3, but it does no harm.) npm asks for your 2FA code. `prepack` builds `dist/` first.

**Optional: publish a "beta" first.** A pre-release does not become the default `npm install` version:

```bash
# set "version": "0.1.0-beta.1" in package.json
npm publish --access public --tag beta
# users install it with: npm install @mcp-testrail-sync/mcp@beta
```

## 8. Verify the published package

```bash
npm view @mcp-testrail-sync/mcp            # shows version, files, dist-tags
mkdir /tmp/try-npm && cd /tmp/try-npm && npm init -y
npm install @mcp-testrail-sync/mcp
node node_modules/@mcp-testrail-sync/mcp/index.js --help
npx -y @mcp-testrail-sync/mcp --help       # also works through the "bin" entry
```

The page appears at https://www.npmjs.com/package/@mcp-testrail-sync/mcp (the README shown there is the one in the package, and it can take a few minutes).

Tag the release in git too:

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## Releasing the next version

```bash
# 1. make changes, update tests and docs
npm test
# 2. bump the version (creates a commit and a git tag)
npm version patch      # 0.1.0 -> 0.1.1   (or: minor -> 0.2.0, major -> 1.0.0)
# 3. publish
npm publish
git push --follow-tags
```

## Optional: automatic publishing from GitHub Actions

Manual publishing is fine for a PoC. Once the repo is on GitHub, you can publish on each GitHub Release (this is what the testomat.io MCP does). The two safe options:

1. **Trusted publishing (OIDC), no stored token.** On npmjs.com open the package → **Settings → Trusted Publisher** and connect your GitHub repo and workflow file. npm then accepts publishes from that workflow without a token, and adds a provenance badge. (The package must exist already, so do the first publish manually.) Check the current npm docs for the exact steps: https://docs.npmjs.com/trusted-publishers
2. **Granular access token.** npm → Account → **Access Tokens → Generate New Token → Granular**. Limit it to this package, give it read and write only, and set an expiry. Save it as the GitHub secret `NPM_TOKEN`.

Minimal workflow `.github/workflows/publish.yml` (trusted publishing version):

```yaml
name: Publish
on:
  release:
    types: [published]
permissions:
  contents: read
  id-token: write        # required for trusted publishing / provenance
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm test
      - run: npm publish --provenance --access public
```

If you use a token instead, add `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to the publish step.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `E403 ... You do not have permission to publish "@mcp-testrail-sync/mcp"` | The scope isn't yours. Create the org (step 2) or check `npm whoami` and your membership in the org |
| `E402 You must sign up for private packages` | A scoped package is private by default. Add `--access public` / `publishConfig.access` |
| `E403 ... cannot publish over the previously published versions` | That version already exists. Bump the version (`npm version patch`) |
| `EOTP` / one-time password required | Add your 2FA code: `npm publish --otp=123456` |
| `ENEEDAUTH` | Run `npm login` |
| `E404` on `npm install` right after publishing | Wait a minute and retry. The registry cache can lag |
| Package is missing `dist/` | `prepack` didn't run. Run `npm run build` and check `npm pack --dry-run` |
| Published a broken version | Publish a fixed one right away (`npm version patch`). Then `npm deprecate @mcp-testrail-sync/mcp@0.1.0 "broken, use 0.1.1"` |

**Unpublishing:** npm only allows `npm unpublish` within 72 hours of publishing (or if nobody depends on it), and the version number can **never be reused**. Prefer `npm deprecate`.

## Security checklist

- Never commit or publish API keys. The server reads `TESTRAIL_API_KEY` from the client's config only. Run `npm pack --dry-run` and read the file list.
- Keep 2FA on. Do not use a classic "automation" token with full access; use a granular token or trusted publishing.
- Every publish is public and permanent. Double-check the README and docs for internal URLs, company names or example data you don't want exposed.
