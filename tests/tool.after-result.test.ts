import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ORIGINAL_CWD = process.cwd();

const createMockClient = () => {
  const promptCalls: Array<Record<string, unknown>> = [];
  const toastCalls: Array<Record<string, unknown>> = [];

  const client = {
    session: {
      promptAsync: async (args: Record<string, unknown>) => {
        promptCalls.push(args);
        return {};
      },
    },
    tui: {
      showToast: async (args: Record<string, unknown>) => {
        toastCalls.push(args);
        return {};
      },
    },
  };

  return { client, promptCalls, toastCalls };
};

describe("tool after hooks", () => {
  let testDir: string;

  const writeConfig = (config: Record<string, unknown>) => {
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    writeFileSync(
      join(testDir, ".opencode", "command-hooks.jsonc"),
      JSON.stringify(config, null, 2),
    );
  };

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "opencode-hooks-tool-result-"));
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("sends the fully interpolated after-hook toast payload to the host client", async () => {
    writeConfig({
      tool: [
        {
          id: "after-hook",
          when: { phase: "after", tool: ["bash"] },
          run: ["sh -c 'printf hook-stdout; printf hook-stderr >&2; exit 23'"],
          inject: "Tool result: {stdout}",
          toast: {
            title: "Hook {id} for {tool}",
            message: "stdout={stdout}; stderr={stderr}; exit={exitCode}",
            variant: "warning",
            duration: 4500,
          },
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls, toastCalls } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);
    await plugin["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s1", callID: "c1" },
      { title: "ok", output: "done", metadata: {} },
    );

    expect(promptCalls).toHaveLength(1);
    expect((promptCalls[0].path as { id: string }).id).toBe("s1");

    const promptParts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    expect(promptParts[0].text).toContain("Tool result: hook-stdout");

    expect(toastCalls).toEqual([
      {
        body: {
          title: "Hook after-hook for bash",
          message: "stdout=hook-stdout; stderr=hook-stderr; exit=23",
          variant: "warning",
          duration: 4500,
        },
      },
    ]);
  });

  it("executes inject-only after hook without run", async () => {
    writeConfig({
      tool: [
        {
          id: "inject-only-after",
          when: { phase: "after", tool: ["bash"] },
          inject: "after only inject",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls, toastCalls } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);
    await plugin["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s-inject", callID: "c-inject" },
      { title: "ok", output: "done", metadata: {} },
    );

    expect(promptCalls).toHaveLength(1);
    const promptParts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    expect(promptParts[0].text).toBe("after only inject");
    expect(toastCalls).toHaveLength(0);
  });

  it("executes toast-only before hook without run", async () => {
    writeConfig({
      tool: [
        {
          id: "toast-only-before",
          when: { phase: "before", tool: ["bash"] },
          toast: {
            title: "Toast Only",
            message: "before only toast",
            variant: "info",
          },
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls, toastCalls } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);
    await plugin["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s-toast", callID: "c-toast" },
      { args: { command: "ls" } },
    );

    expect(promptCalls).toHaveLength(0);
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0].body).toEqual({
      title: "Toast Only",
      message: "before only toast",
      variant: "info",
      duration: undefined,
    });
  });

  it("runs tool.execute.after even when output is missing", async () => {
    writeConfig({
      tool: [
        {
          id: "after-hook",
          when: { phase: "after", tool: ["bash"] },
          run: ["echo 'Hook executed'"],
          inject: "Tool result: {stdout}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls, toastCalls } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);
    await plugin["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s1", callID: "c-missing-output" },
      undefined as never,
    );

    expect(promptCalls).toHaveLength(1);
    const promptParts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    expect(promptParts[0].text).toContain("Tool result: Hook executed");
    expect(toastCalls).toHaveLength(0);
  });

  it("matches after hooks that require toolArgs when args are available", async () => {
    writeConfig({
      tool: [
        {
          id: "target-prod",
          when: {
            phase: "after",
            tool: ["bash"],
            toolArgs: { target: ["prod"] },
          },
          run: ["echo matched-prod"],
          inject: "matched {stdout}",
        },
        {
          id: "target-dev",
          when: {
            phase: "after",
            tool: ["bash"],
            toolArgs: { target: ["dev"] },
          },
          run: ["echo matched-dev"],
          inject: "dev {stdout}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s2", callID: "c2" },
      { args: { target: "prod" } },
    );

    await plugin["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s2", callID: "c2" },
      { title: "ok", output: "done", metadata: {} },
    );

    expect(promptCalls).toHaveLength(1);
    const promptParts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    expect(promptParts[0].text).toContain("matched matched-prod");
    expect(promptParts[0].text).not.toContain("matched-dev");
  });

  it("does not match toolArgs-filtered after hooks when args are unavailable", async () => {
    writeConfig({
      tool: [
        {
          id: "target-prod",
          when: {
            phase: "after",
            tool: ["bash"],
            toolArgs: { target: ["prod"] },
          },
          run: ["echo matched-prod"],
          inject: "matched {stdout}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin.event?.({
      event: {
        type: "tool.result",
        properties: {
          name: "bash",
          sessionID: "s3",
          callID: "missing-before-call",
        },
      },
    } as never);

    expect(promptCalls).toHaveLength(0);
  });

  it("does not double-run after hooks when tool.execute.after and tool.result both fire", async () => {
    writeConfig({
      tool: [
        {
          id: "after-hook-dedupe",
          when: { phase: "after", tool: ["bash"] },
          run: ["echo dedupe"],
          inject: "Deduped: {stdout}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin["tool.execute.before"]?.(
      { tool: "bash", sessionID: "s-dedupe", callID: "c-dedupe" },
      { args: { command: "echo hi" } },
    );

    await plugin["tool.execute.after"]?.(
      { tool: "bash", sessionID: "s-dedupe", callID: "c-dedupe" },
      undefined as never,
    );

    await plugin.event?.({
      event: {
        type: "tool.result",
        properties: {
          name: "bash",
          sessionID: "s-dedupe",
          callID: "c-dedupe",
        },
      },
    } as never);

    expect(promptCalls).toHaveLength(1);
    const promptParts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    expect(promptParts[0].text).toContain("Deduped: dedupe");
  });

  it("strips hook frontmatter keys before provider requests", async () => {
    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client } = createMockClient();

    const plugin = await CommandHooksPlugin({ client } as never);
    const output = {
      options: {
        hooks: { after: [{ run: "npm run lint" }] },
        command_hooks: { tool: [] },
        safe: true,
      },
    };

    await plugin["chat.params"]?.({} as never, output as never);

    expect(output.options).toEqual({ safe: true });
  });

  it("uses OpenCode's project directory instead of process cwd", async () => {
    const processDir = mkdtempSync(join(tmpdir(), "opencode-hooks-process-cwd-"));
    writeConfig({
      tool: [
        {
          id: "project-directory",
          when: { phase: "after", tool: "write" },
          run: "touch project-directory-marker.txt",
        },
      ],
      session: [],
    });

    try {
      process.chdir(processDir);
      const { CommandHooksPlugin } = await import("../src/index.js");
      const { client } = createMockClient();
      const plugin = await CommandHooksPlugin({ client, directory: testDir } as never);

      await plugin["tool.execute.after"]?.(
        { tool: "write", sessionID: "s-directory", callID: "c-directory" },
        { title: "ok", output: "done", metadata: {} },
      );

      expect(existsSync(join(testDir, "project-directory-marker.txt"))).toBe(true);
      expect(existsSync(join(processDir, "project-directory-marker.txt"))).toBe(false);
    } finally {
      process.chdir(testDir);
      rmSync(processDir, { recursive: true, force: true });
    }
  });
});
