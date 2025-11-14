import type { Plugin } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import { handleToolExecuteBefore } from "./handlers/tool-before"
import { handleToolExecuteAfter } from "./handlers/tool-after"

// Export handlers for testing and external use
export { handleToolExecuteBefore } from "./handlers/tool-before"
export { handleToolExecuteAfter } from "./handlers/tool-after"

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
export const CommandHooksPlugin: Plugin = async ({ client }) => {
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
    "tool.execute.before": async (input: unknown, output: unknown) => {
      // Extract event information from input and output
      // The event structure is based on OpenCode plugin hook conventions
      const inputRecord = input as Record<string, unknown>
      const outputRecord = output as Record<string, unknown>

      const event = {
        tool: String(inputRecord?.tool || "unknown"),
        input: (inputRecord?.input as Record<string, unknown>) || {},
        output: outputRecord,
        sessionId: outputRecord?.sessionId as string | undefined,
        callingAgent: outputRecord?.callingAgent as string | undefined,
        slashCommand: outputRecord?.slashCommand as string | undefined,
        callId: outputRecord?.callId as string | undefined,
      }

      // Call the handler with the extracted event and client
      await handleToolExecuteBefore(event, client as OpencodeClient)
    },

    "tool.execute.after": async (input: unknown, output: unknown) => {
      // Extract event information from input and output
      // The event structure is based on OpenCode plugin hook conventions
      const inputRecord = input as Record<string, unknown>
      const outputRecord = output as Record<string, unknown>

      const event = {
        tool: String(inputRecord?.tool || "unknown"),
        input: (inputRecord?.input as Record<string, unknown>) || {},
        output: outputRecord,
        result: outputRecord?.result,
        sessionId: outputRecord?.sessionId as string | undefined,
        callingAgent: outputRecord?.callingAgent as string | undefined,
        slashCommand: outputRecord?.slashCommand as string | undefined,
        callId: outputRecord?.callId as string | undefined,
      }

      // Call the handler with the extracted event and client
      await handleToolExecuteAfter(event, client as OpencodeClient)
    },
  }
}

export default CommandHooksPlugin
