import type { Plugin } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import { handleToolExecuteBefore } from "./handlers/tool-before"
import { handleToolExecuteAfter } from "./handlers/tool-after"
import { handleSessionStart } from "./handlers/session-start"

// Export handlers for testing and external use
export { handleToolExecuteBefore } from "./handlers/tool-before"
export { handleToolExecuteAfter } from "./handlers/tool-after"
export { handleSessionStart } from "./handlers/session-start"

const LOG_PREFIX = "[opencode-command-hooks]"
const DEBUG = process.env.OPENCODE_HOOKS_DEBUG === "1"

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
     *
     * Note: The Plugin type from @opencode-ai/plugin may not include session.start
     * in its event type union, but it is documented as a supported event in the
     * OpenCode SDK. We use a type assertion to allow this event type.
     */
    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      // Handle session.start event
      if (event.type === "session.start") {
        if (DEBUG) {
          console.log(`${LOG_PREFIX} Received session.start event`)
        }

        // Extract event data from properties
        const sessionStartEvent = {
          sessionId: event.properties?.sessionID as string | undefined,
          agent: event.properties?.agent as string | undefined,
          properties: event.properties,
        }

        // Call the handler with the extracted event and client
        await handleSessionStart(sessionStartEvent, client as OpencodeClient)
      }
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
