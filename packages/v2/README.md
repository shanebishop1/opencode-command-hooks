# opencode-command-hooks-v2

Beta package for OpenCode 2. It targets `@opencode-ai/cli@0.0.0-next-15853` and uses the same `.opencode/command-hooks.jsonc` and agent frontmatter configuration as the V1 package.

```jsonc
{
  "plugins": ["opencode-command-hooks-v2@0.1.0-beta.0"]
}
```

Tool before/after hooks, argument filters, agent hooks, session start/idle hooks, shell execution, and synthetic context injection are supported. Commands run in the session's project directory.

OpenCode 2 server plugins cannot currently show TUI toasts. A toast setting produces one diagnostic while command execution and injection continue.

Keep the V1 package and configuration available for rollback while OpenCode 2 remains beta. Verify loading with `opencode2 api get /api/plugin`.
