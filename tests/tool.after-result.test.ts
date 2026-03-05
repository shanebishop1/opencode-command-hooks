import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
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

  it("executes tool.execute.after hooks and triggers inject + toast", async () => {
    writeConfig({
      tool: [
        {
          id: "after-hook",
          when: { phase: "after", tool: ["bash"] },
          run: ["echo 'Hook executed'"],
          inject: "Tool result: {stdout}",
          toast: {
            title: "Hook",
            message: "after complete",
            variant: "success",
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
    expect(promptParts[0].text).toContain("Tool result: Hook executed");

    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0].body).toEqual({
      title: "Hook",
      message: "after complete",
      variant: "success",
      duration: undefined,
    });
  });

  it("skips tool.execute.after when output is missing", async () => {
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
      undefined,
    );

    expect(promptCalls).toHaveLength(0);
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
});
