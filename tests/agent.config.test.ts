import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveAgentPath, loadAgentConfig } from "../src/config/agent";
import { writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { realpathSync } from "fs";

describe("Agent Configuration", () => {
  const testAgentDir = join(tmpdir(), "opencode-test-agents");
  const testProjectDir = join(tmpdir(), "opencode-test-project");

  beforeEach(async () => {
    // Create test directories
    await mkdir(join(testAgentDir, ".opencode", "agent"), { recursive: true });
    await mkdir(join(testProjectDir, ".opencode", "agent"), { recursive: true });
    await mkdir(join(process.env.HOME || "", ".config", "opencode", "agent"), { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await rm(testAgentDir, { recursive: true, force: true });
      await rm(testProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("resolveAgentPath", () => {
    it("should return null for invalid agent names", async () => {
      expect(await resolveAgentPath("")).toBeNull();
      expect(await resolveAgentPath("/etc/passwd")).toBeNull();
      expect(await resolveAgentPath("../etc/passwd")).toBeNull();
      expect(await resolveAgentPath("agent/../../../etc/passwd")).toBeNull();
    });

    it("should return project-level agent file if it exists", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "test-agent.md");
      await writeFile(agentPath, "---\ndescription: Test agent\n---\n# Test agent content");

      // Temporarily change cwd to test project directory
      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const result = await resolveAgentPath("test-agent");
        expect(realpathSync(result!)).toBe(realpathSync(agentPath));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should return user-level agent file if project file doesn't exist", async () => {
      const userAgentPath = join(process.env.HOME || "", ".config", "opencode", "agent", "user-agent.md");
      await writeFile(userAgentPath, "---\ndescription: User agent\n---\n# User agent content");

      const result = await resolveAgentPath("user-agent");
      expect(realpathSync(result!)).toBe(realpathSync(userAgentPath));
    });

    it("should return null if no agent file exists", async () => {
      const result = await resolveAgentPath("nonexistent-agent");
      expect(result).toBeNull();
    });

    it("should prioritize project-level over user-level", async () => {
      const projectAgentPath = join(testProjectDir, ".opencode", "agent", "priority-test.md");
      const userAgentPath = join(process.env.HOME || "", ".config", "opencode", "agent", "priority-test.md");

      await writeFile(projectAgentPath, "---\ndescription: Project agent\n---\n# Project content");
      await writeFile(userAgentPath, "---\ndescription: User agent\n---\n# User content");

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const result = await resolveAgentPath("priority-test");
        expect(realpathSync(result!)).toBe(realpathSync(projectAgentPath));
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("loadAgentConfig", () => {
    it("should return empty config for nonexistent agent", async () => {
      const config = await loadAgentConfig("nonexistent-agent");
      expect(config).toEqual({ tool: [], session: [] });
    });

    it("should load agent config with tool hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "engineer.md");
      await writeFile(
        agentPath,
        `---
description: An engineer agent
command_hooks:
  tool:
    - id: "test-hook"
      when:
        phase: "after"
        tool: ["task"]
      run: ["npm run typecheck", "npm run lint"]
      inject: |
        Validation results:
        {stdout}
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("engineer");

        expect(config.tool).toHaveLength(1);
        expect(config.tool?.[0].id).toBe("test-hook");
        expect(config.tool?.[0].when.phase).toBe("after");
        expect(config.tool?.[0].when.tool).toEqual(["task"]);
        expect(config.tool?.[0].run).toEqual(["npm run typecheck", "npm run lint"]);
        expect(config.session).toEqual([]);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should load agent config with session hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "session-agent.md");
      await writeFile(
        agentPath,
        `---
description: Agent with session hooks
command_hooks:
  session:
    - id: "session-start-hook"
      when:
        event: "session.start"
      run: "git status"
      inject: "Session started: {stdout}"
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("session-agent");

        expect(config.session).toHaveLength(1);
        expect(config.session?.[0].id).toBe("session-start-hook");
        expect(config.session?.[0].when.event).toBe("session.start");
        expect(config.tool).toEqual([]);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should load agent config with both tool and session hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "full-agent.md");
      await writeFile(
        agentPath,
        `---
description: Full featured agent
command_hooks:
  tool:
    - id: "tool-hook"
      when:
        phase: "before"
      run: "echo before"
  session:
    - id: "session-hook"
      when:
        event: "session.start"
      run: "echo session"
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("full-agent");

        expect(config.tool).toHaveLength(1);
        expect(config.session).toHaveLength(1);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should return empty config for agent file without frontmatter", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "no-frontmatter.md");
      await writeFile(agentPath, "# Agent content\n\nNo frontmatter here");

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("no-frontmatter");
        expect(config).toEqual({ tool: [], session: [] });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should return empty config for agent file with malformed YAML", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "malformed.md");
      await writeFile(
        agentPath,
        `---
description: Agent with malformed YAML
command_hooks:
  tool:
    - id: "test"
      when:
        phase: "after"
        tool: ["task]
      run: "echo test"
---
# Agent content`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("malformed");
        expect(config).toEqual({ tool: [], session: [] });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should return empty config for agent file without command_hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "no-hooks.md");
      await writeFile(
        agentPath,
        `---
description: Agent without hooks
mode: subagent
---
# Agent content`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("no-hooks");
        expect(config).toEqual({ tool: [], session: [] });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should load simplified hooks format", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "simple-agent.md");
      await writeFile(
        agentPath,
        `---
description: Agent with simplified hooks
mode: subagent
hooks:
  before:
    - run: "echo 'Starting...'"
  after:
    - run: ["npm run typecheck", "npm run lint"]
      inject: |
        Validation results:
        {stdout}
      toast:
        message: "Validation complete"
        variant: "success"
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("simple-agent");

        expect(config.tool).toHaveLength(2); // 1 before + 1 after
        
        // Check before hook
        const beforeHook = config.tool?.find(h => h.id === "simple-agent-before-0");
        expect(beforeHook).toBeDefined();
        expect(beforeHook?.when.phase).toBe("before");
        expect(beforeHook?.when.tool).toEqual(["task"]);
        expect(beforeHook?.when.callingAgent).toEqual(["simple-agent"]);
        expect(beforeHook?.run).toBe("echo 'Starting...'");
        expect(beforeHook?.inject).toBeUndefined();
        
        // Check after hook
        const afterHook = config.tool?.find(h => h.id === "simple-agent-after-0");
        expect(afterHook).toBeDefined();
        expect(afterHook?.when.phase).toBe("after");
        expect(afterHook?.when.tool).toEqual(["task"]);
        expect(afterHook?.when.callingAgent).toEqual(["simple-agent"]);
        expect(afterHook?.run).toEqual(["npm run typecheck", "npm run lint"]);
        expect(afterHook?.inject).toContain("Validation results");
        expect(afterHook?.toast).toEqual({
          message: "Validation complete",
          variant: "success"
        });
        
        expect(config.session).toEqual([]);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should load simplified hooks with only after hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "after-only.md");
      await writeFile(
        agentPath,
        `---
description: Agent with only after hooks
hooks:
  after:
    - run: "npm run test"
      inject: |
        Test results:
        {stdout}
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("after-only");

        expect(config.tool).toHaveLength(1);
        const hook = config.tool?.[0];
        expect(hook?.id).toBe("after-only-after-0");
        expect(hook?.when.phase).toBe("after");
        expect(hook?.run).toBe("npm run test");
        expect(hook?.inject).toContain("Test results");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should load simplified hooks with only before hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "before-only.md");
      await writeFile(
        agentPath,
        `---
description: Agent with only before hooks
hooks:
  before:
    - run: "echo 'Before work...'"
    - run: "npm run setup"
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("before-only");

        expect(config.tool).toHaveLength(2);
        
        const before0 = config.tool?.find(h => h.id === "before-only-before-0");
        expect(before0?.run).toBe("echo 'Before work...'");
        
        const before1 = config.tool?.find(h => h.id === "before-only-before-1");
        expect(before1?.run).toBe("npm run setup");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should prioritize simplified hooks over command_hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "priority-test.md");
      await writeFile(
        agentPath,
        `---
description: Agent with both formats
command_hooks:
  tool:
    - id: "legacy-hook"
      when:
        phase: "after"
      run: "echo legacy"
hooks:
  after:
    - run: "echo simplified"
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("priority-test");

        // Should only have the simplified hook, not the legacy one
        expect(config.tool).toHaveLength(1);
        expect(config.tool?.[0].id).toBe("priority-test-after-0");
        expect(config.tool?.[0].run).toBe("echo simplified");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should handle invalid simplified hooks gracefully", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "invalid-simple.md");
      await writeFile(
        agentPath,
        `---
description: Agent with invalid simplified hooks
hooks:
  before:
    - run: "echo valid"
  after:
    - run: ["npm run test", "npm run lint"]
      inject: 123  # Invalid inject (should be string)
      toast: "not an object"  # Invalid toast
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("invalid-simple");

        // Should still load the valid before hook and potentially the after hook (with invalid parts ignored)
        expect(config.tool).toHaveLength(2);
        expect(config.tool?.[0].id).toBe("invalid-simple-before-0");
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should return empty config for malformed simplified hooks", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "malformed-simple.md");
      await writeFile(
        agentPath,
        `---
description: Agent with malformed simplified hooks
hooks:
  before: "not an array"
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);
        const config = await loadAgentConfig("malformed-simple");

        // Should return empty config due to malformed hooks
        expect(config).toEqual({ tool: [], session: [] });
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("should cache loaded configurations", async () => {
      const agentPath = join(testProjectDir, ".opencode", "agent", "cache-test.md");
      await writeFile(
        agentPath,
        `---
description: Cache test agent
command_hooks:
  tool:
    - id: "cache-hook"
      when:
        phase: "after"
      run: "echo cached"
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);

        // Load config twice
        const config1 = await loadAgentConfig("cache-test");
        const config2 = await loadAgentConfig("cache-test");

        // Both should return the same result
        expect(config1).toEqual(config2);
        expect(config1.tool).toHaveLength(1);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("Integration scenarios", () => {
    it("should handle task tool calls with subagent_type in index.ts", async () => {
      // This test verifies the integration pattern - in a real scenario,
      // the plugin would detect task tool calls and load agent configs

      const engineerAgentPath = join(testProjectDir, ".opencode", "agent", "engineer.md");
      await writeFile(
        engineerAgentPath,
        `---
description: Engineer agent
command_hooks:
  tool:
    - id: "validate-after-engineer"
      when:
        phase: "after"
        tool: ["task"]
      run: ["npm run typecheck", "npm run lint"]
      inject: |
        Validation results:
        {stdout}
---`
      );

      const originalCwd = process.cwd();
      try {
        process.chdir(testProjectDir);

        // Simulate what the plugin would do
        const agentName = "engineer";
        const agentConfig = await loadAgentConfig(agentName);

        // Verify the agent config has the expected hooks
        expect(agentConfig.tool).toHaveLength(1);
        expect(agentConfig.tool?.[0].id).toBe("validate-after-engineer");

        // In the actual plugin, this would be merged with global config
        // and used to filter and execute hooks
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
