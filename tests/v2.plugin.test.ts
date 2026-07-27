import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { createV2Plugin, type V2Context } from "../src/v2/plugin.js"

type ToolCallback = (event: Record<string, unknown>) => Promise<void> | void
type LifecycleEvent = {
  id?: string
  type: string
  parentID?: string
  info?: { parentID?: string }
  data?: Record<string, unknown>
  location?: { directory?: string; workspaceID?: string }
}

const temporaryDirectories: string[] = []

const createProject = async (config: Record<string, unknown>): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-hooks-v2-"))
  temporaryDirectories.push(directory)
  await mkdir(join(directory, ".opencode"), { recursive: true })
  await writeFile(
    join(directory, ".opencode", "command-hooks.jsonc"),
    JSON.stringify(config),
  )
  return directory
}

const createContext = (
  directory: string,
  events: LifecycleEvent[] = [],
) => {
  const callbacks = new Map<string, ToolCallback>()
  const disposed: string[] = []
  const syntheticCalls: Array<Record<string, unknown>> = []
  let eventsDrained: () => void
  const eventsComplete = new Promise<void>(resolve => {
    eventsDrained = resolve
  })
  const context: V2Context = {
    tool: {
      hook: async (name, callback) => {
        callbacks.set(name, callback as ToolCallback)
        return { dispose: async () => { disposed.push(name) } }
      },
    },
    event: {
      subscribe: () => (async function* () {
        for (const event of events) yield event
        eventsDrained()
      })(),
    },
    session: {
      get: async ({ sessionID }) => ({
        id: sessionID,
        agent: "build",
        location: { directory },
      }),
      synthetic: async (input) => {
        syntheticCalls.push(input)
      },
    },
  }

  return { context, callbacks, disposed, syntheticCalls, eventsComplete }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe("OpenCode V2 plugin", () => {
  it("registers both tool phases and uses after-event input without a V1 cache", async () => {
    const directory = await createProject({
      tool: [
        {
          id: "v2-after",
          when: { phase: "after", tool: "bash", toolArgs: { command: "pwd" } },
          run: "pwd",
          inject: "cwd={stdout}",
        },
      ],
    })
    const { context, callbacks, disposed, syntheticCalls } = createContext(directory)
    const plugin = createV2Plugin()

    const cleanup = await plugin.setup(context)

    expect(plugin.id).toBe("opencode-command-hooks.v2")
    expect([...callbacks.keys()]).toEqual(["execute.before", "execute.after"])

    await callbacks.get("execute.after")?.({
      tool: "bash",
      sessionID: "session-1",
      callID: "call-1",
      agent: "build",
      input: { command: "pwd" },
      result: {},
    })

    expect(syntheticCalls).toHaveLength(1)
    expect(syntheticCalls[0]).toMatchObject({
      sessionID: "session-1",
      text: `cwd=${directory}\n`,
      description: "opencode-command-hooks",
      metadata: { hookId: "v2-after" },
      resume: false,
    })

    await cleanup?.()
    expect(disposed).toEqual(["execute.before", "execute.after"])
  })

  it("maps created and idle events once and keeps callback failures non-blocking", async () => {
    const directory = await createProject({
      session: [
        { id: "start", when: { event: "session.start" }, inject: "started" },
        { id: "idle", when: { event: "session.idle" }, inject: "idle" },
      ],
    })
    const events = [
      {
        id: "event-created",
        type: "session.created",
        location: { directory },
        data: { sessionID: "session-2" },
      },
      {
        id: "event-idle",
        type: "session.idle",
        location: { directory },
        data: { sessionID: "session-2" },
      },
      {
        id: "event-idle",
        type: "session.idle",
        location: { directory },
        data: { sessionID: "session-2" },
      },
    ]
    const { context, syntheticCalls } = createContext(directory, events)
    const cleanup = await createV2Plugin().setup(context)

    await new Promise(resolve => setTimeout(resolve, 20))

    expect(syntheticCalls.map(call => call.text)).toEqual(["started", "idle"])
    expect(syntheticCalls.every(call => call.resume === false)).toBe(true)
    await cleanup?.()

    const failing = createContext(directory)
    failing.context.session.get = async () => {
      throw new Error("session lookup failed")
    }
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})
    const failingCleanup = await createV2Plugin().setup(failing.context)

    await expect(
      failing.callbacks.get("execute.before")?.({
        tool: "bash",
        sessionID: "missing",
        callID: "call-2",
        agent: "build",
        input: {},
      }),
    ).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
    await failingCleanup?.()
  })

  it("maps durable execution lifecycle events to start and idle hooks", async () => {
    const directory = await createProject({
      session: [
        { id: "durable-start", when: { event: "session.start" }, inject: "durable started" },
        { id: "durable-idle", when: { event: "session.idle" }, inject: "durable idle" },
      ],
    })
    const events = [
      {
        id: "execution-started",
        type: "session.execution.started",
        location: { directory },
        data: { sessionID: "session-durable" },
      },
      {
        id: "execution-succeeded",
        type: "session.execution.succeeded",
        location: { directory },
        data: { sessionID: "session-durable" },
      },
    ]
    const { context, syntheticCalls } = createContext(directory, events)
    const cleanup = await createV2Plugin().setup(context)

    await new Promise(resolve => setTimeout(resolve, 20))

    expect(syntheticCalls.map(call => call.text)).toEqual(["durable started", "durable idle"])
    await cleanup?.()
  })

  it("filters lifecycle hooks by resolved and fallback session scope without guessing unknown sessions", async () => {
    const directory = await createProject({
      session: [
        { id: "parent", when: { event: "session.idle" }, inject: "parent" },
        { id: "child", when: { event: "session.idle", sessionScope: "child" }, inject: "child" },
        { id: "any", when: { event: "session.idle", sessionScope: "any" }, inject: "any" },
      ],
    })
    const events = [
      { id: "parent", type: "session.idle", location: { directory }, data: { sessionID: "parent" } },
      { id: "child", type: "session.idle", location: { directory }, data: { sessionID: "child" } },
      {
        id: "fallback-parent-id",
        type: "session.idle",
        location: { directory },
        data: { sessionID: "fallback-parent-id", parentID: "parent" },
      },
      {
        id: "fallback-info-parent-id",
        type: "session.execution.succeeded",
        location: { directory },
        data: { sessionID: "fallback-info-parent-id", info: { parentID: "parent" } },
      },
      {
        id: "fallback-undefined-parent-id",
        type: "session.idle",
        location: { directory },
        data: { sessionID: "fallback-undefined-parent-id", parentID: undefined },
      },
      { id: "unknown", type: "session.idle", location: { directory }, data: { sessionID: "unknown" } },
    ]
    const { context, eventsComplete, syntheticCalls } = createContext(directory, events)
    context.session.get = async ({ sessionID }) => {
      if (sessionID.startsWith("fallback") || sessionID === "unknown") {
        throw new Error("session lookup failed")
      }
      return {
        id: sessionID,
        agent: "build",
        location: { directory },
        ...(sessionID === "child" ? { parentID: "parent" } : {}),
      }
    }

    const cleanup = await createV2Plugin().setup(context)
    await eventsComplete

    expect(syntheticCalls.map(call => call.text)).toEqual([
      "parent", "any",
      "child", "any",
      "child", "any",
      "child", "any",
      "any",
      "any",
    ])
    await cleanup?.()
  })

  it("reports V2 toast degradation once without blocking injection", async () => {
    const directory = await createProject({
      tool: [
        {
          id: "toast-gap",
          when: { phase: "before", tool: "bash" },
          inject: "still injected",
          toast: { message: "not available" },
        },
      ],
    })
    const { context, callbacks, syntheticCalls } = createContext(directory)
    const warningSpy = spyOn(console, "warn").mockImplementation(() => {})
    const cleanup = await createV2Plugin().setup(context)
    const event = {
      tool: "bash",
      sessionID: "session-3",
      callID: "call-3",
      agent: "build",
      input: {},
    }

    await callbacks.get("execute.before")?.(event)
    await callbacks.get("execute.before")?.(event)

    expect(syntheticCalls).toHaveLength(2)
    expect(warningSpy).toHaveBeenCalledTimes(1)

    warningSpy.mockRestore()
    await cleanup?.()
  })
})
