import type { Plugin } from "@opencode-ai/plugin"
import type { Config, OpencodeClient } from "@opencode-ai/sdk"
import type { CommandHooksConfig, HookExecutionContext, ToolHook, SessionHook } from "./types/hooks.js"
import { createLogger, setGlobalLogger, logger } from "./logging.js"
import { executeHooks } from "./executor.js"
import { loadGlobalConfig } from "./config/global.js"
import { loadAgentConfig } from "./config/agent.js"
import { mergeConfigs } from "./config/merge.js"

/**
 * Helper to extract string values from event properties
 */
function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

async function notifyConfigError(
  configError: string | null,
  sessionId: string | undefined,
  client: OpencodeClient,
): Promise<void> {
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

const TOOL_ARGS_TTL_MS = 5 * 60 * 1000
const toolCallArgsCache = new Map<
  string,
  { args: Record<string, unknown>; cleanup?: ReturnType<typeof setTimeout> }
>()
const notifiedConfigErrors = new Set<string>()

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
    // Normalize session.start to session.created
    let normalizedEvent = hook.when.event
    if (normalizedEvent === "session.start") {
      normalizedEvent = "session.created"
    }
    
    if (normalizedEvent !== criteria.event) return false
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
    if (hook.when.toolArgs) {
      // If hook specifies toolArgs but we don't have them, we can't match
      // (this happens for async tools in tool.result event)
      if (!criteria.toolArgs) {
        logger.debug(
          `Hook ${hook.id} requires toolArgs but none were provided for tool ${criteria.toolName}`
        )
        return false
      }

      for (const [key, expectedValue] of Object.entries(hook.when.toolArgs)) {
        const actualValue = criteria.toolArgs[key]
        if (!matches(expectedValue, actualValue as string | undefined)) {
          logger.debug(
            `Hook ${hook.id} toolArgs mismatch for ${key}: expected ${JSON.stringify(expectedValue)}, actual ${JSON.stringify(actualValue)}`
          )
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

           if (!sessionId) {
             logger.debug("session.created event missing session ID in info")
             return
           }

           try {
             // Load config
             const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
             await notifyConfigError(globalConfigError, sessionId, client as OpencodeClient)

             const markdownConfig = { tool: [], session: [] }
             const { config: mergedConfig } = mergeConfigs(
               globalConfig,
               markdownConfig
             )

             // Filter session hooks for session.created (maps to session.start)
             const matchedHooks = filterSessionHooks(mergedConfig.session || [], {
               event: "session.created",
               agent,
             })

             logger.debug(
               `Matched ${matchedHooks.length} hook(s) for session.created (mapped to session.start), agent=${agent}, sessionId=${sessionId}`
             )

             // Build execution context
             const context: HookExecutionContext = {
               sessionId,
               agent: agent || "unknown",
             }

             // Execute hooks with truncationLimit from config
             await executeHooks(matchedHooks, context, client as OpencodeClient, mergedConfig.truncationLimit)
           } catch (error) {
             const errorMessage =
               error instanceof Error ? error.message : String(error)
             logger.error(
               `Error handling session.created event: ${errorMessage}`
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
             const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
             await notifyConfigError(globalConfigError, sessionId, client as OpencodeClient)

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
               `Matched ${matchedHooks.length} hook(s) for session.idle, config truncationLimit: ${mergedConfig.truncationLimit}`
             )

             // Build execution context
             const context: HookExecutionContext = {
               sessionId,
               agent: agent || "unknown",
             }

             // Execute hooks with truncationLimit from config
             await executeHooks(matchedHooks, context, client as OpencodeClient, mergedConfig.truncationLimit)
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
             // Load global config
             const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
             await notifyConfigError(globalConfigError, sessionId, client as OpencodeClient)

             // Load agent-specific config if this is a task tool with subagent_type
             let agentConfig: CommandHooksConfig = { tool: [], session: [] }
             if (toolName === "task" && storedToolArgs) {
               const subagentType = normalizeString(storedToolArgs.subagent_type)
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

           try {
            // Load global config
            const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
            await notifyConfigError(globalConfigError, input.sessionID, client as OpencodeClient)
 
            // Load agent-specific config if this is a task tool with subagent_type

           let agentConfig: CommandHooksConfig = { tool: [], session: [] }
           let subagentType: string | undefined
           if (input.tool === "task") {
             subagentType = normalizeString(output.args.subagent_type) || undefined
             if (subagentType) {
               logger.debug(`Detected task tool call with subagent_type: ${subagentType}`)
               agentConfig = await loadAgentConfig(subagentType)
             }
           }

           const { config: mergedConfig } = mergeConfigs(
             globalConfig,
             agentConfig
           )

           // Filter tool hooks for before phase
           const matchedHooks = filterToolHooks(mergedConfig.tool || [], {
             phase: "before",
             toolName: input.tool,
             callingAgent: subagentType,
             slashCommand: undefined,
             toolArgs: output.args,
           })

          logger.debug(
            `Matched ${matchedHooks.length} hook(s) for tool.execute.before`
          )

           // Build execution context
           const context: HookExecutionContext = {
             sessionId: input.sessionID,
             agent: subagentType || "unknown",
             tool: input.tool,
             callId: input.callID,
             toolArgs: output.args,
           }

            storeToolArgs(input.callID, output.args)

            // Execute hooks with truncationLimit from config
            await executeHooks(matchedHooks, context, client as OpencodeClient, mergedConfig.truncationLimit)
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
             // Load global config
             const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig()
             await notifyConfigError(globalConfigError, input.sessionID, client as OpencodeClient)
 
             // Load agent-specific config if this is a task tool with subagent_type

           let agentConfig: CommandHooksConfig = { tool: [], session: [] }
            let subagentType: string | undefined
            if (input.tool === "task" && storedToolArgs) {
              subagentType = normalizeString(storedToolArgs.subagent_type) || undefined
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
              toolName: input.tool,
              callingAgent: subagentType,
              slashCommand: undefined,
              toolArgs: storedToolArgs,
            })

           logger.debug(
             `Matched ${matchedHooks.length} hook(s) for tool.execute.after`
           )

             // Build execution context
             const context: HookExecutionContext = {
               sessionId: input.sessionID,
               agent: subagentType || "unknown",
               tool: input.tool,
               callId: input.callID,
               toolArgs: storedToolArgs,
             }

             // Execute hooks with truncationLimit from config
             await executeHooks(matchedHooks, context, client as OpencodeClient, mergedConfig.truncationLimit)
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

