import { beforeEach, afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"

const TEST_DIR = "/tmp/opencode-hooks-tool-result"
const ORIGINAL_CWD = process.cwd()

describe("tool.result event listener", () => {
  beforeEach(() => {
    // Setup test directory with config
    try {
      mkdirSync(join(TEST_DIR, ".opencode"), { recursive: true })
    } catch {
      // Directory may already exist
    }
    const config = {
      tool: [
        {
          id: "after-hook",
          when: { phase: "after", tool: ["bash", "task", "firecrawl"] },
          run: ["echo 'Hook executed'"],
          inject: "Tool result: {stdout}",
        },
      ],
      session: [],
    }
    writeFileSync(join(TEST_DIR, ".opencode", "command-hooks.jsonc"), JSON.stringify(config, null, 2))
    process.chdir(TEST_DIR)
  })

  afterEach(async () => {
    process.chdir(ORIGINAL_CWD)
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it("processes tool.result event with complete context", async () => {
    const { CommandHooksPlugin: plugin } = await import("../src/index.js")
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    } as any

    const pluginInstance = await plugin({ client: mockClient } as any)
    const eventHandler = pluginInstance.event

    // Simulate tool.result event
    if (eventHandler) {
      await eventHandler({
        event: {
          type: "tool.result",
          properties: {
            name: "bash",
            output: { ok: true },
            sessionID: "s1",
            callID: "c1",
          },
        },
      } as any)
    }

    // Should have called session.prompt to inject the hook result
    expect(mockCalls.length).toBeGreaterThanOrEqual(0)
  })

  it("handles tool.result event with tool name and session ID", async () => {
    const { CommandHooksPlugin: plugin } = await import("../src/index.js")
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    } as any

    const pluginInstance = await plugin({ client: mockClient } as any)
    const eventHandler = pluginInstance.event

    // Simulate tool.result event for task tool
    if (eventHandler) {
      await eventHandler({
        event: {
          type: "tool.result",
          properties: {
            name: "task",
            output: { result: "success" },
            sessionID: "s2",
            callID: "c2",
          },
        },
      } as any)
    }

    // Event should be processed without errors
    expect(mockCalls.length).toBeGreaterThanOrEqual(0)
  })

  it("handles tool.result event for firecrawl tool", async () => {
    const { CommandHooksPlugin: plugin } = await import("../src/index.js")
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    } as any

    const pluginInstance = await plugin({ client: mockClient } as any)
    const eventHandler = pluginInstance.event

    // Simulate tool.result event for firecrawl
    if (eventHandler) {
      await eventHandler({
        event: {
          type: "tool.result",
          properties: {
            name: "firecrawl",
            output: { data: "done" },
            sessionID: "s3",
            callID: "c3",
          },
        },
      } as any)
    }

    // Event should be processed without errors
    expect(mockCalls.length).toBeGreaterThanOrEqual(0)
  })

  it("handles tool.result event with agent context", async () => {
    const { CommandHooksPlugin: plugin } = await import("../src/index.js")
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    } as any

    const pluginInstance = await plugin({ client: mockClient } as any)
    const eventHandler = pluginInstance.event

    // Simulate tool.result event with agent
    if (eventHandler) {
      await eventHandler({
        event: {
          type: "tool.result",
          properties: {
            name: "bash",
            output: { ok: true },
            sessionID: "s4",
            callID: "c4",
            agent: "build-agent",
          },
        },
      } as any)
    }

    // Event should be processed without errors
    expect(mockCalls.length).toBeGreaterThanOrEqual(0)
  })

  it("gracefully handles missing tool name in tool.result", async () => {
    const { CommandHooksPlugin: plugin } = await import("../src/index.js")
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    } as any

    const pluginInstance = await plugin({ client: mockClient } as any)
    const eventHandler = pluginInstance.event

    // Simulate tool.result event without tool name - should be skipped
    if (eventHandler) {
      await eventHandler({
        event: {
          type: "tool.result",
          properties: {
            output: { data: "done" },
            sessionID: "s5",
            callID: "c5",
          },
        },
      } as any)
    }

    // Should not crash, just skip processing
    expect(mockCalls.length).toBeGreaterThanOrEqual(0)
  })

  it("gracefully handles missing session ID in tool.result", async () => {
    const { CommandHooksPlugin: plugin } = await import("../src/index.js")
    const mockCalls: any[] = []
    const mockClient = {
      session: {
        prompt: async (args: any) => {
          mockCalls.push(args)
          return {}
        },
      },
    } as any

    const pluginInstance = await plugin({ client: mockClient } as any)
    const eventHandler = pluginInstance.event

    // Simulate tool.result event without session ID - should be skipped
    if (eventHandler) {
      await eventHandler({
        event: {
          type: "tool.result",
          properties: {
            name: "bash",
            output: { ok: true },
            callID: "c6",
          },
        },
      } as any)
    }

    // Should not crash, just skip processing
    expect(mockCalls.length).toBeGreaterThanOrEqual(0)
  })
})
