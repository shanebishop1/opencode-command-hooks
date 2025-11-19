import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test"
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
            as: "user",
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

  it("passes the most recent agent/model into session.prompt", async () => {
    const mockSessionMessages = mock(async () => ({
      data: [
        {
          info: {
            role: "user",
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-3-5" },
          },
        },
        {
          info: {
            role: "assistant",
            mode: "dev",
            providerID: "x-provider",
            modelID: "grok-fast",
          },
        },
      ],
    }))
    const mockSessionPrompt = mock(async () => ({}))

    const client = {
      session: {
        messages: mockSessionMessages,
        prompt: mockSessionPrompt,
      },
    }

    const event = {
      tool: "test-tool",
      input: {},
      sessionId: "session-123",
      callId: "call-a",
    }

    await handleToolExecuteAfter(event as any, client as any)

    expect(mockSessionMessages).toHaveBeenCalledTimes(1)
    expect(mockSessionMessages).toHaveBeenCalledWith({
      path: { id: "session-123" },
      query: { limit: 50 },
    })

    expect(mockSessionPrompt).toHaveBeenCalledTimes(1)
    const promptCall = mockSessionPrompt.mock.calls[0]?.[0]
    expect(promptCall?.body?.agent).toBe("dev")
    expect(promptCall?.body?.model).toEqual({ providerID: "x-provider", modelID: "grok-fast" })
  })

  it("falls back to calling agent when message history fails", async () => {
    const mockSessionMessages = mock(async () => {
      throw new Error("network failure")
    })
    const mockSessionPrompt = mock(async () => ({}))

    const client = {
      session: {
        messages: mockSessionMessages,
        prompt: mockSessionPrompt,
      },
    }

    const event = {
      tool: "test-tool",
      input: {},
      sessionId: "session-999",
      callId: "call-b",
      callingAgent: "orchestrator",
    }

    await handleToolExecuteAfter(event as any, client as any)

    expect(mockSessionMessages).toHaveBeenCalledTimes(1)
    const promptCall = mockSessionPrompt.mock.calls[0]?.[0]
    expect(promptCall?.body?.agent).toBe("orchestrator")
    expect(promptCall?.body?.model).toBeUndefined()
  })
})
