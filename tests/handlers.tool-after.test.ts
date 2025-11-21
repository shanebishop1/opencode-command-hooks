import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { handleToolExecuteAfter } from "../src/handlers/tool-after.js"

const TEST_DIR = "/tmp/opencode-hooks-tool-after"
const ORIGINAL_CWD = process.cwd()

describe("handleToolExecuteAfter message injection", () => {
  beforeAll(() => {
    mkdirSync(join(TEST_DIR, ".opencode"), { recursive: true })
    const config = {
      tool: [
        {
          id: "test-hook",
          when: { phase: "after", tool: ["test-tool"] },
          run: ["echo hook"],
          inject: {
            template: "Result: {stdout}",
          },
        },
      ],
      session: [],
    }
    writeFileSync(join(TEST_DIR, ".opencode", "command-hooks.jsonc"), JSON.stringify(config, null, 2))
  })

  afterAll(() => {
    process.chdir(ORIGINAL_CWD)
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  beforeEach(() => {
    process.chdir(TEST_DIR)
  })

  afterEach(() => {
    process.chdir(ORIGINAL_CWD)
  })

  it("calls session.prompt with simplified format", async () => {
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    }

    const event = {
      tool: "test-tool",
      input: {},
      sessionId: "session-123",
      callId: "call-a",
    }

    await handleToolExecuteAfter(event as any, mockClient as any)

    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]).toEqual({
      path: { id: "session-123" },
      body: {
        noReply: true,
        parts: [{ type: "text", text: "Result: hook\n" }],
      },
    })
  })

  it("calls session.prompt with simplified format for different session", async () => {
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    }

    const event = {
      tool: "test-tool",
      input: {},
      sessionId: "session-999",
      callId: "call-b",
    }

    await handleToolExecuteAfter(event as any, mockClient as any)

    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]).toEqual({
      path: { id: "session-999" },
      body: {
        noReply: true,
        parts: [{ type: "text", text: "Result: hook\n" }],
      },
    })
  })
})