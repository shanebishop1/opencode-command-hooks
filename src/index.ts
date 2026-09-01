import type { Config, Plugin } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { CommandHooksConfig, HookExecutionContext, SessionHook } from "./types/hooks.js"
import { createLogger, setGlobalLogger, logger } from "./logging.js"
import { executeHooks, filterSessionHooks, filterToolHooks, type HookHost } from "./executor.js"
import { normalizeString } from "./utils.js"
import { loadGlobalConfig } from "./config/global.js"
import { loadAgentConfig } from "./config/agent.js"
import { mergeConfigs } from "./config/merge.js"
import { createActiveSubagentTracker } from "./subagent-tracker.js"

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

type ToolArgsCacheEntry = {
  args: Record<string, unknown>
  savedAt: number
}

const TOOL_ARGS_TTL_MS = 10 * 60 * 1000
const TOOL_ARGS_MAX = 1000
const AFTER_HOOK_DEDUPE_TTL_MS = 60 * 1000

const toolCallArgsCache = new Map<string, ToolArgsCacheEntry>()
const afterHookCallCache = new Map<string, number>()
const notifiedConfigErrors = new Set<string>()

type SessionParentId = string | null | undefined

type ChatParamsOutput = {
  options?: Record<string, unknown>
}

const stripHookProviderOptions = (output: ChatParamsOutput): void => {
  if (!output.options) return
  delete output.options.hooks
  delete output.options.command_hooks
}

const pruneToolArgsCache = (): void => {
  const now = Date.now()

  for (const [callId, entry] of toolCallArgsCache) {
    if (now - entry.savedAt > TOOL_ARGS_TTL_MS) {
      toolCallArgsCache.delete(callId)
    }
  }

  while (toolCallArgsCache.size > TOOL_ARGS_MAX) {
    const oldest = toolCallArgsCache.keys().next().value
    if (!oldest) break
    toolCallArgsCache.delete(oldest)
  }
}

const pruneAfterHookCache = (): void => {
  const now = Date.now()
  for (const [callId, seenAt] of afterHookCallCache) {
    if (now - seenAt > AFTER_HOOK_DEDUPE_TTL_MS) {
      afterHookCallCache.delete(callId)
    }
  }
}

const markAfterHookProcessed = (callId: string | undefined): void => {
  if (!callId) return
  pruneAfterHookCache()
  afterHookCallCache.set(callId, Date.now())
}

const wasAfterHookProcessed = (callId: string | undefined): boolean => {
  if (!callId) return false
  pruneAfterHookCache()
  const seenAt = afterHookCallCache.get(callId)
  if (!seenAt) return false
  return Date.now() - seenAt <= AFTER_HOOK_DEDUPE_TTL_MS
}

const storeToolArgs = (callId: string | undefined, args: Record<string, unknown> | undefined): void => {
  if (!callId || !args) return
  pruneToolArgsCache()
  toolCallArgsCache.set(callId, {
    args,
    savedAt: Date.now(),
  })
}

const getToolArgs = (callId: string | undefined): Record<string, unknown> | undefined => {
  if (!callId) return undefined
  pruneToolArgsCache()
  const entry = toolCallArgsCache.get(callId)
  if (!entry) return undefined
  if (Date.now() - entry.savedAt > TOOL_ARGS_TTL_MS) {
    toolCallArgsCache.delete(callId)
    return undefined
  }
  return entry.args
}

const deleteToolArgs = (callId: string | undefined): void => {
  if (!callId) return
  toolCallArgsCache.delete(callId)
}



/**
 * Handle a session lifecycle event (session.created or session.idle)
 */
const isRootSessionOnlyHook = (
  hook: SessionHook,
  eventType: "session.created" | "session.idle",
): boolean => hook.when.rootSessionOnly ?? eventType === "session.idle"

const resolveRootSession = async (
  sessionId: string,
  parentId: SessionParentId,
  client: OpencodeClient,
): Promise<boolean | undefined> => {
  if (parentId !== undefined) {
    return parentId === null
  }

  try {
    const result = await client.session.get({ path: { id: sessionId } })
    if (!result.data) {
      logger.error(`Could not determine parent session for ${sessionId}; running hooks without root filtering`)
      return undefined
    }
    return !result.data.parentID
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to fetch session ${sessionId}: ${errorMessage}; running hooks without root filtering`)
    return undefined
  }
}

const handleSessionEvent = async (
  eventType: "session.created" | "session.idle",
  sessionId: string | undefined,
  agent: string | undefined,
  client: OpencodeClient,
  host: HookHost,
  hasActiveSubagents: boolean,
  parentId: SessionParentId = undefined,
): Promise<void> => {
  if (!sessionId) {
    logger.debug(`${eventType} event missing session ID`)
    return
  }

  if (!agent) {
    logger.debug(`${eventType} event does not include agent; agent-filtered session hooks may not match`)
  }

  try {
    const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig(host.cwd)
    await notifyConfigError(globalConfigError, sessionId, client)

    const markdownConfig = { tool: [], session: [] }
    const { config: mergedConfig } = mergeConfigs(globalConfig, markdownConfig)

    let matchedHooks = filterSessionHooks(mergedConfig.session || [], {
      event: eventType,
      agent,
      hasActiveSubagents,
    })

    if (matchedHooks.some((hook) => isRootSessionOnlyHook(hook, eventType))) {
      const isRootSession = await resolveRootSession(sessionId, parentId, client)
      if (isRootSession === false) {
        matchedHooks = matchedHooks.filter((hook) => !isRootSessionOnlyHook(hook, eventType))
      }
    }

    logger.debug(
      `Matched ${matchedHooks.length} hook(s) for ${eventType}, agent=${agent}`
    )

    const context: HookExecutionContext = {
      sessionId,
      agent: agent || "unknown",
    }

    await executeHooks(matchedHooks, context, host, mergedConfig.truncationLimit)
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
  input: { tool: string; sessionID: string; callID?: string; args?: Record<string, unknown> },
  toolArgs: Record<string, unknown> | undefined,
  client: OpencodeClient,
  host: HookHost,
): Promise<void> => {
  if (phase === "before") {
    storeToolArgs(input.callID, toolArgs)
  }

  if (phase === "after") {
    markAfterHookProcessed(input.callID)
  }

  try {
    const { config: globalConfig, error: globalConfigError } = await loadGlobalConfig(host.cwd)
    await notifyConfigError(globalConfigError, input.sessionID, client)

    let agentConfig: CommandHooksConfig = { tool: [], session: [] }
    let subagentType: string | undefined
    
    if (input.tool === "task" && toolArgs) {
      subagentType = normalizeString(toolArgs.subagent_type) || undefined
      if (subagentType) {
        logger.debug(`Detected task tool call with subagent_type: ${subagentType}`)
        agentConfig = await loadAgentConfig(subagentType, host.cwd)
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

    await executeHooks(matchedHooks, context, host, mergedConfig.truncationLimit)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Error handling tool.execute.${phase}: ${errorMessage}`)
  } finally {
    if (phase === "after") {
      deleteToolArgs(input.callID)
    }
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
 * - Lightweight in-memory caching for tool args + dedupe
 * - Unified executor handles all hook matching and execution
 */
export const CommandHooksPlugin: Plugin = async ({ client, directory }) => {
  const clientLogger = createLogger(client)
  setGlobalLogger(clientLogger)
  const typedClient = client as OpencodeClient
  const host: HookHost = {
    cwd: directory || process.cwd(),
    inject: async (sessionId, message) => {
      await typedClient.session.promptAsync({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: message }] },
      })
    },
    toast: async ({ title, message, variant, duration }) => {
      await typedClient.tui.showToast({
        body: { title, message, variant: variant ?? "info", duration },
      })
    },
  }
  const activeSubagents = createActiveSubagentTracker()
  
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

      "chat.params": async (_input: unknown, output: ChatParamsOutput) => {
        void _input
        stripHookProviderOptions(output)
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
          const info = event.properties?.info as { id?: string; parentID?: string; agent?: string } | undefined
          const sessionId = info?.id ? normalizeString(info.id) : undefined
          const agent = normalizeString(info?.agent ?? event.properties?.agent)
          const parentId = info?.parentID ? normalizeString(info.parentID) : null

          await handleSessionEvent(
            "session.created",
            sessionId,
            agent,
            typedClient,
            host,
            sessionId ? activeSubagents.hasActive(sessionId) : false,
            parentId,
          )
        }

        if (event.type === "session.deleted") {
          const info = event.properties?.info as { id?: string } | undefined
          const sessionId = info?.id ? normalizeString(info.id) : undefined
          if (sessionId) activeSubagents.clear(sessionId)
        }
        // Handle session.idle event
        if (event.type === "session.idle") {
          logger.debug("Received session.idle event")

          const sessionId = normalizeString(event.properties?.sessionID)
          const agent = normalizeString(event.properties?.agent)

          await handleSessionEvent(
            "session.idle",
            sessionId,
            agent,
            typedClient,
            host,
            sessionId ? activeSubagents.hasActive(sessionId) : false,
          )
        }

          // Backward-compat fallback for older OpenCode event streams.
          // Newer builds should already trigger tool.execute.after.
          if (event.type === "tool.result") {
            logger.debug("Received tool.result event")

            const toolName = normalizeString(
              event.properties?.name ?? event.properties?.tool
            )
            const sessionId = normalizeString(
              event.properties?.sessionID ?? event.properties?.sessionId
            )
            const callId = normalizeString(
              event.properties?.callID ?? event.properties?.callId
            )

            if (!sessionId || !toolName) {
              logger.debug(
                "tool.result event missing sessionID or tool name"
              )
              return
            }

            if (toolName === "task") activeSubagents.end(sessionId, callId)

            if (wasAfterHookProcessed(callId)) {
              logger.debug(`Skipping duplicate after-hook execution for callID: ${callId}`)
              deleteToolArgs(callId)
              return
            }

            const storedToolArgs = getToolArgs(callId)
            await handleToolExecutionHook(
              "after",
              { tool: toolName, sessionID: sessionId, callID: callId },
              storedToolArgs,
              typedClient,
              host,
            )
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

        if (input.tool === "task") activeSubagents.begin(input.sessionID, input.callID)

        await handleToolExecutionHook("before", input, output.args, typedClient, host)
      },

      /**
       * Tool execution after hook
       * Runs after a tool completes.
       */
      "tool.execute.after": async (
        input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
        toolOutput?: { title: string; output: string; metadata: Record<string, unknown> }
      ) => {
        logger.debug(
          `Received tool.execute.after for tool: ${input.tool}`
        )

        if (!toolOutput) {
          logger.debug(
            `tool.execute.after for ${input.tool} has no output payload; running hooks with cached args only`
          )
        }

        if (input.tool === "task") activeSubagents.end(input.sessionID, input.callID)

        const toolArgs = input.args ?? getToolArgs(input.callID)
        await handleToolExecutionHook("after", input, toolArgs, typedClient, host)
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

export default CommandHooksPlugin
