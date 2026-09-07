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
          run: ["cat \"$OPENCODE_HOOK_ARGS_FILE\""],
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
    expect(promptParts[0].text).toBe("Tool result: {}");
    expect(toastCalls).toHaveLength(0);
  });

  it("uses direct input args for an after-only event", async () => {
    writeConfig({
      tool: [
        {
          id: "direct-after-args",
          when: {
            phase: "after",
            tool: ["custom-tool"],
            toolArgs: { target: ["prod"] },
          },
          inject: "direct target={args.target}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();
    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin["tool.execute.after"]?.(
      {
        tool: "custom-tool",
        sessionID: "s-direct-args",
        callID: "c-direct-args",
        args: { target: "prod" },
      },
      undefined as never,
    );

    expect(promptCalls).toHaveLength(1);
    const promptParts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    expect(promptParts[0].text).toBe("direct target=prod");
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

  it("scopes cached args and after deduplication by session and call ID", async () => {
    writeConfig({
      tool: [
        {
          id: "session-scoped-after",
          when: {
            phase: "after",
            tool: ["custom-tool"],
            toolArgs: { target: ["first", "second"] },
          },
          inject: "target={args.target}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();
    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin["tool.execute.before"]?.(
      { tool: "custom-tool", sessionID: "s-first", callID: "shared-call" },
      { args: { target: "first" } },
    );

    await plugin["tool.execute.after"]?.(
      {
        tool: "custom-tool",
        sessionID: "s-second",
        callID: "shared-call",
        args: { target: "second" },
      },
      undefined as never,
    );

    await plugin.event?.({
      event: {
        type: "tool.result",
        properties: {
          name: "custom-tool",
          sessionID: "s-first",
          callID: "shared-call",
        },
      },
    } as never);

    const promptTexts = promptCalls.map(
      (call) => (call.body as { parts: Array<{ text: string }> }).parts[0].text,
    );
    expect(promptTexts).toEqual(["target=second", "target=first"]);
  });

  it("passes generic arguments to before and after hooks without shell interpolation", async () => {
    writeConfig({
      tool: [
        {
          id: "generic-arguments-before",
          when: {
            phase: "before",
            tool: "custom-tool",
            toolArgs: {
              filePath: { glob: "**/*.ts" },
              command: { regex: "^git\\s+commit" },
            },
          },
          inject: "before path={args.filePath}",
        },
        {
          id: "generic-arguments",
          when: {
            phase: "after",
            tool: "custom-tool",
            toolArgs: {
              filePath: { glob: "**/*.ts" },
              command: { regex: "^git\\s+commit" },
            },
          },
          run: "cat \"$OPENCODE_HOOK_ARGS_FILE\"",
          inject: "path={args.filePath}; args={stdout}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();
    const plugin = await CommandHooksPlugin({ client } as never);
    const shellLookingValue = "$(touch should-not-exist)";

    await plugin["tool.execute.before"]?.(
      { tool: "custom-tool", sessionID: "s-generic", callID: "c-generic" },
      {
        args: {
          filePath: "src/index.ts",
          command: "git commit -m ok",
          content: shellLookingValue,
          nested: { enabled: true },
        },
      },
    );
    await plugin["tool.execute.after"]?.(
      { tool: "custom-tool", sessionID: "s-generic", callID: "c-generic" },
      undefined as never,
    );

    expect(promptCalls).toHaveLength(2);
    const beforeParts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    const afterParts = (promptCalls[1].body as { parts: Array<{ text: string }> }).parts;
    expect(beforeParts[0].text).toBe("before path=src/index.ts");
    const afterPrefix = "path=src/index.ts; args=";
    expect(afterParts[0].text.startsWith(afterPrefix)).toBe(true);
    expect(JSON.parse(afterParts[0].text.slice(afterPrefix.length))).toEqual({
      filePath: "src/index.ts",
      command: "git commit -m ok",
      content: shellLookingValue,
      nested: { enabled: true },
    });
    expect(existsSync(join(testDir, "should-not-exist"))).toBe(false);
  });

  it("isolates complete hook arguments across concurrent plugin executions", async () => {
    writeConfig({
      tool: [
        {
          id: "concurrent-arguments",
          when: { phase: "before", tool: "custom-tool" },
          run: "sleep 0.05; cat \"$OPENCODE_HOOK_ARGS_FILE\"",
          inject: "{stdout}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();
    const plugin = await CommandHooksPlugin({ client } as never);
    const firstArgs = {
      id: "first",
      nested: { enabled: true, values: ["one", 1] },
    };
    const secondArgs = {
      id: "second",
      nested: { enabled: false, values: ["two", 2] },
    };

    await Promise.all([
      plugin["tool.execute.before"]?.(
        { tool: "custom-tool", sessionID: "s-concurrent", callID: "c-first" },
        { args: firstArgs },
      ),
      plugin["tool.execute.before"]?.(
        { tool: "custom-tool", sessionID: "s-concurrent", callID: "c-second" },
        { args: secondArgs },
      ),
    ]);

    const outputs = promptCalls.map((call) => {
      const parts = (call.body as { parts: Array<{ text: string }> }).parts;
      return JSON.parse(parts[0].text) as Record<string, unknown>;
    });
    expect(outputs).toHaveLength(2);
    expect(outputs).toEqual(expect.arrayContaining([firstArgs, secondArgs]));
  });

  it("creates a private argument file and cleans it up after successful commands", async () => {
    if (process.platform === "win32") return;

    writeConfig({
      tool: [
        {
          id: "argument-file-lifecycle",
          when: { phase: "before", tool: "custom-tool" },
          run: "node -e 'const fs=require(\"fs\");const p=process.env.OPENCODE_HOOK_ARGS_FILE;console.log((fs.statSync(p).mode & 0o777).toString(8));console.log(p)'",
          inject: "{stdout}",
        },
      ],
      session: [],
    });

    const originalPath = process.env.OPENCODE_HOOK_ARGS_FILE;
    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();
    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin["tool.execute.before"]?.(
      { tool: "custom-tool", sessionID: "s-lifecycle", callID: "c-lifecycle" },
      { args: { nested: { enabled: true } } },
    );

    const output = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts[0].text;
    const [mode, argsFile] = output.trim().split("\n");
    expect(mode).toBe("600");
    expect(argsFile).toMatch(/opencode-command-hooks-.*\/args\.json$/);
    expect(existsSync(argsFile)).toBe(false);
    expect(process.env.OPENCODE_HOOK_ARGS_FILE).toBe(originalPath);
  });

  it("cleans up the argument file when a command fails", async () => {
    writeConfig({
      tool: [
        {
          id: "argument-file-failure-cleanup",
          when: { phase: "before", tool: "custom-tool" },
          run: "printf '%s' \"$OPENCODE_HOOK_ARGS_FILE\"; exit 17",
          inject: "{stdout}",
        },
      ],
      session: [],
    });

    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();
    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin["tool.execute.before"]?.(
      { tool: "custom-tool", sessionID: "s-failure-cleanup", callID: "c-failure-cleanup" },
      { args: { value: "failure" } },
    );

    const argsFile = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts[0].text;
    expect(argsFile).toMatch(/opencode-command-hooks-.*\/args\.json$/);
    expect(existsSync(argsFile)).toBe(false);
  });

  it("passes large nested arguments through the file without environment-size limits", async () => {
    writeConfig({
      tool: [
        {
          id: "large-argument-file",
          when: { phase: "before", tool: "custom-tool" },
          run: "wc -c < \"$OPENCODE_HOOK_ARGS_FILE\" | tr -d ' '",
          inject: "{stdout}",
        },
      ],
      session: [],
    });

    const largeArgs = {
      nested: { values: ["one", { two: true }] },
      payload: "x".repeat(300_000),
    };
    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls } = createMockClient();
    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin["tool.execute.before"]?.(
      { tool: "custom-tool", sessionID: "s-large", callID: "c-large" },
      { args: largeArgs },
    );

    const output = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts[0].text;
    expect(Number(output.trim())).toBe(Buffer.byteLength(JSON.stringify(largeArgs)));
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
