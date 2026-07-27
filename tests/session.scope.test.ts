import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { filterSessionHooks } from "../src/executor";
import { parseSessionHook } from "../src/schemas";

const ORIGINAL_CWD = process.cwd();

const sessionHook = (id: string, sessionScope?: "parent" | "child" | "any") =>
  parseSessionHook({
    id,
    when: { event: "session.idle", ...(sessionScope ? { sessionScope } : {}) },
    inject: id,
  })!;

describe("session hook scope", () => {
  it("defaults parsed session hooks to parent scope and accepts child and any", () => {
    expect(sessionHook("default").when.sessionScope).toBe("parent");
    expect(sessionHook("child", "child").when.sessionScope).toBe("child");
    expect(sessionHook("any", "any").when.sessionScope).toBe("any");
    expect(parseSessionHook({
      id: "invalid",
      when: { event: "session.idle", sessionScope: "all" },
      inject: "invalid",
    })).toBeNull();
  });

  it("matches parent, child, any, and unknown session identities deterministically", () => {
    const hooks = [sessionHook("default"), sessionHook("child", "child"), sessionHook("any", "any")];

    expect(filterSessionHooks(hooks, {
      event: "session.idle",
      agent: undefined,
      sessionScope: "parent",
    }).map((hook) => hook.id)).toEqual(["default", "any"]);
    expect(filterSessionHooks(hooks, {
      event: "session.idle",
      agent: undefined,
      sessionScope: "child",
    }).map((hook) => hook.id)).toEqual(["child", "any"]);
    expect(filterSessionHooks(hooks, {
      event: "session.idle",
      agent: undefined,
      sessionScope: undefined,
    }).map((hook) => hook.id)).toEqual(["any"]);
  });
});

describe("session lifecycle scope adapter", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "opencode-hooks-session-scope-"));
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    writeFileSync(join(testDir, ".opencode", "command-hooks.jsonc"), JSON.stringify({
      session: [
        { id: "default-parent", when: { event: "session.idle" }, inject: "default-parent" },
        { id: "child-only", when: { event: "session.idle", sessionScope: "child" }, inject: "child-only" },
        { id: "any-session", when: { event: "session.idle", sessionScope: "any" }, inject: "any-session" },
      ],
    }));
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("resolves session identity through client.session.get and only lets any hooks run when unknown", async () => {
    const promptCalls: string[] = [];
    const getCalls: string[] = [];
    const client = {
      session: {
        get: async ({ path }: { path: { id: string } }) => {
          getCalls.push(path.id);
          if (path.id === "unknown") throw new Error("not found");
          return { data: path.id === "child" ? { parentID: "parent" } : {} };
        },
        promptAsync: async ({ body }: { body: { parts: Array<{ text: string }> } }) => {
          promptCalls.push(body.parts[0].text);
          return {};
        },
      },
      tui: { showToast: async () => ({}) },
    };

    const { CommandHooksPlugin } = await import("../src/index.js");
    const plugin = await CommandHooksPlugin({ client } as never);

    for (const id of ["parent", "child", "unknown"]) {
      await plugin.event?.({
        event: { type: "session.idle", properties: { sessionID: id } },
      } as never);
    }

    expect(getCalls).toEqual(["parent", "child", "unknown"]);
    expect(promptCalls).toEqual([
      "default-parent", "any-session",
      "child-only", "any-session",
      "any-session",
    ]);
  });
});
