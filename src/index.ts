import type { Plugin } from "@opencode-ai/plugin"
import type { Config, OpencodeClient } from "@opencode-ai/sdk"
import { handleToolExecuteBefore } from "./handlers/tool-before.js"
import { handleToolExecuteAfter } from "./handlers/tool-after.js"
import { handleSessionStart } from "./handlers/session-start.js"
import { handleSessionIdle } from "./handlers/session-idle.js"

// Export handlers for testing and external use
export { handleToolExecuteBefore } from "./handlers/tool-before.js"
export { handleToolExecuteAfter } from "./handlers/tool-after.js"
export { handleSessionStart } from "./handlers/session-start.js"
export { handleSessionIdle } from "./handlers/session-idle.js"

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
const plugin: Plugin = async ({ client }) => {
  try {
    console.log(`${LOG_PREFIX} Initializing plugin`)

    const hooks = {
    /**
     * Config hook for plugin initialization
     * Called by OpenCode during plugin initialization to provide configuration.
     * We don't need to do anything with this config as we load our configuration
     * from .opencode/command-hooks.jsonc, but we need to implement this hook
     * to prevent OpenCode from throwing an error when it tries to call it.
     */
    config: async (_input: Config) => {
      if (DEBUG) {
        console.log(`${LOG_PREFIX} Config hook called`)
      }
      // No-op for now - we load config from .opencode/command-hooks.jsonc
      // This hook is called by OpenCode during plugin initialization
    },

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

      // Handle session.idle event
      if (event.type === "session.idle") {
        if (DEBUG) {
          console.log(`${LOG_PREFIX} Received session.idle event`)
        }

        // Extract event data from properties
        const sessionIdleEvent = {
          sessionId: event.properties?.sessionID as string | undefined,
          agent: event.properties?.agent as string | undefined,
          properties: event.properties,
        }

        // Call the handler with the extracted event and client
        await handleSessionIdle(sessionIdleEvent, client as OpencodeClient)
      }
    },

    /**
     * Tool execution hooks
     * Supports: tool.execute.before, tool.execute.after
     */
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => {
      const event = {
        tool: input.tool,
        input: output.args || {},
        output: output,
        sessionId: input.sessionID,
        callingAgent: undefined, // Not provided by OpenCode
        slashCommand: undefined, // Not provided by OpenCode
        callId: input.callID,
      }

      // Call the handler with the extracted event and client
      await handleToolExecuteBefore(event, client as OpencodeClient)
    },

    "tool.execute.after": async (input: { tool: string; sessionID: string; callID: string }, output: { title: string; output: string; metadata: any }) => {
      const event = {
        tool: input.tool,
        input: {}, // Not provided by OpenCode for after hooks
        output: output,
        result: output.output,
        sessionId: input.sessionID,
        callingAgent: undefined, // Not provided by OpenCode
        slashCommand: undefined, // Not provided by OpenCode
        callId: input.callID,
      }

      // Call the handler with the extracted event and client
      await handleToolExecuteAfter(event, client as OpencodeClient)
    },
  }

    console.log(`${LOG_PREFIX} Plugin returning hooks:`, Object.keys(hooks))
    return hooks
  } catch (error) {
    console.error(`${LOG_PREFIX} Error in plugin initialization:`, error)
    throw error
  }
}

export default plugin
