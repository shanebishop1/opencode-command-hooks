# OpenCode Command Hooks

Declaratively attach hooks to agent, tool, and session lifecycles.

## Why?

### 1. Config vs. Code

Custom OpenCode plugins require lots of TypeScript boilerplate, manual error handling, and build steps.  
This is great for ad-hoc functionality or highly complex tooling, but for simple hooks, it's overkill. This plugin gives you an abstraction to configure global/per-agent shell hook behavior using simple, readable JSON/YAML configs.

See below for a comparison of building your own custom plugin for shell hooks vs. using this plugin.

**Native Plugin:**

Writing this manually is deceptive. You have to handle:

1. **Error Swallowing**: If `npm run lint` fails, it throws an error. If you don't catch it, your agent might crash.
2. **UI Noise**: Using `console.error` to debug often spams the user's UI with raw JSON or stack traces.
3. **Context Injection**: Getting the lint output _back_ to the LLM so it can fix the code requires manually constructing a `session.prompt` call with specific `noReply: true` flags—otherwise, the LLM might get confused or reply to itself.

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
          // If you log this, it might break the UI, or just look ugly
          console.error(e);
          // And the agent still won't know *what* failed unless you inject the shell output back (which requires even more code)
        }
      }
    },
  };
};
```

**This Plugin:**

_This configuration handles execution, captures stdout/stderr, prevents crashes on failure, and injects the result back to the agent in a clean, formatted block automatically._

```jsonc
{
  "tool": [
    {
      "id": "lint-ts",
      "when": { "tool": "write" },
      "run": ["npm run lint"],
    },
  ],
}
```

### 2. Your Agent Actually "Sees" the Output

Setting up a plugin to run commands is easy. Getting the output back to the Agent so it can _react_ to it is harder (requires specific SDK calls).
This plugin handles context injection automatically.

```jsonc
"inject": { "as": "system" } // The agent sees the command output immediately
```

### 3. Reliability

- **Deduplication**: Prevents commands from firing multiple times (a common issue with raw event listeners).
- **Non-Blocking**: If a hook fails, your agent keeps working. Errors are logged gracefully.

---

## Installation

```bash
opencode install opencode-command-hooks
```

## Configuration

Create a `.opencode/command-hooks.jsonc` file in your project root.

### Examples

#### 1. Auto-Verify Subagent Work

When a subagent finishes a task (via the `task` tool), automatically run the project's test suite. If the tests fail, the main agent sees the error immediately and can ask the subagent to fix it.

````jsonc
{
  "tool": [
    {
      "id": "verify-subagent-work",
      "when": {
        "phase": "after",
        "tool": ["task"], // This is the tool that OpenCode uses to spin up subagents
        "callingAgent": ["*"],
      },
      "run": ["npm test"],
      "inject": {
        "as": "user", // Inject as 'user' to simulate user feedback
        "template": "Test Runner:\nExit Code: {exitCode}\n\nOutput:\n```\n{stdout}\n```\n\nIf tests failed, please fix them before proceeding.",
      },
    },
  ],
}
````

#### 2. Enforce Linting on File Edits

Prevent broken code from accumulating by running a linter every time a file is written.

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

---

#### 3. The "Orchestrator" Pattern (Save Money & Reduce Errors)

**Scenario**: You have an Orchestrator Agent that spins up Subagents to write code. You want to ensure every Subagent's work is valid before accepting it.

**The Problem with Prompts**:
If you just instruct the Subagent to _"run tests before finishing"_, three things go wrong:

1.  **Reliability**: The Subagent might forget, hallucinate that it ran them, or crash before it gets to that step.
2.  **Cost**: You pay for the input tokens to instruct it, and the output tokens for it to decide to call the test tool.
3.  **Orchestrator Overhead**: If the Orchestrator has to manually run the tests after the Subagent returns, that's another expensive tool call loop.

**The Hook Solution**:
Attach a hook to the `task` tool (which launches subagents). It runs _automatically_ when the subagent finishes. It costs **0 tokens** to trigger, is **guaranteed** to run, and the Orchestrator gets the results immediately.

````jsonc
{
  "tool": [
    {
      "id": "validate-subagent",
      "when": {
        "phase": "after",
        "tool": ["task"], // Fires when the subagent finishes
      },
      "run": ["npm test"],
      "inject": {
        "as": "user",
        "template": "AUTOMATED VALIDATION:\n\nYour subagent has finished. We ran the tests to verify their work:\n\nExit Code: {exitCode}\nOutput:\n```\n{stdout}\n```\n\nIf this failed, REJECT the subagent's work and ask them to fix it.",
      },
    },
  ],
}
````

---

## Development

_Instructions for building this plugin._

```bash
bun install
bun run build
```

TODO:
Implement max-length output using tail
