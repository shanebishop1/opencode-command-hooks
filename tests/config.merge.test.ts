import { describe, it, expect } from "bun:test"
import { mergeConfigs, findDuplicateIds } from "../src/config/merge.js"
import type { CommandHooksConfig, ToolHook, SessionHook } from "../src/types/hooks.js"

describe("findDuplicateIds", () => {
  it("returns empty array when no duplicates", () => {
    const hooks: ToolHook[] = [
      {
        id: "hook-1",
        when: { phase: "after", tool: ["task"] },
        run: "echo 1",
      },
      {
        id: "hook-2",
        when: { phase: "before", tool: ["bash"] },
        run: "echo 2",
      },
    ]
    expect(findDuplicateIds(hooks)).toEqual([])
  })

  it("detects single duplicate ID", () => {
    const hooks: ToolHook[] = [
      {
        id: "hook-1",
        when: { phase: "after", tool: ["task"] },
        run: "echo 1",
      },
      {
        id: "hook-2",
        when: { phase: "before", tool: ["bash"] },
        run: "echo 2",
      },
      {
        id: "hook-1",
        when: { phase: "after", tool: ["write"] },
        run: "echo 1b",
      },
    ]
    expect(findDuplicateIds(hooks)).toEqual(["hook-1"])
  })

  it("detects multiple duplicate IDs", () => {
    const hooks: ToolHook[] = [
      {
        id: "hook-1",
        when: { phase: "after", tool: ["task"] },
        run: "echo 1",
      },
      {
        id: "hook-2",
        when: { phase: "before", tool: ["bash"] },
        run: "echo 2",
      },
      {
        id: "hook-1",
        when: { phase: "after", tool: ["write"] },
        run: "echo 1b",
      },
      {
        id: "hook-2",
        when: { phase: "before", tool: ["read"] },
        run: "echo 2b",
      },
    ]
    const duplicates = findDuplicateIds(hooks)
    expect(duplicates).toContain("hook-1")
    expect(duplicates).toContain("hook-2")
    expect(duplicates.length).toBe(2)
  })

  it("detects triplicates", () => {
    const hooks: ToolHook[] = [
      {
        id: "hook-1",
        when: { phase: "after", tool: ["task"] },
        run: "echo 1",
      },
      {
        id: "hook-1",
        when: { phase: "after", tool: ["write"] },
        run: "echo 1b",
      },
      {
        id: "hook-1",
        when: { phase: "after", tool: ["bash"] },
        run: "echo 1c",
      },
    ]
    expect(findDuplicateIds(hooks)).toEqual(["hook-1"])
  })

  it("works with session hooks", () => {
    const hooks: SessionHook[] = [
      {
        id: "session-1",
        when: { event: "session.start", agent: ["*"] },
        run: "echo start",
      },
      {
        id: "session-2",
        when: { event: "session.idle", agent: ["*"] },
        run: "echo idle",
      },
      {
        id: "session-1",
        when: { event: "session.end", agent: ["*"] },
        run: "echo end",
      },
    ]
    expect(findDuplicateIds(hooks)).toEqual(["session-1"])
  })

  it("returns empty array for empty input", () => {
    expect(findDuplicateIds([])).toEqual([])
  })
})

describe("mergeConfigs", () => {
  it("merges empty configs", () => {
    const global: CommandHooksConfig = { tool: [], session: [] }
    const markdown: CommandHooksConfig = { tool: [], session: [] }

    const result = mergeConfigs(global, markdown)
    expect(result.config).toEqual({ tool: [], session: [] })
    expect(result.errors).toEqual([])
  })

  it("returns global hooks when markdown is empty", () => {
    const global: CommandHooksConfig = {
      tool: [
        {
          id: "global-hook",
          when: { phase: "after", tool: ["task"] },
          run: "echo global",
        },
      ],
      session: [],
    }
    const markdown: CommandHooksConfig = { tool: [], session: [] }

    const result = mergeConfigs(global, markdown)
    expect(result.config.tool).toHaveLength(1)
    expect(result.config.tool?.[0]?.id).toBe("global-hook")
    expect(result.config.tool?.[0]?.run).toBe("echo global")
    expect(result.errors).toEqual([])
  })

  it("returns markdown hooks when global is empty", () => {
    const global: CommandHooksConfig = { tool: [], session: [] }
    const markdown: CommandHooksConfig = {
      tool: [
        {
          id: "markdown-hook",
          when: { phase: "before", tool: ["bash"] },
          run: "echo markdown",
        },
      ],
      session: [],
    }

    const result = mergeConfigs(global, markdown)
    expect(result.config.tool).toHaveLength(1)
    expect(result.config.tool?.[0]?.id).toBe("markdown-hook")
    expect(result.config.tool?.[0]?.run).toBe("echo markdown")
    expect(result.errors).toEqual([])
  })

  it("markdown hook replaces global hook with same ID", () => {
    const global: CommandHooksConfig = {
      tool: [
        {
          id: "hook-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo global",
        },
      ],
      session: [],
    }
    const markdown: CommandHooksConfig = {
      tool: [
        {
          id: "hook-1",
          when: { phase: "before", tool: ["bash"] },
          run: "echo markdown",
        },
      ],
      session: [],
    }

    const result = mergeConfigs(global, markdown)
    expect(result.config.tool).toHaveLength(1)
    expect(result.config.tool?.[0]?.id).toBe("hook-1")
    expect(result.config.tool?.[0]?.run).toBe("echo markdown")
    expect(result.config.tool?.[0]?.when.tool).toEqual(["bash"])
    expect(result.errors).toEqual([])
  })

  it("preserves order: global first, then new markdown", () => {
    const global: CommandHooksConfig = {
      tool: [
        {
          id: "global-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo global-1",
        },
        {
          id: "global-2",
          when: { phase: "after", tool: ["write"] },
          run: "echo global-2",
        },
      ],
      session: [],
    }
    const markdown: CommandHooksConfig = {
      tool: [
        {
          id: "global-1",
          when: { phase: "before", tool: ["bash"] },
          run: "echo markdown-1",
        },
        {
          id: "markdown-3",
          when: { phase: "after", tool: ["read"] },
          run: "echo markdown-3",
        },
      ],
      session: [],
    }

    const result = mergeConfigs(global, markdown)
    expect(result.config.tool).toHaveLength(3)
    expect(result.config.tool?.[0]?.id).toBe("global-1")
    expect(result.config.tool?.[0]?.run).toBe("echo markdown-1") // replaced
    expect(result.config.tool?.[1]?.id).toBe("global-2") // kept
    expect(result.config.tool?.[2]?.id).toBe("markdown-3") // added
    expect(result.errors).toEqual([])
  })

  it("merges session hooks with same precedence rules", () => {
    const global: CommandHooksConfig = {
      tool: [],
      session: [
        {
          id: "session-1",
          when: { event: "session.start", agent: ["*"] },
          run: "echo global",
        },
      ],
    }
    const markdown: CommandHooksConfig = {
      tool: [],
      session: [
        {
          id: "session-1",
          when: { event: "session.idle", agent: ["*"] },
          run: "echo markdown",
        },
      ],
    }

    const result = mergeConfigs(global, markdown)
    expect(result.config.session).toHaveLength(1)
    expect(result.config.session?.[0]?.id).toBe("session-1")
    expect(result.config.session?.[0]?.run).toBe("echo markdown")
    expect(result.errors).toEqual([])
  })

  it("detects duplicate IDs in global config", () => {
    const global: CommandHooksConfig = {
      tool: [
        {
          id: "hook-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo 1",
        },
        {
          id: "hook-1",
          when: { phase: "before", tool: ["bash"] },
          run: "echo 1b",
        },
      ],
      session: [],
    }
    const markdown: CommandHooksConfig = { tool: [], session: [] }

    const result = mergeConfigs(global, markdown)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.type).toBe("duplicate_id")
    expect(result.errors[0]?.hookId).toBe("hook-1")
    expect(result.errors[0]?.message).toContain("global")
  })

  it("detects duplicate IDs in markdown config", () => {
    const global: CommandHooksConfig = { tool: [], session: [] }
    const markdown: CommandHooksConfig = {
      tool: [
        {
          id: "hook-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo 1",
        },
        {
          id: "hook-1",
          when: { phase: "before", tool: ["bash"] },
          run: "echo 1b",
        },
      ],
      session: [],
    }

    const result = mergeConfigs(global, markdown)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.type).toBe("duplicate_id")
    expect(result.errors[0]?.hookId).toBe("hook-1")
    expect(result.errors[0]?.message).toContain("markdown")
  })

  it("detects duplicates in both global and markdown", () => {
    const global: CommandHooksConfig = {
      tool: [
        {
          id: "hook-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo 1",
        },
        {
          id: "hook-1",
          when: { phase: "before", tool: ["bash"] },
          run: "echo 1b",
        },
      ],
      session: [],
    }
    const markdown: CommandHooksConfig = {
      tool: [
        {
          id: "hook-2",
          when: { phase: "after", tool: ["write"] },
          run: "echo 2",
        },
        {
          id: "hook-2",
          when: { phase: "before", tool: ["read"] },
          run: "echo 2b",
        },
      ],
      session: [],
    }

    const result = mergeConfigs(global, markdown)
    expect(result.errors).toHaveLength(2)
    const errorIds = result.errors.map((e) => e.hookId)
    expect(errorIds).toContain("hook-1")
    expect(errorIds).toContain("hook-2")
  })

  it("detects duplicates in session hooks", () => {
    const global: CommandHooksConfig = {
      tool: [],
      session: [
        {
          id: "session-1",
          when: { event: "session.start", agent: ["*"] },
          run: "echo 1",
        },
        {
          id: "session-1",
          when: { event: "session.idle", agent: ["*"] },
          run: "echo 1b",
        },
      ],
    }
    const markdown: CommandHooksConfig = { tool: [], session: [] }

    const result = mergeConfigs(global, markdown)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.type).toBe("duplicate_id")
    expect(result.errors[0]?.message).toContain("session")
  })

  it("returns merged config even when duplicates are present", () => {
    const global: CommandHooksConfig = {
      tool: [
        {
          id: "hook-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo global",
        },
        {
          id: "hook-1",
          when: { phase: "before", tool: ["bash"] },
          run: "echo global-dup",
        },
      ],
      session: [],
    }
    const markdown: CommandHooksConfig = { tool: [], session: [] }

    const result = mergeConfigs(global, markdown)
    // Should still return a merged config, even with errors
    expect(result.config.tool).toBeDefined()
    expect(result.errors).toHaveLength(1)
  })

  it("handles complex merge with multiple hooks and replacements", () => {
    const global: CommandHooksConfig = {
      tool: [
        {
          id: "global-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo global-1",
        },
        {
          id: "global-2",
          when: { phase: "after", tool: ["write"] },
          run: "echo global-2",
        },
        {
          id: "global-3",
          when: { phase: "before", tool: ["bash"] },
          run: "echo global-3",
        },
      ],
      session: [
        {
          id: "session-1",
          when: { event: "session.start", agent: ["*"] },
          run: "echo session-1",
        },
      ],
    }
    const markdown: CommandHooksConfig = {
      tool: [
        {
          id: "global-2",
          when: { phase: "after", tool: ["write"] },
          run: "echo markdown-2",
        },
        {
          id: "markdown-4",
          when: { phase: "after", tool: ["read"] },
          run: "echo markdown-4",
        },
      ],
      session: [
        {
          id: "session-1",
          when: { event: "session.idle", agent: ["*"] },
          run: "echo markdown-session-1",
        },
        {
          id: "session-2",
          when: { event: "session.end", agent: ["*"] },
          run: "echo session-2",
        },
      ],
    }

    const result = mergeConfigs(global, markdown)

    // Tool hooks: global-1, global-2 (replaced), global-3, markdown-4
    expect(result.config.tool).toHaveLength(4)
    expect(result.config.tool?.[0]?.id).toBe("global-1")
    expect(result.config.tool?.[1]?.id).toBe("global-2")
    expect(result.config.tool?.[1]?.run).toBe("echo markdown-2")
    expect(result.config.tool?.[2]?.id).toBe("global-3")
    expect(result.config.tool?.[3]?.id).toBe("markdown-4")

    // Session hooks: session-1 (replaced), session-2
    expect(result.config.session).toHaveLength(2)
    expect(result.config.session?.[0]?.id).toBe("session-1")
    expect(result.config.session?.[0]?.run).toBe("echo markdown-session-1")
    expect(result.config.session?.[1]?.id).toBe("session-2")

    expect(result.errors).toEqual([])
  })

  it("handles undefined tool/session arrays", () => {
    const global: CommandHooksConfig = {}
    const markdown: CommandHooksConfig = {
      tool: [
        {
          id: "hook-1",
          when: { phase: "after", tool: ["task"] },
          run: "echo markdown",
        },
      ],
    }

    const result = mergeConfigs(global, markdown)
    expect(result.config.tool).toHaveLength(1)
    expect(result.config.tool?.[0]?.id).toBe("hook-1")
    expect(result.errors).toEqual([])
  })
})
