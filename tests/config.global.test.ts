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

  it("loads .opencode/command_hooks.jsonc", async () => {
    const opencodeDirPath = join(testDir, ".opencode")
    const configPath = join(opencodeDirPath, "command_hooks.jsonc")
    const content = `
{
  // This is a comment
  "tool": [
    {
      "id": "test-hook",
      "when": { "phase": "after", "tool": ["task"] },
      "run": "echo test"
    }
  ],
  "session": []
}
    `
    try {
      mkdirSync(opencodeDirPath, { recursive: true })
    } catch {
      // Directory may already exist
    }
    writeFileSync(configPath, content)
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config.tool).toHaveLength(1)
    expect(config.tool?.[0]?.id).toBe("test-hook")
    expect(config.session).toHaveLength(0)

    unlinkSync(configPath)
  })

  it("loads .opencode/command_hooks.jsonc with session hooks", async () => {
    const opencodeDirPath = join(testDir, ".opencode")
    const configPath = join(opencodeDirPath, "command_hooks.jsonc")
    const content = JSON.stringify({
      tool: [],
      session: [
        {
          id: "session-hook",
          when: { event: "session.start", agent: ["*"] },
          run: "git status",
        },
      ],
    })
    try {
      mkdirSync(opencodeDirPath, { recursive: true })
    } catch {
      // Directory may already exist
    }
    writeFileSync(configPath, content)
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config.tool).toHaveLength(0)
    expect(config.session).toHaveLength(1)
    expect(config.session?.[0]?.id).toBe("session-hook")

    unlinkSync(configPath)
  })

  it("handles malformed JSON gracefully", async () => {
    const opencodeDirPath = join(testDir, ".opencode")
    const configPath = join(opencodeDirPath, "command_hooks.jsonc")
    try {
      mkdirSync(opencodeDirPath, { recursive: true })
    } catch {
      // Directory may already exist
    }
    writeFileSync(configPath, "{ invalid json }")
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config).toEqual({ tool: [], session: [] })

    unlinkSync(configPath)
  })

  it("handles invalid CommandHooksConfig structure", async () => {
    const opencodeDirPath = join(testDir, ".opencode")
    const configPath = join(opencodeDirPath, "command_hooks.jsonc")
    try {
      mkdirSync(opencodeDirPath, { recursive: true })
    } catch {
      // Directory may already exist
    }
    writeFileSync(configPath, JSON.stringify("not an object"))
    process.chdir(testDir)

    const config = await loadGlobalConfig()
    expect(config).toEqual({ tool: [], session: [] })

    unlinkSync(configPath)
  })

  it("handles block comments in JSONC", async () => {
    const opencodeDirPath = join(testDir, ".opencode")
    const configPath = join(opencodeDirPath, "command_hooks.jsonc")
    const content = `
{
  /* This is a block comment
     spanning multiple lines */
  "tool": [
    {
      "id": "test",
      /* inline comment */ "when": { "phase": "after" },
      "run": "echo test"
    }
  ]
}
    `
    try {
      mkdirSync(opencodeDirPath, { recursive: true })
    } catch {
      // Directory may already exist
    }
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

    const opencodeDirPath = join(testDir, ".opencode")
    const configPath = join(opencodeDirPath, "command_hooks.jsonc")
    try {
      mkdirSync(opencodeDirPath, { recursive: true })
    } catch {
      // Directory may already exist
    }
    writeFileSync(configPath, JSON.stringify({ tool: [{ id: "found" }] }))

    process.chdir(subDir)
    const config = await loadGlobalConfig()
    expect(config.tool?.[0]?.id).toBe("found")

    unlinkSync(configPath)
    rmSync(join(testDir, "subdir"), { recursive: true })
  })
})
