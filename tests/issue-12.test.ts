import { describe, expect, it } from "bun:test";
import { filterToolHooks } from "../src/executor.js";
import { interpolateTemplate } from "../src/execution/template.js";
import { getConfigValidationErrors, parseToolHook } from "../src/schemas.js";

describe("Issue #12 tool argument support", () => {
  it("accepts exact, glob, and regex argument filters", () => {
    const hook = parseToolHook({
      id: "argument-matchers",
      when: {
        phase: "before",
        toolArgs: {
          exact: "value",
          path: { glob: "**/*.{ts,js}" },
          command: { regex: "^git\\s+" },
        },
      },
      run: "echo matched",
    });

    expect(hook).not.toBeNull();
  });

  it("rejects ambiguous argument matchers", () => {
    const errors = getConfigValidationErrors({
      tool: [
        {
          id: "ambiguous-matcher",
          when: {
            phase: "before",
            toolArgs: {
              ambiguous: { glob: "*.ts", regex: "ts" },
            },
          },
          run: "echo invalid",
        },
      ],
    });

    expect(errors).not.toBeNull();
    expect(errors?.issues.some((issue) => issue.message.includes("Unrecognized key"))).toBe(true);
  });

  it("rejects invalid regular expressions", () => {
    const errors = getConfigValidationErrors({
      tool: [
        {
          id: "invalid-regex",
          when: { phase: "before", toolArgs: { command: { regex: "[" } } },
          run: "echo invalid",
        },
      ],
    });

    expect(errors).not.toBeNull();
    expect(errors?.issues.some((issue) => issue.message.startsWith("Invalid regex pattern:"))).toBe(true);
  });

  it("rejects unbalanced glob syntax supported by picomatch validation", () => {
    const errors = getConfigValidationErrors({
      tool: [
        {
          id: "invalid-glob",
          when: { phase: "before", toolArgs: { path: { glob: "[" } } },
          run: "echo invalid",
        },
      ],
    });

    expect(errors).not.toBeNull();
    expect(errors?.issues.some((issue) => issue.message.startsWith("Invalid glob pattern:"))).toBe(true);
  });

  it("matches glob and regex filters generically with AND semantics", () => {
    const hooks = [
      parseToolHook({
        id: "matches",
        when: {
          phase: "before",
          tool: "custom_tool",
          toolArgs: {
            file: { glob: "**/*.{ts,js}" },
            command: { regex: "^git\\s+(commit|push)\\b" },
          },
        },
        run: "echo matched",
      })!,
    ];

    expect(
      filterToolHooks(hooks, {
        phase: "before",
        toolName: "custom_tool",
        callingAgent: undefined,
        slashCommand: undefined,
        toolArgs: { file: "src/index.ts", command: "git commit -m ok" },
      }),
    ).toHaveLength(1);

    expect(
      filterToolHooks(hooks, {
        phase: "before",
        toolName: "custom_tool",
        callingAgent: undefined,
        slashCommand: undefined,
        toolArgs: { file: "src/index.ts", command: "npm test" },
      }),
    ).toHaveLength(0);

    const ordinaryStringHook = [
      parseToolHook({
        id: "ordinary-string",
        when: { phase: "before", toolArgs: { label: { glob: "release-*" } } },
        run: "echo matched",
      })!,
    ];
    expect(
      filterToolHooks(ordinaryStringHook, {
        phase: "before",
        toolName: "custom_tool",
        callingAgent: undefined,
        slashCommand: undefined,
        toolArgs: { label: "release-v1" },
      }),
    ).toHaveLength(1);
  });

  it("preserves exact and wildcard argument matching", () => {
    const hooks = [
      parseToolHook({
        id: "exact",
        when: { phase: "before", toolArgs: { mode: ["safe", "strict"] } },
        run: "echo exact",
      })!,
      parseToolHook({
        id: "wildcard",
        when: { phase: "before", toolArgs: { mode: "*" } },
        run: "echo wildcard",
      })!,
    ];

    const matched = filterToolHooks(hooks, {
      phase: "before",
      toolName: "custom_tool",
      callingAgent: undefined,
      slashCommand: undefined,
      toolArgs: { mode: "safe" },
    });
    expect(matched.map((hook) => hook.id)).toEqual(["exact", "wildcard"]);
  });

  it("treats leading negation and comment characters as literal glob input", () => {
    const hooks = [
      parseToolHook({
        id: "literal-prefixes",
        when: {
          phase: "before",
          toolArgs: {
            negated: { glob: "!release-*" },
            commented: { glob: "#release-*" },
          },
        },
        run: "echo matched",
      })!,
    ];

    expect(
      filterToolHooks(hooks, {
        phase: "before",
        toolName: "custom_tool",
        callingAgent: undefined,
        slashCommand: undefined,
        toolArgs: { negated: "!release-v1", commented: "#release-v1" },
      }),
    ).toHaveLength(1);

    expect(
      filterToolHooks(hooks, {
        phase: "before",
        toolName: "custom_tool",
        callingAgent: undefined,
        slashCommand: undefined,
        toolArgs: { negated: "release-v1", commented: "release-v1" },
      }),
    ).toHaveLength(0);
  });

  it("does not apply pattern matchers to missing or non-string values", () => {
    const hooks = [
      parseToolHook({
        id: "string-only",
        when: { phase: "before", toolArgs: { value: { regex: "match" } } },
        run: "echo matched",
      })!,
    ];

    for (const value of [undefined, null, [], {}, 42, true]) {
      expect(
        filterToolHooks(hooks, {
          phase: "before",
          toolName: "custom_tool",
          callingAgent: undefined,
          slashCommand: undefined,
          toolArgs: { value },
        }),
      ).toHaveLength(0);
    }
  });

  it("renders direct argument values in one pass without replacement expansion", () => {
    const result = interpolateTemplate(
      "{args.text}|{args.number}|{args.boolean}|{args.array}|{args.object}|{args.null}|{args.missing}|{args.nested.value}",
      {
        id: "hook",
        args: {
          text: "$& {id} {args.number}",
          number: 12,
          boolean: false,
          array: ["a", 2],
          object: { key: "value" },
          null: null,
          nested: { value: "not-resolved" },
        },
      },
    );

    expect(result).toBe(
      "$& {id} {args.number}|12|false|[\"a\",2]|{\"key\":\"value\"}|||",
    );
  });

});
