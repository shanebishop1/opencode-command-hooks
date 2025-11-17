/**
 * Type definitions for command hooks configuration
 * Supports tool hooks and session hooks with flexible matching and injection
 *
 * Hooks allow users to declaratively attach shell commands to agent/tool/slash-command
 * lifecycle events. They can be defined in:
 * - Global config in opencode.json/.opencode.jsonc
 * - Per-agent YAML frontmatter in agent markdown
 * - Per-slash-command YAML frontmatter in command markdown
 */

// ============================================================================
// TOOL HOOKS
// ============================================================================

/**
 * Tool hook configuration
 *
 * Runs shell command(s) before or after a tool execution. Hooks can be filtered
 * by tool name, calling agent, and slash command context. Results can optionally
 * be injected into the session as messages.
 *
 * @example
 * ```json
 * {
 *   "id": "global-tests-after-task",
 *   "when": {
 *     "phase": "after",
 *     "tool": ["task"],
 *     "callingAgent": ["*"]
 *   },
 *   "run": ["pnpm test --runInBand"],
 *   "inject": {
 *     "target": "callingSession",
 *     "as": "user",
 *     "template": "Tests after {tool}: exit {exitCode}\n```sh\n{stdout}\n```"
 *   }
 * }
 * ```
 */
export interface ToolHook {
  /**
   * Unique identifier for this hook within its scope (global or per-entity).
   * Used for deduplication and error reporting.
   * Must be unique within the same config source (global or markdown file).
   */
  id: string

  /**
   * Matching conditions that determine when this hook should run.
   * All specified conditions must match for the hook to execute.
   */
  when: ToolHookWhen

  /**
   * Shell command(s) to execute when this hook matches.
   * - Single string: executed as-is
   * - Array of strings: executed sequentially, even if earlier commands fail
   *
   * Commands are executed via Bun's shell API ($) with proper error handling.
   * Non-zero exit codes do not block subsequent commands or normal tool execution.
   */
  run: string | string[]

  /**
   * Optional configuration for injecting hook results into the session.
   * If omitted, the hook still runs but output is only logged.
   */
  inject?: HookInjection

  /**
   * Optional message to log directly to OpenCode's console via console.log().
   * Supports template placeholder substitution like the inject template.
   * If omitted, no console.log is performed.
   */
  consoleLog?: string
}

/**
 * Matching conditions for tool hooks
 *
 * Determines when a tool hook should execute. All specified conditions must match.
 * Omitted fields default to matching all values (wildcard behavior).
 */
export interface ToolHookWhen {
  /**
   * Execution phase: "before" or "after" tool execution.
   * - "before": runs before the tool is invoked
   * - "after": runs after the tool completes (regardless of success/failure)
   */
  phase: "before" | "after"

  /**
   * Tool name(s) to match.
   * - Omitted or "*": matches all tools
   * - Array of strings: matches if tool name is in the array
   * - Single string: matches if tool name equals the string
   *
   * Examples: "task", ["bash", "write"], "*"
   */
  tool?: string | string[]

  /**
   * Calling agent name(s) to match.
   * - Omitted: defaults to "*" in global config, "this agent" in markdown
   * - "*": matches any agent
   * - Array of strings: matches if agent name is in the array
   * - Single string: matches if agent name equals the string
   *
   * When defined in agent markdown, omitting this field means the hook
   * applies only to that agent (implicit scoping).
   */
  callingAgent?: string | string[]

  /**
   * Slash command name(s) to match (optional).
   * Only applies when the tool invocation is associated with a slash command.
   * - Omitted: matches tool calls regardless of slash command context
   * - "*": matches any slash command
   * - Array of strings: matches if slash command name is in the array
   * - Single string: matches if slash command name equals the string
   *
   * Note: Slash command detection may not be available for all tool types.
   */
  slashCommand?: string | string[]
}

// ============================================================================
// SESSION HOOKS
// ============================================================================

/**
 * Session hook configuration
 *
 * Runs shell command(s) on session lifecycle events (start, idle, end).
 * Can be filtered by agent name. Results can optionally be injected into
 * the session as messages.
 *
 * @example
 * ```json
 * {
 *   "id": "global-bootstrap",
 *   "when": {
 *     "event": "session.start",
 *     "agent": ["build", "validator", "*"]
 *   },
 *   "run": ["git status --short"],
 *   "inject": {
 *     "as": "system",
 *     "template": "Repo status for {agent}:\n```sh\n{stdout}\n```"
 *   }
 * }
 * ```
 */
export interface SessionHook {
  /**
   * Unique identifier for this hook within its scope (global or per-entity).
   * Used for deduplication and error reporting.
   * Must be unique within the same config source (global or markdown file).
   */
  id: string

  /**
   * Matching conditions that determine when this hook should run.
   * All specified conditions must match for the hook to execute.
   */
  when: SessionHookWhen

  /**
   * Shell command(s) to execute when this hook matches.
   * - Single string: executed as-is
   * - Array of strings: executed sequentially, even if earlier commands fail
   *
   * Commands are executed via Bun's shell API ($) with proper error handling.
   * Non-zero exit codes do not block subsequent commands or normal session flow.
   */
  run: string | string[]

  /**
   * Optional configuration for injecting hook results into the session.
   * If omitted, the hook still runs but output is only logged.
   */
  inject?: HookInjection

  /**
   * Optional message to log directly to OpenCode's console via console.log().
   * Supports template placeholder substitution like the inject template.
   * If omitted, no console.log is performed.
   */
  consoleLog?: string
}

/**
 * Matching conditions for session hooks
 *
 * Determines when a session hook should execute. All specified conditions must match.
 * Omitted fields default to matching all values (wildcard behavior).
 */
export interface SessionHookWhen {
  /**
   * Session lifecycle event type.
   * - "session.start": fires when session is ready to receive pre-context
   * - "session.idle": fires after agent turn completes (for after-turn hooks)
   * - "session.end": fires when session ends
   */
  event: "session.start" | "session.idle" | "session.end"

  /**
   * Agent name(s) to match.
   * - Omitted: defaults to "*" in global config, "this agent" in markdown
   * - "*": matches any agent
   * - Array of strings: matches if agent name is in the array
   * - Single string: matches if agent name equals the string
   *
   * When defined in agent markdown, omitting this field means the hook
   * applies only to that agent (implicit scoping).
   */
  agent?: string | string[]
}

// ============================================================================
// MESSAGE INJECTION
// ============================================================================

/**
 * Configuration for injecting hook execution results into a session
 *
 * When a hook executes, its output can be injected as a message into the
 * session. The message is formatted using a template with placeholder substitution.
 *
 * @example
 * ```json
 * {
 *   "target": "callingSession",
 *   "as": "user",
 *   "template": "Hook {id} completed:\nexit {exitCode}\n```\n{stdout}\n```"
 * }
 * ```
 */
export interface HookInjection {
  /**
   * Target for message injection.
   * - "callingSession" (default): inject into the current session
   *
   * Future expansion may support:
   * - "subagentSession": inject into a subagent's session (when available)
   * - "parentSession": inject into the parent session
   */
  target?: "callingSession"

  /**
   * Message role/type for injection.
   * - "system": injected as system-level message (context for AI)
   * - "user": injected as user message (visible in conversation)
   * - "note": injected as non-disruptive note (internal metadata)
   *
   * Default: "system"
   */
  as?: "system" | "user" | "note"

  /**
   * Template string for formatting the injected message.
   * Supports placeholder substitution with the following variables:
   *
   * - {id}: hook ID
   * - {agent}: agent name (if available)
   * - {tool}: tool name (for tool hooks)
   * - {cmd}: command string that was executed
   * - {stdout}: captured standard output (truncated to limit)
   * - {stderr}: captured standard error (truncated to limit)
   * - {exitCode}: command exit code (integer)
   *
   * Placeholders for unavailable values are replaced with empty string.
   * Multi-line templates are supported.
   *
   * @example
   * ```
   * "Hook {id} for {tool} completed with exit code {exitCode}\n```\n{stdout}\n```"
   * ```
   */
  template?: string
}

// ============================================================================
// TOP-LEVEL CONFIGURATION
// ============================================================================

/**
 * Top-level command hooks configuration
 *
 * This is the root configuration object that appears in opencode.json/.opencode.jsonc
 * under the "command_hooks" key, or in YAML frontmatter of agent/slash-command markdown.
 *
 * @example
 * In opencode.json:
 * ```json
 * {
 *   "command_hooks": {
 *     "tool": [...],
 *     "session": [...]
 *   }
 * }
 * ```
 *
 * In agent markdown frontmatter:
 * ```yaml
 * ---
 * command_hooks:
 *   tool: [...]
 *   session: [...]
 * ---
 * ```
 */
export interface CommandHooksConfig {
  /**
   * Array of tool execution hooks.
   * Hooks run before or after tool calls based on matching conditions.
   * Optional; omit if no tool hooks are needed.
   */
  tool?: ToolHook[]

  /**
   * Array of session lifecycle hooks.
   * Hooks run on session events (start, idle, end) based on matching conditions.
   * Optional; omit if no session hooks are needed.
   */
  session?: SessionHook[]
}

// ============================================================================
// RUNTIME EXECUTION TRACKING
// ============================================================================

/**
 * Result of executing a single hook command
 *
 * Captures the outcome of running a hook's shell command(s), including
 * output, exit code, and any errors that occurred.
 */
export interface HookExecutionResult {
  /**
   * ID of the hook that was executed
   */
  hookId: string

  /**
   * Whether the hook executed successfully (exit code 0)
   */
  success: boolean

  /**
   * Exit code from the last command in the hook's run array
   * - 0: success
   * - non-zero: command failed
   * - undefined: command did not execute (e.g., binary not found)
   */
  exitCode?: number

  /**
   * Captured standard output from the command(s).
   * Truncated to the configured limit (default 4096 chars).
   * May be empty if command produced no output.
   */
  stdout?: string

  /**
   * Captured standard error from the command(s).
   * Truncated to the configured limit (default 4096 chars).
   * May be empty if command produced no error output.
   */
  stderr?: string

  /**
   * Error message if the hook failed to execute.
   * Examples:
   * - "Command not found: pnpm"
   * - "Timeout executing hook"
   * - "Failed to inject message into session"
   */
  error?: string
}

// ============================================================================
// TEMPLATE SUBSTITUTION CONTEXT
// ============================================================================

/**
 * Context object for template placeholder substitution
 *
 * When injecting hook results into a session, the template string is processed
 * with placeholder substitution using values from this context. All fields are
 * optional as not all contexts have all values available.
 *
 * @example
 * ```typescript
 * const context: TemplateContext = {
 *   id: "tests-after-task",
 *   agent: "build",
 *   tool: "task",
 *   cmd: "pnpm test --runInBand",
 *   stdout: "✓ All tests passed",
 *   stderr: "",
 *   exitCode: 0
 * }
 *
 * const template = "Hook {id} for {tool} completed: exit {exitCode}"
 * // Result: "Hook tests-after-task for task completed: exit 0"
 * ```
 */
export interface TemplateContext {
  /**
   * Hook ID (always available)
   */
  id: string

  /**
   * Agent name (available for tool hooks and session hooks)
   * May be undefined if agent context is not available
   */
  agent?: string

  /**
   * Tool name (available for tool hooks only)
   * May be undefined for session hooks
   */
  tool?: string

  /**
   * Command string that was executed (available when hook runs)
   * May be undefined if command execution failed before running
   */
  cmd?: string

  /**
   * Captured standard output from command execution
   * Truncated to configured limit (default 4096 chars)
   * May be undefined or empty if command produced no output
   */
  stdout?: string

  /**
   * Captured standard error from command execution
   * Truncated to configured limit (default 4096 chars)
   * May be undefined or empty if command produced no error output
   */
  stderr?: string

  /**
   * Exit code from command execution
   * - 0: success
   * - non-zero: command failed
   * May be undefined if command did not execute
   */
  exitCode?: number

  /**
   * Additional context fields for future expansion
   * Examples: subagentSummary, taskResult, etc.
   */
  [key: string]: unknown
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Normalized representation of a hook's matching conditions
 *
 * Converts flexible input formats (string | string[]) into consistent
 * array format for easier matching logic.
 */
export interface NormalizedToolHookWhen {
  phase: "before" | "after"
  tool: string[]
  callingAgent: string[]
  slashCommand: string[]
}

/**
 * Normalized representation of session hook matching conditions
 */
export interface NormalizedSessionHookWhen {
  event: "session.start" | "session.idle" | "session.end"
  agent: string[]
}

/**
 * Hook validation error
 *
 * Represents a validation error found in hook configuration.
 * Used for reporting configuration issues without blocking execution.
 */
export interface HookValidationError {
  /**
   * Hook ID (if available; may be undefined if id field is missing)
   */
  hookId?: string

  /**
   * Type of validation error
   */
  type:
    | "missing_id"
    | "missing_when"
    | "missing_run"
    | "invalid_phase"
    | "invalid_event"
    | "invalid_injection_target"
    | "invalid_injection_as"
    | "duplicate_id"
    | "unknown"

  /**
   * Human-readable error message
   */
  message: string

  /**
   * Severity level
   */
  severity: "error" | "warning"
}

/**
 * Loaded and merged hooks for a specific context
 *
 * Represents the final set of hooks that apply to a given agent/session/tool call,
 * after merging global and entity-specific hooks with proper precedence.
 */
export interface MergedHooksContext {
  /**
   * Tool hooks that apply to this context
   */
  toolHooks: ToolHook[]

  /**
   * Session hooks that apply to this context
   */
  sessionHooks: SessionHook[]

  /**
   * Validation errors found during loading/merging
   * Hooks with errors are included but marked for error reporting
   */
  validationErrors: HookValidationError[]
}

/**
 * Hook execution context
 *
 * Information about the current execution context that hooks may need
 */
export interface HookExecutionContext {
  /**
   * Current session ID
   */
  sessionId: string

  /**
   * Current agent name
   */
  agent: string

  /**
   * Tool name (for tool hooks)
   */
  tool?: string

  /**
   * Slash command name (if applicable)
   */
  slashCommand?: string

  /**
   * Tool call ID for deduplication
   */
  callId?: string
}
