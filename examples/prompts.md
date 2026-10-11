# Example prompts

Copy these into Claude / Copilot / Codex / OpenCode once the server is connected.

## Check the setup
- `Run system_ping from mcp-testrail-sync and tell me which project and suite I'm working in.`

## Explore
- `Show me the section tree of my TestRail suite with case counts.`
- `Find sections about "registration" in TestRail.`
- `List test cases in section "User registration".`
- `Search TestRail for cases with "password" in the title.`
- `Show me the full steps of C1234.`
- `Which labels exist in our TestRail project?`

## Create
- `Use mcp-testrail-sync to create new test cases in section "User registration" from examples/test_registration.md. Check for duplicates first.`
- `Create a subsection "Social login" under "Auth", then add 3 test cases for Google sign-in (happy path, cancelled consent, account already linked).`
- `Turn the acceptance criteria in JIRA-123 (pasted below) into TestRail cases with steps and expected results, priority High, label "smoke".`

## Tips
- Name the section in the prompt. The AI finds its id with `suites_search`, or creates it with `sections_create`.
- Ask it to *"check for duplicates first"* so it runs `tests_search` before `tests_create`.
- If creation fails on a required field, ask: *"Which fields are required? (system_ping)"*.
