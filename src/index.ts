import type { Plugin } from "@opencode-ai/plugin"
import type { Config, OpencodeClient } from "@opencode-ai/sdk"
import type { CommandHooksConfig, HookExecutionContext } from "./types/hooks.js"
import { createLogger, setGlobalLogger, logger } from "./logging.js"
import { executeHooks, filterSessionHooks, filterToolHooks } from "./executor.js"
import { normalizeString } from "./utils.js"
import { loadGlobalConfig } from "./config/global.js"
import { loadAgentConfig } from "./config/agent.js"
import { mergeConfigs } from "./config/merge.js"

const notifyConfigError = async (
  configError: string | null,
  sessionId: string | undefined,
  client: OpencodeClient,
): Promise<void> => {
  if (!configError) return

  const key = `${sessionId ?? "no-session"}:${configError}`
  if (notifiedConfigErrors.has(key)) return
  notifiedConfigErrors.add(key)

  try {
    await client.tui.showToast({
      body: {
        title: "Command Hooks Config Error",
        message: configError,
        variant: "error",
      },
    })
  } catch (notifyError) {
    const notifyMessage =
      notifyError instanceof Error ? notifyError.message : String(notifyError)
    logger.error(`Failed to notify config error: ${notifyMessage}`)
  }
}

const toolCallArgsCache = new Map<string, Record<string, unknown>>()
const notifiedConfigErrors = new Set<string>()

const storeToolArgs = (callId: string | undefined, args: Record<string, unknown> | undefined): void => {
  if (!callId || !args) return
  toolCallArgsCache.set(callId, args)
}

const getToolArgs = (callId: string | undefined): Record<string, unknown> | undefined => {
  if (!callId) return undefined
  return toolCallArgsCache.get(callId)
}

const deleteToolArgs = (callId: string | undefined): void => {
  if (!callId) return
  toolCallArgsCache.delete(callId)
}



/**
 * Handle a session lifecycle event (session.created or session.idle)
 */
const handleSessionEvent = async (
  eventType: "session.created" | "session.idle",
  sessionId: string | undefined,
  agent: string | undefined,
  client: OpencodeClient
): Promise<void> => {
  if (!sessionId) {
    logger.debug(`${eventType} event missing session ID`)
    return
  }

  try {
    const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
    await notifyConfigError(globalConfigError, sessionId, client)

    const markdownConfig = { tool: [], session: [] }
    const { config: mergedConfig } = mergeConfigs(globalConfig, markdownConfig)

    const matchedHooks = filterSessionHooks(mergedConfig.session || [], {
      event: eventType,
      agent,
    })

    logger.debug(
      `Matched ${matchedHooks.length} hook(s) for ${eventType}, agent=${agent}`
    )

    const context: HookExecutionContext = {
      sessionId,
      agent: agent || "unknown",
    }

    await executeHooks(matchedHooks, context, client, mergedConfig.truncationLimit)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Error handling ${eventType} event: ${errorMessage}`)
  }
}

/**
 * Handle tool execution hook (before or after)
 */
const handleToolExecutionHook = async (
  phase: "before" | "after",
  input: { tool: string; sessionID: string; callID: string },
  toolArgs: Record<string, unknown> | undefined,
  client: OpencodeClient
): Promise<void> => {
  try {
    const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
    await notifyConfigError(globalConfigError, input.sessionID, client)

    let agentConfig: CommandHooksConfig = { tool: [], session: [] }
    let subagentType: string | undefined
    
    if (input.tool === "task" && toolArgs) {
      subagentType = normalizeString(toolArgs.subagent_type) || undefined
      if (subagentType) {
        logger.debug(`Detected task tool call with subagent_type: ${subagentType}`)
        agentConfig = await loadAgentConfig(subagentType)
      }
    }

    const { config: mergedConfig } = mergeConfigs(globalConfig, agentConfig)

    const matchedHooks = filterToolHooks(mergedConfig.tool || [], {
      phase,
      toolName: input.tool,
      callingAgent: subagentType,
      slashCommand: undefined,
      toolArgs,
    })

    logger.debug(`Matched ${matchedHooks.length} hook(s) for tool.execute.${phase}`)

    const context: HookExecutionContext = {
      sessionId: input.sessionID,
      agent: subagentType || "unknown",
      tool: input.tool,
      callId: input.callID,
      toolArgs,
    }

    if (phase === "before") {
      storeToolArgs(input.callID, toolArgs)
    }

    await executeHooks(matchedHooks, context, client, mergedConfig.truncationLimit)

    if (phase === "after") {
      deleteToolArgs(input.callID)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Error handling tool.execute.${phase}: ${errorMessage}`)
  }
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
export const CommandHooksPlugin: Plugin = async ({ client }) => {
  const clientLogger = createLogger(client)
  setGlobalLogger(clientLogger)
  
  try {
    logger.info("Initializing OpenCode Command Hooks plugin...")

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
           // Handle session.created event
           if (event.type === "session.created") {
            logger.debug("Received session.created event")

            // session.created has info.id, not sessionID directly
            const info = event.properties?.info as { id?: string } | undefined
            const sessionId = info?.id ? normalizeString(info.id) : undefined
            const agent = normalizeString(event.properties?.agent)

            await handleSessionEvent("session.created", sessionId, agent, client as OpencodeClient)
          }

          // Handle session.idle event
          if (event.type === "session.idle") {
            logger.debug("Received session.idle event")

            const sessionId = normalizeString(event.properties?.sessionID)
            const agent = normalizeString(event.properties?.agent)

            await handleSessionEvent("session.idle", sessionId, agent, client as OpencodeClient)
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

            // For tool.result, we need to pass the stored tool args and handle agent differently
            try {
              const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
              await notifyConfigError(globalConfigError, sessionId, client as OpencodeClient)

              // Load agent-specific config if this is a task tool with subagent_type
              let agentConfig: CommandHooksConfig = { tool: [], session: [] }
              let subagentType: string | undefined
              if (toolName === "task" && storedToolArgs) {
                subagentType = normalizeString(storedToolArgs.subagent_type)
                if (subagentType) {
                  logger.debug(`Detected task tool call with subagent_type: ${subagentType}`)
                  agentConfig = await loadAgentConfig(subagentType)
                }
              }

              const { config: mergedConfig } = mergeConfigs(
                globalConfig,
                agentConfig
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

               // Execute hooks with truncationLimit from config
               await executeHooks(matchedHooks, context, client as OpencodeClient, mergedConfig.truncationLimit)

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
           logger.debug(
             `Tool args: ${JSON.stringify(output.args)}`
           )

           await handleToolExecutionHook("before", input, output.args, client as OpencodeClient)
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
          await handleToolExecutionHook("after", input, storedToolArgs, client as OpencodeClient)
        },
    }

    logger.info(`Plugin returning hooks: ${Object.keys(hooks).join(", ")}`)
    return hooks
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Error in plugin initialization: ${message}`)
    const fallbackHooks = {
      config: async () => {},
      event: async () => {},
      "tool.execute.before": async () => {},
      "tool.execute.after": async () => {},
    }
    return fallbackHooks
  }
}

