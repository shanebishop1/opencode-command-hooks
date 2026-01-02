import { describe, it, expect } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { $ } from "bun"

describe("Logging smoke test", () => {
  it("client.app.log() writes to OpenCode log files", async () => {
    const logDir = join(homedir(), ".local", "share", "opencode", "log")
    
    // Run opencode to trigger plugin initialization
    console.log("\n=== Running OpenCode ===")
    try {
      await $`timeout 15 opencode run "say hi" 2>&1 || true`.quiet()
    } catch {
      // Expected to timeout or exit
    }
    
    // Wait for logs to flush
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Get the latest log file
    const logs = existsSync(logDir) ? readdirSync(logDir).sort() : []
    const latestLog = logs[logs.length - 1]
    
    if (!latestLog) {
      console.log("No log files found!")
      expect(latestLog).toBeDefined()
      return
    }
    
    const logPath = join(logDir, latestLog)
    const logContent = readFileSync(logPath, "utf-8")
    const lines = logContent.split("\n")
    
    console.log(`\n=== Log Analysis ===`)
    console.log(`Log file: ${logPath}`)
    console.log(`Total lines: ${lines.length}`)
    
    // Search for our plugin
    const pluginLines = lines.filter(l => 
      l.includes("opencode-command-hooks") ||
      l.includes("plugin")
    )
    
    console.log(`\nLines mentioning plugin/hooks (${pluginLines.length}):`)
    pluginLines.slice(-20).forEach(l => console.log(`  ${l}`))
    
    // Check for our marker
    const hasMarker = logContent.includes("opencode-command-hooks")
    console.log(`\nContains plugin marker: ${hasMarker}`)
    
    if (!hasMarker) {
      console.log(`\nLast 15 lines of log:`)
      lines.slice(-15).forEach(l => console.log(`  ${l}`))
    }
    
    expect(hasMarker).toBe(true)
  }, 60000)
})
