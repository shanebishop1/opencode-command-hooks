import { beforeEach, describe, expect, it } from "bun:test"
import plugin, {
  __clearPendingAfterEvents,
  __getPendingAfterEventCount,
  handleToolResultEvent,
} from "../src/index.js"

describe("after hooks run when tools finish", () => {
  beforeEach(() => {
    __clearPendingAfterEvents()
  })

  it("defers execution until a tool.result event is seen", async () => {
    const hooks = await plugin({ client: {} } as any)

    const afterHook = hooks["tool.execute.after"]!

    await afterHook(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      { title: "", output: undefined, metadata: {} } as any
    )

    expect(__getPendingAfterEventCount()).toBe(1)
  })

  it("runs after hooks when tool.result arrives", async () => {
    const calls: any[] = []

    await handleToolResultEvent(
      { properties: { name: "bash", output: { ok: true }, sessionID: "s1", callID: "c1" } },
      {} as any,
      async event => {
        calls.push(event)
      }
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].tool).toBe("bash")
    expect(calls[0].result).toEqual({ ok: true })
    expect(calls[0].sessionId).toBe("s1")
  })

  it("runs immediately when after hook already has a final result", async () => {
    const hooks = await plugin({ client: {} } as any)
    const afterHook = hooks["tool.execute.after"]!
    const calls: any[] = []

    await afterHook(
      { tool: "bash", sessionID: "s3", callID: "c-final" },
      { title: "", output: { value: 123 }, metadata: { status: "completed" } } as any
    )

    await handleToolResultEvent(
      { properties: { name: "bash", output: { value: 123 }, sessionID: "s3", callID: "c-final" } },
      {} as any,
      async event => {
        calls.push(event)
      }
    )

    expect(calls).toHaveLength(0)
    expect(__getPendingAfterEventCount()).toBe(0)
  })

  it("uses staged context when tool.result omits tool name", async () => {
    const hooks = await plugin({ client: {} } as any)

    const afterHook = hooks["tool.execute.after"]!

    await afterHook(
      { tool: "firecrawl", sessionID: "s2", callID: "pending-123" },
      { title: "", output: undefined, metadata: {} } as any
    )

    const calls: any[] = []

    await handleToolResultEvent(
      { properties: { output: { data: "done" }, callID: "pending-123" } },
      {} as any,
      async event => {
        calls.push(event)
      }
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].tool).toBe("firecrawl")
    expect(calls[0].result).toEqual({ data: "done" })
    expect(__getPendingAfterEventCount()).toBe(0)
  })
})
