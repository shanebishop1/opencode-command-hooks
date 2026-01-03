import { describe, it, expect } from "bun:test"
import { executeCommand, executeCommands } from "../src/execution/shell.js"

describe("Shell command execution", () => {
  describe("executeCommand", () => {
    it("executes a simple echo command", async () => {
      const result = await executeCommand("echo 'hello world'")

      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("hello world")
    })

    it("captures command output in stdout", async () => {
      const result = await executeCommand("echo 'test output'")

      expect(result.stdout).toContain("test output")
      expect(result.stderr).toBe("")
    })

    it("captures stderr from failed commands", async () => {
      const result = await executeCommand("sh -c 'echo error >&2; exit 1'")

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("error")
    })

    it("returns non-zero exit code for failed commands", async () => {
      const result = await executeCommand("exit 42")

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(42)
    })

    it("handles command with arguments", async () => {
      const result = await executeCommand("echo 'arg1' 'arg2'")

      expect(result.success).toBe(true)
      expect(result.stdout).toContain("arg1")
      expect(result.stdout).toContain("arg2")
    })

    it("truncates long output", async () => {
       const longOutput = "x".repeat(5000)
       const result = await executeCommand(`echo '${longOutput}'`, { truncateOutput: 100 })

       expect(result.success).toBe(true)
       expect(result.stdout).toContain("[Output truncated: exceeded 100 character limit]")
       // Output should be truncated to 100 chars + metadata
       expect(result.stdout!.length).toBeLessThan(200) // 100 chars + metadata message
     })

    it("handles commands with pipes", async () => {
      const result = await executeCommand("echo 'hello' | tr 'a-z' 'A-Z'")

      expect(result.success).toBe(true)
      expect(result.stdout).toContain("HELLO")
    })

    it("handles commands with environment variables", async () => {
      const result = await executeCommand("TEST_VAR=hello sh -c 'echo $TEST_VAR'")

      expect(result.success).toBe(true)
      expect(result.stdout).toContain("hello")
    })
  })

  describe("executeCommands", () => {
    it("executes a single command in array", async () => {
      const results = await executeCommands(["echo 'test'"], "test-hook")

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(results[0].stdout).toContain("test")
    })

    it("executes multiple commands sequentially", async () => {
      const results = await executeCommands(
        ["echo 'first'", "echo 'second'", "echo 'third'"],
        "test-hook"
      )

      expect(results).toHaveLength(3)
      expect(results[0].stdout).toContain("first")
      expect(results[1].stdout).toContain("second")
      expect(results[2].stdout).toContain("third")
    })

    it("continues executing after command failure", async () => {
      const results = await executeCommands(
        ["echo 'first'", "exit 1", "echo 'third'"],
        "test-hook"
      )

      expect(results).toHaveLength(3)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(results[2].success).toBe(true)
    })

    it("includes hook ID in results", async () => {
      const results = await executeCommands(["echo 'test'"], "my-hook")

      expect(results[0].hookId).toBe("my-hook")
    })

    it("handles string command (converts to array)", async () => {
      const results = await executeCommands("echo 'test'", "test-hook")

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
    })

    it("truncates output for all commands", async () => {
       const longOutput = "x".repeat(5000)
       const results = await executeCommands(
         [`echo '${longOutput}'`, `echo '${longOutput}'`],
         "test-hook",
         { truncateOutput: 100 }
       )

       expect(results).toHaveLength(2)
       results.forEach(result => {
         expect(result.stdout).toContain("[Output truncated: exceeded 100 character limit]")
       })
     })

    it("captures exit codes for all commands", async () => {
      const results = await executeCommands(
        ["exit 0", "exit 1", "exit 2"],
        "test-hook"
      )

      expect(results[0].exitCode).toBe(0)
      expect(results[1].exitCode).toBe(1)
      expect(results[2].exitCode).toBe(2)
    })

    it("handles empty command array", async () => {
      const results = await executeCommands([], "test-hook")

      expect(results).toHaveLength(0)
    })

    it("handles commands with special characters", async () => {
      const result = await executeCommands(
        ["echo 'hello@world#test'"],
        "test-hook"
      )

      expect(result[0].success).toBe(true)
      expect(result[0].stdout).toContain("hello@world#test")
    })

    it("handles multiline output", async () => {
      const result = await executeCommands(
        ["printf 'line1\\nline2\\nline3'"],
        "test-hook"
      )

      expect(result[0].success).toBe(true)
      expect(result[0].stdout).toContain("line1")
      expect(result[0].stdout).toContain("line2")
      expect(result[0].stdout).toContain("line3")
    })
  })

  describe("Bun shell integration", () => {
    it("uses Bun's $ API for command execution", async () => {
      // This test verifies that Bun's shell is being used
      // by checking that Bun-specific features work (like nothrow)
      const result = await executeCommand("exit 5")

      // With nothrow, this should not throw and should return exit code 5
      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(5)
    })

    it("handles Bun shell with quiet mode", async () => {
      // quiet() suppresses output, so we should get clean stdout/stderr
      const result = await executeCommand("echo 'test' && echo 'error' >&2")

      expect(result.stdout).toContain("test")
      expect(result.stderr).toContain("error")
    })

    it("properly converts Bun Buffer output to strings", async () => {
      const result = await executeCommand("echo 'buffer test'")

      // Result should be a string, not a Buffer
      expect(typeof result.stdout).toBe("string")
      expect(typeof result.stderr).toBe("string")
      expect(result.stdout).toContain("buffer test")
    })
  })

  describe("Error handling", () => {
    it("returns failure in result instead of throwing", async () => {
      // Even if something goes wrong, executeCommand should not throw
      const result = await executeCommand("nonexistent-command-xyz-123")

      expect(result.success).toBe(false)
      expect(result.exitCode).not.toBe(0)
      // nonexistent command puts error in stderr, not in error field
      expect(result.stderr?.length ?? 0).toBeGreaterThan(0)
    })

    it("handles commands with syntax errors", async () => {
      const result = await executeCommand("sh -c 'invalid syntax )'")

      expect(result.success).toBe(false)
      expect(result.exitCode).toBeGreaterThan(0)
    })

    it("handles very long commands", async () => {
      const longCmd = "echo '" + "a".repeat(1000) + "'"
      const result = await executeCommand(longCmd)

      expect(result.success).toBe(true)
    })
  })
})
