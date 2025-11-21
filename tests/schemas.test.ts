import { describe, it, expect } from "bun:test";
import {
  parseConfig,
  parseToolHook,
  parseSessionHook,
  getConfigValidationErrors,
} from "../src/schemas";

describe("Zod Schemas", () => {
  describe("parseConfig", () => {
    it("should parse valid config with tool and session hooks", () => {
      const config = {
        tool: [
          {
            id: "test-hook",
            when: { phase: "after", tool: "task" },
            run: "echo test",
          },
        ],
        session: [
          {
            id: "session-hook",
            when: { event: "session.start" },
            run: ["git status"],
          },
        ],
      };

      const result = parseConfig(config);
      expect(result.tool).toHaveLength(1);
      expect(result.session).toHaveLength(1);
      expect(result.tool?.[0].id).toBe("test-hook");
      expect(result.session?.[0].id).toBe("session-hook");
    });

    it("should return safe defaults on invalid input", () => {
      const result = parseConfig(null);
      expect(result.tool).toEqual([]);
      expect(result.session).toEqual([]);
    });

    it("should return safe defaults on truly invalid structure", () => {
      // Pass something that really doesn't match the schema (e.g., array instead of object)
      const result = parseConfig(["not", "an", "object"]);
      expect(result.tool).toEqual([]);
      expect(result.session).toEqual([]);
    });

    it("should return undefined fields when config is empty but valid", () => {
      const result = parseConfig({});
      // Empty object is valid - just has undefined fields
      expect(result.tool).toBeUndefined();
      expect(result.session).toBeUndefined();
    });

    it("should handle empty config", () => {
      const result = parseConfig({});
      expect(result.tool).toBeUndefined();
      expect(result.session).toBeUndefined();
    });
  });

  describe("parseToolHook", () => {
    it("should parse valid tool hook", () => {
      const hook = {
        id: "my-hook",
        when: { phase: "before", tool: ["bash", "write"] },
        run: "echo before",
      };

      const result = parseToolHook(hook);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("my-hook");
      expect(result?.when.phase).toBe("before");
    });

    it("should return null for invalid tool hook", () => {
      const hook = {
        id: "my-hook",
        // missing 'when'
        run: "echo test",
      };

      const result = parseToolHook(hook);
      expect(result).toBeNull();
    });

    it("should handle optional fields", () => {
      const hook = {
        id: "minimal-hook",
        when: { phase: "after" },
        run: "echo test",
      };

      const result = parseToolHook(hook);
      expect(result).not.toBeNull();
      expect(result?.inject).toBeUndefined();
      expect(result?.consoleLog).toBeUndefined();
    });

    it("should handle inject configuration", () => {
      const hook = {
        id: "hook-with-inject",
        when: { phase: "after", tool: "task" },
        run: "echo test",
        inject: "Result: {exitCode}",
      };

      const result = parseToolHook(hook);
      expect(result?.inject).toBe("Result: {exitCode}");
    });
  });

  describe("parseSessionHook", () => {
    it("should parse valid session hook", () => {
      const hook = {
        id: "session-hook",
        when: { event: "session.start" },
        run: "git status",
      };

      const result = parseSessionHook(hook);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("session-hook");
      expect(result?.when.event).toBe("session.start");
    });

    it("should return null for invalid session hook", () => {
      const hook = {
        id: "session-hook",
        when: { event: "invalid-event" },
        run: "git status",
      };

      const result = parseSessionHook(hook);
      expect(result).toBeNull();
    });

    it("should support agent filtering", () => {
      const hook = {
        id: "agent-filtered",
        when: { event: "session.idle", agent: ["build", "validator"] },
        run: "echo idle",
      };

      const result = parseSessionHook(hook);
      expect(result?.when.agent).toEqual(["build", "validator"]);
    });
  });

  describe("getConfigValidationErrors", () => {
    it("should return null for valid config", () => {
      const config = {
        tool: [
          {
            id: "test",
            when: { phase: "after" },
            run: "echo test",
          },
        ],
      };

      const errors = getConfigValidationErrors(config);
      expect(errors).toBeNull();
    });

    it("should return errors for invalid config", () => {
      const config = {
        tool: [
          {
            id: "", // Empty ID should fail
            when: { phase: "after" },
            run: "echo test",
          },
        ],
      };

      const errors = getConfigValidationErrors(config);
      expect(errors).not.toBeNull();
    });
  });

  describe("Schema flexibility", () => {
    it("should accept string or array for tool field", () => {
      const hookWithString = {
        id: "hook1",
        when: { phase: "after", tool: "task" },
        run: "echo test",
      };

      const hookWithArray = {
        id: "hook2",
        when: { phase: "after", tool: ["task", "bash"] },
        run: "echo test",
      };

      expect(parseToolHook(hookWithString)).not.toBeNull();
      expect(parseToolHook(hookWithArray)).not.toBeNull();
    });

    it("should accept string or array for run field", () => {
      const hookWithString = {
        id: "hook1",
        when: { phase: "after" },
        run: "echo test",
      };

      const hookWithArray = {
        id: "hook2",
        when: { phase: "after" },
        run: ["echo test", "echo done"],
      };

      expect(parseToolHook(hookWithString)).not.toBeNull();
      expect(parseToolHook(hookWithArray)).not.toBeNull();
    });
  });

  describe("Validation edge cases", () => {
    it("should reject empty hook ID", () => {
      const hook = {
        id: "",
        when: { phase: "after" },
        run: "echo test",
      };

      const result = parseToolHook(hook);
      expect(result).toBeNull();
    });

    it("should reject invalid phase", () => {
      const hook = {
        id: "hook",
        when: { phase: "invalid" },
        run: "echo test",
      };

      const result = parseToolHook(hook);
      expect(result).toBeNull();
    });

    it("should reject invalid session event", () => {
      const hook = {
        id: "hook",
        when: { event: "invalid.event" },
        run: "echo test",
      };

      const result = parseSessionHook(hook);
      expect(result).toBeNull();
    });

    it("should allow inject as string template", () => {
      const hook = {
        id: "hook",
        when: { phase: "after" },
        run: "echo test",
        inject: "Command completed",
      };

      const result = parseToolHook(hook);
      expect(result).not.toBeNull();
      expect(result?.inject).toBe("Command completed");
    });
  });
});
