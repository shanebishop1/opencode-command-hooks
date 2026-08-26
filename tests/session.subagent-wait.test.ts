import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { parseSessionHook } from "../src/schemas"

const originalCwd = process.cwd()

describe("session idle subagent waits", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "opencode-hooks-subagent-wait-"))
    mkdirSync(join(directory, ".opencode"), { recursive: true })
    writeFileSync(
      join(directory, ".opencode", "command-hooks.jsonc"),
      JSON.stringify({
        session: [
          { id: "always", when: { event: "session.idle" }, inject: "always" },
          {
            id: "after-subagents",
            when: { event: "session.idle", excludeSubagentWait: true },
            inject: "after-subagents",
          },
        ],
      }),
    )
    process.chdir(directory)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(directory, { recursive: true, force: true })
  })

  it("accepts excludeSubagentWait as an opt-in session hook condition", () => {
    const hook = parseSessionHook({
      id: "notify",
      when: { event: "session.idle", excludeSubagentWait: true },
      inject: "notify",
    })

    expect(hook?.when.excludeSubagentWait).toBe(true)
  })

  it("suppresses only opted-in idle hooks until every task call finishes", async () => {
    const injected: string[] = []
    const client = {
      session: {
        get: async () => ({ data: { id: "parent" } }),
        promptAsync: async ({ body }: { body: { parts: Array<{ text: string }> } }) => {
          injected.push(body.parts[0].text)
          return {}
        },
      },
      tui: { showToast: async () => ({}) },
    }
    const { CommandHooksPlugin } = await import("../src/index.js")
    const plugin = await CommandHooksPlugin({ client } as never)
    const idle = () => plugin.event?.({
      event: { type: "session.idle", properties: { sessionID: "parent" } },
    } as never)

    await plugin["tool.execute.before"]?.(
      { tool: "task", sessionID: "parent", callID: "task-1" },
      { args: { subagent_type: "worker" } },
    )
    await plugin["tool.execute.before"]?.(
      { tool: "task", sessionID: "parent", callID: "task-2" },
      { args: { subagent_type: "worker" } },
    )
    await idle()

    await plugin["tool.execute.after"]?.(
      { tool: "task", sessionID: "parent", callID: "task-1" },
      undefined as never,
    )
    await idle()

    await plugin["tool.execute.after"]?.(
      { tool: "task", sessionID: "parent", callID: "task-2" },
      undefined as never,
    )
    await idle()

    expect(injected).toEqual(["always", "always", "always", "after-subagents"])
  })

  it("clears active subagent state when the session is deleted", async () => {
    const injected: string[] = []
    const client = {
      session: {
        get: async () => ({ data: { id: "parent" } }),
        promptAsync: async ({ body }: { body: { parts: Array<{ text: string }> } }) => {
          injected.push(body.parts[0].text)
          return {}
        },
      },
      tui: { showToast: async () => ({}) },
    }
    const { CommandHooksPlugin } = await import("../src/index.js")
    const plugin = await CommandHooksPlugin({ client } as never)

    await plugin["tool.execute.before"]?.(
      { tool: "task", sessionID: "deleted", callID: "task-deleted" },
      { args: { subagent_type: "worker" } },
    )
    await plugin.event?.({
      event: { type: "session.deleted", properties: { info: { id: "deleted" } } },
    } as never)
    await plugin.event?.({
      event: { type: "session.idle", properties: { sessionID: "deleted" } },
    } as never)

    expect(injected).toEqual(["always", "after-subagents"])
  })
})
