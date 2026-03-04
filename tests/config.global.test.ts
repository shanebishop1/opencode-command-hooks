import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { clearGlobalConfigCacheForTests, loadGlobalConfig } from "../src/config/global";
import { writeFile, rm, mkdir, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("Global Configuration", () => {
  let testRootDir: string;
  let testProjectDir: string;
  let userConfigDir: string;
  let userConfigPath: string;
  let originalCwd: string;
  const originalHome = process.env.HOME;

  const writeUserConfig = async (config: unknown | string): Promise<void> => {
    await mkdir(userConfigDir, { recursive: true });
    await writeFile(
      userConfigPath,
      typeof config === "string" ? config : JSON.stringify(config),
    );
  };

  const writeProjectConfig = async (config: unknown): Promise<void> => {
    const projectConfigDir = join(testProjectDir, ".opencode");
    await mkdir(projectConfigDir, { recursive: true });
    await writeFile(
      join(projectConfigDir, "command-hooks.jsonc"),
      JSON.stringify(config),
    );
  };

  const loadFromDir = async (dir = testProjectDir) => {
    process.chdir(dir);
    return loadGlobalConfig();
  };

  const sleep = async (ms: number): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, ms));
  };

  beforeEach(async () => {
    originalCwd = process.cwd();
    clearGlobalConfigCacheForTests();

    testRootDir = await mkdtemp(join(tmpdir(), "opencode-global-config-test-"));
    testProjectDir = join(testRootDir, "project");
    const testHomeDir = join(testRootDir, "home");
    userConfigDir = join(testHomeDir, ".config", "opencode");
    userConfigPath = join(userConfigDir, "command-hooks.jsonc");

    process.env.HOME = testHomeDir;

    await mkdir(testProjectDir, { recursive: true });
    await mkdir(userConfigDir, { recursive: true });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    clearGlobalConfigCacheForTests();

    try {
      await rm(testRootDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("User global config fallback", () => {
    it("should load from ~/.config/opencode/command-hooks.jsonc when no project config exists", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "user-global-hook",
            when: { phase: "after", tool: ["bash"] },
            run: "echo user global",
          },
        ],
        session: [],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("user-global-hook");
    });

    it("should concat hooks from both global and project configs", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "user-hook",
            when: { phase: "after" },
            run: "echo user",
          },
        ],
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(2);
      const hookIds = result.config.tool?.map(h => h.id) ?? [];
      expect(hookIds).toContain("user-hook");
      expect(hookIds).toContain("project-hook");
    });

    it("should let project hook replace global hook with same id", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "shared-hook",
            when: { phase: "after" },
            run: "echo global version",
          },
        ],
      });

      await writeProjectConfig({
        tool: [
          {
            id: "shared-hook",
            when: { phase: "after" },
            run: "echo project version",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("shared-hook");
      expect(result.config.tool?.[0].run).toBe("echo project version");
    });

    it("should return empty config when neither project nor user config exists", async () => {
      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toEqual([]);
      expect(result.config.session).toEqual([]);
    });

    it("should load session hooks from user global config", async () => {
      await writeUserConfig({
        session: [
          {
            id: "user-session-hook",
            when: { event: "session.created" },
            run: "echo session started",
            inject: "Session initialized",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.session).toHaveLength(1);
      expect(result.config.session?.[0].id).toBe("user-session-hook");
      expect(result.config.session?.[0].when.event).toBe("session.created");
    });

    it("should handle JSONC comments in user global config", async () => {
      await writeUserConfig(`{
        // This is a comment
        "tool": [
          {
            "id": "commented-hook",
            "when": { "phase": "after" },
            "run": "echo with comments"
          }
        ]
        /* Block comment */
      }`);

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("commented-hook");
    });

    it("should use project config only when global config has parse errors", async () => {
      await writeUserConfig("{ invalid json }");

      await writeProjectConfig({
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("project-hook");
    });

    it("should return empty config when only global config exists and is malformed", async () => {
      await writeUserConfig("{ invalid json }");

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toEqual([]);
      expect(result.config.session).toEqual([]);
    });
  });

  describe("Project config discovery", () => {
    it("should find project config in parent directory", async () => {
      const nestedDir = join(testProjectDir, "src", "components");
      await mkdir(nestedDir, { recursive: true });

      await writeProjectConfig({
        tool: [
          {
            id: "parent-hook",
            when: { phase: "before" },
            run: "echo from parent",
          },
        ],
      });

      const result = await loadFromDir(nestedDir);

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("parent-hook");
    });
  });

  describe("Caching and invalidation", () => {
    it("should pick up project config changes after file updates", async () => {
      await writeProjectConfig({
        tool: [
          {
            id: "version-one",
            when: { phase: "after" },
            run: "echo v1",
          },
        ],
      });

      const firstLoad = await loadFromDir();
      expect(firstLoad.error).toBeNull();
      expect(firstLoad.config.tool).toHaveLength(1);
      expect(firstLoad.config.tool?.[0].id).toBe("version-one");

      await sleep(20);
      await writeProjectConfig({
        tool: [
          {
            id: "version-two",
            when: { phase: "after" },
            run: "echo v2",
          },
        ],
      });

      const secondLoad = await loadFromDir();
      expect(secondLoad.error).toBeNull();
      expect(secondLoad.config.tool).toHaveLength(1);
      expect(secondLoad.config.tool?.[0].id).toBe("version-two");
    });

    it("should refresh a cached discovery miss after TTL", async () => {
      const firstLoad = await loadFromDir();
      expect(firstLoad.error).toBeNull();
      expect(firstLoad.config.tool).toEqual([]);

      await writeProjectConfig({
        tool: [
          {
            id: "new-project-hook",
            when: { phase: "after" },
            run: "echo refreshed",
          },
        ],
      });

      const immediateLoad = await loadFromDir();
      expect(immediateLoad.error).toBeNull();
      expect(immediateLoad.config.tool).toEqual([]);

      await sleep(300);
      const refreshedLoad = await loadFromDir();
      expect(refreshedLoad.error).toBeNull();
      expect(refreshedLoad.config.tool).toHaveLength(1);
      expect(refreshedLoad.config.tool?.[0].id).toBe("new-project-hook");
    });
  });

  describe("Strict schema validation", () => {
    it("should reject project config when ignoreGlobalConfig is not a boolean", async () => {
      await writeProjectConfig({
        ignoreGlobalConfig: "false",
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toContain("project config file failed schema validation");
      expect(result.config.tool).toEqual([]);
      expect(result.config.session).toEqual([]);
    });

    it("should reject project config when overrideGlobal is not a boolean", async () => {
      await writeProjectConfig({
        tool: [
          {
            id: "project-hook",
            when: { phase: "after", tool: "bash" },
            run: "echo project",
            overrideGlobal: "true",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toContain("project config file failed schema validation");
      expect(result.config.tool).toEqual([]);
      expect(result.config.session).toEqual([]);
    });

    it("should ignore invalid global boolean values and still use project config", async () => {
      await writeUserConfig({
        ignoreGlobalConfig: "false",
        tool: [
          {
            id: "global-hook",
            when: { phase: "after" },
            run: "echo global",
          },
        ],
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("project-hook");
    });
  });

  describe("ignoreGlobalConfig flag", () => {
    it("should skip global config when project has ignoreGlobalConfig: true", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "global-hook",
            when: { phase: "after" },
            run: "echo global",
          },
        ],
      });

      await writeProjectConfig({
        ignoreGlobalConfig: true,
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(1);
      expect(result.config.tool?.[0].id).toBe("project-hook");
    });
  });

  describe("truncationLimit precedence", () => {
    it("should use project truncationLimit when global does not set one", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "global-hook",
            when: { phase: "after" },
            run: "echo global",
          },
        ],
      });

      await writeProjectConfig({
        truncationLimit: 11111,
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.truncationLimit).toBe(11111);
    });

    it("should let project truncationLimit override global truncationLimit", async () => {
      await writeUserConfig({
        truncationLimit: 9999,
        tool: [
          {
            id: "global-hook",
            when: { phase: "after" },
            run: "echo global",
          },
        ],
      });

      await writeProjectConfig({
        truncationLimit: 1234,
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.truncationLimit).toBe(1234);
    });

    it("should keep global truncationLimit when project does not set one", async () => {
      await writeUserConfig({
        truncationLimit: 2222,
        tool: [
          {
            id: "global-hook",
            when: { phase: "after" },
            run: "echo global",
          },
        ],
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-hook",
            when: { phase: "after" },
            run: "echo project",
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.truncationLimit).toBe(2222);
    });
  });

  describe("overrideGlobal flag", () => {
    it("should skip global session hooks when project hook has overrideGlobal", async () => {
      await writeUserConfig({
        session: [
          {
            id: "global-session-hook",
            when: { event: "session.created" },
            run: "echo global session",
          },
        ],
      });

      await writeProjectConfig({
        session: [
          {
            id: "project-session-hook",
            when: { event: "session.created" },
            run: "echo project session",
            overrideGlobal: true,
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.session).toHaveLength(1);
      expect(result.config.session?.[0].id).toBe("project-session-hook");
    });

    it("should not skip global hooks for different events when overrideGlobal is set", async () => {
      await writeUserConfig({
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
      });

      await writeProjectConfig({
        session: [
          {
            id: "project-created-hook",
            when: { event: "session.created" },
            run: "echo project created",
            overrideGlobal: true,
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.session).toHaveLength(2);
      const sessionIds = result.config.session?.map(h => h.id) ?? [];
      expect(sessionIds).toContain("project-created-hook");
      expect(sessionIds).toContain("global-idle-hook");
      expect(sessionIds).not.toContain("global-created-hook");
    });

    it("should skip global tool hooks matching phase+tool when project hook has overrideGlobal", async () => {
      await writeUserConfig({
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
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-after-bash",
            when: { phase: "after", tool: "bash" },
            run: "echo project after bash",
            overrideGlobal: true,
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(2);
      const toolIds = result.config.tool?.map(h => h.id) ?? [];
      expect(toolIds).toContain("project-after-bash");
      expect(toolIds).toContain("global-after-write");
      expect(toolIds).not.toContain("global-after-bash");
    });

    it("should treat tool string and single-item array as equivalent for override matching", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "global-after-bash",
            when: { phase: "after", tool: "bash" },
            run: "echo global bash",
          },
          {
            id: "global-after-write",
            when: { phase: "after", tool: "write" },
            run: "echo global write",
          },
        ],
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-after-bash",
            when: { phase: "after", tool: ["bash"] },
            run: "echo project bash",
            overrideGlobal: true,
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      const toolIds = result.config.tool?.map(h => h.id) ?? [];
      expect(toolIds).toContain("project-after-bash");
      expect(toolIds).toContain("global-after-write");
      expect(toolIds).not.toContain("global-after-bash");
    });

    it("should treat single-item array and tool string as equivalent for override matching", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "global-after-bash",
            when: { phase: "after", tool: ["bash"] },
            run: "echo global bash",
          },
          {
            id: "global-after-write",
            when: { phase: "after", tool: "write" },
            run: "echo global write",
          },
        ],
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-after-bash",
            when: { phase: "after", tool: "bash" },
            run: "echo project bash",
            overrideGlobal: true,
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      const toolIds = result.config.tool?.map(h => h.id) ?? [];
      expect(toolIds).toContain("project-after-bash");
      expect(toolIds).toContain("global-after-write");
      expect(toolIds).not.toContain("global-after-bash");
    });

    it("should normalize multi-tool arrays (sort + dedupe) for override matching", async () => {
      await writeUserConfig({
        tool: [
          {
            id: "global-after-bash-write",
            when: { phase: "after", tool: ["bash", "write"] },
            run: "echo global bash write",
          },
          {
            id: "global-after-edit",
            when: { phase: "after", tool: "edit" },
            run: "echo global edit",
          },
        ],
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-after-bash-write",
            when: { phase: "after", tool: ["write", "bash", "bash"] },
            run: "echo project bash write",
            overrideGlobal: true,
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      const toolIds = result.config.tool?.map(h => h.id) ?? [];
      expect(toolIds).toContain("project-after-bash-write");
      expect(toolIds).toContain("global-after-edit");
      expect(toolIds).not.toContain("global-after-bash-write");
    });

    it("should skip ALL global tool hooks for phase when project uses overrideGlobal with tool: '*'", async () => {
      await writeUserConfig({
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
      });

      await writeProjectConfig({
        tool: [
          {
            id: "project-after-all",
            when: { phase: "after", tool: "*" },
            run: "echo project after all",
            overrideGlobal: true,
          },
        ],
      });

      const result = await loadFromDir();

      expect(result.error).toBeNull();
      expect(result.config.tool).toHaveLength(2);
      const toolIds = result.config.tool?.map(h => h.id) ?? [];
      expect(toolIds).toContain("project-after-all");
      expect(toolIds).toContain("global-before-bash");
      expect(toolIds).not.toContain("global-after-bash");
      expect(toolIds).not.toContain("global-after-write");
    });
  });
});
