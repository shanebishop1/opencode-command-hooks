# opencode-command-hooks

An OpenCode plugin that allows users to declaratively attach shell commands to agent/tool/slash-command lifecycle events.

## Overview

This plugin enables users to define hooks via:
- Global configuration in `opencode.json` / `.opencode.jsonc`
- Per-agent YAML frontmatter in agent markdown
- Per-slash-command YAML frontmatter in command markdown

Hooks run before/after tool calls and other events, with results injected into the relevant OpenCode session without blocking normal operation.

## Project Structure

```
src/
  config/
    global.ts       # Global config parser implementation
  types/
    hooks.ts        # TypeScript type definitions for hook configuration
  index.ts          # Main plugin entry point
tests/              # Test files
package.json        # Package configuration
tsconfig.json       # TypeScript configuration
.gitignore          # Git ignore rules
```

## Development

### Setup

```bash
bun install
```

### Build

```bash
bun run build
```

### Type Check

```bash
bun run typecheck
```

### Watch Mode

```bash
bun run dev
```

## Configuration

### Global Configuration (opencode.json)

```jsonc
{
  "command_hooks": {
    "tool": [
      {
        "id": "tests-after-task",
        "when": {
          "phase": "after",
          "tool": ["task"],
          "callingAgent": ["*"]
        },
        "run": ["pnpm test --runInBand"],
        "inject": {
          "target": "callingSession",
          "as": "user",
          "template": "Tests after {tool}: exit {exitCode}\n```sh\n{stdout}\n```"
        }
      }
    ],
    "session": [
      {
        "id": "bootstrap",
        "when": {
          "event": "session.start",
          "agent": ["*"]
        },
        "run": ["git status --short"],
        "inject": {
          "as": "system",
          "template": "Repo status:\n```sh\n{stdout}\n```"
        }
      }
    ]
  }
}
```

### Per-Agent Configuration

Add `command_hooks` to agent markdown frontmatter:

```markdown
---
name: build
description: Build agent
tools:
  - bash
  - task

command_hooks:
  tool:
    - id: tests-after-task
      when:
        phase: after
        tool: ["task"]
      run:
        - pnpm test --runInBand
      inject:
        as: user
        template: "Tests completed: exit {exitCode}"
---

# Build Agent

Instructions...
```

## Features (Planned)

- [x] Project structure initialization
- [x] Configuration loading from opencode.json
- [ ] Configuration loading from markdown frontmatter
- [ ] Tool hook execution (before/after)
- [ ] Session hook execution
- [ ] Hook result injection into sessions
- [x] Error handling and reporting
- [x] Deduplication of repeated events
- [x] Debug logging support

## License

MIT
