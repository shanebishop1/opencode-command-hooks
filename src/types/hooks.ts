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

/**
 * Simplified agent hooks configuration for markdown frontmatter
 *
 * This is the new, simplified schema for defining hooks in agent markdown files.
 * It's much more concise than the full CommandHooksConfig format.
 */
export interface AgentHooks {
  /** Hooks that run before agent execution */
  before?: AgentHookEntry[]

  /** Hooks that run after agent execution */
  after?: AgentHookEntry[]
}

/** Single hook entry in the simplified agent hooks format */
export interface AgentHookEntry {
  /** Command(s) to execute. Array runs sequentially. */
  run: string | string[]

  /** Optional template for injecting hook results into the session. Supports placeholder substitution. */
  inject?: string

  /** Optional toast notification. Supports placeholder substitution. */
  toast?: {
    /** Optional title. Supports placeholder substitution. */
    title?: string

    /** Message text. Supports placeholder substitution. */
    message: string

    /** Visual variant: "info" | "success" | "warning" | "error" */
    variant?: "info" | "success" | "warning" | "error"

    /** Duration in milliseconds. */
    duration?: number
  }
}

/**
 * Tool hook configuration
 *
 * Runs shell command(s) before or after a tool execution. Hooks can be filtered
 * by tool name, calling agent, and slash command context. Results can optionally
 * be injected into the session as messages.
 */
export interface ToolHook {
  /** Unique hook identifier. Must be unique within config source. */
  id: string

  /** Matching conditions that determine when this hook should run. */
  when: ToolHookWhen

  /** Command(s) to execute. Array runs sequentially; failures don't block. */
  run: string | string[]

  /**
   * Optional template for injecting hook results into the session.
   * Supports placeholders: {id}, {agent}, {tool}, {cmd}, {stdout}, {stderr}, {exitCode}
   * Unavailable values are replaced with empty string.
   */
  inject?: string

  /** Optional toast notification. Supports placeholder substitution. */
  toast?: {
    /** Optional title. Supports placeholder substitution. */
    title?: string

    /** Message text. Supports placeholder substitution. */
    message: string

    /** Visual variant: "info" | "success" | "warning" | "error" */
    variant?: "info" | "success" | "warning" | "error"

    /** Duration in milliseconds. */
    duration?: number
  }
}

/**
 * Matching conditions for tool hooks
 *
 * All specified conditions must match for the hook to execute.
 * Omitted fields default to matching all values (wildcard behavior).
 */
export interface ToolHookWhen {
  /** Execution phase: "before" or "after" tool execution. */
  phase: "before" | "after"

  /** Tool name(s) to match. Omitted or "*" matches all tools. */
  tool?: string | string[]

  /**
   * Calling agent name(s) to match.
   * Omitted: defaults to "*" in global config, "this agent" in markdown.
   */
  callingAgent?: string | string[]

  /** Slash command name(s) to match. Omitted matches all contexts. */
  slashCommand?: string | string[]

  /** Tool argument filters (only in tool.execute.before). Match by input arguments. */
  toolArgs?: Record<string, string | string[]>
}

/**
 * Session hook configuration
 *
 * Runs shell command(s) on session lifecycle events (start, idle, end).
 * Can be filtered by agent name. Results can optionally be injected into
 * the session as messages.
 */
export interface SessionHook {
  /** Unique hook identifier. Must be unique within config source. */
  id: string

  /** Matching conditions that determine when this hook should run. */
  when: SessionHookWhen

  /** Command(s) to execute. Array runs sequentially; failures don't block. */
  run: string | string[]

  /**
   * Optional template for injecting hook results into the session.
   * Supports placeholders: {id}, {agent}, {cmd}, {stdout}, {stderr}, {exitCode}
   * Unavailable values are replaced with empty string.
   */
  inject?: string

  /** Optional toast notification. Supports placeholder substitution. */
  toast?: {
    /** Optional title. Supports placeholder substitution. */
    title?: string

    /** Message text. Supports placeholder substitution. */
    message: string

    /** Visual variant: "info" | "success" | "warning" | "error" */
    variant?: "info" | "success" | "warning" | "error"

    /** Duration in milliseconds. */
    duration?: number
  }
}

/**
 * Matching conditions for session hooks
 *
 * All specified conditions must match for the hook to execute.
 * Omitted fields default to matching all values (wildcard behavior).
 */
export interface SessionHookWhen {
  /**
   * Session lifecycle event type.
   * "session.start" (alias for "session.created"), "session.idle", "session.end"
   */
  event: "session.created" | "session.idle" | "session.end" | "session.start"

  /**
   * Agent name(s) to match.
   * Omitted: defaults to "*" in global config, "this agent" in markdown.
   */
  agent?: string | string[]
}

/**
 * Top-level command hooks configuration
 *
 * Root configuration object in opencode.json/.opencode.jsonc under "command_hooks" key,
 * or in YAML frontmatter of agent/slash-command markdown.
 */
export interface CommandHooksConfig {
  /** Truncation limit for command output in characters. Defaults to 30,000. */
  truncationLimit?: number

  /** Array of tool execution hooks. */
  tool?: ToolHook[]

  /** Array of session lifecycle hooks. */
  session?: SessionHook[]
}

/**
 * Result of executing a single hook command
 *
 * Captures the outcome of running a hook's shell command(s), including
 * output, exit code, and any errors that occurred.
 */
export interface HookExecutionResult {
  /** ID of the hook that was executed */
  hookId: string

  /** Whether the hook executed successfully (exit code 0) */
  success: boolean

  /** Exit code from the last command (0 = success, undefined = not executed) */
  exitCode?: number

  /** Captured standard output (truncated to configured limit) */
  stdout?: string

  /** Captured standard error (truncated to configured limit) */
  stderr?: string

  /** Error message if the hook failed to execute */
  error?: string
}

/**
 * Context object for template placeholder substitution
 *
 * When injecting hook results into a session, the template string is processed
 * with placeholder substitution using values from this context.
 * All fields are optional as not all contexts have all values available.
 */
export interface TemplateContext {
  /** Hook ID (always available) */
  id: string

  /** Agent name (available for tool and session hooks) */
  agent?: string

  /** Tool name (available for tool hooks only) */
  tool?: string

  /** Command string that was executed */
  cmd?: string

  /** Captured standard output (truncated to configured limit) */
  stdout?: string

  /** Captured standard error (truncated to configured limit) */
  stderr?: string

  /** Exit code from command execution (0 = success) */
  exitCode?: number

  /** Additional context fields for future expansion */
  [key: string]: unknown
}

/**
 * Hook validation error
 *
 * Represents a validation error found in hook configuration.
 * Used for reporting configuration issues without blocking execution.
 */
export interface HookValidationError {
  /** Hook ID (if available) */
  hookId?: string

  /** Type of validation error */
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

  /** Human-readable error message */
  message: string

  /** Severity level */
  severity: "error" | "warning"
}

/**
 * Hook execution context
 *
 * Information about the current execution context that hooks may need
 */
export interface HookExecutionContext {
  /** Current session ID */
  sessionId: string

  /** Current agent name */
  agent: string

  /** Tool name (for tool hooks) */
  tool?: string

  /** Slash command name (if applicable) */
  slashCommand?: string

  /** Tool call ID provided by OpenCode (if available) */
  callId?: string

  /** Tool arguments (available for tool.execute.before hooks) */
  toolArgs?: Record<string, unknown>
}
