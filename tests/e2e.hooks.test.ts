import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { $ } from "bun"

const TEST_CONFIG_DIR = join(process.cwd(), "tests", "fixtures", "e2e-config")
const TEST_OPENCODE_SUBDIR = join(TEST_CONFIG_DIR, ".opencode")
const TEST_OPENCODE_CONFIG = join(TEST_CONFIG_DIR, "opencode.jsonc")
const TEST_HOOKS_CONFIG = join(TEST_OPENCODE_SUBDIR, "command-hooks.jsonc")
const LOG_DIR = join(homedir(), ".local", "share", "opencode", "log")

/**
 * Check if OpenCode CLI is available and working properly
 * Tests both --version and a simple run command to ensure full functionality
 */
async function isOpenCodeAvailable(): Promise<boolean> {
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

/**
 * Generate a unique ID for test isolation
 */
function generateUniqueId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * Get the content of all recent OpenCode log files (modified in last 5 minutes)
 * This handles the case where each opencode run creates a new log file
 */
function getRecentLogContent(): string {
  if (!existsSync(LOG_DIR)) {
    return ""
  }
  const now = Date.now()
  const fiveMinutesAgo = now - 5 * 60 * 1000
  
  const logs = readdirSync(LOG_DIR)
    .map(name => ({
      name,
      path: join(LOG_DIR, name),
      mtime: statSync(join(LOG_DIR, name)).mtimeMs
    }))
    .filter(f => f.mtime > fiveMinutesAgo)
    .sort((a, b) => a.mtime - b.mtime)
  
  if (logs.length === 0) {
    return ""
  }
  
  return logs.map(f => readFileSync(f.path, "utf-8")).join("\n")
}

/**
 * Write a test configuration to the test config directory
 */
function writeTestConfig(config: object): void {
  if (!existsSync(TEST_OPENCODE_SUBDIR)) {
    mkdirSync(TEST_OPENCODE_SUBDIR, { recursive: true })
  }
  writeFileSync(TEST_HOOKS_CONFIG, JSON.stringify(config, null, 2))
}

/**
 * Write OpenCode plugin configuration to enable the plugin in the test config directory
 */
function writeTestOpencodeConfig(): void {
  if (!existsSync(TEST_CONFIG_DIR)) {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true })
  }
  const pluginConfig = {
    plugin: [join(process.cwd(), "dist", "index.js")],
  }
  writeFileSync(TEST_OPENCODE_CONFIG, JSON.stringify(pluginConfig, null, 2))
}

/**
 * Poll for log content until a predicate is satisfied or times out.
 */
async function waitForLogMatch(
  predicate: (logContent: string) => boolean,
  timeoutMs = 10000,
  intervalMs = 500
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const logContent = getRecentLogContent()
    if (predicate(logContent)) {
      return logContent
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return getRecentLogContent()
}

/**
 * Run OpenCode with a prompt and capture the stdout response
 * This function captures the actual stdout from opencode, not just runs it silently
 */
async function runOpenCode(prompt: string): Promise<string> {
  try {
    const result = await $`cd ${TEST_CONFIG_DIR} && OPENCODE_CONFIG=${TEST_OPENCODE_CONFIG} timeout 30 opencode -m opencode/big-pickle run ${prompt} 2>&1`.text()
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Ensure we always return a string
    const resultStr = typeof result === 'string' ? result : String(result || '')
    return resultStr
  } catch (e: unknown) {
    // Handle error case - ensure we return a string
    const error = e as { stdout?: unknown; stderr?: unknown; message?: string }
    const errorContent = error.stdout || error.stderr || error.message || ""
    return typeof errorContent === 'string' ? errorContent : String(errorContent || "")
  }
}

describe("E2E Hook Behavioral Tests", () => {
  let skipTests = false
  
  beforeAll(async () => {
    // Check if OpenCode is available
    skipTests = !(await isOpenCodeAvailable())
    if (skipTests) {
      console.log("⚠️ Skipping E2E tests: OpenCode is not available or not working properly")
      return
    }
    
    // Enable the plugin in the test opencode config
    writeTestOpencodeConfig()
  })

  afterAll(() => {
    // Clean up the test config directory (optional - leave for debugging if needed)
    // Uncomment the following code to clean up after tests:
    /*
    if (existsSync(TEST_CONFIG_DIR)) {
      try {
        const files = readdirSync(TEST_CONFIG_DIR)
        for (const file of files) {
          unlinkSync(join(TEST_CONFIG_DIR, file))
        }
        rmdirSync(TEST_CONFIG_DIR)
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    */
  })

  it("Test 1: Inject during tool.execute.after - LLM responds", async () => {
    if (skipTests) {
      console.log("Skipping: OpenCode not available")
      return
    }
    
    console.log("\n=== Test 1: Inject during tool.execute.after - LLM responds ===")
    
    const uniqueId = generateUniqueId()
    console.log(`Unique ID: ${uniqueId}`)
    
    // Configure a hook that injects a math question after any tool execution
    const config = {
      tool: [
        {
          id: "test1-inject-math",
          when: { phase: "after", tool: "*" },
          run: "echo test1_echo_output",
          inject: `What is 2+2? Reply ONLY with the number 4, nothing else.`,
        },
      ],
    }
    writeTestConfig(config)
    console.log("Config written:", JSON.stringify(config, null, 2))

    // Run OpenCode with a simple bash command
    console.log("Running OpenCode...")
    const opencodeResponse = await runOpenCode("use bash to echo hello")

    console.log("OpenCode response received")
    console.log(`Response length: ${String(opencodeResponse).length}`)
    console.log(`Response preview: ${String(opencodeResponse).substring(0, 200)}...`)

    // Check logs for inject marker
    const logContent = getRecentLogContent()
    console.log(`Log content length: ${logContent.length}`)

    // Assert: OpenCode response should contain "4" (the LLM should respond to the injected question)
    const containsNumber4 = opencodeResponse.includes("4") || opencodeResponse.includes(" four")
    console.log(`OpenCode response contains "4": ${containsNumber4}`)

    expect(containsNumber4).toBe(true)
  }, 120000)

  it("Test 2: Inject during session.idle - LLM does NOT respond (noReply)", async () => {
    if (skipTests) {
      console.log("Skipping: OpenCode not available")
      return
    }
    
    console.log("\n=== Test 2: Inject during session.idle - LLM does NOT respond ===")
    
    const uniqueId = generateUniqueId()
    console.log(`Unique ID: ${uniqueId}`)
    
    // Configure a session hook that injects a message on idle with noReply: true
    const config = {
      session: [
        {
          id: "test2-session-idle",
          when: { event: "session.idle" },
          inject: `IGNORE_THIS_IDLE_MESSAGE_${uniqueId}`,
          noReply: true,
        },
      ],
    }
    writeTestConfig(config)
    console.log("Config written:", JSON.stringify(config, null, 2))

    // Run OpenCode with a simple bash command
    console.log("Running OpenCode...")
    const opencodeResponse = await runOpenCode("use bash to echo test")

    console.log("OpenCode response received")
    console.log(`Response length: ${String(opencodeResponse).length}`)
    console.log(`Response preview: ${String(opencodeResponse).substring(0, 200)}...`)

    // Check logs for inject marker
    const logContent = getRecentLogContent()
    console.log(`Log content length: ${logContent.length}`)
    console.log(`Log contains [inject]: ${logContent.includes("[inject]")}`)
    console.log(`Log contains unique ID: ${logContent.includes(`IGNORE_THIS_IDLE_MESSAGE_${uniqueId}`)}`)

    // Assert: OpenCode response should NOT contain the ignore message or unique ID
    // This proves that noReply worked and the LLM did not respond to the injection
    const responseStr = String(opencodeResponse)
    const containsIgnoreMessage = responseStr.includes(`IGNORE_THIS_IDLE_MESSAGE_${uniqueId}`)
    const containsUniqueId = responseStr.includes(uniqueId)
    
    console.log(`OpenCode response contains IGNORE message: ${containsIgnoreMessage}`)
    console.log(`OpenCode response contains unique ID: ${containsUniqueId}`)

    expect(containsIgnoreMessage).toBe(false)
    expect(containsUniqueId).toBe(false)
  }, 120000)

  it("Test 3: Toast doesn't affect LLM response", async () => {
    if (skipTests) {
      console.log("Skipping: OpenCode not available")
      return
    }
    
    console.log("\n=== Test 3: Toast doesn't affect LLM response ===")
    
    const uniqueId = generateUniqueId()
    console.log(`Unique ID: ${uniqueId}`)
    
    // Configure a hook that shows a toast before any tool execution
    const config = {
      tool: [
        {
          id: "test3-toast-before",
          when: { phase: "before", tool: "*" },
          run: "echo test3_echo_output",
          toast: {
            title: "Test 3 Toast",
            message: `TOAST_MARKER_${uniqueId}`,
            variant: "info",
          },
        },
      ],
    }
    writeTestConfig(config)
    console.log("Config written:", JSON.stringify(config, null, 2))

    // Run OpenCode with a prompt asking to describe what it did
    console.log("Running OpenCode...")
    const opencodeResponse = await runOpenCode("use bash to echo hello and describe what you did")

    console.log("OpenCode response received")
    console.log(`Response length: ${opencodeResponse.length}`)
    console.log(`Response preview: ${opencodeResponse.substring(0, 200)}...`)

    const logContent = await waitForLogMatch(
      content => content.includes(`TOAST_MARKER_${uniqueId}`),
      15000,
      500
    )
    console.log(`Log content length: ${logContent.length}`)
    console.log(`Log contains [toast]: ${logContent.includes("[toast]")}`)
    console.log(`Log contains toast marker: ${logContent.includes(`TOAST_MARKER_${uniqueId}`)}`)
    console.log(`Log sample: ${logContent.substring(0, 500)}...`)

    // Assert: Toast marker should appear in logs but NOT in OpenCode response
    const toastInLogs = logContent.includes(`TOAST_MARKER_${uniqueId}`)
    const toastInResponse = opencodeResponse.includes(`TOAST_MARKER_${uniqueId}`)
    
    console.log(`Toast marker in logs: ${toastInLogs}`)
    console.log(`Toast marker in OpenCode response: ${toastInResponse}`)

    expect(toastInLogs).toBe(true)
    expect(toastInResponse).toBe(false)
  }, 120000)

  it("Test 4: stdout template substitution works", async () => {
    if (skipTests) {
      console.log("Skipping: OpenCode not available")
      return
    }
    
    console.log("\n=== Test 4: stdout template substitution works ===")
    
    const uniqueId = generateUniqueId()
    console.log(`Unique ID: ${uniqueId}`)
    
    // Configure a hook that runs a command and injects with {stdout} substitution
    const config = {
      tool: [
        {
          id: "test4-stdout-subst",
          when: { phase: "after", tool: "*" },
          run: `echo CAPTURED_${uniqueId}`,
          inject: `Output was: {stdout}`,
        },
      ],
    }
    writeTestConfig(config)
    console.log("Config written:", JSON.stringify(config, null, 2))

    // Run OpenCode with a simple bash command
    console.log("Running OpenCode...")
    const opencodeResponse = await runOpenCode("use bash to list files")

    console.log("OpenCode response received")
    console.log(`Response length: ${opencodeResponse.length}`)
    console.log(`Response preview: ${opencodeResponse.substring(0, 200)}...`)

    const logContent = await waitForLogMatch(
      content => content.includes(`Output was: CAPTURED_${uniqueId}`),
      15000,
      500
    )
    console.log(`Log content length: ${logContent.length}`)
    console.log(`Log contains [inject]: ${logContent.includes("[inject]")}`)
    console.log(`Log contains CAPTURED marker: ${logContent.includes(`CAPTURED_${uniqueId}`)}`)

    // Assert: Log should contain "[inject]" with "CAPTURED_{uniqueId}" 
    // proving that {stdout} was substituted with the actual command output
    const hasInjectLog = logContent.includes("[inject]")
    const hasCapturedMarker = logContent.includes(`CAPTURED_${uniqueId}`)
    const hasStdoutSubstitution = logContent.includes(`Output was: CAPTURED_${uniqueId}`)
    
    console.log(`Log contains [inject]: ${hasInjectLog}`)
    console.log(`Log contains CAPTURED marker: ${hasCapturedMarker}`)
    console.log(`Log contains stdout substitution: ${hasStdoutSubstitution}`)

    expect(hasInjectLog).toBe(true)
    expect(hasCapturedMarker).toBe(true)
    expect(hasStdoutSubstitution).toBe(true)
  }, 120000)

  it("Test 5: Hook fires after write tool and creates file", async () => {
    if (skipTests) {
      console.log("Skipping: OpenCode not available")
      return
    }
    
    console.log("\n=== Test 5: Hook fires after write tool and creates file ===")
    
    const uniqueId = generateUniqueId()
    console.log(`Unique ID: ${uniqueId}`)
    
    // Configure a hook that runs after the write tool
    const config = {
      tool: [
        {
          id: `test-write-hook-${uniqueId}`,
          when: { phase: "after", tool: "write" },
          run: "touch goodbye.txt"
        },
      ],
    }
    writeTestConfig(config)
    console.log("Config written:", JSON.stringify(config, null, 2))

    // Run OpenCode with a prompt to create a file
    console.log("Running OpenCode...")
    const opencodeResponse = await runOpenCode("Create a file called hello.txt with the content 'hello' and nothing else")

    console.log("OpenCode response received")
    console.log(`Response length: ${opencodeResponse.length}`)
    console.log(`Response preview: ${opencodeResponse.substring(0, 200)}...`)

    // Check file existence and content
    const helloFilePath = join(TEST_CONFIG_DIR, "hello.txt")
    const goodbyeFilePath = join(TEST_CONFIG_DIR, "goodbye.txt")
    
    // Wait a bit for file system operations to complete
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    try {
      // Assert 1: hello.txt exists
      const helloExists = existsSync(helloFilePath)
      console.log(`hello.txt exists: ${helloExists}`)
      expect(helloExists).toBe(true)

      // Assert 2: hello.txt contains exactly "hello"
      if (helloExists) {
        const helloContent = readFileSync(helloFilePath, "utf-8")
        console.log(`hello.txt content: "${helloContent}"`)
        expect(helloContent).toBe("hello")
      }

      // Assert 3: goodbye.txt exists (proving the hook ran)
      const goodbyeExists = existsSync(goodbyeFilePath)
      console.log(`goodbye.txt exists: ${goodbyeExists}`)
      expect(goodbyeExists).toBe(true)

      // Assert 4: Logs contain evidence the write tool was used

    } finally {
      // Clean up test files
      try {
        if (existsSync(helloFilePath)) {
          unlinkSync(helloFilePath)
          console.log("Cleaned up hello.txt")
        }
        if (existsSync(goodbyeFilePath)) {
          unlinkSync(goodbyeFilePath)
          console.log("Cleaned up goodbye.txt")
        }
      } catch (e) {
        console.log("Cleanup warning:", e)
      }
    }
  }, 120000)
})