import { describe, expect, it } from "bun:test"
import { executeHooks, type HookHost } from "../src/executor.js"
import type { ToolHook } from "../src/types/hooks.js"

describe("host-neutral hook execution", () => {
  it("delegates injection and toast delivery to the host", async () => {
    const injections: Array<{ sessionId: string; message: string; hookId: string }> = []
    const toasts: Array<{ title?: string; message: string }> = []
    const host: HookHost = {
      cwd: process.cwd(),
      inject: async (sessionId, message, hookId) => {
        injections.push({ sessionId, message, hookId })
      },
      toast: async (toast) => {
        toasts.push(toast)
      },
    }
    const hook: ToolHook = {
      id: "host-port",
      when: { phase: "after", tool: "bash" },
      inject: "hook {id} for {tool}",
      toast: { title: "Hook", message: "finished {id}" },
    }

    await executeHooks(
      [hook],
      { sessionId: "session-1", agent: "build", tool: "bash" },
      host,
    )

    expect(injections).toEqual([
      { sessionId: "session-1", message: "hook host-port for bash", hookId: "host-port" },
    ])
    expect(toasts).toEqual([
      { title: "Hook", message: "finished host-port", variant: "info", duration: undefined },
    ])
  })
})
