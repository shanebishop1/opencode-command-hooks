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

    it("should prefer project config over user global config", async () => {
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

      // Create project config
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
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("project-hook");
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

    it("should return error for malformed user global config", async () => {
      await writeFile(userConfigPath, "{ invalid json }");
      createdUserConfig = true;

      process.chdir(testProjectDir);

      const result = await loadGlobalConfig();

      expect(result.error).not.toBeNull();
      expect(result.error).toContain("Failed to parse");
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
});
