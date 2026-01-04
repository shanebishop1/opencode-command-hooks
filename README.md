# 🪝 OpenCode Command Hooks 🪝

Use simple configs to declaratively define shell command hooks on tool/subagent invocations. With a single line of config, you can inject a hook's output directly into context for your agent to read.

## Markdown Frontmatter Hooks

Define hooks in just a couple lines of markdown frontmatter. Putting them here is also really nice because you can see your entire agent's config in one place.

```yaml
---
description: Analyzes the codebase and implements code changes.
mode: subagent
hooks:
  after:
    - run: "npm test"
      inject: "Test Output:\n{stdout}\n{stderr}"
---
```
**This plugin was not built by the OpenCode team nor is it affiliated with them.**

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Examples](#examples)
- [Template Placeholders](#template-placeholders)

### How It Works

1. **Runs automatically** on the configured event
2. **Executes shell commands** (sequentially, if you pass an array)
3. **Captures output** (truncated to configured limit, default 30,000 characters)
4. **Optionally reports results** via `inject` (to the session) and/or `toast` (to the UI).

## Why?

When working with a fleet of subagents, automatic validation of the state of your codebase is really useful. By setting up quality gates (lint/typecheck/test/etc.) or other automation, you can catch and prevent errors quickly and reliably.

Doing this by asking your orchestrator agent to use the bash tool (or call a validator subagent) is non-deterministic and can cost a lot of tokens over time. You could always write your own custom plugin to achieve this automatic validation behavior, but I found myself writing the same boilerplate, error handling, output capture, and session injection logic over and over again.

Though this plugin is mostly a wrapper around accessing hooks that OpenCode already exposes, it provides basic plumbing that reduces overhead, giving you a simple, opinionated system for integrating command hooks into your OpenCode workflow. I also just like having hooks/config for my agents all colocated in one place (markdown files) and thought that maybe somebody else would like this too.

---

### JSON Config

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

### Markdown Frontmatter Config

```yaml
hooks:
  after:
    - run: ["npm run lint", "npm run typecheck", "npm test"]
      inject: "Validation Results (exit {exitCode}): \n`{stdout}`\n`{stderr}`"
      toast:
        message: "Validation Complete"
```

### Hook Configuration Options

| Option   | Type                   | Description                       |
| -------- | ---------------------- | --------------------------------- |
| `run`    | `string` \| `string[]` | Command(s) to execute             |
| `inject` | `string`               | Message injected into the session |
| `toast`  | `object`               | Toast notification configuration  |

### Toast Configuration

```yaml
toast:
  title: "Build" # optional
  message: "exit {exitCode}"
  variant: "info" # optional- one of: info, success, warning, error
  duration: 5000 # optional (milliseconds)
```

### Inject String Template Variables

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
    "toolArgs": { "url": "http://localhost:3000]" },
  },
  "run": ["osascript -e 'display notification \"Agent triggered playwright\"'"],
  "toast": {
    "message": "Agent used the playwright {tool} tool",
  },
}
```

## Features

- Tool hooks (`before`/`after`) and session hooks (`start`/`idle`) via simple JSON/YAML frontmatter config
  - Hooks are **non-blocking**: failures don’t crash the session/tool.
  - Commands run **sequentially**, even if earlier ones fail.
- Inject bash output into context with `inject` and notify user with `toast`
  - `inject`/`toast` interpolate using the **last command’s** output if `run` is an array.
- Match by tool name and (optionally) arguments
- Optional session injection and toast notifications
- Automatic output truncation (30,000 by default)

---

## Installation

Add to your `opencode.json`:

```jsonc
{
  "plugin": ["opencode-command-hooks"],
}
```

---

## Configuration

### JSON Config

Create `.opencode/command-hooks.jsonc` in your project (the plugin searches upward from the current working directory):

```jsonc
{
  "truncationLimit": 30000,
  "tool": [
    // Tool hooks
  ],
  "session": [
    // Session hooks
  ],
}
```

#### JSON Config Options

| Option            | Type            | Description                                                                                                                        |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `truncationLimit` | `number`        | Maximum characters to capture from command output. Defaults to 30,000 (matching OpenCode's bash tool). Must be a positive integer. |
| `tool`            | `ToolHook[]`    | Array of tool execution hooks                                                                                                      |
| `session`         | `SessionHook[]` | Array of session lifecycle hooks                                                                                                   |

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

1. Hooks are loaded from `.opencode/command-hooks.jsonc`
2. Markdown hooks are converted to normal hooks with auto-generated IDs
3. If a markdown hook and a global hook share the same `id`, the markdown hook wins
4. Duplicate IDs within the same source are errors
5. Global config is cached to avoid repeated file reads

---

## Examples

### Automatically run typecheck, lint, and test (after `task`)

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

### Run Tests After Any `task` (subagent creation toolcall)

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

### Enforce Linting After a Specific `write`

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

### Toast Notifications for Build Status

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

### Session Lifecycle Hooks

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

All inject/toast string templates support these placeholders:

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

## Why Use This Plugin?

**It lets you easily set up bash hooks with ~3-5 lines of YAML which are cleanly colocated with your subagent configuration.**
Conversely, rolling your own looks something like this (for each project and set of hooks you want to set up):

```ts
import type { Plugin } from "@opencode-ai/plugin";

export const MyHooks: Plugin = async ({ $, client }) => {
  const argsCache = new Map();

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "task") {
        argsCache.set(input.callID, output.args);
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!output && input.tool === "task") return;

      const args = argsCache.get(input.callID);
      argsCache.delete(input.callID);

      // Filter by tool and subagent type
      if (input.tool !== "task") return;
      if (!["engineer", "debugger"].includes(args?.subagent_type)) return;

      try {
        // Run commands sequentially, even if they fail
        let lastResult = { exitCode: 0, stdout: "", stderr: "" };

        for (const cmd of ["npm run typecheck", "npm run lint"]) {
          try {
            const result = await $`sh -c ${cmd}`.nothrow().quiet();
            const stdout = result.stdout?.toString() || "";
            const stderr = result.stderr?.toString() || "";

            // Truncate to 30k chars to match OpenCode's bash tool
            lastResult = {
              exitCode: result.exitCode ?? 0,
              stdout:
                stdout.length > 30000
                  ? stdout.slice(0, 30000) +
                    "\n[Output truncated: exceeded 30000 character limit]"
                  : stdout,
              stderr:
                stderr.length > 30000
                  ? stderr.slice(0, 30000) +
                    "\n[Output truncated: exceeded 30000 character limit]"
                  : stderr,
            };
          } catch (err) {
            lastResult = { exitCode: 1, stdout: "", stderr: String(err) };
          }
        }

        // Inject results into session (noReply prevents LLM response)
        const message = `Validation (exit ${lastResult.exitCode})\n\n${lastResult.stdout}\n${lastResult.stderr}`;
        await client.session.promptAsync({
          path: { id: input.sessionID },
          body: {
            noReply: true,
            parts: [{ type: "text", text: message }],
          },
        });

        // Show toast notification
        await client.tui.showToast({
          body: {
            title: "Validation",
            message: `exit ${lastResult.exitCode}`,
            variant: "info",
          },
        });
      } catch (err) {
        console.error("Hook failed:", err);
      }
    },
  };
};
```
