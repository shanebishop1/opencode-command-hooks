import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { loadGlobalConfig } from "../src/config/global.js"
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

describe("loadGlobalConfig", () => {
  const testDir = "/tmp/opencode-hooks-test"
  const originalCwd = process.cwd()

  beforeAll(() => {
    // Create test directory
    try {
      mkdirSync(testDir, { recursive: true })
    } catch {
      // Directory may already exist
    }
  })

  afterAll(() => {
    // Cleanup
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    process.chdir(originalCwd)
  })

  it("returns empty config when no config file exists", async () => {
    process.chdir(testDir)
    const config = await loadGlobalConfig()
    expect(config).toEqual({ tool: [], session: [] })
  })

  it("loads opencode.jsonc with command_hooks", async () => {
    const configPath = join(testDir, "opencode.jsonc")
    const content = `
{
  // This is a comment
  "command_hooks": {
    "tool": [
      {
        "id": "test-hook",
        "when": { "phase": "after", "tool": ["task"] },
        "run": "echo test"
      }
    ],
    "session": []
  }
}
    `
    writeFileSync(configPath, content)
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config.tool).toHaveLength(1)
    expect(config.tool?.[0]?.id).toBe("test-hook")
    expect(config.session).toHaveLength(0)

    unlinkSync(configPath)
  })

  it("loads opencode.json with command_hooks", async () => {
    const configPath = join(testDir, "opencode.json")
    const content = JSON.stringify({
      command_hooks: {
        tool: [],
        session: [
          {
            id: "session-hook",
            when: { event: "session.start", agent: ["*"] },
            run: "git status",
          },
        ],
      },
    })
    writeFileSync(configPath, content)
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config.tool).toHaveLength(0)
    expect(config.session).toHaveLength(1)
    expect(config.session?.[0]?.id).toBe("session-hook")

    unlinkSync(configPath)
  })

  it("prefers opencode.jsonc over opencode.json", async () => {
    const jsoncPath = join(testDir, "opencode.jsonc")
    const jsonPath = join(testDir, "opencode.json")

    writeFileSync(jsoncPath, JSON.stringify({ command_hooks: { tool: [{ id: "jsonc" }] } }))
    writeFileSync(jsonPath, JSON.stringify({ command_hooks: { tool: [{ id: "json" }] } }))

    process.chdir(testDir)
    const config = await loadGlobalConfig()
    expect(config.tool?.[0]?.id).toBe("jsonc")

    unlinkSync(jsoncPath)
    unlinkSync(jsonPath)
  })

  it("handles malformed JSON gracefully", async () => {
    const configPath = join(testDir, "opencode.json")
    writeFileSync(configPath, "{ invalid json }")
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config).toEqual({ tool: [], session: [] })

    unlinkSync(configPath)
  })

  it("handles invalid command_hooks structure", async () => {
    const configPath = join(testDir, "opencode.json")
    writeFileSync(configPath, JSON.stringify({ command_hooks: "not an object" }))
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config).toEqual({ tool: [], session: [] })

    unlinkSync(configPath)
  })

  it("handles missing command_hooks field", async () => {
    const configPath = join(testDir, "opencode.json")
    writeFileSync(configPath, JSON.stringify({ other_field: "value" }))
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config).toEqual({ tool: [], session: [] })

    unlinkSync(configPath)
  })

  it("handles block comments in JSONC", async () => {
    const configPath = join(testDir, "opencode.jsonc")
    const content = `
{
  /* This is a block comment
     spanning multiple lines */
  "command_hooks": {
    "tool": [
      {
        "id": "test",
        /* inline comment */ "when": { "phase": "after" },
        "run": "echo test"
      }
    ]
  }
}
    `
    writeFileSync(configPath, content)
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config.tool).toHaveLength(1)
    expect(config.tool?.[0]?.id).toBe("test")

    unlinkSync(configPath)
  })

  it("walks up directory tree to find config", async () => {
    const subDir = join(testDir, "subdir", "nested")
    mkdirSync(subDir, { recursive: true })

    const configPath = join(testDir, "opencode.json")
    writeFileSync(configPath, JSON.stringify({ command_hooks: { tool: [{ id: "found" }] } }))

    process.chdir(subDir)
    const config = await loadGlobalConfig()
    expect(config.tool?.[0]?.id).toBe("found")

    unlinkSync(configPath)
    rmSync(join(testDir, "subdir"), { recursive: true })
  })
})
