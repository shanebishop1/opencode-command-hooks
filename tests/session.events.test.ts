import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearGlobalConfigCacheForTests } from "../src/config/global.js";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_HOME = process.env.HOME;

type SessionData = { id: string; parentID?: string };

const createMockClient = (session: SessionData | undefined) => {
  const promptCalls: Array<Record<string, unknown>> = [];
  const sessionGetCalls: Array<Record<string, unknown>> = [];

  const client = {
    session: {
      get: async (args: Record<string, unknown>) => {
        sessionGetCalls.push(args);
        return { data: session };
      },
      promptAsync: async (args: Record<string, unknown>) => {
        promptCalls.push(args);
        return {};
      },
    },
    tui: {
      showToast: async () => ({}),
    },
  };

  return { client, promptCalls, sessionGetCalls };
};

describe("session event hooks", () => {
  let testDir: string;

  const writeConfig = (session: Array<Record<string, unknown>>) => {
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    writeFileSync(
      join(testDir, ".opencode", "command-hooks.jsonc"),
      JSON.stringify({ tool: [], session }, null, 2),
    );
  };

  const dispatchIdle = async (
    session: SessionData | undefined,
    hooks: Array<Record<string, unknown>>,
  ) => {
    writeConfig(hooks);
    const { CommandHooksPlugin } = await import("../src/index.js");
    const mock = createMockClient(session);
    const plugin = await CommandHooksPlugin({ client: mock.client } as never);

    await plugin.event?.({
      event: {
        type: "session.idle",
        properties: { sessionID: session?.id ?? "missing-session" },
      },
    } as never);

    return mock;
  };

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "opencode-hooks-session-events-"));
    process.chdir(testDir);
    process.env.HOME = testDir;
    clearGlobalConfigCacheForTests();
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    process.env.HOME = ORIGINAL_HOME;
    clearGlobalConfigCacheForTests();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("runs a default session.idle hook for a root session", async () => {
    const { promptCalls, sessionGetCalls } = await dispatchIdle(
      { id: "root-session" },
      [{ id: "idle", when: { event: "session.idle" }, inject: "root idle" }],
    );

    expect(sessionGetCalls).toEqual([{ path: { id: "root-session" } }]);
    expect(promptCalls).toHaveLength(1);
  });

  it("skips a default session.idle hook for a child session", async () => {
    const { promptCalls, sessionGetCalls } = await dispatchIdle(
      { id: "child-session", parentID: "root-session" },
      [{ id: "idle", when: { event: "session.idle" }, inject: "child idle" }],
    );

    expect(sessionGetCalls).toHaveLength(1);
    expect(promptCalls).toHaveLength(0);
  });

  it("runs an idle hook for child sessions when rootSessionOnly is false", async () => {
    const { promptCalls, sessionGetCalls } = await dispatchIdle(
      { id: "child-session", parentID: "root-session" },
      [
        {
          id: "all-idle",
          when: { event: "session.idle", rootSessionOnly: false },
          inject: "any idle",
        },
      ],
    );

    expect(sessionGetCalls).toHaveLength(0);
    expect(promptCalls).toHaveLength(1);
  });

  it("applies root filtering per hook when scopes are mixed", async () => {
    const { promptCalls } = await dispatchIdle(
      { id: "child-session", parentID: "root-session" },
      [
        { id: "root-idle", when: { event: "session.idle" }, inject: "root only" },
        {
          id: "all-idle",
          when: { event: "session.idle", rootSessionOnly: false },
          inject: "all sessions",
        },
      ],
    );

    expect(promptCalls).toHaveLength(1);
    const parts = (promptCalls[0].body as { parts: Array<{ text: string }> }).parts;
    expect(parts[0].text).toBe("all sessions");
  });

  it("fails open when session lookup cannot determine parentage", async () => {
    const { promptCalls, sessionGetCalls } = await dispatchIdle(
      undefined,
      [{ id: "idle", when: { event: "session.idle" }, inject: "idle fallback" }],
    );

    expect(sessionGetCalls).toHaveLength(1);
    expect(promptCalls).toHaveLength(1);
  });

  it("uses parentID from session.created without fetching the session", async () => {
    writeConfig([
      {
        id: "root-created",
        when: { event: "session.created", rootSessionOnly: true },
        inject: "root created",
      },
    ]);
    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls, sessionGetCalls } = createMockClient(undefined);
    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin.event?.({
      event: {
        type: "session.created",
        properties: { info: { id: "child-session", parentID: "root-session" } },
      },
    } as never);

    expect(sessionGetCalls).toHaveLength(0);
    expect(promptCalls).toHaveLength(0);
  });

  it("keeps child session.created hooks enabled by default", async () => {
    writeConfig([
      {
        id: "all-created",
        when: { event: "session.created" },
        inject: "child created",
      },
    ]);
    const { CommandHooksPlugin } = await import("../src/index.js");
    const { client, promptCalls, sessionGetCalls } = createMockClient(undefined);
    const plugin = await CommandHooksPlugin({ client } as never);

    await plugin.event?.({
      event: {
        type: "session.created",
        properties: { info: { id: "child-session", parentID: "root-session" } },
      },
    } as never);

    expect(sessionGetCalls).toHaveLength(0);
    expect(promptCalls).toHaveLength(1);
  });
});
