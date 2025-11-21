import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
   loadMarkdownConfig,
   parseYamlFrontmatter,
   extractYamlFrontmatter,
   clearMarkdownConfigCache,
} from "../src/config/markdown.js";
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("extractYamlFrontmatter", () => {
  it("extracts YAML between --- delimiters", () => {
    const content = `---
name: test-agent
description: A test agent
command_hooks:
  tool: []
---

# Agent content here`;

    const yaml = extractYamlFrontmatter(content);
    expect(yaml).toBeTruthy();
    expect(yaml).toContain("name: test-agent");
    expect(yaml).toContain("command_hooks:");
  });

  it("returns null when content doesn't start with ---", () => {
    const content = `# No frontmatter
name: test`;

    const yaml = extractYamlFrontmatter(content);
    expect(yaml).toBeNull();
  });

  it("returns null when closing --- is missing", () => {
    const content = `---
name: test-agent
# No closing delimiter`;

    const yaml = extractYamlFrontmatter(content);
    expect(yaml).toBeNull();
  });

  it("handles empty frontmatter", () => {
    const content = `---
---

# Content`;

    const yaml = extractYamlFrontmatter(content);
    expect(yaml).toBe("");
  });

  it("preserves multiline YAML content", () => {
    const content = `---
command_hooks:
  tool:
    - id: test
      run:
        - echo hello
        - echo world
---

Content`;

    const yaml = extractYamlFrontmatter(content);
    expect(yaml).toContain("echo hello");
    expect(yaml).toContain("echo world");
  });

  it("handles YAML with special characters", () => {
    const content = `---
template: |
  Hook {id} completed:
  exit {exitCode}
  \`\`\`
  {stdout}
  \`\`\`
---

Content`;

    const yaml = extractYamlFrontmatter(content);
    expect(yaml).toContain("Hook {id} completed:");
    expect(yaml).toContain("{exitCode}");
  });
});

describe("parseYamlFrontmatter", () => {
  it("parses valid YAML", () => {
    const yaml = `name: test-agent
description: A test agent`;

    const parsed = parseYamlFrontmatter(yaml);
    expect(parsed).toEqual({
      name: "test-agent",
      description: "A test agent",
    });
  });

  it("parses YAML with arrays", () => {
    const yaml = `command_hooks:
  tool:
    - id: hook1
      run: echo test`;

    const parsed = parseYamlFrontmatter(yaml);
    expect(parsed).toBeTruthy();
    expect((parsed as any).command_hooks.tool).toHaveLength(1);
    expect((parsed as any).command_hooks.tool[0].id).toBe("hook1");
  });

  it("returns null for invalid YAML", () => {
    const yaml = `invalid: yaml: content: here:`;

    const parsed = parseYamlFrontmatter(yaml);
    expect(parsed).toBeNull();
  });

  it("handles empty YAML", () => {
    const yaml = "";

    const parsed = parseYamlFrontmatter(yaml);
    expect(parsed).toBeNull();
  });

  it("parses YAML with nested objects", () => {
    const yaml = `command_hooks:
  tool:
    - id: test
      when:
        phase: after
        tool:
          - task
      run: pnpm test`;

    const parsed = parseYamlFrontmatter(yaml);
    expect(parsed).toBeTruthy();
    const config = (parsed as any).command_hooks;
    expect(config.tool[0].when.phase).toBe("after");
    expect(config.tool[0].when.tool).toEqual(["task"]);
  });
});

describe("loadMarkdownConfig", () => {
   const testDir = "/tmp/opencode-markdown-test";
   const originalCwd = process.cwd();

   beforeAll(() => {
     try {
       mkdirSync(testDir, { recursive: true });
     } catch {
       // Directory may already exist
     }
   });

   beforeEach(() => {
     // Clear cache before each test to ensure fresh loads
     clearMarkdownConfigCache();
   });

   afterAll(() => {
     try {
       rmSync(testDir, { recursive: true, force: true });
     } catch {
       // Ignore cleanup errors
     }
     process.chdir(originalCwd);
   });

  it("returns empty config when file doesn't exist", async () => {
    const config = await loadMarkdownConfig(
      join(testDir, "nonexistent.md"),
    );
    expect(config).toEqual({ tool: [], session: [] });
  });

  it("loads markdown with command_hooks in frontmatter", async () => {
    const filePath = join(testDir, "agent-with-hooks.md");
    const content = `---
name: build-agent
description: Build agent with hooks
command_hooks:
  tool:
    - id: tests-after-task
      when:
        phase: after
        tool: ["task"]
      run: pnpm test
  session:
    - id: bootstrap
      when:
        event: session.start
      run: git status
---

# Build Agent

This is the build agent content.`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(1);
    expect(config.tool?.[0]?.id).toBe("tests-after-task");
    expect(config.session).toHaveLength(1);
    expect(config.session?.[0]?.id).toBe("bootstrap");

    unlinkSync(filePath);
  });

  it("returns empty config when no frontmatter exists", async () => {
    const filePath = join(testDir, "no-frontmatter.md");
    const content = `# Agent without frontmatter

This agent has no YAML frontmatter.`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config).toEqual({ tool: [], session: [] });

    unlinkSync(filePath);
  });

  it("returns empty config when no command_hooks field", async () => {
    const filePath = join(testDir, "no-hooks.md");
    const content = `---
name: simple-agent
description: Agent without hooks
---

# Simple Agent

No hooks here.`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config).toEqual({ tool: [], session: [] });

    unlinkSync(filePath);
  });

  it("handles malformed YAML gracefully", async () => {
    const filePath = join(testDir, "malformed.md");
    const content = `---
name: test
command_hooks: [invalid: yaml: here:
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config).toEqual({ tool: [], session: [] });

    unlinkSync(filePath);
  });

  it("handles invalid command_hooks structure", async () => {
    const filePath = join(testDir, "invalid-hooks.md");
    const content = `---
name: test
command_hooks: "not an object"
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config).toEqual({ tool: [], session: [] });

    unlinkSync(filePath);
  });

  it("handles command_hooks with only tool hooks", async () => {
    const filePath = join(testDir, "tool-only.md");
    const content = `---
name: test
command_hooks:
  tool:
    - id: hook1
      when:
        phase: before
      run: echo before
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(1);
    expect(config.session).toHaveLength(0);

    unlinkSync(filePath);
  });

  it("handles command_hooks with only session hooks", async () => {
    const filePath = join(testDir, "session-only.md");
    const content = `---
name: test
command_hooks:
  session:
    - id: hook1
      when:
        event: session.start
      run: git status
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(0);
    expect(config.session).toHaveLength(1);

    unlinkSync(filePath);
  });

  it("handles complex hook configurations", async () => {
    const filePath = join(testDir, "complex.md");
    const content = `---
name: complex-agent
command_hooks:
  tool:
    - id: tests-after-task
      when:
        phase: after
        tool: ["task"]
        callingAgent: ["build"]
      run:
        - pnpm test --runInBand
      inject: |
        Tests completed:
        exit {exitCode}
        \`\`\`
        {stdout}
        \`\`\`
    - id: lint-before-write
      when:
        phase: before
        tool: ["write"]
      run: pnpm lint
  session:
    - id: bootstrap
      when:
        event: session.start
        agent: ["build", "validator"]
      run: git status --short
      inject: "Repo status: {stdout}"
---

# Complex Agent`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(2);
    expect(config.session).toHaveLength(1);

     const toolHook = config.tool?.[0];
     expect(toolHook?.id).toBe("tests-after-task");
     expect(toolHook?.run).toEqual(["pnpm test --runInBand"]);
     expect(toolHook?.inject).toContain("Tests completed:");

    const sessionHook = config.session?.[0];
    expect(sessionHook?.id).toBe("bootstrap");
    expect((sessionHook?.when as any).agent).toEqual(["build", "validator"]);

    unlinkSync(filePath);
  });

  it("handles markdown with special characters in content", async () => {
    const filePath = join(testDir, "special-chars.md");
    const content = `---
name: test
command_hooks:
  tool:
    - id: test
      run: echo "test"
---

# Content with special chars
\`\`\`
code block with --- inside
\`\`\`

More content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(1);

    unlinkSync(filePath);
  });

  it("handles empty tool and session arrays", async () => {
    const filePath = join(testDir, "empty-arrays.md");
    const content = `---
name: test
command_hooks:
  tool: []
  session: []
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toEqual([]);
    expect(config.session).toEqual([]);

    unlinkSync(filePath);
  });

  it("handles frontmatter with only tool array", async () => {
    const filePath = join(testDir, "only-tool-array.md");
    const content = `---
name: test
command_hooks:
  tool:
    - id: test
      run: echo test
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(1);
    expect(config.session).toHaveLength(0);

    unlinkSync(filePath);
  });

  it("handles frontmatter with only session array", async () => {
    const filePath = join(testDir, "only-session-array.md");
    const content = `---
name: test
command_hooks:
  session:
    - id: test
      run: echo test
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(0);
    expect(config.session).toHaveLength(1);

    unlinkSync(filePath);
  });

  it("handles YAML with comments", async () => {
    const filePath = join(testDir, "yaml-comments.md");
    const content = `---
# This is a comment
name: test
command_hooks:
  # Tool hooks section
  tool:
    - id: test  # Hook ID
      run: echo test
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool).toHaveLength(1);

    unlinkSync(filePath);
  });

  it("handles multiline run commands", async () => {
    const filePath = join(testDir, "multiline-run.md");
    const content = `---
name: test
command_hooks:
  tool:
    - id: test
      run:
        - echo step1
        - echo step2
        - echo step3
---

Content`;

    writeFileSync(filePath, content);

    const config = await loadMarkdownConfig(filePath);
    expect(config.tool?.[0]?.run).toEqual([
      "echo step1",
      "echo step2",
      "echo step3",
    ]);

     unlinkSync(filePath);
   });

   it("caches config per file path", async () => {
     const filePath = join(testDir, "cache-test.md");
     const content = `---
name: test
command_hooks:
   tool:
     - id: cached-hook
       run: echo cached
---

Content`;

     writeFileSync(filePath, content);

     // First load
     const config1 = await loadMarkdownConfig(filePath);
     expect(config1.tool).toHaveLength(1);
     expect(config1.tool?.[0]?.id).toBe("cached-hook");

     // Modify the file
     const newContent = `---
name: test
command_hooks:
   tool:
     - id: new-hook
       run: echo new
---

Content`;
     writeFileSync(filePath, newContent);

     // Second load should return cached version (not the modified file)
     const config2 = await loadMarkdownConfig(filePath);
     expect(config2.tool).toHaveLength(1);
     expect(config2.tool?.[0]?.id).toBe("cached-hook");

     // After clearing cache for this file, should load the new version
     clearMarkdownConfigCache(filePath);
     const config3 = await loadMarkdownConfig(filePath);
     expect(config3.tool).toHaveLength(1);
     expect(config3.tool?.[0]?.id).toBe("new-hook");

     unlinkSync(filePath);
   });

   it("clears all markdown cache when called without arguments", async () => {
     const filePath1 = join(testDir, "cache-test-1.md");
     const filePath2 = join(testDir, "cache-test-2.md");
     const content = `---
name: test
command_hooks:
   tool:
     - id: hook1
       run: echo test
---

Content`;

     writeFileSync(filePath1, content);
     writeFileSync(filePath2, content);

     // Load both files
     const config1 = await loadMarkdownConfig(filePath1);
     const config2 = await loadMarkdownConfig(filePath2);
     expect(config1.tool).toHaveLength(1);
     expect(config2.tool).toHaveLength(1);

     // Clear all cache
     clearMarkdownConfigCache();

     // Modify both files
     const newContent = `---
name: test
command_hooks:
   tool:
     - id: hook2
       run: echo new
---

Content`;
     writeFileSync(filePath1, newContent);
     writeFileSync(filePath2, newContent);

     // Both should load new versions
     const config3 = await loadMarkdownConfig(filePath1);
     const config4 = await loadMarkdownConfig(filePath2);
     expect(config3.tool?.[0]?.id).toBe("hook2");
     expect(config4.tool?.[0]?.id).toBe("hook2");

     unlinkSync(filePath1);
     unlinkSync(filePath2);
   });
});
