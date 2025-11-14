/**
 * Tests for hook matching and filtering logic
 *
 * Tests the matchToolHooks and matchSessionHooks functions with various
 * filter combinations and context scenarios.
 */

import { describe, it, expect } from "bun:test"
import { matchToolHooks, matchSessionHooks } from "../src/matching/matcher"
import type { ToolHook, SessionHook } from "../src/types/hooks"

// ============================================================================
// TOOL HOOK MATCHING TESTS
// ============================================================================

describe("matchToolHooks", () => {
  describe("phase matching", () => {
    it("should match hooks with correct phase", () => {
      const hooks: ToolHook[] = [
        {
          id: "before-hook",
          when: { phase: "before", tool: "*" },
          run: "echo before",
        },
        {
          id: "after-hook",
          when: { phase: "after", tool: "*" },
          run: "echo after",
        },
      ]

      const beforeMatches = matchToolHooks(hooks, {
        phase: "before",
        toolName: "bash",
      })
      expect(beforeMatches).toHaveLength(1)
      expect(beforeMatches[0].id).toBe("before-hook")

      const afterMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(afterMatches).toHaveLength(1)
      expect(afterMatches[0].id).toBe("after-hook")
    })

    it("should not match hooks with wrong phase", () => {
      const hooks: ToolHook[] = [
        {
          id: "before-hook",
          when: { phase: "before", tool: "*" },
          run: "echo before",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(0)
    })
  })

  describe("tool name matching", () => {
    it("should match wildcard tool filter", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-tool",
          when: { phase: "after", tool: "*" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(1)
    })

    it("should match specific tool in array", () => {
      const hooks: ToolHook[] = [
        {
          id: "task-hook",
          when: { phase: "after", tool: ["task", "bash"] },
          run: "echo task",
        },
      ]

      const taskMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "task",
      })
      expect(taskMatches).toHaveLength(1)

      const bashMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(bashMatches).toHaveLength(1)

      const writeMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "write",
      })
      expect(writeMatches).toHaveLength(0)
    })

    it("should match single tool string", () => {
      const hooks: ToolHook[] = [
        {
          id: "task-hook",
          when: { phase: "after", tool: "task" },
          run: "echo task",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "task",
      })
      expect(matches).toHaveLength(1)

      const noMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(noMatches).toHaveLength(0)
    })

    it("should handle omitted tool filter (defaults to wildcard)", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-tool",
          when: { phase: "after" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(1)
    })
  })

  describe("calling agent matching", () => {
    it("should match wildcard agent filter", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-agent",
          when: { phase: "after", tool: "*", callingAgent: "*" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "build",
      })
      expect(matches).toHaveLength(1)
    })

    it("should match specific agent in array", () => {
      const hooks: ToolHook[] = [
        {
          id: "agent-hook",
          when: { phase: "after", tool: "*", callingAgent: ["build", "test"] },
          run: "echo agent",
        },
      ]

      const buildMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "build",
      })
      expect(buildMatches).toHaveLength(1)

      const testMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "test",
      })
      expect(testMatches).toHaveLength(1)

      const otherMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "other",
      })
      expect(otherMatches).toHaveLength(0)
    })

    it("should match single agent string", () => {
      const hooks: ToolHook[] = [
        {
          id: "build-hook",
          when: { phase: "after", tool: "*", callingAgent: "build" },
          run: "echo build",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "build",
      })
      expect(matches).toHaveLength(1)

      const noMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "test",
      })
      expect(noMatches).toHaveLength(0)
    })

    it("should handle omitted agent filter (defaults to wildcard)", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-agent",
          when: { phase: "after", tool: "*" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "build",
      })
      expect(matches).toHaveLength(1)
    })

    it("should handle undefined calling agent in context", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-agent",
          when: { phase: "after", tool: "*", callingAgent: "*" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(1)
    })

    it("should not match specific agent when context agent is undefined", () => {
      const hooks: ToolHook[] = [
        {
          id: "build-hook",
          when: { phase: "after", tool: "*", callingAgent: "build" },
          run: "echo build",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(0)
    })
  })

  describe("slash command matching", () => {
    it("should match wildcard slash command filter", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-command",
          when: { phase: "after", tool: "*", slashCommand: "*" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        slashCommand: "build",
      })
      expect(matches).toHaveLength(1)
    })

    it("should match specific slash command in array", () => {
      const hooks: ToolHook[] = [
        {
          id: "command-hook",
          when: { phase: "after", tool: "*", slashCommand: ["build", "deploy"] },
          run: "echo command",
        },
      ]

      const buildMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        slashCommand: "build",
      })
      expect(buildMatches).toHaveLength(1)

      const deployMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        slashCommand: "deploy",
      })
      expect(deployMatches).toHaveLength(1)

      const otherMatches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        slashCommand: "other",
      })
      expect(otherMatches).toHaveLength(0)
    })

    it("should handle omitted slash command filter (defaults to wildcard)", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-command",
          when: { phase: "after", tool: "*" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        slashCommand: "build",
      })
      expect(matches).toHaveLength(1)
    })

    it("should handle undefined slash command in context", () => {
      const hooks: ToolHook[] = [
        {
          id: "any-command",
          when: { phase: "after", tool: "*", slashCommand: "*" },
          run: "echo any",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(1)
    })

    it("should not match specific slash command when context command is undefined", () => {
      const hooks: ToolHook[] = [
        {
          id: "build-command",
          when: { phase: "after", tool: "*", slashCommand: "build" },
          run: "echo build",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(0)
    })
  })

  describe("combined matching (AND logic)", () => {
    it("should require all conditions to match", () => {
      const hooks: ToolHook[] = [
        {
          id: "specific-hook",
          when: {
            phase: "after",
            tool: "task",
            callingAgent: "build",
            slashCommand: "deploy",
          },
          run: "echo specific",
        },
      ]

      // All match
      const allMatch = matchToolHooks(hooks, {
        phase: "after",
        toolName: "task",
        callingAgent: "build",
        slashCommand: "deploy",
      })
      expect(allMatch).toHaveLength(1)

      // Phase mismatch
      const phaseMismatch = matchToolHooks(hooks, {
        phase: "before",
        toolName: "task",
        callingAgent: "build",
        slashCommand: "deploy",
      })
      expect(phaseMismatch).toHaveLength(0)

      // Tool mismatch
      const toolMismatch = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
        callingAgent: "build",
        slashCommand: "deploy",
      })
      expect(toolMismatch).toHaveLength(0)

      // Agent mismatch
      const agentMismatch = matchToolHooks(hooks, {
        phase: "after",
        toolName: "task",
        callingAgent: "test",
        slashCommand: "deploy",
      })
      expect(agentMismatch).toHaveLength(0)

      // Command mismatch
      const commandMismatch = matchToolHooks(hooks, {
        phase: "after",
        toolName: "task",
        callingAgent: "build",
        slashCommand: "build",
      })
      expect(commandMismatch).toHaveLength(0)
    })
  })

  describe("order preservation", () => {
    it("should return hooks in input order", () => {
      const hooks: ToolHook[] = [
        {
          id: "first",
          when: { phase: "after", tool: "*" },
          run: "echo first",
        },
        {
          id: "second",
          when: { phase: "after", tool: "*" },
          run: "echo second",
        },
        {
          id: "third",
          when: { phase: "after", tool: "*" },
          run: "echo third",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(3)
      expect(matches[0].id).toBe("first")
      expect(matches[1].id).toBe("second")
      expect(matches[2].id).toBe("third")
    })

    it("should preserve order when filtering subset", () => {
      const hooks: ToolHook[] = [
        {
          id: "first",
          when: { phase: "after", tool: "task" },
          run: "echo first",
        },
        {
          id: "second",
          when: { phase: "after", tool: "*" },
          run: "echo second",
        },
        {
          id: "third",
          when: { phase: "after", tool: "bash" },
          run: "echo third",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(2)
      expect(matches[0].id).toBe("second")
      expect(matches[1].id).toBe("third")
    })
  })

  describe("edge cases", () => {
    it("should handle empty hook array", () => {
      const matches = matchToolHooks([], {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(0)
    })

    it("should handle no matching hooks", () => {
      const hooks: ToolHook[] = [
        {
          id: "task-hook",
          when: { phase: "after", tool: "task" },
          run: "echo task",
        },
      ]

      const matches = matchToolHooks(hooks, {
        phase: "after",
        toolName: "bash",
      })
      expect(matches).toHaveLength(0)
    })
  })
})

// ============================================================================
// SESSION HOOK MATCHING TESTS
// ============================================================================

describe("matchSessionHooks", () => {
  describe("event matching", () => {
    it("should match hooks with correct event", () => {
      const hooks: SessionHook[] = [
        {
          id: "start-hook",
          when: { event: "session.start", agent: "*" },
          run: "echo start",
        },
        {
          id: "idle-hook",
          when: { event: "session.idle", agent: "*" },
          run: "echo idle",
        },
        {
          id: "end-hook",
          when: { event: "session.end", agent: "*" },
          run: "echo end",
        },
      ]

      const startMatches = matchSessionHooks(hooks, {
        event: "session.start",
      })
      expect(startMatches).toHaveLength(1)
      expect(startMatches[0].id).toBe("start-hook")

      const idleMatches = matchSessionHooks(hooks, {
        event: "session.idle",
      })
      expect(idleMatches).toHaveLength(1)
      expect(idleMatches[0].id).toBe("idle-hook")

      const endMatches = matchSessionHooks(hooks, {
        event: "session.end",
      })
      expect(endMatches).toHaveLength(1)
      expect(endMatches[0].id).toBe("end-hook")
    })

    it("should not match hooks with wrong event", () => {
      const hooks: SessionHook[] = [
        {
          id: "start-hook",
          when: { event: "session.start", agent: "*" },
          run: "echo start",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.idle",
      })
      expect(matches).toHaveLength(0)
    })
  })

  describe("agent matching", () => {
    it("should match wildcard agent filter", () => {
      const hooks: SessionHook[] = [
        {
          id: "any-agent",
          when: { event: "session.start", agent: "*" },
          run: "echo any",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "build",
      })
      expect(matches).toHaveLength(1)
    })

    it("should match specific agent in array", () => {
      const hooks: SessionHook[] = [
        {
          id: "agent-hook",
          when: { event: "session.start", agent: ["build", "test"] },
          run: "echo agent",
        },
      ]

      const buildMatches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "build",
      })
      expect(buildMatches).toHaveLength(1)

      const testMatches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "test",
      })
      expect(testMatches).toHaveLength(1)

      const otherMatches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "other",
      })
      expect(otherMatches).toHaveLength(0)
    })

    it("should match single agent string", () => {
      const hooks: SessionHook[] = [
        {
          id: "build-hook",
          when: { event: "session.start", agent: "build" },
          run: "echo build",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "build",
      })
      expect(matches).toHaveLength(1)

      const noMatches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "test",
      })
      expect(noMatches).toHaveLength(0)
    })

    it("should handle omitted agent filter (defaults to wildcard)", () => {
      const hooks: SessionHook[] = [
        {
          id: "any-agent",
          when: { event: "session.start" },
          run: "echo any",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "build",
      })
      expect(matches).toHaveLength(1)
    })

    it("should handle undefined agent in context", () => {
      const hooks: SessionHook[] = [
        {
          id: "any-agent",
          when: { event: "session.start", agent: "*" },
          run: "echo any",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
      })
      expect(matches).toHaveLength(1)
    })

    it("should not match specific agent when context agent is undefined", () => {
      const hooks: SessionHook[] = [
        {
          id: "build-hook",
          when: { event: "session.start", agent: "build" },
          run: "echo build",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
      })
      expect(matches).toHaveLength(0)
    })
  })

  describe("combined matching (AND logic)", () => {
    it("should require all conditions to match", () => {
      const hooks: SessionHook[] = [
        {
          id: "specific-hook",
          when: { event: "session.start", agent: "build" },
          run: "echo specific",
        },
      ]

      // All match
      const allMatch = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "build",
      })
      expect(allMatch).toHaveLength(1)

      // Event mismatch
      const eventMismatch = matchSessionHooks(hooks, {
        event: "session.idle",
        agent: "build",
      })
      expect(eventMismatch).toHaveLength(0)

      // Agent mismatch
      const agentMismatch = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "test",
      })
      expect(agentMismatch).toHaveLength(0)
    })
  })

  describe("order preservation", () => {
    it("should return hooks in input order", () => {
      const hooks: SessionHook[] = [
        {
          id: "first",
          when: { event: "session.start", agent: "*" },
          run: "echo first",
        },
        {
          id: "second",
          when: { event: "session.start", agent: "*" },
          run: "echo second",
        },
        {
          id: "third",
          when: { event: "session.start", agent: "*" },
          run: "echo third",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
      })
      expect(matches).toHaveLength(3)
      expect(matches[0].id).toBe("first")
      expect(matches[1].id).toBe("second")
      expect(matches[2].id).toBe("third")
    })

    it("should preserve order when filtering subset", () => {
      const hooks: SessionHook[] = [
        {
          id: "first",
          when: { event: "session.start", agent: "build" },
          run: "echo first",
        },
        {
          id: "second",
          when: { event: "session.start", agent: "*" },
          run: "echo second",
        },
        {
          id: "third",
          when: { event: "session.start", agent: "test" },
          run: "echo third",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "test",
      })
      expect(matches).toHaveLength(2)
      expect(matches[0].id).toBe("second")
      expect(matches[1].id).toBe("third")
    })
  })

  describe("edge cases", () => {
    it("should handle empty hook array", () => {
      const matches = matchSessionHooks([], {
        event: "session.start",
      })
      expect(matches).toHaveLength(0)
    })

    it("should handle no matching hooks", () => {
      const hooks: SessionHook[] = [
        {
          id: "build-hook",
          when: { event: "session.start", agent: "build" },
          run: "echo build",
        },
      ]

      const matches = matchSessionHooks(hooks, {
        event: "session.start",
        agent: "test",
      })
      expect(matches).toHaveLength(0)
    })
  })
})
