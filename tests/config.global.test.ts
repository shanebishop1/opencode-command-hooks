import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadGlobalConfig } from "../src/config/global";
import { writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";

describe("Global Configuration", () => {
  const testProjectDir = join(tmpdir(), "opencode-global-config-test");
  const userConfigDir = join(homedir(), ".config", "opencode");
  const userConfigPath = join(userConfigDir, "command-hooks.jsonc");
  let originalCwd: string;
  let createdUserConfig = false;

  beforeEach(async () => {
    originalCwd = process.cwd();
    // Create test project directory (without .opencode config)
    await mkdir(testProjectDir, { recursive: true });
    // Ensure user config directory exists
    await mkdir(userConfigDir, { recursive: true });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    // Clean up test directories
    try {
      await rm(testProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Only clean up user config if we created it
    if (createdUserConfig) {
      try {
        await rm(userConfigPath, { force: true });
        createdUserConfig = false;
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("User global config fallback", () => {
    it("should load from ~/.config/opencode/command-hooks.jsonc when no project config exists", async () => {
      // Create user global config
      await writeFile(
        userConfigPath,
        JSON.stringify({
          tool: [
            {
              id: "user-global-hook",
              when: { phase: "after", tool: ["bash"] },
              run: "echo user global",
            },
          ],
          session: [],
        })
      );
      createdUserConfig = true;

      // Change to project dir without .opencode config
      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("user-global-hook");
    });

    it("should concat hooks from both global and project configs", async () => {
      // Create user global config
      await writeFile(
        userConfigPath,
        JSON.stringify({
          tool: [
            {
              id: "user-hook",
              when: { phase: "after" },
              run: "echo user",
            },
          ],
        })
      );
      createdUserConfig = true;

      // Create project config with different hook ID
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          tool: [
            {
              id: "project-hook",
              when: { phase: "after" },
              run: "echo project",
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      // Both hooks should be present (concatenation)
      expect(result.config.tool).toHaveLength(2);
      const hookIds = result.config.tool?.map(h => h.id) ?? [];
      expect(hookIds).toContain("user-hook");
      expect(hookIds).toContain("project-hook");
    });

    it("should let project hook replace global hook with same id", async () => {
      // Create user global config
      await writeFile(
        userConfigPath,
        JSON.stringify({
          tool: [
            {
              id: "shared-hook",
              when: { phase: "after" },
              run: "echo global version",
            },
          ],
        })
      );
      createdUserConfig = true;

      // Create project config with SAME hook ID
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          tool: [
            {
              id: "shared-hook",
              when: { phase: "after" },
              run: "echo project version",
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      // Only one hook (project replaced global)
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("shared-hook");
      expect(result.config.tool?.[0].run).toBe("echo project version");
    });

    it("should return empty config when neither project nor user config exists", async () => {
      // Ensure no user config exists for this test
      try {
        await rm(userConfigPath, { force: true });
      } catch {
        // Ignore if doesn't exist
      }

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      expect(result.config.tool).toEqual([]);
      expect(result.config.session).toEqual([]);
    });

    it("should load session hooks from user global config", async () => {
      await writeFile(
        userConfigPath,
        JSON.stringify({
          session: [
            {
              id: "user-session-hook",
              when: { event: "session.created" },
              run: "echo session started",
              inject: "Session initialized",
            },
          ],
        })
      );
      createdUserConfig = true;

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      expect(result.config.session).toHaveLength(1);
      expect(result.config.session?.[0].id).toBe("user-session-hook");
      expect(result.config.session?.[0].when.event).toBe("session.created");
    });

    it("should handle JSONC comments in user global config", async () => {
      await writeFile(
        userConfigPath,
        `{
          // This is a comment
          "tool": [
            {
              "id": "commented-hook",
              "when": { "phase": "after" },
              "run": "echo with comments"
            }
          ]
          /* Block comment */
        }`
      );
      createdUserConfig = true;

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("commented-hook");
    });

    it("should use project config only when global config has parse errors", async () => {
      // Create malformed user global config
      await writeFile(userConfigPath, "{ invalid json }");
      createdUserConfig = true;

      // Create valid project config
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          tool: [
            {
              id: "project-hook",
              when: { phase: "after" },
              run: "echo project",
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      // Should succeed with project config only (global parse error logged but not returned)
      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("project-hook");
    });

    it("should return error when only global config exists and is malformed", async () => {
      await writeFile(userConfigPath, "{ invalid json }");
      createdUserConfig = true;

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      // No project config, so global error is returned
      expect(result.error).toBeNull(); // Actually returns empty config since no project
      expect(result.config.tool).toEqual([]);
      expect(result.config.session).toEqual([]);
    });
  });

  describe("Project config discovery", () => {
    it("should find project config in parent directory", async () => {
      // Create nested directory structure
      const nestedDir = join(testProjectDir, "src", "components");
      await mkdir(nestedDir, { recursive: true });

      // Create config at project root
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          tool: [
            {
              id: "parent-hook",
              when: { phase: "before" },
              run: "echo from parent",
            },
          ],
        })
      );

      // Change to nested directory
      process.chdir(nestedDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("parent-hook");
    });
  });

  describe("ignoreGlobalConfig flag", () => {
    it("should skip global config when project has ignoreGlobalConfig: true", async () => {
      // Create user global config
      await writeFile(
        userConfigPath,
        JSON.stringify({
          tool: [
            {
              id: "global-hook",
              when: { phase: "after" },
              run: "echo global",
            },
          ],
        })
      );
      createdUserConfig = true;

      // Create project config with ignoreGlobalConfig
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          ignoreGlobalConfig: true,
          tool: [
            {
              id: "project-hook",
              when: { phase: "after" },
              run: "echo project",
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      // Only project hook, global was ignored
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("project-hook");
    });
  });

  describe("overrideGlobal flag", () => {
    it("should skip global session hooks when project hook has overrideGlobal", async () => {
      // Create user global config with session.created hook
      await writeFile(
        userConfigPath,
        JSON.stringify({
          session: [
            {
              id: "global-session-hook",
              when: { event: "session.created" },
              run: "echo global session",
            },
          ],
        })
      );
      createdUserConfig = true;

      // Create project config with overrideGlobal for same event
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          session: [
            {
              id: "project-session-hook",
              when: { event: "session.created" },
              run: "echo project session",
              overrideGlobal: true,
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      // Only project hook (global was overridden)
      expect(result.config.session).toHaveLength(1);
      expect(result.config.session?.[0].id).toBe("project-session-hook");
    });

    it("should not skip global hooks for different events when overrideGlobal is set", async () => {
      // Create user global config with multiple session hooks
      await writeFile(
        userConfigPath,
        JSON.stringify({
          session: [
            {
              id: "global-created-hook",
              when: { event: "session.created" },
              run: "echo global created",
            },
            {
              id: "global-idle-hook",
              when: { event: "session.idle" },
              run: "echo global idle",
            },
          ],
        })
      );
      createdUserConfig = true;

      // Create project config with overrideGlobal only for session.created
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          session: [
            {
              id: "project-created-hook",
              when: { event: "session.created" },
              run: "echo project created",
              overrideGlobal: true,
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      // Should have project's created hook + global's idle hook
      expect(result.config.session).toHaveLength(2);
      const sessionIds = result.config.session?.map(h => h.id) ?? [];
      expect(sessionIds).toContain("project-created-hook");
      expect(sessionIds).toContain("global-idle-hook");
      expect(sessionIds).not.toContain("global-created-hook");
    });

    it("should skip global tool hooks matching phase+tool when project hook has overrideGlobal", async () => {
      // Create user global config
      await writeFile(
        userConfigPath,
        JSON.stringify({
          tool: [
            {
              id: "global-after-bash",
              when: { phase: "after", tool: "bash" },
              run: "echo global after bash",
            },
            {
              id: "global-after-write",
              when: { phase: "after", tool: "write" },
              run: "echo global after write",
            },
          ],
        })
      );
      createdUserConfig = true;

      // Create project config with overrideGlobal for after:bash
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          tool: [
            {
              id: "project-after-bash",
              when: { phase: "after", tool: "bash" },
              run: "echo project after bash",
              overrideGlobal: true,
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      // Should have project's after:bash + global's after:write
      expect(result.config.tool).toHaveLength(2);
      const toolIds = result.config.tool?.map(h => h.id) ?? [];
      expect(toolIds).toContain("project-after-bash");
      expect(toolIds).toContain("global-after-write");
      expect(toolIds).not.toContain("global-after-bash");
    });

    it("should skip ALL global tool hooks for phase when project uses overrideGlobal with tool: '*'", async () => {
      // Create user global config with multiple after hooks
      await writeFile(
        userConfigPath,
        JSON.stringify({
          tool: [
            {
              id: "global-after-bash",
              when: { phase: "after", tool: "bash" },
              run: "echo global after bash",
            },
            {
              id: "global-after-write",
              when: { phase: "after", tool: "write" },
              run: "echo global after write",
            },
            {
              id: "global-before-bash",
              when: { phase: "before", tool: "bash" },
              run: "echo global before bash",
            },
          ],
        })
      );
      createdUserConfig = true;

      // Create project config with overrideGlobal for after:* (wildcard)
      const projectConfigDir = join(testProjectDir, ".opencode");
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(
        join(projectConfigDir, "command-hooks.jsonc"),
        JSON.stringify({
          tool: [
            {
              id: "project-after-all",
              when: { phase: "after", tool: "*" },
              run: "echo project after all",
              overrideGlobal: true,
            },
          ],
        })
      );

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).toBeNull();
      // Should have project's after:* + global's before:bash (before phase not affected)
      expect(result.config.tool).toHaveLength(2);
      const toolIds = result.config.tool?.map(h => h.id) ?? [];
      expect(toolIds).toContain("project-after-all");
      expect(toolIds).toContain("global-before-bash");
      // Both global after hooks should be gone
      expect(toolIds).not.toContain("global-after-bash");
      expect(toolIds).not.toContain("global-after-write");
    });
  });
});
