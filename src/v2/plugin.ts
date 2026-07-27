import type { CommandHooksConfig, HookExecutionContext } from "../types/hooks.js"
import { loadGlobalConfig } from "../config/global.js"
import { loadAgentConfig } from "../config/agent.js"
import { mergeConfigs } from "../config/merge.js"
import { executeHooks, filterSessionHooks, filterToolHooks, type HookHost } from "../executor.js"
import { normalizeString } from "../utils.js"

type V2ToolEvent = {
  tool: string
  sessionID: string
  callID?: string
  agent?: string
  input: unknown
}

type V2Event = {
  id?: string
  type: string
  parentID?: string
  info?: { parentID?: string }
  data?: Record<string, unknown>
  location?: { directory?: string; workspaceID?: string }
}

type V2SessionInfo = {
  id: string
  agent?: string
  parentID?: string
  location: { directory: string; workspaceID?: string }
}

export interface V2Context {
  tool: {
    hook: (
      name: "execute.before" | "execute.after",
      callback: (event: V2ToolEvent) => Promise<void> | void,
    ) => Promise<{ dispose: () => Promise<void> }>
  }
  event: {
    subscribe: () => AsyncIterable<V2Event>
  }
  session: {
    get: (input: { sessionID: string }) => Promise<V2SessionInfo>
    synthetic: (input: {
      sessionID: string
      text: string
      description?: string
      metadata?: Record<string, string>
      resume?: boolean
    }) => Promise<unknown>
  }
}

export interface V2Plugin {
  id: string
  setup: (context: V2Context) => Promise<(() => Promise<void>) | void>
}

const emptyConfig = (): CommandHooksConfig => ({ tool: [], session: [] })

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const eventSessionScope = (event: V2Event): "child" | undefined => {
  const info = asRecord(event.data?.info)
  const parentID = normalizeString(
    event.parentID ?? event.info?.parentID ?? event.data?.parentID ?? info?.parentID,
  )
  return parentID ? "child" : undefined
}

const toolContext = (event: V2ToolEvent): {
  toolName: string
  toolArgs: Record<string, unknown> | undefined
  callingAgent: string | undefined
  agentConfigName: string | undefined
} => {
  const originalArgs = asRecord(event.input)
  if (event.tool !== "subagent") {
    return {
      toolName: event.tool,
      toolArgs: originalArgs,
      callingAgent: normalizeString(event.agent) || undefined,
      agentConfigName: undefined,
    }
  }

  const agent = normalizeString(originalArgs?.agent) || undefined
  return {
    // Keep the public command-hooks vocabulary compatible with V1.
    toolName: "task",
    toolArgs: originalArgs ? { ...originalArgs, subagent_type: agent } : originalArgs,
    callingAgent: agent,
    agentConfigName: agent,
  }
}

const diagnostic = (message: string, error?: unknown): void => {
  const detail = error instanceof Error ? error.message : error === undefined ? "" : String(error)
  console.error(`[opencode-command-hooks-v2] ${message}${detail ? `: ${detail}` : ""}`)
}

export const createV2Plugin = (): V2Plugin => ({
  id: "opencode-command-hooks.v2",
  setup: async (ctx) => {
    const notifiedConfigErrors = new Set<string>()
    const handledEvents = new Set<string>()
    const startedSessions = new Set<string>()
    let warnedToastUnsupported = false
    let stopped = false

    const notifyConfigError = (error: string | null, directory: string): void => {
      if (!error) return
      const key = `${directory}:${error}`
      if (notifiedConfigErrors.has(key)) return
      notifiedConfigErrors.add(key)
      diagnostic(error)
    }

    const createHost = (directory: string): HookHost => ({
      cwd: directory,
      inject: async (sessionId, message, hookId) => {
        await ctx.session.synthetic({
          sessionID: sessionId,
          text: message,
          description: "opencode-command-hooks",
          metadata: { hookId },
          resume: false,
        })
      },
      toast: async () => {
        if (warnedToastUnsupported) return
        warnedToastUnsupported = true
        console.warn(
          "[opencode-command-hooks-v2] Toast notifications are not available to V2 server plugins; hook execution and injection will continue.",
        )
      },
    })

    const sessionInfo = async (
      sessionID: string,
      fallback?: { directory?: string; agent?: string; sessionScope?: "child" },
    ): Promise<{
      directory: string
      agent: string | undefined
      sessionScope: "parent" | "child" | undefined
    }> => {
      try {
        const session = await ctx.session.get({ sessionID })
        return {
          directory: session.location.directory,
          agent: normalizeString(session.agent) || normalizeString(fallback?.agent) || undefined,
          sessionScope: session.parentID === undefined ? "parent" : "child",
        }
      } catch (error) {
        if (fallback?.directory) {
          return {
            directory: fallback.directory,
            agent: normalizeString(fallback.agent) || undefined,
            sessionScope: fallback.sessionScope,
          }
        }
        throw error
      }
    }

    const handleTool = async (phase: "before" | "after", event: V2ToolEvent): Promise<void> => {
      try {
        const resolved = await sessionInfo(event.sessionID, { agent: event.agent })
        const normalized = toolContext(event)
        const { config: globalConfig, error } = await loadGlobalConfig(resolved.directory)
        notifyConfigError(error, resolved.directory)

        let agentConfig = emptyConfig()
        if (normalized.agentConfigName) {
          agentConfig = await loadAgentConfig(normalized.agentConfigName, resolved.directory)
        }

        const { config } = mergeConfigs(globalConfig, agentConfig)
        const hooks = filterToolHooks(config.tool ?? [], {
          phase,
          toolName: normalized.toolName,
          callingAgent: normalized.callingAgent,
          slashCommand: undefined,
          toolArgs: normalized.toolArgs,
        })
        const context: HookExecutionContext = {
          sessionId: event.sessionID,
          agent: normalized.callingAgent ?? resolved.agent ?? "unknown",
          tool: normalized.toolName,
          callId: event.callID,
          toolArgs: normalized.toolArgs,
        }
        await executeHooks(hooks, context, createHost(resolved.directory), config.truncationLimit)
      } catch (error) {
        diagnostic(`Failed to handle tool.execute.${phase}`, error)
      }
    }

    const handleSession = async (event: V2Event): Promise<void> => {
      const eventType = event.type === "session.created" || event.type === "session.execution.started"
        ? "session.created"
        : event.type === "session.idle" ||
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted"
          ? "session.idle"
          : undefined
      if (!eventType) return
      if (event.id && handledEvents.has(event.id)) return
      if (event.id) {
        handledEvents.add(event.id)
        if (handledEvents.size > 1000) {
          const oldest = handledEvents.values().next().value
          if (oldest) handledEvents.delete(oldest)
        }
      }

      const sessionID = normalizeString(event.data?.sessionID)
      if (!sessionID) return
      if (eventType === "session.created") {
        if (startedSessions.has(sessionID)) return
        startedSessions.add(sessionID)
      }

      try {
        const resolved = await sessionInfo(sessionID, {
          directory: normalizeString(event.location?.directory) || undefined,
          agent: normalizeString(event.data?.agent) || undefined,
          sessionScope: eventSessionScope(event),
        })
        const { config, error } = await loadGlobalConfig(resolved.directory)
        notifyConfigError(error, resolved.directory)
        const hooks = filterSessionHooks(config.session ?? [], {
          event: eventType,
          agent: resolved.agent,
          sessionScope: resolved.sessionScope,
        })
        await executeHooks(
          hooks,
          { sessionId: sessionID, agent: resolved.agent ?? "unknown" },
          createHost(resolved.directory),
          config.truncationLimit,
        )
      } catch (error) {
        diagnostic(`Failed to handle ${event.type}`, error)
      }
    }

    const registrations = [
      await ctx.tool.hook("execute.before", event => handleTool("before", event)),
      await ctx.tool.hook("execute.after", event => handleTool("after", event)),
    ]

    let iterator: AsyncIterator<V2Event> | undefined
    const eventTask = (async () => {
      try {
        iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
        while (!stopped) {
          const next = await iterator.next()
          if (next.done) break
          await handleSession(next.value)
        }
      } catch (error) {
        if (!stopped) diagnostic("Event subscription failed", error)
      }
    })()

    return async () => {
      stopped = true
      const disposed = Promise.allSettled(registrations.map(registration => registration.dispose()))
      await iterator?.return?.()
      await eventTask
      await disposed
    }
  },
})
