# 🪝 OpenCode Command Hooks

Run shell commands automatically on OpenCode tool + session events, configured in JSON/YAML. Optionally inject the output into the session.

Typical uses: run tests after a subagent finishes, lint after writes, or bootstrap on session start—without asking the agent to do it.

## Markdown Frontmatter Hooks

Define hooks in agent markdown frontmatter so they live with the agent.

````markdown
---
description: Engineer agent
mode: subagent
hooks:
  after:
    - run: "npm run test"
      inject: "Test Output:\n{stdout}\n{stderr}"
---

### How It Works

1. **Runs automatically** on the configured lifecycle event (tool/session).
2. **Executes shell commands** sequentially (if you give an array).
3. **Captures output** (truncated for safety).
4. **Optionally reports results** via `inject` (to the session) and/or `toast` (to the UI).

### Simplified vs Global Config Format

**JSON Config**

```jsonc
{
  "tool": [
    {
      "id": "validate-engineer",
      "when": {
        "phase": "after",
        "tool": "task",
        "toolArgs": { "subagent_type": "engineer" },
      },
      "run": ["npm run lint", "npm run typecheck", "npm test"],
      "inject": "Validation Results (exit {exitCode}): \n`{stdout}`\n`{stderr}`",
    },
  ],
}
```
````

**Markdown Frontmatter Config**

```yaml
hooks:
  after:
    - run: ["npm run lint", "npm run typecheck", "npm test"]
      inject: "Validation Results (exit {exitCode}): \n`{stdout}`\n`{stderr}`"
      toast:
        message: "Validation Complete"
```

### Hook Configuration Options

| Option   | Type                   | Required | Description                       |
| -------- | ---------------------- | -------- | --------------------------------- |
| `run`    | `string` \| `string[]` | ✅ Yes   | Command(s) to execute             |
| `inject` | `string`               | ❌ No    | Message injected into the session |
| `toast`  | `object`               | ❌ No    | Toast notification configuration  |

### Toast Configuration

```yaml
toast:
  title: "Build" # optional
  message: "exit {exitCode}"
  variant: "info" # optional- one of: info, success, warning, error
  duration: 5000 # optional (milliseconds)
```

### Template Variables

- `{id}` - Hook ID
- `{agent}` - Agent name (if available)
- `{tool}` - Tool name (tool hooks only)
- `{cmd}` - Executed command
- `{stdout}` - Command stdout (truncated)
- `{stderr}` - Command stderr (truncated)
- `{exitCode}` - Command exit code

### Complete Example

````markdown
---
description: Engineer Agent
mode: subagent
hooks:
  before:
    - run: "echo 'Engineer starting...'"
      toast:
        message: "Engineer starting"
        variant: "info"
  after:
    - run: ["npm run typecheck", "npm run lint"]
      inject: "Typecheck + lint (exit {exitCode}) ``` {stdout} ```"
---

<your subagent instructions>
````

---

## Why?

When working with a fleet of subagents, automatic validation of the state of your codebase is really useful. By setting up quality gates (tests, lint, typechecks, etc.) or other automation, you can catch and prevent errors quickly and reliably.  

Doing this by having your orchestrator agent use the bash tool (or call a validator subagent) is non-deterministic and can cost a lot of tokens over time. You could always write a custom plugin to achieve this, but I found myself writing the same boilerplate, error handling, output capture, session injection logic over and over again. This plugin removes that overhead and provides an simple, opinionated system for integrating command hooks into your Opencode flow.

### Automatic Context Injection

If `inject` is set, the command output is posted into the session, so your agents can react to failures.

### Filter by Tool Arguments

You can set up tool hooks to only trigger on specific arguments via `when.toolArgs`.

```jsonc
{
  "id": "playwright-access-localhost",
  "when": {
    "phase": "after",
    "tool": "playwright_browser_navigate",
    "toolArgs": { "url": "http://localhost:3000]" }
  },
  "run": [
    "osascript -e 'display notification \"Agent triggered playwright\"'"
  ],
  "toast": {
    "message": "Agent used the playwright {tool} tool"
  }
}
```

### 4. Execution Semantics

- Hooks are **non-blocking**: failures don’t crash the session/tool.
- Commands run **sequentially**, even if earlier ones fail.
- `inject`/`toast` interpolate using the **last command’s** output if `run` is an array.

---

## Features

- Tool hooks (`before`/`after`) and session hooks (`start`/`idle`)
- Match by tool name, calling agent, slash command, and tool arguments
- Optional session injection and toast notifications
- Output truncation to keep memory bounded
- Debug logging via `OPENCODE_HOOKS_DEBUG=1`

---

## Installation

```bash
opencode install opencode-command-hooks
```

---

## Configuration

### Global Configuration

Create `.opencode/command-hooks.jsonc` in your project (the plugin searches upward from the current working directory):

```jsonc
{
  "tool": [
    // Tool hooks
  ],
  "session": [
    // Session hooks
  ],
}
```

### Markdown Frontmatter

Use `hooks:` in agent markdown for the simplified format:

```markdown
---
description: Engineer agent
mode: subagent
hooks:
  before:
    - run: "echo 'Starting engineering work...'"
  after:
    - run: "npm run lint"
      inject: "Lint output:\n{stdout}\n{stderr}"
---
```

### Configuration Precedence

1. Global hooks are loaded from `.opencode/command-hooks.jsonc`
2. Markdown hooks are converted to normal hooks with auto-generated IDs
3. If a markdown hook and a global hook share the same `id`, the markdown hook wins
4. Duplicate IDs within the same source are errors
5. Global config is cached to avoid repeated file reads

---

## Examples

### Autonomous Quality Gates (After `task`)

Run validation after certain subagents complete, inject results back into the session, and show a small toast.

```jsonc
{
  "tool": [
    {
      "id": "validate-after-task",
      "when": {
        "phase": "after",
        "tool": "task",
        "toolArgs": { "subagent_type": ["engineer", "debugger"] },
      },
      "run": ["npm run typecheck", "npm run lint", "npm test"],
      "inject": "Validation (exit {exitCode})\n\n{stdout}\n{stderr}",
      "toast": {
        "title": "Validation",
        "message": "exit {exitCode}",
        "variant": "info",
        "duration": 5000,
      },
    },
  ],
}
```

### Basic Examples

#### Run Tests After Any `task`

```jsonc
{
  "tool": [
    {
      "id": "tests-after-task",
      "when": { "phase": "after", "tool": "task" },
      "run": ["npm test"],
      "inject": "Tests (exit {exitCode})\n\n{stdout}\n{stderr}",
    },
  ],
}
```

#### Enforce Linting After a Specific `write`

Tool-arg matching is exact. This example runs only when the tool arg `path` equals `src/index.ts`.

```jsonc
{
  "tool": [
    {
      "id": "lint-src-index",
      "when": {
        "phase": "after",
        "tool": "write",
        "toolArgs": { "path": "src/index.ts" },
      },
      "run": ["npm run lint"],
      "inject": "Lint (exit {exitCode})\n\n{stdout}\n{stderr}",
    },
  ],
}
```

### Advanced Examples

#### Toast Notifications for Build Status

```jsonc
{
  "tool": [
    {
      "id": "build-toast",
      "when": { "phase": "after", "tool": "write" },
      "run": ["npm run build"],
      "toast": {
        "title": "Build",
        "message": "exit {exitCode}",
        "variant": "info",
        "duration": 3000,
      },
    },
  ],
}
```

#### Handle Async Tool Completion (`tool.result`)

```jsonc
{
  "tool": [
    {
      "id": "task-result-hook",
      "when": {
        "phase": "after",
        "tool": "task",
        "toolArgs": { "subagent_type": "code-writer" },
      },
      "run": ["npm run validate-changes"],
      "toast": { "title": "Code Writer", "message": "exit {exitCode}" },
    },
  ],
}
```

#### Session Lifecycle Hooks

```jsonc
{
  "session": [
    {
      "id": "session-start",
      "when": { "event": "session.start" },
      "run": ["echo 'New session started'"],
      "toast": { "title": "Session", "message": "started", "variant": "info" },
    },
    {
      "id": "session-idle",
      "when": { "event": "session.idle" },
      "run": ["echo 'Session idle'"],
    },
  ],
}
```

---

## Template Placeholders

All templates support these placeholders:

| Placeholder  | Description                | Example                    |
| ------------ | -------------------------- | -------------------------- |
| `{id}`       | Hook ID                    | `lint-ts`                  |
| `{agent}`    | Calling agent name         | `orchestrator`             |
| `{tool}`     | Tool name                  | `write`                    |
| `{cmd}`      | Executed command           | `npm run lint`             |
| `{stdout}`   | Command stdout (truncated) | `Linting complete`         |
| `{stderr}`   | Command stderr (truncated) | `Error: missing semicolon` |
| `{exitCode}` | Command exit code          | `0` or `1`                 |

---

## Debugging

Enable debug logging:

```bash
export OPENCODE_HOOKS_DEBUG=1
opencode start
```

---

## Event Types

### Tool Events

- `tool.execute.before`
- `tool.execute.after`
- `tool.result`

### Session Events

- `session.start`
- `session.idle`

---

## Tool vs Session Hooks

### Tool Hooks

- Triggered around tool executions (`before`/`after`)
- Can match by tool name, calling agent, slash command, and tool arguments
- Best for: lint/tests/formatters around `write` and `task`

### Session Hooks

- Triggered on session lifecycle events
- Can match by `agent` when OpenCode includes it in event properties (otherwise it’s treated as unknown)
- Best for: bootstrapping, cleanup, periodic checks

---

## Native Plugin vs This Plugin

Native plugins can do anything, but even “run a command and post its output” turns into a bunch of glue code.

**Native plugin (code you maintain):**

```ts
import type { Plugin } from "@opencode-ai/plugin";

export const MyPlugin: Plugin = async ({ $, client }) => ({
  "tool.execute.after": async (input) => {
    if (input.tool !== "task") return;
    const stdout = await $`npm test`.text();
    await client.session.promptAsync({
      path: { id: input.sessionID },
      body: { noReply: true, parts: [{ type: "text", text: stdout }] },
    });
  },
});
```

**This plugin (config):**

```jsonc
{
  "id": "tests-after-task",
  "when": { "phase": "after", "tool": "task" },
  "run": ["npm test"],
  "inject": "Tests (exit {exitCode})\n\n{stdout}\n{stderr}",
}
```

---

### Feature Comparison

| Feature           | Native Plugin                       | This Plugin       |
| ----------------- | ----------------------------------- | ----------------- |
| Setup             | TypeScript + build + error handling | JSON/YAML config  |
| Error handling    | Manual                              | Non-blocking      |
| User feedback     | Console logs unless you build UI    | Toasts            |
| Session injection | Manual SDK calls                    | `inject` template |
| Tool filtering    | Whatever you implement              | Built-in matchers |
| Agent prompting   | Optional (you wire it up)           | Not needed        |

---

## Known Limitations

- Templates are simple placeholder substitution (no conditionals / ICU MessageFormat).
- `when.toolArgs` matching is exact string/array match (no glob/regex).
- For multi-command hooks (`run: [...]`), `inject`/`toast` use the last command’s output.

---

## Development

```bash
bun install
bun run build
```

TODO:

- Implement max-length output using tail
- Add more template functions (date formatting, etc.)
