import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { createV2Plugin, type V2Context } from "../src/v2/plugin.js"

type ToolCallback = (event: Record<string, unknown>) => Promise<void> | void

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
  events: Record<string, unknown>[] = [],
  parentID?: string,
) => {
  const callbacks = new Map<string, ToolCallback>()
  const disposed: string[] = []
  const syntheticCalls: Array<Record<string, unknown>> = []
  const context: V2Context = {
    location: { directory },
    tool: {
      hook: async (name, callback) => {
        callbacks.set(name, callback as ToolCallback)
        return { dispose: async () => { disposed.push(name) } }
      },
    },
    event: {
      subscribe: () => (async function* () {
        for (const event of events) yield event
      })(),
    },
    session: {
      get: async ({ sessionID }) => ({
        id: sessionID,
        agent: "build",
        parentID,
        location: { directory },
      }),
      synthetic: async (input) => {
        syntheticCalls.push(input)
      },
    },
  }

  return { context, callbacks, disposed, syntheticCalls }
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
      id: "call-1",
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
    failing.context.location.directory = ""
    failing.context.session.get = async () => {
      throw new Error("session lookup failed")
    }
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})
    const failingCleanup = await createV2Plugin().setup(failing.context)

    await expect(
      failing.callbacks.get("execute.before")?.({
        tool: "bash",
        sessionID: "missing",
        id: "call-2",
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

  it("keeps default idle hooks on root sessions unless child sessions are enabled", async () => {
    const directory = await createProject({
      session: [
        { id: "root-only", when: { event: "session.idle" }, inject: "root only" },
        {
          id: "all-sessions",
          when: { event: "session.idle", rootSessionOnly: false },
          inject: "all sessions",
        },
      ],
    })
    const events = [{
      id: "child-idle",
      type: "session.idle",
      location: { directory },
      data: { sessionID: "child" },
    }]
    const { context, syntheticCalls } = createContext(directory, events, "parent")
    const cleanup = await createV2Plugin().setup(context)

    await new Promise(resolve => setTimeout(resolve, 20))

    expect(syntheticCalls.map(call => call.text)).toEqual(["all sessions"])
    await cleanup?.()
  })

  it("suppresses opted-in idle hooks while a V2 subagent tool is active", async () => {
    const directory = await createProject({
      session: [
        { id: "always", when: { event: "session.idle" }, inject: "always" },
        {
          id: "after-subagents",
          when: { event: "session.idle", excludeSubagentWait: true },
          inject: "after-subagents",
        },
      ],
    })
    const { context, callbacks, syntheticCalls } = createContext(directory)
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    let waitingForSecond!: () => void
    let eventsFinished!: () => void
    const first = new Promise<void>(resolve => { releaseFirst = resolve })
    const second = new Promise<void>(resolve => { releaseSecond = resolve })
    const firstProcessed = new Promise<void>(resolve => { waitingForSecond = resolve })
    const complete = new Promise<void>(resolve => { eventsFinished = resolve })
    context.event.subscribe = () => (async function* () {
      await first
      yield {
        id: "idle-active",
        type: "session.idle",
        location: { directory },
        data: { sessionID: "parent" },
      }
      waitingForSecond()
      await second
      yield {
        id: "idle-complete",
        type: "session.idle",
        location: { directory },
        data: { sessionID: "parent" },
      }
      eventsFinished()
    })()

    const cleanup = await createV2Plugin().setup(context)
    const subagent = {
      tool: "subagent",
      sessionID: "parent",
      id: "subagent-call",
      agent: "build",
      input: { agent: "worker" },
    }
    await callbacks.get("execute.before")?.(subagent)
    releaseFirst()
    await firstProcessed

    expect(syntheticCalls.map(call => call.text)).toEqual(["always"])

    await callbacks.get("execute.after")?.(subagent)
    releaseSecond()
    await complete

    expect(syntheticCalls.map(call => call.text)).toEqual([
      "always",
      "always",
      "after-subagents",
    ])
    await cleanup?.()
  })

  it("clears active V2 subagent state when the session is deleted", async () => {
    const directory = await createProject({
      session: [
        {
          id: "after-subagents",
          when: { event: "session.idle", excludeSubagentWait: true },
          inject: "after-subagents",
        },
      ],
    })
    const { context, callbacks, syntheticCalls } = createContext(directory)
    let releaseEvents!: () => void
    let eventsFinished!: () => void
    const release = new Promise<void>(resolve => { releaseEvents = resolve })
    const complete = new Promise<void>(resolve => { eventsFinished = resolve })
    context.event.subscribe = () => (async function* () {
      await release
      yield { id: "deleted", type: "session.deleted", data: { sessionID: "parent" } }
      yield {
        id: "idle-after-delete",
        type: "session.idle",
        location: { directory },
        data: { sessionID: "parent" },
      }
      eventsFinished()
    })()

    const cleanup = await createV2Plugin().setup(context)
    await callbacks.get("execute.before")?.({
      tool: "subagent",
      sessionID: "parent",
      id: "subagent-call",
      agent: "build",
      input: { agent: "worker" },
    })
    releaseEvents()
    await complete

    expect(syntheticCalls.map(call => call.text)).toEqual(["after-subagents"])
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
      id: "call-3",
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
