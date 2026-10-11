# Connecting MCP clients

Every client needs the same four values plus `--project`. Only the file format changes.

> **About the path `node_modules/@mcp-testrail-sync/mcp/index.js`:** it is relative, so it works when the client starts from your project folder. That is true for project-level configs (Claude Code `.mcp.json`, OpenCode `opencode.json`, VS Code `.vscode/mcp.json`). For global configs (Claude Desktop, Codex), use an **absolute path**.

> **Secrets:** don't commit your API key. Where the client supports it, read the key from your shell environment or a prompt instead (examples below).

---

## Claude Code

**Option A: one command** (saved for you only):
```bash
claude mcp add mcp-testrail-sync \
  -e TESTRAIL_URL=https://your-instance.testrail.io \
  -e TESTRAIL_USERNAME=your-email@example.com \
  -e TESTRAIL_API_KEY=your-api-key \
  -e TESTRAIL_SUITE=test1 \
  -- node node_modules/@mcp-testrail-sync/mcp/index.js --project demo-name
```

**Option B: shared with the team** (`.mcp.json` in the repo root). `${VAR}` is read from each person's shell, so the key never lands in git:
```json
{
  "mcpServers": {
    "mcp-testrail-sync": {
      "command": "node",
      "args": ["node_modules/@mcp-testrail-sync/mcp/index.js", "--project", "demo-name"],
      "env": {
        "TESTRAIL_URL": "https://your-instance.testrail.io",
        "TESTRAIL_USERNAME": "${TESTRAIL_USERNAME}",
        "TESTRAIL_API_KEY": "${TESTRAIL_API_KEY}",
        "TESTRAIL_SUITE": "test1"
      }
    }
  }
}
```
Check it with `/mcp` inside Claude Code.

## Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
```json
{
  "mcpServers": {
    "mcp-testrail-sync": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/node_modules/@mcp-testrail-sync/mcp/index.js", "--project", "demo-name"],
      "env": {
        "TESTRAIL_URL": "https://your-instance.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key",
        "TESTRAIL_SUITE": "test1"
      }
    }
  }
}
```

## OpenCode

File: `opencode.json` in the project. Note that OpenCode calls the env block **`environment`**, not `env`, and `command` is one array.
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mcp-testrail-sync": {
      "type": "local",
      "command": ["node", "node_modules/@mcp-testrail-sync/mcp/index.js", "--project", "demo-name"],
      "enabled": true,
      "environment": {
        "TESTRAIL_URL": "https://your-instance.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key",
        "TESTRAIL_SUITE": "test1"
      }
    }
  }
}
```

## Codex (CLI / IDE)

File: `~/.codex/config.toml`
```toml
[mcp_servers.mcp-testrail-sync]
command = "node"
args = ["/ABSOLUTE/PATH/node_modules/@mcp-testrail-sync/mcp/index.js", "--project", "demo-name"]

[mcp_servers.mcp-testrail-sync.env]
TESTRAIL_URL = "https://your-instance.testrail.io"
TESTRAIL_USERNAME = "your-email@example.com"
TESTRAIL_API_KEY = "your-api-key"
TESTRAIL_SUITE = "test1"
```

## VS Code (GitHub Copilot, agent mode)

File: `.vscode/mcp.json`. VS Code asks for the API key once and stores it securely:
```json
{
  "inputs": [
    { "type": "promptString", "id": "testrail-api-key", "description": "TestRail API key", "password": true }
  ],
  "servers": {
    "mcp-testrail-sync": {
      "type": "stdio",
      "command": "node",
      "args": ["node_modules/@mcp-testrail-sync/mcp/index.js", "--project", "demo-name"],
      "env": {
        "TESTRAIL_URL": "https://your-instance.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "${input:testrail-api-key}",
        "TESTRAIL_SUITE": "test1"
      }
    }
  }
}
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server "failed" / shows no tools | Look at the client's MCP log. The server prints the exact reason, e.g. a missing env var |
| `Cannot reach TestRail` | Check `TESTRAIL_URL` (with `https://`) and your VPN |
| HTTP 401 | Wrong username/API key, or the API is disabled in Admin → Site Settings → API |
| `Project "X" not found` | The error lists the projects you can access. Use the exact name or the id |
| `Section N is not part of suite` | You are trying to work outside the configured suite. Use `sections_list` |
| `Field :custom_xxx is a required field` | Your project requires that field. Pass it in `custom_fields` |

Screenshots of a working setup: [docs/screenshots/](screenshots/) (added after the first team demo).
