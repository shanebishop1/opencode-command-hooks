import type { Plugin } from "@opencode-ai/plugin"

const LOG_PREFIX = "[opencode-command-hooks]"

/**
 * OpenCode Command Hooks Plugin
 *
 * Allows users to declaratively attach shell commands to agent/tool/slash-command
 * lifecycle events via configuration in opencode.json or markdown frontmatter.
 *
 * Features:
 * - Tool hooks (before/after tool execution)
 * - Session hooks (on session lifecycle events)
 * - Configuration via global config or per-agent/command markdown
 * - Non-blocking error semantics
 */
export const CommandHooksPlugin: Plugin = async () => {
  console.log(`${LOG_PREFIX} Initializing plugin`)

  return {
    /**
     * Event hook for session lifecycle events
     * Supports: session.start, session.idle, session.end
     */
    event: async () => {
      // Placeholder for session event hook implementation
      // Will be implemented in subsequent tasks
    },

    /**
     * Tool execution hooks
     * Supports: tool.execute.before, tool.execute.after
     */
    "tool.execute.before": async () => {
      // Placeholder for pre-tool-execution hook implementation
      // Will be implemented in subsequent tasks
    },

    "tool.execute.after": async () => {
      // Placeholder for post-tool-execution hook implementation
      // Will be implemented in subsequent tasks
    },
  }
}

export default CommandHooksPlugin
