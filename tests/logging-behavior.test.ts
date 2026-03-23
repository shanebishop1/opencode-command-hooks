import { describe, it, expect } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { $ } from "bun"

const LOG_WINDOW_MS = 15 * 60 * 1000
const LOG_FALLBACK_FILES = 3

const isOpenCodeAvailable = async (): Promise<boolean> => {
  try {
    const whichResult = await $`which opencode 2>&1`.text()
    if (!whichResult || whichResult.includes("not found")) {
      return false
    }
    return true
  } catch {
    return false
  }
}

const getLogFiles = (dir: string) => {
  if (!existsSync(dir)) {
    return [] as Array<{ name: string; path: string; mtime: number }>
  }

  return readdirSync(dir)
    .map((name) => {
      const path = join(dir, name)
      try {
        return {
          name,
          path,
          mtime: statSync(path).mtimeMs,
        }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { name: string; path: string; mtime: number } => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)
}

const getRecentLogContent = (dir: string): { files: Array<{ name: string; path: string; mtime: number }>; content: string } => {
  const files = getLogFiles(dir)
  if (files.length === 0) {
    return { files: [], content: "" }
  }

  const cutoff = Date.now() - LOG_WINDOW_MS
  const recent = files.filter((file) => file.mtime > cutoff)
  const selected = recent.length > 0 ? recent : files.slice(0, LOG_FALLBACK_FILES)

  const content = selected
    .slice()
    .reverse()
    .map((file) => {
      try {
        return readFileSync(file.path, "utf-8")
      } catch {
        return ""
      }
    })
    .join("\n")

  return { files: selected, content }
}

const waitForLogMarker = async (dir: string, marker: string, timeoutMs = 20000, intervalMs = 500) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = getRecentLogContent(dir)
    if (result.content.includes(marker)) {
      return result
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return getRecentLogContent(dir)
}

describe("Logging smoke test", () => {
  it("client.app.log() writes to OpenCode log files", async () => {
    const hasOpenCode = await isOpenCodeAvailable()
    if (!hasOpenCode) {
      console.log("OpenCode CLI not available - skipping logging smoke test")
      return
    }

    const logDir = join(homedir(), ".local", "share", "opencode", "log")
    const configPath = join(process.cwd(), "opencode.jsonc")
    
    // Run opencode to trigger plugin initialization
    console.log("\n=== Running OpenCode ===")
    try {
      await $`OPENCODE_CONFIG=${configPath} timeout 20 opencode run "say hi" 2>&1 || true`.quiet()
    } catch {
      // Expected to timeout or exit
    }

    const marker = "opencode-command-hooks"
    const result = await waitForLogMarker(logDir, marker)

    if (result.files.length === 0) {
      console.log("No log files found!")
      expect(result.files.length).toBeGreaterThan(0)
      return
    }

    const newest = result.files[0]
    const lines = result.content.split("\n")
    
    console.log(`\n=== Log Analysis ===`)
    console.log(`Newest log file: ${newest.path}`)
    console.log(`Scanned log files: ${result.files.map((file) => file.name).join(", ")}`)
    console.log(`Total lines: ${lines.length}`)
    
    // Search for our plugin
    const pluginLines = lines.filter(l => 
      l.includes("opencode-command-hooks") ||
      l.includes("plugin")
    )
    
    console.log(`\nLines mentioning plugin/hooks (${pluginLines.length}):`)
    pluginLines.slice(-20).forEach(l => console.log(`  ${l}`))
    
    // Check for our marker
    const hasMarker = result.content.includes(marker)
    console.log(`\nContains plugin marker: ${hasMarker}`)
    
    if (!hasMarker) {
      console.log(`\nLast 15 lines of log:`)
      lines.slice(-15).forEach(l => console.log(`  ${l}`))
    }
    
    expect(hasMarker).toBe(true)
  }, 60000)
})
