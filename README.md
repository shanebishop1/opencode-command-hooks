# 🪝OpenCode Command Hooks

Attach shell commands to agent, tool, and session lifecycles using JSON/YAML configuration. Execute commands automatically without consuming tokens or requiring agent interaction.

## Why?

### 1. Zero-Token Automation

Custom OpenCode plugins require TypeScript setup, manual error handling, and build processes. For routine automation tasks, this creates unnecessary complexity. This plugin provides shell hook functionality through configuration files—no tokens spent prompting agents to run repetitive commands.

**Native Plugin (Requires TypeScript):**

```typescript
// .opencode/plugin/my-plugin.ts
import type { Plugin } from "@opencode-ai/plugin";

export const MyPlugin: Plugin = async ({ $ }) => {
  return {
    "tool.execute.after": async (input) => {
      if (input.tool === "write") {
        try {
          await $`npm run lint`;
        } catch (e) {
          console.error(e); // UI spam or crashes
          // Agent won't see what failed unless you inject it back
        }
      }
    },
  };
};
```

**This Plugin (Configuration-Based):**

```jsonc
{
  "tool": [
    {
      "id": "lint-ts",
      "when": { "tool": "write" },
      "run": ["npm run lint"],
      "inject": {
        "as": "system",
        "template": "Lint results:\n{stdout}\n{stderr}",
      },
    },
  ],
}
```

### 2. Automatic Context Injection

Command output returns to the agent automatically without manual SDK calls. The agent can see and react to errors, warnings, or other results:

```jsonc
{
  "tool": [
    {
      "id": "typecheck",
      "when": { "tool": "write", "toolArgs": { "path": "*.ts" } },
      "run": ["npm run typecheck"],
      "inject": {
        "as": "system",
        "template": "TypeScript check:\n{stdout}\n{stderr}",
      },
    },
  ],
}
```

For background tasks where the agent doesn't need context, use toast notifications instead:

```jsonc
{
  "tool": [
    {
      "id": "build-status",
      "when": { "tool": "write", "phase": "after" },
      "run": ["npm run build"],
      "toast": {
        "title": "Build Status",
        "message": "Build {exitCode, select, 0 {succeeded} other {failed}}",
        "variant": "{exitCode, select, 0 {success} other {error}}",
        "duration": 5000,
      },
    },
  ],
}
```

### 3. Filter Tools by Any Argument

Run different hooks based on any tool argument—not just task subagent types. Filter by file paths, API endpoints, model names, or custom parameters.

```jsonc
// Filter by multiple subagent types
{
  "when": {
    "tool": "task",
    "toolArgs": { "subagent_type": ["validator", "reviewer", "tester"] }
  }
}

// Filter write tool by file extension
{
  "when": {
    "tool": "write",
    "toolArgs": { "path": "*.test.ts" }
  }
}

// Filter by API endpoint
{
  "when": {
    "tool": "fetch",
    "toolArgs": { "url": "*/api/validate" }
  }
}
```

### 4. Reliable Execution

- **Non-blocking**: Hook failures don't crash the agent
- **Automatic error handling**: Failed hooks inject error messages automatically
- **Memory safe**: Output truncated to prevent memory issues
- **Sequential execution**: Commands run in order, even if earlier ones fail

---

## Features

- 🔔 **Toast Notifications** - Non-blocking user feedback with customizable titles, messages, and variants
- 🎯 **Precise Filtering** - Filter by tool name, agent, phase, slash command, or ANY tool argument
- 📊 **Complete Template System** - Access to `{id}`, `{agent}`, `{tool}`, `{cmd}`, `{stdout}`, `{stderr}`, `{exitCode}`
- 🔄 **Multiple Event Types** - `tool.execute.before`, `tool.execute.after`, `tool.result`, `session.start`, `session.idle`
- 🧩 **Flexible Configuration** - Global configs in `.opencode/command-hooks.jsonc` or markdown frontmatter
- ⚡ **Zero-Token Automation** - Guaranteed execution without spending tokens on agent prompts
- 🛡️ **Bulletproof Error Handling** - Graceful failures that never crash the agent
- 🐛 **Debug Mode** - Detailed logging with `OPENCODE_HOOKS_DEBUG=1`

---

## Installation

```bash
opencode install opencode-command-hooks
```

---

## Configuration

### Global Configuration

Create `.opencode/command-hooks.jsonc` in your project root:

```jsonc
{
  "tool": [
    // Your tool hooks here
  ],
  "session": [
    // Your session hooks here
  ],
}
```

### Markdown Frontmatter

Override global settings in individual markdown files:

```markdown
---
opencode-hooks:
  tool:
    - id: custom-hook
      when: { tool: "write" }
      run: ["echo 'File modified'"]
---

# Your markdown content
```

### Configuration Precedence

1. **Markdown hooks** override global hooks with the same ID
2. **Global hooks** are loaded from `.opencode/command-hooks.jsonc`
3. **Duplicate IDs** within the same source are errors
4. **Caching** prevents repeated file reads for performance

---

## Examples

### Basic Examples

#### Auto-Verify Subagent Work

````jsonc
{
  "tool": [
    {
      "id": "verify-subagent-work",
      "when": {
        "phase": "after",
        "tool": ["task"],
      },
      "run": ["npm test"],
      "inject": {
        "as": "user",
        "template": "Test Runner:\nExit Code: {exitCode}\n\nOutput:\n```\n{stdout}\n```\n\nIf tests failed, please fix them before proceeding.",
      },
    },
  ],
}
````

#### Enforce Linting on File Edits

```jsonc
{
  "tool": [
    {
      "id": "lint-on-save",
      "when": {
        "phase": "after",
        "tool": ["write"],
      },
      "run": ["npm run lint"],
      "inject": {
        "as": "system",
        "template": "Linting auto-fix results: {stdout}",
      },
    },
  ],
}
```

### Advanced Examples

#### Toast Notifications for Build Status

````jsonc
{
  "tool": [
    {
      "id": "build-notification",
      "when": {
        "phase": "after",
        "tool": ["write"],
        "toolArgs": { "path": "*.ts" },
      },
      "run": ["npm run build"],
      "toast": {
        "title": "TypeScript Build",
        "message": "Build {exitCode, select, 0 {succeeded ✓} other {failed ✗}}",
        "variant": "{exitCode, select, 0 {success} other {error}}",
        "duration": 3000,
      },
      "inject": {
        "as": "system",
        "template": "Build output:\n```\n{stdout}\n```",
      },
    },
  ],
}
````

#### Filter by Multiple Tool Arguments

```jsonc
{
  "tool": [
    // Run for specific file types
    {
      "id": "test-js-files",
      "when": {
        "tool": "write",
        "toolArgs": {
          "path": ["*.js", "*.jsx", "*.ts", "*.tsx"],
        },
      },
      "run": ["npm test -- --testPathPattern={toolArgs.path}"],
    },
    // Filter by multiple subagent types
    {
      "id": "validate-subagents",
      "when": {
        "tool": "task",
        "toolArgs": {
          "subagent_type": ["validator", "reviewer", "tester"],
        },
      },
      "run": ["echo 'Validating {toolArgs.subagent_type} subagent'"],
    },
  ],
}
```

#### Handle Async Tool Completion

```jsonc
{
  "tool": [
    {
      "id": "task-complete",
      "when": {
        "event": "tool.result",
        "tool": ["task"],
        "toolArgs": { "subagent_type": "code-writer" },
      },
      "run": ["npm run validate-changes"],
      "toast": {
        "title": "Code Writer Complete",
        "message": "Validation: {exitCode, select, 0 {Passed} other {Failed}}",
        "variant": "{exitCode, select, 0 {success} other {warning}}",
      },
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
      "toast": {
        "title": "Session Started",
        "message": "Ready to assist!",
        "variant": "info",
      },
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

| Placeholder  | Description                              | Example                    |
| ------------ | ---------------------------------------- | -------------------------- |
| `{id}`       | Hook ID                                  | `lint-ts`                  |
| `{agent}`    | Calling agent name                       | `orchestrator`             |
| `{tool}`     | Tool name                                | `write`                    |
| `{cmd}`      | Executed command                         | `npm run lint`             |
| `{stdout}`   | Command stdout (truncated to 4000 chars) | `Linting complete`         |
| `{stderr}`   | Command stderr (truncated to 4000 chars) | `Error: missing semicolon` |
| `{exitCode}` | Command exit code                        | `0` or `1`                 |

**Advanced Usage:**

```jsonc
{
  "inject": {
    "template": "Command '{cmd}' exited with code {exitCode}\n\nStdout:\n{stdout}\n\nStderr:\n{stderr}",
  },
}
```

---

## Debugging

Enable detailed debug logging:

```bash
export OPENCODE_HOOKS_DEBUG=1
opencode start
```

This logs:

- Command execution details
- Template interpolation
- Hook matching logic
- Error handling

**Example Debug Output:**

```
[DEBUG] Hook matched: lint-ts
[DEBUG] Executing: npm run lint
[DEBUG] Template interpolated: Exit code: 0
[DEBUG] Toast shown: Lint Complete
```

---

## Event Types

### Tool Events

- **`tool.execute.before`** - Before tool execution
- **`tool.execute.after`** - After tool execution
- **`tool.result`** - When async tools complete (task, firecrawl, etc.)

### Session Events

- **`session.start`** - New session started
- **`session.idle`** - Session became idle
- **`session.end`** - Session ended

---

## Tool vs Session Hooks

### Tool Hooks

- Run before/after specific tool executions
- Can filter by tool name, calling agent, slash command, tool arguments
- Access to tool-specific context (tool name, call ID, args)
- **Best for**: Linting after writes, tests after code changes, validation

### Session Hooks

- Run on session lifecycle events
- Can only filter by agent name (session events lack tool context)
- **Best for**: Bootstrapping, cleanup, periodic checks

---

## Native Plugin vs This Plugin

| Feature                  | Native Plugin                           | This Plugin               |
| ------------------------ | --------------------------------------- | ------------------------- |
| **Setup**                | TypeScript, build steps, error handling | JSON/YAML config          |
| **Error Handling**       | Manual try/catch required               | Automatic, non-blocking   |
| **User Feedback**        | Console logs (UI spam)                  | Toast notifications       |
| **Context Injection**    | Manual SDK calls                        | Automatic                 |
| **Tool Filtering**       | Basic tool name only                    | Tool name + ANY arguments |
| **Guaranteed Execution** | Depends on agent                        | Always runs               |
| **Token Cost**           | Variable                                | Zero tokens               |
| **Debugging**            | Console.log                             | OPENCODE_HOOKS_DEBUG=1    |

---

## Known Limitations

### Session Hooks Cannot Filter by Agent

Session lifecycle events (`session.start`, `session.idle`, `session.end`) don't include the calling agent name. You **cannot** use the `agent` filter field in session hook conditions—it matches all agents.

**Workaround:** Use `tool.execute.after` events instead, which provide agent context.

---

## Development

```bash
bun install
bun run build
```

TODO:

- Implement max-length output using tail
- Add more template functions (date formatting, etc.)
