import type { Plugin } from "@opencode-ai/plugin"
import type { Config, OpencodeClient } from "@opencode-ai/sdk"
import type { HookExecutionContext, ToolHook, SessionHook } from "./types/hooks.js"
import { createLogger, setGlobalLogger, logger } from "./logging.js"
import { executeHooks } from "./executor.js"
import { loadGlobalConfig } from "./config/global.js"
import { mergeConfigs } from "./config/merge.js"

// Export unified executor
export { executeHooks } from "./executor.js"

/**
 * Helper to extract string values from event properties
 */
function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

const TOOL_ARGS_TTL_MS = 5 * 60 * 1000
const toolCallArgsCache = new Map<
  string,
  { args: Record<string, unknown>; cleanup?: ReturnType<typeof setTimeout> }
>()

function storeToolArgs(callId: string | undefined, args: Record<string, unknown> | undefined): void {
  if (!callId || !args) return
  const existing = toolCallArgsCache.get(callId)
  if (existing?.cleanup) {
    clearTimeout(existing.cleanup)
  }
  const cleanup = setTimeout(() => {
    toolCallArgsCache.delete(callId)
  }, TOOL_ARGS_TTL_MS)
  toolCallArgsCache.set(callId, { args, cleanup })
}

function getToolArgs(callId: string | undefined): Record<string, unknown> | undefined {
  if (!callId) return undefined
  return toolCallArgsCache.get(callId)?.args
}

function deleteToolArgs(callId: string | undefined): void {
  if (!callId) return
  const entry = toolCallArgsCache.get(callId)
  if (entry?.cleanup) {
    clearTimeout(entry.cleanup)
  }
  toolCallArgsCache.delete(callId)
}

/**
 * Check if a value matches a pattern (string, array of strings, or wildcard)
 */
function matches(pattern: string | string[] | undefined, value: string | undefined): boolean {
  if (!pattern) return true // Omitted pattern matches all
  if (pattern === "*") return true // Wildcard matches all
  if (Array.isArray(pattern)) return value ? pattern.includes(value) : false
  return value === pattern
}

/**
 * Filter session hooks that match the given criteria
 */
function filterSessionHooks(
  hooks: SessionHook[],
  criteria: { event: string; agent: string | undefined }
): SessionHook[] {
  return hooks.filter((hook) => {
    if (hook.when.event !== criteria.event) return false
    return matches(hook.when.agent, criteria.agent)
  })
}

/**
 * Filter tool hooks that match the given criteria
 */
function filterToolHooks(
  hooks: ToolHook[],
  criteria: {
    phase: "before" | "after"
    toolName: string | undefined
    callingAgent: string | undefined
    slashCommand: string | undefined
    toolArgs?: Record<string, unknown>
  }
): ToolHook[] {
  return hooks.filter((hook) => {
    if (hook.when.phase !== criteria.phase) return false
    if (!matches(hook.when.tool, criteria.toolName)) return false
    if (!matches(hook.when.callingAgent, criteria.callingAgent)) return false
    if (!matches(hook.when.slashCommand, criteria.slashCommand)) return false
    
    // Match tool args if specified in the hook
    if (hook.when.toolArgs && criteria.toolArgs) {
      for (const [key, expectedValue] of Object.entries(hook.when.toolArgs)) {
        const actualValue = criteria.toolArgs[key]
        if (!matches(expectedValue, actualValue as string | undefined)) {
          return false
        }
      }
    }
    
    return true
  })
}

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
 *
 * Architecture:
 * - Simplified event handlers that extract context and call executeHooks
 * - No state tracking (pendingAfterEvents, completedAfterEvents removed)
 * - Unified executor handles all hook matching and execution
 */
const plugin: Plugin = async ({ client }) => {
    const clientLogger = createLogger(client)
   setGlobalLogger(clientLogger)
  
   try {
     logger.info("Initializing plugin")
     logger.info("[SMOKE-TEST] opencode-command-hooks plugin loaded successfully")

     const hooks = {
      /**
       * Config hook for plugin initialization
       * Called by OpenCode during plugin initialization to provide configuration.
       * We don't need to do anything with this config as we load our configuration
       * from .opencode/command-hooks.jsonc, but we need to implement this hook
       * to prevent OpenCode from throwing an error when it tries to call it.
       */
      config: async (_input: Config) => {
        void _input
        logger.debug("Config hook called")
        // No-op for now - we load config from .opencode/command-hooks.jsonc
        // This hook is called by OpenCode during plugin initialization
      },

      /**
       * Event hook for session lifecycle events
       * Supports: session.start, session.idle, tool.result
       *
       * Note: The Plugin type from @opencode-ai/plugin may not include session.start
       * in its event type union, but it is documented as a supported event in the
       * OpenCode SDK. We use a type assertion to allow this event type.
       */
      event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
        // Handle session.start event
        if (event.type === "session.start") {
          logger.debug("Received session.start event")

          const sessionId = normalizeString(event.properties?.sessionID)
          const agent = normalizeString(event.properties?.agent)

          if (!sessionId) {
            logger.debug("session.start event missing sessionID")
            return
          }

           try {
             // Load config
             const globalConfig = await loadGlobalConfig()
             const markdownConfig = { tool: [], session: [] }
             const { config: mergedConfig } = mergeConfigs(
               globalConfig,
               markdownConfig
             )

             // Filter session hooks for session.start
             const matchedHooks = filterSessionHooks(mergedConfig.session || [], {
               event: "session.start",
               agent,
             })

            logger.debug(
              `Matched ${matchedHooks.length} hook(s) for session.start`
            )

            // Build execution context
            const context: HookExecutionContext = {
              sessionId,
              agent: agent || "unknown",
            }

            // Execute hooks
            await executeHooks(matchedHooks, context, client as OpencodeClient)
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            logger.error(
              `Error handling session.start event: ${errorMessage}`
            )
          }
        }

        // Handle session.idle event
        if (event.type === "session.idle") {
          logger.debug("Received session.idle event")

          const sessionId = normalizeString(event.properties?.sessionID)
          const agent = normalizeString(event.properties?.agent)

          if (!sessionId) {
            logger.debug("session.idle event missing sessionID")
            return
          }

           try {
             // Load config
             const globalConfig = await loadGlobalConfig()
             const markdownConfig = { tool: [], session: [] }
             const { config: mergedConfig } = mergeConfigs(
               globalConfig,
               markdownConfig
             )

             // Filter session hooks for session.idle
             const matchedHooks = filterSessionHooks(mergedConfig.session || [], {
               event: "session.idle",
               agent,
             })

            logger.debug(
              `Matched ${matchedHooks.length} hook(s) for session.idle`
            )

            // Build execution context
            const context: HookExecutionContext = {
              sessionId,
              agent: agent || "unknown",
            }

            // Execute hooks
            await executeHooks(matchedHooks, context, client as OpencodeClient)
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            logger.error(
              `Error handling session.idle event: ${errorMessage}`
            )
          }
        }

        // Handle tool.result event (fires when tool finishes)
        if (event.type === "tool.result") {
          logger.debug("Received tool.result event")

          const toolName = normalizeString(
            event.properties?.name ?? event.properties?.tool
          )
          const sessionId = normalizeString(
            event.properties?.sessionID ?? event.properties?.sessionId
          )
          const agent = normalizeString(event.properties?.agent)
          const callId = normalizeString(
            event.properties?.callID ?? event.properties?.callId
          )
          const storedToolArgs = getToolArgs(callId)

          if (!sessionId || !toolName) {
            logger.debug(
              "tool.result event missing sessionID or tool name"
            )
            return
          }

           try {
             // Load config
             const globalConfig = await loadGlobalConfig()
             const markdownConfig = { tool: [], session: [] }
             const { config: mergedConfig } = mergeConfigs(
               globalConfig,
               markdownConfig
             )

             // Filter tool hooks for after phase
             const matchedHooks = filterToolHooks(mergedConfig.tool || [], {
               phase: "after",
               toolName,
               callingAgent: agent,
               slashCommand: normalizeString(event.properties?.slashCommand),
               toolArgs: storedToolArgs,
             })

            logger.debug(
              `Matched ${matchedHooks.length} hook(s) for tool.result (after phase)`
            )

            // Build execution context
            const context: HookExecutionContext = {
              sessionId,
              agent: agent || "unknown",
              tool: toolName,
              callId,
              toolArgs: storedToolArgs,
            }

            // Execute hooks
            await executeHooks(matchedHooks, context, client as OpencodeClient)

            deleteToolArgs(callId)
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error)
            logger.error(
              `Error handling tool.result event: ${errorMessage}`
            )
          }
        }
      },

      /**
       * Tool execution before hook
       * Runs before a tool is executed
       */
      "tool.execute.before": async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: Record<string, unknown> }
      ) => {
        logger.debug(
          `Received tool.execute.before for tool: ${input.tool}`
        )

         try {
           // Load config
           const globalConfig = await loadGlobalConfig()
           const markdownConfig = { tool: [], session: [] }
           const { config: mergedConfig } = mergeConfigs(
             globalConfig,
             markdownConfig
           )

           // Filter tool hooks for before phase
           const matchedHooks = filterToolHooks(mergedConfig.tool || [], {
             phase: "before",
             toolName: input.tool,
             callingAgent: undefined,
             slashCommand: undefined,
             toolArgs: output.args,
           })

          logger.debug(
            `Matched ${matchedHooks.length} hook(s) for tool.execute.before`
          )

          // Build execution context
          const context: HookExecutionContext = {
            sessionId: input.sessionID,
            agent: "unknown",
            tool: input.tool,
            callId: input.callID,
            toolArgs: output.args,
          }

          storeToolArgs(input.callID, output.args)

          // Execute hooks
          await executeHooks(matchedHooks, context, client as OpencodeClient)
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          logger.error(
            `Error handling tool.execute.before: ${errorMessage}`
          )
        }
      },

      /**
       * Tool execution after hook
       * Runs after a tool completes (only if output is present - sync tools)
       */
      "tool.execute.after": async (
        input: { tool: string; sessionID: string; callID: string },
        toolOutput?: { title: string; output: string; metadata: Record<string, unknown> }
      ) => {
        logger.debug(
          `Received tool.execute.after for tool: ${input.tool}`
        )

        // Only process if output is present (sync tools)
        if (!toolOutput) {
          logger.debug(
            `Skipping tool.execute.after for ${input.tool}: no output (async tool)`
          )
          return
        }

        const storedToolArgs = getToolArgs(input.callID)

         try {
           // Load config
           const globalConfig = await loadGlobalConfig()
           const markdownConfig = { tool: [], session: [] }
           const { config: mergedConfig } = mergeConfigs(
             globalConfig,
             markdownConfig
           )

           // Filter tool hooks for after phase
           const matchedHooks = filterToolHooks(mergedConfig.tool || [], {
             phase: "after",
             toolName: input.tool,
             callingAgent: undefined,
             slashCommand: undefined,
             toolArgs: storedToolArgs,
           })

          logger.debug(
            `Matched ${matchedHooks.length} hook(s) for tool.execute.after`
          )

          // Build execution context
          const context: HookExecutionContext = {
            sessionId: input.sessionID,
            agent: "unknown",
            tool: input.tool,
            callId: input.callID,
            toolArgs: storedToolArgs,
          }

          // Execute hooks
          await executeHooks(matchedHooks, context, client as OpencodeClient)
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          logger.error(
            `Error handling tool.execute.after: ${errorMessage}`
          )
        }
      },
    }

    logger.info(`Plugin returning hooks: ${Object.keys(hooks).join(", ")}`)
    return hooks
  } catch (error) {
    logger.error(
      `Error in plugin initialization: ${error instanceof Error ? error.message : String(error)}`
    )
    throw error
  }
}

export default plugin
