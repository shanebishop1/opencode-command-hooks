# 🪝OpenCode Command Hooks

Attach shell commands to agent, tool, and session lifecycles using JSON/YAML configuration. Execute commands automatically without consuming tokens or requiring agent interaction.

**Quick Win:** Make your engineer subagent self-validating with 15 lines of config (no TypeScript, no rebuilds, zero tokens):

````jsonc
{
  "tool": [
    {
      "id": "auto-validate",
      "when": {
        "phase": "after",
        "tool": "task",
        "toolArgs": { "subagent_type": "engineer" },
      },
      "run": ["npm run typecheck", "npm test"],
      "inject": "✅ Validation: {exitCode, select, 0 {Passed} other {Failed - fix errors below}}\n```\n{stdout}\n```",
    },
  ],
}
````

Every time the engineer finishes, tests run automatically and results flow back to the orchestrator. Failed validations trigger self-healing—no manual intervention, no token costs.

---

## Simplified Agent Markdown Hooks

Define hooks directly in your agent's markdown file for maximum simplicity. No need for global configs, `id` fields, `when` clauses, or `tool` specifications—everything is auto-configured when you use subagents via the `task` tool.

### Quick Example

```yaml
---
description: My agent
mode: subagent
hooks:
  before:
    - run: "echo 'Starting...'"
  after:
    - run: ["npm run typecheck", "npm run lint"]
      inject: "Results:\n{stdout}"
    - run: "npm test"
      toast:
        message: "Tests {exitCode, select, 0 {passed} other {failed}}"
---
# Your agent markdown content here
```

### How It Works

1. **Automatic Targeting**: Hooks defined in agent markdown automatically apply when that subagent is invoked via the `task` tool
2. **Simplified Syntax**: No `id`, `when`, or `tool` fields needed—everything is inferred from context
3. **Before/After Hooks**: Use `before` hooks for setup/preparation and `after` hooks for validation/cleanup
4. **Dual Location Support**: Works with both:
   - `.opencode/agent/*.md` (project-level agents)
   - `~/.config/opencode/agent/*.md` (user-level agents)

### Simplified vs Global Config Format

**Global Config (verbose):**

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
      "run": ["npm run typecheck", "npm test"],
      "inject": "Validation: {exitCode, select, 0 {✓ Passed} other {✗ Failed}}",
      "toast": {
        "title": "Validation Complete",
        "message": "{exitCode, select, 0 {✓ Passed} other {✗ Failed}}",
      },
    },
  ],
}
```

**Agent Markdown (simplified):**

```yaml
hooks:
  after:
    - run: ["npm run typecheck", "npm test"]
      inject: "Validation: {exitCode, select, 0 {✓ Passed} other {✗ Failed}}"
      toast:
        message: "{exitCode, select, 0 {✓ Passed} other {✗ Failed}}"
```

**Reduction: 60% less boilerplate!**

### Hook Configuration Options

| Option   | Type                   | Required | Description                                         |
| -------- | ---------------------- | -------- | --------------------------------------------------- |
| `run`    | `string` \| `string[]` | ✅ Yes   | Command(s) to execute                               |
| `inject` | `string`               | ❌ No    | Message to inject into session (supports templates) |
| `toast`  | `object`               | ❌ No    | Toast notification configuration                    |

### Toast Configuration

```yaml
toast:
  message: "Build {exitCode, select, 0 {succeeded} other {failed}}"
  variant: "{exitCode, select, 0 {success} other {error}}" # info, success, warning, error
  duration: 5000 # milliseconds (optional)
```

### Template Variables

Agent markdown hooks support the same template variables as global config:

- `{stdout}` - Command stdout (truncated to 4000 chars)
- `{stderr}` - Command stderr (truncated to 4000 chars)
- `{exitCode}` - Command exit code
- `{cmd}` - Executed command

### Complete Example

````yaml
---
description: Engineer Agent
mode: subagent
hooks:
  before:
    - run: "echo '🚀 Engineer agent starting...'"
  after:
    - run: ["npm run typecheck", "npm run lint"]
      inject: |
        ## Validation Results

        **TypeCheck:** {exitCode, select, 0 {✓ Passed} other {✗ Failed}}

        ```
        {stdout}
        ```

        {exitCode, select, 0 {} other {⚠️ Please fix validation errors before proceeding.}}
      toast:
        message: "TypeCheck & Lint: {exitCode, select, 0 {✓ Passed} other {✗ Failed}}"
        variant: "{exitCode, select, 0 {success} other {error}}"
    - run: "npm test -- --coverage --passWithNoTests"
      inject: "Test Coverage: {stdout}%"
      toast:
        message: "Tests {exitCode, select, 0 {✓ Passed} other {✗ Failed}}"
        variant: "{exitCode, select, 0 {success} other {error}}"
---
# Engineer Agent
Focus on implementing features with tests and proper error handling.
````

---

## Why?

**The Problem:** You want your engineer/validator subagents to automatically run tests/linters and self-heal when validation fails—but asking agents to run validation costs tokens, isn't guaranteed, and requires complex native plugin code with manual error handling.

**The Solution:** This plugin lets you attach validation commands to subagent completions via simple config. Results automatically inject back to the orchestrator, enabling autonomous quality gates with zero tokens spent.

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

### 🚀 Power User Example: Autonomous Quality Gates

This example demonstrates the plugin's killer feature: **automatic validation injection after subagent work**. Unlike native plugins that require complex TypeScript and manual result handling, this achieves enterprise-grade quality gates with pure configuration.

````jsonc
{
  "tool": [
    {
      "id": "validate-engineer-work",
      "when": {
        "phase": "after",
        "tool": "task",
        "toolArgs": { "subagent_type": ["engineer", "debugger"] },
      },
      "run": [
        "npm run typecheck",
        "npm run lint",
        "npm test -- --coverage --passWithNoTests",
      ],
      "inject": "🔍 Validation Results:\n\n**TypeCheck:** {exitCode, select, 0 {✓ Passed} other {✗ Failed}}\n\n```\n{stdout}\n```\n\n{exitCode, select, 0 {} other {⚠️ The code you just wrote has validation errors. Please fix them before proceeding.}}",
      "toast": {
        "title": "Code Validation",
        "message": "{exitCode, select, 0 {All checks passed ✓} other {Validation failed - check errors}}",
        "variant": "{exitCode, select, 0 {success} other {error}}",
        "duration": 5000,
      },
    },
    {
      "id": "verify-test-coverage",
      "when": {
        "phase": "after",
        "tool": "task",
        "toolArgs": { "subagent_type": "engineer" },
      },
      "run": [
        "npm test -- --coverage --json > coverage.json && node -p 'JSON.parse(require(\"fs\").readFileSync(\"coverage.json\")).coverageMap.total.lines.pct'",
      ],
      "inject": "📊 Test Coverage: {stdout}%\n\n{stdout, select, ^[89]\\d|100$ {} other {⚠️ Coverage is below 80%. Please add more tests.}}",
    },
  ],
}
````

**What makes this powerful:**

1. **Zero-Token Enforcement** - Quality gates run automatically after engineer/debugger subagents without consuming tokens to prompt validation
2. **Intelligent Filtering** - Uses `toolArgs.subagent_type` to target specific subagents (impossible with native plugins without SDK access)
3. **Context Injection** - Validation results automatically flow back to the orchestrator/agent, enabling self-healing workflows
4. **Non-Blocking** - Failed validations don't crash the session; the agent sees errors and can fix them
5. **Dual Feedback** - Users get instant toast notifications while agents receive detailed error context
6. **Sequential Commands** - Multiple validation steps run in order, even if earlier ones fail
7. **Template Power** - Conditional messages using ICU MessageFormat syntax (`{exitCode, select, ...}`)

**Real-world impact:** A single hook configuration replaces 50+ lines of TypeScript plugin code with error handling, session.prompt calls, and manual filtering logic. The agent becomes self-validating without you spending a single token to ask it to run tests.

---

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
      "inject": "Test Runner:\nExit Code: {exitCode}\n\nOutput:\n```\n{stdout}\n```\n\nIf tests failed, please fix them before proceeding.",
    },
  ],
}
````

#### Multi-Stage Validation Pipeline

````jsonc
{
  "tool": [
    {
      "id": "validator-security-scan",
      "when": {
        "phase": "after",
        "tool": "task",
        "toolArgs": { "subagent_type": "validator" },
      },
      "run": [
        "npm audit --audit-level=moderate",
        "git diff --name-only | xargs grep -l 'API_KEY\\|SECRET\\|PASSWORD' || true",
      ],
      "inject": "🔒 Security Scan:\n\n**Audit:** {exitCode, select, 0 {No vulnerabilities} other {⚠️ Vulnerabilities found}}\n\n```\n{stdout}\n```\n\nPlease address security issues before deployment.",
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
      "run": ["npm run lint -- --fix"],
      "inject": "Linting auto-fix results: {stdout}",
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

**The Real Difference:** The Power User Example above would require this native plugin implementation:

**Native Plugin: 73 lines of TypeScript with manual everything**

```typescript
import type { Plugin } from "@opencode-ai/plugin";

export const ValidationPlugin: Plugin = async ({ $, client }) => {
  return {
    "tool.execute.after": async (input) => {
      if (input.tool !== "task") return;

      // No way to filter by toolArgs.subagent_type without complex parsing

      try {
        const results: string[] = [];

        try {
          const typecheck = await $`npm run typecheck`.text();
          results.push(`TypeCheck: ${typecheck}`);
        } catch (e: any) {
          results.push(`TypeCheck failed: ${e.stderr || e.message}`);
        }

        try {
          const lint = await $`npm run lint`.text();
          results.push(`Lint: ${lint}`);
        } catch (e: any) {
          results.push(`Lint failed: ${e.stderr || e.message}`);
        }

        try {
          const test = await $`npm test -- --coverage --passWithNoTests`.text();
          results.push(`Tests: ${test}`);
        } catch (e: any) {
          results.push(`Tests failed: ${e.stderr || e.message}`);
        }

        const output = results.join("\n\n");
        const exitCode = results.some((r) => r.includes("failed")) ? 1 : 0;
        const message = `🔍 Validation Results:\n\n${output}\n\n${
          exitCode !== 0
            ? "⚠️ The code you just wrote has validation errors. Please fix them before proceeding."
            : ""
        }`;

        await client.session.prompt({
          sessionID: input.sessionID,
          message,
        });

        console.log(
          exitCode === 0 ? "✓ All checks passed" : "✗ Validation failed",
        );
      } catch (e) {
        console.error("Validation hook failed:", e);
      }
    },
  };
};
```

Problems: Can't filter by subagent_type, manual error handling for each command, manual template building, manual session.prompt calls, no toast notifications, must rebuild after changes.

**This Plugin: 15 lines of JSON**

````jsonc
{
  "id": "validate-engineer-work",
  "when": {
    "phase": "after",
    "tool": "task",
    "toolArgs": { "subagent_type": ["engineer", "debugger"] },
  },
  "run": [
    "npm run typecheck",
    "npm run lint",
    "npm test -- --coverage --passWithNoTests",
  ],
  "inject": "🔍 Validation Results:\n\n**TypeCheck:** {exitCode, select, 0 {✓ Passed} other {✗ Failed}}\n\n```\n{stdout}\n```\n\n{exitCode, select, 0 {} other {⚠️ Please fix validation errors.}}",
  "toast": {
    "title": "Code Validation",
    "message": "{exitCode, select, 0 {All checks passed ✓} other {Validation failed}}",
    "variant": "{exitCode, select, 0 {success} other {error}}",
  },
}
````

---

### Feature Comparison

| Feature                  | Native Plugin                           | This Plugin                  |
| ------------------------ | --------------------------------------- | ---------------------------- |
| **Setup**                | TypeScript, build steps, error handling | JSON/YAML config             |
| **Error Handling**       | Manual try/catch required               | Automatic, non-blocking      |
| **User Feedback**        | Console logs (UI spam)                  | Toast notifications          |
| **Context Injection**    | Manual SDK calls                        | Automatic                    |
| **Tool Filtering**       | Basic tool name only                    | Tool name + ANY arguments    |
| **Subagent Targeting**   | Complex parsing required                | Native `toolArgs` filter     |
| **Guaranteed Execution** | Depends on agent                        | Always runs                  |
| **Token Cost**           | Variable                                | Zero tokens                  |
| **Hot Reload**           | Requires rebuild                        | Edit config, works instantly |
| **Debugging**            | Console.log                             | OPENCODE_HOOKS_DEBUG=1       |

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
