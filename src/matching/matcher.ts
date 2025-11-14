/**
 * Hook matching and filtering logic for determining which hooks apply to a given context
 *
 * Implements the matching semantics from PRD sections 5.4 (tool hooks) and 5.5 (session hooks):
 * - If field is omitted or contains "*", match all
 * - If field is array of values, match if context value is in array
 * - Support both string and string[] for filter fields
 * - All conditions must match (AND logic)
 */

import type {
  ToolHook,
  SessionHook,
  ToolHookWhen,
  SessionHookWhen,
  NormalizedToolHookWhen,
  NormalizedSessionHookWhen,
} from "../types/hooks.js"

const LOG_PREFIX = "[opencode-command-hooks]"
const DEBUG = process.env.OPENCODE_HOOKS_DEBUG === "1"

// ============================================================================
// NORMALIZATION HELPERS
// ============================================================================

/**
 * Normalize a filter field to an array of strings
 *
 * Converts flexible input formats (string | string[] | undefined) into a consistent
 * array format for easier matching logic.
 *
 * Semantics:
 * - undefined or "*" → ["*"] (match all)
 * - string → [string]
 * - string[] → string[] (as-is)
 *
 * @param value - Filter value to normalize
 * @returns Array of filter values, where "*" means match all
 */
function normalizeToArray(value: string | string[] | undefined): string[] {
  // Undefined defaults to match all
  if (value === undefined) {
    return ["*"]
  }

  // Single string
  if (typeof value === "string") {
    return [value]
  }

  // Array of strings
  if (Array.isArray(value)) {
    return value
  }

  // Fallback (shouldn't happen with proper types)
  return ["*"]
}

/**
 * Normalize tool hook matching conditions to consistent array format
 *
 * @param when - Tool hook when conditions
 * @returns Normalized conditions with all fields as arrays
 */
function normalizeToolHookWhen(when: ToolHookWhen): NormalizedToolHookWhen {
  return {
    phase: when.phase,
    tool: normalizeToArray(when.tool),
    callingAgent: normalizeToArray(when.callingAgent),
    slashCommand: normalizeToArray(when.slashCommand),
  }
}

/**
 * Normalize session hook matching conditions to consistent array format
 *
 * @param when - Session hook when conditions
 * @returns Normalized conditions with all fields as arrays
 */
function normalizeSessionHookWhen(when: SessionHookWhen): NormalizedSessionHookWhen {
  return {
    event: when.event,
    agent: normalizeToArray(when.agent),
  }
}

// ============================================================================
// MATCHING HELPERS
// ============================================================================

/**
 * Check if a context value matches a filter array
 *
 * Matching rules:
 * - If filter contains "*", always matches (wildcard)
 * - Otherwise, matches if context value is in the filter array
 * - If context value is undefined/empty, only matches if filter is ["*"]
 *
 * @param contextValue - Value from the execution context
 * @param filterArray - Normalized filter array (result of normalizeToArray)
 * @returns true if context value matches the filter
 */
function matchesFilter(contextValue: string | undefined, filterArray: string[]): boolean {
  // Wildcard always matches
  if (filterArray.includes("*")) {
    return true
  }

  // If no context value, only match if filter is wildcard (already checked above)
  if (!contextValue) {
    return false
  }

  // Check if context value is in filter array
  return filterArray.includes(contextValue)
}

// ============================================================================
// TOOL HOOK MATCHING
// ============================================================================

/**
 * Match tool hooks to tool execution context
 *
 * Filters hooks based on:
 * - phase: "before" or "after" (must match exactly)
 * - tool: array of tool names or "*" for all
 * - callingAgent: array of agent names or "*" for all
 * - slashCommand: optional, array of command names or "*" for all
 *
 * All conditions must match (AND logic). Hooks are returned in the order
 * they appear in the input array.
 *
 * @param hooks - Array of tool hooks to filter
 * @param context - Tool execution context to match against
 * @returns Array of matching hooks (subset of input, in same order)
 *
 * @example
 * ```typescript
 * const hooks = [
 *   {
 *     id: "test-after-task",
 *     when: { phase: "after", tool: ["task"], callingAgent: "*" },
 *     run: "pnpm test"
 *   }
 * ]
 *
 * const matching = matchToolHooks(hooks, {
 *   phase: "after",
 *   toolName: "task",
 *   callingAgent: "build"
 * })
 * // Returns: [hooks[0]]
 * ```
 */
export function matchToolHooks(
  hooks: ToolHook[],
  context: {
    phase: "before" | "after"
    toolName: string
    callingAgent?: string
    slashCommand?: string
  },
): ToolHook[] {
  const matched: ToolHook[] = []

  for (const hook of hooks) {
    const normalized = normalizeToolHookWhen(hook.when)

    // Check phase (must match exactly)
    if (normalized.phase !== context.phase) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Hook "${hook.id}": phase mismatch (${normalized.phase} !== ${context.phase})`,
        )
      }
      continue
    }

    // Check tool name
    if (!matchesFilter(context.toolName, normalized.tool)) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Hook "${hook.id}": tool mismatch (${context.toolName} not in [${normalized.tool.join(", ")}])`,
        )
      }
      continue
    }

    // Check calling agent
    if (!matchesFilter(context.callingAgent, normalized.callingAgent)) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Hook "${hook.id}": callingAgent mismatch (${context.callingAgent} not in [${normalized.callingAgent.join(", ")}])`,
        )
      }
      continue
    }

    // Check slash command (if filter is specified)
    if (!matchesFilter(context.slashCommand, normalized.slashCommand)) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Hook "${hook.id}": slashCommand mismatch (${context.slashCommand} not in [${normalized.slashCommand.join(", ")}])`,
        )
      }
      continue
    }

    // All conditions matched
    matched.push(hook)
    if (DEBUG) {
      console.log(`${LOG_PREFIX} Hook "${hook.id}" matched for tool "${context.toolName}"`)
    }
  }

  if (DEBUG) {
    console.log(
      `${LOG_PREFIX} matchToolHooks: ${matched.length}/${hooks.length} hooks matched for phase="${context.phase}" tool="${context.toolName}"`,
    )
  }

  return matched
}

// ============================================================================
// SESSION HOOK MATCHING
// ============================================================================

/**
 * Match session hooks to session context
 *
 * Filters hooks based on:
 * - event: "session.start", "session.idle", or "session.end" (must match exactly)
 * - agent: array of agent names or "*" for all
 *
 * All conditions must match (AND logic). Hooks are returned in the order
 * they appear in the input array.
 *
 * @param hooks - Array of session hooks to filter
 * @param context - Session context to match against
 * @returns Array of matching hooks (subset of input, in same order)
 *
 * @example
 * ```typescript
 * const hooks = [
 *   {
 *     id: "bootstrap",
 *     when: { event: "session.start", agent: ["build", "validator"] },
 *     run: "git status"
 *   }
 * ]
 *
 * const matching = matchSessionHooks(hooks, {
 *   event: "session.start",
 *   agent: "build"
 * })
 * // Returns: [hooks[0]]
 * ```
 */
export function matchSessionHooks(
  hooks: SessionHook[],
  context: {
    event: "session.start" | "session.idle" | "session.end"
    agent?: string
  },
): SessionHook[] {
  const matched: SessionHook[] = []

  for (const hook of hooks) {
    const normalized = normalizeSessionHookWhen(hook.when)

    // Check event (must match exactly)
    if (normalized.event !== context.event) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Hook "${hook.id}": event mismatch (${normalized.event} !== ${context.event})`,
        )
      }
      continue
    }

    // Check agent
    if (!matchesFilter(context.agent, normalized.agent)) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Hook "${hook.id}": agent mismatch (${context.agent} not in [${normalized.agent.join(", ")}])`,
        )
      }
      continue
    }

    // All conditions matched
    matched.push(hook)
    if (DEBUG) {
      console.log(`${LOG_PREFIX} Hook "${hook.id}" matched for event "${context.event}"`)
    }
  }

  if (DEBUG) {
    console.log(
      `${LOG_PREFIX} matchSessionHooks: ${matched.length}/${hooks.length} hooks matched for event="${context.event}"`,
    )
  }

  return matched
}
