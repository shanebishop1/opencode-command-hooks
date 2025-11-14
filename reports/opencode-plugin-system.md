---
title: "OpenCode Plugin System and SDK Research"
date: 2025-11-14
sources:
  - https://opencode.ai/docs/plugins/ — OpenCode Documentation — 2025
  - https://opencode.ai/docs/sdk/ — OpenCode Documentation — 2025
  - https://deepwiki.com/sst/opencode/10-sdks-and-plugin-system — DeepWiki — 2025-11-07
  - https://deepwiki.com/sst/opencode/10.2-plugin-system — DeepWiki — 2025-11-07
  - https://github.com/malhashemi/opencode-skills — GitHub — 2025
  - https://bun.sh/docs/runtime/shell — Bun Documentation — 2025
  - https://github.com/sst/opencode — GitHub — 2025
---

# Executive Summary

- **Plugin Architecture**: OpenCode plugins are JavaScript/TypeScript modules that export async functions receiving a context object (`project`, `client`, `$`, `directory`, `worktree`) and return a hooks object. Plugins are loaded from `.opencode/plugin/` (project-local) or `~/.config/opencode/plugin/` (global).

- **Event Hooks**: Plugins can hook into `session.idle`, `session.start`, `session.end` events via an `event` hook. The `tool.execute.before` and `tool.execute.after` hooks intercept tool execution with access to `input` (tool name, arguments) and `output` (execution results).

- **Tool Hooks**: Custom tools are defined using `@opencode-ai/plugin` with Zod schemas for type-safe parameter validation. Tools receive execution context with `sessionID`, `messageID`, `agent`, `abort` signal, and `metadata()` function for streaming updates.

- **SDK Client API**: The `@opencode-ai/sdk` provides type-safe methods for session management (`session.create`, `session.prompt`), file operations (`find.text`, `file.read`), and event subscription. The `noReply: true` pattern injects context without triggering AI responses.

- **Bun Shell Integration**: The `$` template literal from Bun provides cross-platform shell execution with `.text()`, `.json()`, `.lines()` output methods, error handling via `.nothrow()`, and environment/working directory control via `.env()` and `.cwd()`.

- **Example Plugins**: The `opencode-skills` plugin demonstrates auto-discovery of skill files, YAML frontmatter parsing, dynamic tool registration, and the message insertion pattern for delivering skill content via `noReply: true`.

- **Gaps & Uncertainties**: Agent/slash command YAML frontmatter reading at runtime is not explicitly documented; MCP tool calls do not trigger plugin hooks (known issue #2319); plugin hot-reload is not supported; tool context metadata structure varies by tool type.

---

# Key Findings

## 1. Plugin Architecture

### Plugin Structure and Initialization

Plugins are **JavaScript/TypeScript modules** that export one or more async functions. Each function receives a context object and returns a hooks object:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  console.log("Plugin initialized!")
  
  return {
    // Hook implementations go here
  }
}
```

### Plugin Context Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `project` | `Project` | Current project information (name, path, etc.) |
| `client` | `OpencodeClient` | SDK client for interacting with the AI server |
| `$` | `Shell` | Bun's shell API for executing commands |
| `directory` | `string` | Current working directory |
| `worktree` | `string` | Git worktree path |

### Plugin Loading and Registration

**Plugin Locations** (in order of precedence):
1. **Project-local**: `.opencode/plugin/` directory in the project
2. **Global**: `~/.config/opencode/plugin/` directory

Plugins are loaded automatically when OpenCode starts. Plugin files can be:
- TypeScript files (`.ts`)
- JavaScript files (`.js`)
- Exported as named exports or default exports

**Configuration in opencode.json/opencode.jsonc**:

```json
{
  "plugin": [
    "opencode-skills",
    "opencode-skills@1.0.0",
    "./local-plugin.ts"
  ]
}
```

### Plugin Lifecycle

- **Initialization**: Plugin function is called once when OpenCode starts
- **Hook Registration**: Plugin returns an object with hook implementations
- **No Hot Reload**: Adding/modifying plugins requires restarting OpenCode
- **Error Handling**: Invalid plugins are skipped with helpful error messages

---

## 2. Event Hooks

### Available Event Types

Plugins can hook into session lifecycle events via the `event` hook:

```typescript
export const NotificationPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        // Session completed, send notification
        await $`osascript -e 'display notification "Session completed!" with title "opencode"'`
      }
    },
  }
}
```

### Known Event Types

| Event Type | Trigger | Properties |
|------------|---------|-----------|
| `session.idle` | Session completes/becomes idle | `event.properties.sessionID` |
| `session.start` | Session begins | `event.properties.sessionID` |
| `session.end` | Session ends | `event.properties.sessionID` |
| `session.updated` | Session status changes | `event.properties.info.status`, `event.properties.info.cost` |
| `message.part.updated` | Message part is updated | `event.properties.part.type`, `event.properties.part.text` |
| `tool.execute` | Tool is called | `event.properties.name`, `event.properties.input` |
| `tool.result` | Tool returns result | `event.properties.output` |
| `file.edited` | File is modified | `event.properties.file` |

### Event Hook Signature

```typescript
event: async ({ event }) => {
  // event.type: string
  // event.properties: object (varies by event type)
}
```

---

## 3. Tool Hooks

### Tool Execution Hooks

Plugins can intercept tool execution before and after execution:

```typescript
export const EnvProtection = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // input: { tool: string, input: object }
      // output: { args: object, ... }
      
      if (input.tool === "read" && output.args.filePath.includes(".env")) {
        throw new Error("Do not read .env files")
      }
    },
    
    "tool.execute.after": async (input, output) => {
      // Called after tool execution
      // Can access results and modify behavior
    }
  }
}
```

### Hook Parameters

**`tool.execute.before` Input**:
- `input.tool`: Name of the tool being executed (e.g., `"read"`, `"bash"`, `"edit"`)
- `input.input`: Arguments passed to the tool

**`tool.execute.before` Output**:
- `output.args`: Tool arguments (can be modified)
- Tool-specific metadata

**`tool.execute.after` Input/Output**:
- Access to execution results
- Can log, monitor, or validate tool execution

### Custom Tool Definition

Tools are defined using the `@opencode-ai/plugin` package with Zod schemas:

```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "This is a custom tool",
        args: {
          foo: tool.schema.string().describe("A string parameter"),
          count: tool.schema.number().describe("A number parameter"),
        },
        async execute(args, ctx) {
          // ctx.sessionID: string
          // ctx.messageID: string
          // ctx.agent: string (agent name)
          // ctx.abort: AbortSignal
          // ctx.metadata(data): function for streaming updates
          
          return `Hello ${args.foo}!`
        },
      }),
    },
  }
}
```

### Tool Execution Context

| Property | Type | Purpose |
|----------|------|---------|
| `ctx.sessionID` | `string` | Current session identifier |
| `ctx.messageID` | `string` | Current message identifier |
| `ctx.agent` | `string` | Agent configuration name |
| `ctx.abort` | `AbortSignal` | Signal for aborting long operations |
| `ctx.callID` | `string?` | Tool call identifier (optional) |
| `ctx.metadata()` | `function` | Update streaming metadata |

### Streaming Metadata Updates

Tools can publish progress updates during execution:

```typescript
async execute(args, ctx) {
  ctx.metadata({
    status: "processing",
    progress: 25,
    description: "Step 1 of 4"
  })
  
  // ... do work ...
  
  ctx.metadata({
    status: "processing",
    progress: 50,
    description: "Step 2 of 4"
  })
  
  return result
}
```

### Tool Return Values

Tools return structured data:

```typescript
{
  title: "Operation Result",
  metadata: {
    // Tool-specific structured data
    output: "...",
    exit: 0,
    description: "..."
  },
  output: "Text for AI model context"
}
```

---

## 4. SDK Client API

### Client Initialization

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

// Connect to existing server
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})

// Or create server + client together
import { createOpencode } from "@opencode-ai/sdk"
const { client, server } = await createOpencode({
  port: 4096,
  hostname: "127.0.0.1"
})
```

### Session Management

```typescript
// Create session
const session = await client.session.create({
  body: { title: "My session" },
})

// List sessions
const sessions = await client.session.list()

// Get session details
const sessionInfo = await client.session.get({ path: { id: session.id } })

// Send prompt with AI response
const result = await client.session.prompt({
  path: { id: session.id },
  body: {
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    parts: [{ type: "text", text: "Hello!" }],
  },
})

// Inject context without AI response (useful for plugins)
await client.session.prompt({
  path: { id: session.id },
  body: {
    noReply: true,
    parts: [{ type: "text", text: "You are a helpful assistant." }],
  },
})
```

### Message Types

**Text Message**:
```typescript
{ type: "text", text: "Message content" }
```

**File Message**:
```typescript
{
  type: "file",
  url: "file:///absolute/path/to/file.ts",
  filename: "file.ts",
  mime: "text/plain"
}
```

**System Message** (via `noReply: true`):
```typescript
{
  noReply: true,
  parts: [{ type: "text", text: "System instruction" }]
}
```

### File Operations

```typescript
// Search for text in files
const textResults = await client.find.text({
  query: { pattern: "function.*opencode" },
})

// Find files by name
const files = await client.find.files({
  query: { query: "*.ts" },
})

// Read file content
const content = await client.file.read({
  query: { path: "src/index.ts" },
})

// Get file status
const status = await client.file.status()
```

### Event Subscription

```typescript
// Subscribe to real-time events
const events = await client.event.subscribe()
for await (const event of events.stream) {
  console.log("Event:", event.type, event.properties)
  
  switch (event.type) {
    case "session.updated":
      console.log("Status:", event.properties.info.status)
      break
    case "message.part.updated":
      console.log("Text:", event.properties.part.text)
      break
    case "tool.execute":
      console.log("Tool:", event.properties.name)
      break
  }
}
```

### Other APIs

```typescript
// App API
await client.app.log({
  body: {
    service: "my-app",
    level: "info",
    message: "Operation completed",
  },
})
const agents = await client.app.agents()

// Project API
const projects = await client.project.list()
const currentProject = await client.project.current()

// Config API
const config = await client.config.get()
const { providers, default: defaults } = await client.config.providers()

// Path API
const pathInfo = await client.path.get()

// TUI API
await client.tui.appendPrompt({ body: { text: "Add to prompt" } })
await client.tui.showToast({ body: { message: "Done", variant: "success" } })
```

---

## 5. Bun Shell Integration

### Basic Shell Execution

```typescript
import { $ } from "bun"

// Simple command
await $`echo "Hello World!"`

// Capture output as text
const output = await $`echo "Hello World!"`.text()

// Capture output as JSON
const data = await $`echo '{"foo": "bar"}'`.json()

// Capture output line-by-line
for await (let line of $`cat file.txt`.lines()) {
  console.log(line)
}
```

### Error Handling

```typescript
// By default, non-zero exit codes throw
try {
  await $`command-that-fails`
} catch (err) {
  console.log(`Failed with code ${err.exitCode}`)
  console.log(err.stdout.toString())
  console.log(err.stderr.toString())
}

// Disable throwing
const { stdout, stderr, exitCode } = await $`command`.nothrow().quiet()
if (exitCode !== 0) {
  console.log(`Non-zero exit code ${exitCode}`)
}

// Configure globally
$.nothrow()  // Don't throw on non-zero exit
$.throws(true)  // Throw on non-zero exit (default)
```

### Output Capture

```typescript
// Quiet output (no printing)
await $`echo "Hello"`.quiet()

// Get stdout and stderr as Buffers
const { stdout, stderr } = await $`echo "Hello"`.quiet()

// Get as text
const text = await $`echo "Hello"`.text()

// Get as blob
const blob = await $`echo "Hello"`.blob()

// Get as JSON
const json = await $`echo '{"a":1}'`.json()
```

### Redirection

```typescript
// Redirect stdout to file
await $`echo "Hello" > output.txt`

// Redirect stderr to file
await $`command 2> errors.txt`

// Redirect both
await $`command &> all.txt`

// Redirect to JavaScript objects
const buffer = Buffer.alloc(100)
await $`echo "Hello" > ${buffer}`

// Pipe commands
const result = await $`echo "Hello World!" | wc -w`.text()

// Command substitution
await $`echo Hash: $(git rev-parse HEAD)`
```

### Environment and Working Directory

```typescript
// Set environment variable for command
await $`FOO=bar bun -e 'console.log(process.env.FOO)'`

// Set environment variables via .env()
await $`echo $FOO`.env({ ...process.env, FOO: "bar" })

// Set globally
$.env({ FOO: "bar" })

// Change working directory
await $`pwd`.cwd("/tmp")

// Set globally
$.cwd("/tmp")
```

### String Interpolation and Safety

```typescript
// Variables are escaped by default (prevents injection)
const userInput = "file.txt; rm -rf /"
await $`ls ${userInput}`  // Safe: treats as single string

// Use raw strings if needed
await $`echo ${{ raw: '$(foo) `bar`' }}`

// Escape strings manually
console.log($.escape('$(foo) `bar` "baz"'))
```

### Builtin Commands

Bun Shell implements these commands natively (cross-platform):
- `cd`, `ls`, `rm`, `echo`, `pwd`, `cat`, `touch`, `mkdir`, `which`, `mv`, `exit`, `true`, `false`, `yes`, `seq`, `dirname`, `basename`

---

## 6. Example Plugins

### opencode-skills Plugin

The `opencode-skills` plugin demonstrates several key patterns:

**Plugin Structure**:
```typescript
export const SkillsPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  // 1. Discover skills from filesystem
  // 2. Parse YAML frontmatter
  // 3. Register as dynamic tools
  // 4. Use message insertion pattern
  
  return {
    tool: {
      skills_my_skill: {
        description: "...",
        args: { ... },
        execute: async (args, ctx) => {
          // Inject skill content via noReply
          await client.session.prompt({
            path: { id: ctx.sessionID },
            body: {
              noReply: true,
              parts: [{ type: "text", text: skillContent }]
            }
          })
          return "Launching skill: my-skill"
        }
      }
    }
  }
}
```

**Skill File Structure**:
```markdown
---
name: my-skill
description: A custom skill that helps with specific tasks
license: MIT
allowed-tools:
  - read
  - write
metadata:
  version: "1.0"
---

# My Custom Skill

Instructions and content for the skill...
```

**Skill Discovery**:
1. `.opencode/skills/` (project-local, highest priority)
2. `~/.opencode/skills/` (global)
3. `~/.config/opencode/skills/` (XDG config)

**Key Pattern - Message Insertion**:
```typescript
// Use noReply: true to inject context without triggering AI response
await client.session.prompt({
  path: { id: sessionID },
  body: {
    noReply: true,
    parts: [
      { type: "text", text: "Skill loading message" },
      { type: "text", text: skillContent }
    ]
  }
})
```

This pattern ensures skill content persists in conversation history even when OpenCode purges tool responses to manage context.

---

## 7. Agent & Slash Command Metadata

### Agent Configuration

Agents are defined in `AGENTS.md` files with YAML frontmatter:

```markdown
---
name: build
description: Builds and deploys applications
model: anthropic/claude-3-5-sonnet-20241022
tools:
  - bash
  - edit
  - read
permissions:
  bash: ["npm *", "git *"]
---

# Build Agent

Instructions for the build agent...
```

### Reading Agent Configuration at Runtime

**Available in Tool Context**:
```typescript
async execute(args, ctx) {
  const agentName = ctx.agent  // e.g., "build"
  // Agent configuration is available via ctx.agent
}
```

**Via SDK**:
```typescript
const agents = await client.app.agents()
// Returns list of available agents with their configuration
```

### Slash Command Metadata

Slash commands are similar to agents but invoked with `/` prefix. They also use YAML frontmatter:

```markdown
---
name: /format
description: Format code in the project
tools:
  - edit
  - bash
---

# Format Command

Format code using prettier...
```

**Accessing Slash Command Context**:
- Slash commands are invoked as tools
- Context available via `ctx.agent` in tool execution
- Can detect slash command context by checking tool name or agent metadata

---

## 8. Configuration Loading

### opencode.json/opencode.jsonc

```jsonc
{
  // Plugin configuration
  "plugin": [
    "opencode-skills",
    "opencode-skills@1.0.0",
    "./local-plugin.ts"
  ],
  
  // Agent configuration
  "agents": {
    "build": {
      "model": "anthropic/claude-3-5-sonnet-20241022",
      "tools": ["bash", "edit", "read"]
    }
  },
  
  // Provider configuration
  "providers": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

### Plugin Auto-Installation

- Plugins listed in `opencode.json` are automatically downloaded from npm on startup
- Cached in `~/.cache/opencode/node_modules/`
- Version pinning supported: `"opencode-skills@1.0.0"`

---

# Conflicts / Uncertainties

## Known Limitations

1. **MCP Tool Calls Don't Trigger Hooks** (Issue #2319)
   - `tool.execute.before` and `tool.execute.after` hooks are NOT called for MCP (Model Context Protocol) tool invocations
   - Makes it difficult to attach session-level metadata to MCP tool calls
   - Workaround: Use event hooks instead

2. **No Plugin Hot-Reload**
   - Adding or modifying plugins requires restarting OpenCode
   - Acceptable because skills/plugins change infrequently
   - No runtime API for tool registration

3. **Agent/Slash Command Metadata Access**
   - YAML frontmatter reading at runtime is not explicitly documented
   - `ctx.agent` provides agent name but full configuration access is unclear
   - May need to parse AGENTS.md files manually or use SDK `client.app.agents()`

4. **Tool Context Metadata Structure**
   - Different tools return different metadata structures
   - `bash`: `{ output, exit, description }`
   - `edit`: `{ diagnostics, diff }`
   - `webfetch`: `{}`
   - No unified interface documented

5. **Slash Command Context Detection**
   - No explicit way to detect if tool was invoked as slash command vs. normal tool call
   - May need to check tool name prefix or use agent metadata

## Research Gaps

- **Plugin Dependency Management**: How to declare plugin dependencies or load plugins conditionally
- **Plugin Configuration**: How plugins can accept configuration from opencode.json
- **Permission System Integration**: How plugins interact with the permission system for tool restrictions
- **Session Metadata Persistence**: How to store and retrieve custom metadata across session lifecycle
- **Plugin Testing**: Best practices for testing plugins locally before publishing
- **Error Recovery**: How plugins should handle and recover from errors without crashing OpenCode

---

# Recommendations for opencode-command-hooks

## Architecture

1. **Plugin Structure**:
   - Export a single `CommandHooksPlugin` function
   - Use TypeScript for type safety
   - Implement both `tool.execute.before` and `event` hooks

2. **Hook Implementation**:
   - `tool.execute.before`: Detect slash command context, extract metadata
   - `event` hook: Track session lifecycle, manage command state
   - Consider using `noReply: true` for injecting command context

3. **Command Discovery**:
   - Scan `.opencode/commands/` directory for command definitions
   - Parse YAML frontmatter similar to opencode-skills
   - Register as dynamic tools with `commands_*` prefix

4. **Context Injection**:
   - Use message insertion pattern (`noReply: true`) to inject command context
   - Ensure context persists even when OpenCode purges tool responses

5. **Shell Integration**:
   - Use Bun `$` template literals for command execution
   - Implement proper error handling with `.nothrow()`
   - Capture stdout/stderr for command output

## Testing Considerations

- Test plugin loading from `.opencode/plugin/`
- Test hook execution order and data flow
- Test Bun shell command execution with various scenarios
- Test message injection pattern with `noReply: true`
- Test error handling and recovery

---

# References

- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/) — OpenCode — 2025
- [OpenCode SDK Documentation](https://opencode.ai/docs/sdk/) — OpenCode — 2025
- [SDKs and Plugin System](https://deepwiki.com/sst/opencode/10-sdks-and-plugin-system) — DeepWiki — 2025-11-07
- [Plugin System](https://deepwiki.com/sst/opencode/10.2-plugin-system) — DeepWiki — 2025-11-07
- [opencode-skills Plugin](https://github.com/malhashemi/opencode-skills) — GitHub — 2025
- [Bun Shell Documentation](https://bun.sh/docs/runtime/shell) — Bun — 2025
- [OpenCode Repository](https://github.com/sst/opencode) — GitHub — 2025
- [MCP Tool Calls Issue #2319](https://github.com/sst/opencode/issues/2319) — GitHub — 2025
