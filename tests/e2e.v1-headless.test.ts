import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync, unlinkSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { $ } from "bun"

const REPOSITORY_ROOT = process.cwd()
let TEST_SANDBOX_DIR = ""
let TEST_PLUGIN_DIR = ""
let TEST_CONFIG_DIR = ""
let TEST_OPENCODE_SUBDIR = ""
let TEST_OPENCODE_CONFIG = ""
let TEST_HOOKS_CONFIG = ""
let TEST_AGENT_DIR = ""
let TEST_HOME_DIR = ""
let TEST_XDG_CONFIG_HOME = ""
let TEST_XDG_DATA_HOME = ""
let TEST_XDG_CACHE_HOME = ""
let LOG_DIR = ""
const LOG_WINDOW_MS = 15 * 60 * 1000
const LOG_FALLBACK_FILES = 3
const OPENCODE_COMMAND_TIMEOUT_MS = 110_000
const E2E_ENABLED = process.env.OPENCODE_E2E === "1"
let E2E_MODEL = process.env.OPENCODE_E2E_MODEL ?? ""

function createTestSandbox(): void {
  TEST_SANDBOX_DIR = mkdtempSync(join(tmpdir(), "opencode-command-hooks-e2e-"))
  TEST_CONFIG_DIR = join(TEST_SANDBOX_DIR, "project")
  TEST_OPENCODE_SUBDIR = join(TEST_CONFIG_DIR, ".opencode")
  TEST_OPENCODE_CONFIG = join(TEST_CONFIG_DIR, "opencode.jsonc")
  TEST_HOOKS_CONFIG = join(TEST_OPENCODE_SUBDIR, "command-hooks.jsonc")
  TEST_AGENT_DIR = join(TEST_OPENCODE_SUBDIR, "agent")
  TEST_HOME_DIR = join(TEST_SANDBOX_DIR, "home")
  TEST_XDG_CONFIG_HOME = join(TEST_SANDBOX_DIR, "xdg-config")
  TEST_XDG_DATA_HOME = join(TEST_SANDBOX_DIR, "xdg-data")
  TEST_XDG_CACHE_HOME = join(TEST_SANDBOX_DIR, "xdg-cache")
  LOG_DIR = join(TEST_XDG_DATA_HOME, "opencode", "log")

  mkdirSync(TEST_CONFIG_DIR, { recursive: true })
  mkdirSync(TEST_HOME_DIR, { recursive: true })
  mkdirSync(TEST_XDG_CONFIG_HOME, { recursive: true })
  mkdirSync(TEST_XDG_DATA_HOME, { recursive: true })
  mkdirSync(TEST_XDG_CACHE_HOME, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })
}

function getOpenCodeEnvironment(): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: TEST_HOME_DIR,
    XDG_CONFIG_HOME: TEST_XDG_CONFIG_HOME,
    XDG_DATA_HOME: TEST_XDG_DATA_HOME,
    XDG_CACHE_HOME: TEST_XDG_CACHE_HOME,
    OPENCODE_CONFIG: TEST_OPENCODE_CONFIG,
    PWD: TEST_CONFIG_DIR,
  }
}

interface OpenCodeCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

function formatOpenCodeCommand(args: string[]): string {
  return ["opencode", ...args].map(argument => JSON.stringify(argument)).join(" ")
}

function selectFreeOpenCodeModel(output: string): string {
  const models = output
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("opencode/") && line.endsWith("-free"))
  const model = ["opencode/mimo-v2.5-free", "opencode/north-mini-code-free"]
    .find(candidate => models.includes(candidate)) ?? models[0]
  if (!model) {
    throw new Error(`OpenCode did not advertise a credential-free model:\n${output}`)
  }
  return model
}

function formatOpenCodeCommandError(
  message: string,
  args: string[],
  stdout: string,
  stderr: string
): Error {
  return new Error(
    `${message}\nCommand: ${formatOpenCodeCommand(args)}\nstdout:\n${stdout}\nstderr:\n${stderr}`
  )
}

/**
 * Run an OpenCode command in the isolated test environment. Command failures
 * are rejected so behavioral assertions never inspect failed-process output.
 */
async function runOpenCodeCommand(args: string[]): Promise<OpenCodeCommandResult> {
  let subprocess: Bun.ReadableSubprocess
  try {
    subprocess = Bun.spawn(["opencode", ...args], {
      cwd: TEST_CONFIG_DIR,
      env: getOpenCodeEnvironment(),
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (error) {
    throw new Error(
      `Failed to start OpenCode command: ${formatOpenCodeCommand(args)}\n${String(error)}`
    )
  }

  let timedOut = false
  const timeout = setTimeout(() => {
    if (subprocess.exitCode === null) {
      timedOut = true
      subprocess.kill("SIGKILL")
    }
  }, OPENCODE_COMMAND_TIMEOUT_MS)

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
    ])

    if (timedOut) {
      throw formatOpenCodeCommandError(
        `OpenCode command timed out after ${OPENCODE_COMMAND_TIMEOUT_MS / 1000} seconds.`,
        args,
        stdout,
        stderr
      )
    }

    if (exitCode !== 0) {
      throw formatOpenCodeCommandError(
        `OpenCode command exited with code ${exitCode}.`,
        args,
        stdout,
        stderr
      )
    }

    return { stdout, stderr, exitCode }
  } finally {
    clearTimeout(timeout)
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
  const logs = readdirSync(LOG_DIR)
    .map((name) => {
      const filePath = join(LOG_DIR, name)
      try {
        return {
          name,
          path: filePath,
          mtime: statSync(filePath).mtimeMs,
        }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { name: string; path: string; mtime: number } => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)

  if (logs.length === 0) {
    return ""
  }

  const cutoff = Date.now() - LOG_WINDOW_MS
  const recent = logs.filter((file) => file.mtime > cutoff)
  const selected = recent.length > 0 ? recent : logs.slice(0, LOG_FALLBACK_FILES)

  return selected
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

function writeTestAgent(name: string, content: string): void {
  mkdirSync(TEST_AGENT_DIR, { recursive: true })
  writeFileSync(join(TEST_AGENT_DIR, `${name}.md`), content)
}

/**
 * Write OpenCode plugin configuration to enable the plugin in the test config directory
 */
function writeTestOpencodeConfig(): void {
  if (!existsSync(TEST_CONFIG_DIR)) {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true })
  }
  const pluginConfig = {
    // OpenCode V1 must select the package's ./server export instead of its V2 root.
    plugin: [TEST_PLUGIN_DIR],
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
 * Poll for one exact sandbox file effect from a hook.
 */
async function waitForFileContent(
  filePath: string,
  expectedContent: string,
  timeoutMs = 10000,
  intervalMs = 500
): Promise<string | undefined> {
  const start = Date.now()
  let content: string | undefined
  while (Date.now() - start < timeoutMs) {
    try {
      content = readFileSync(filePath, "utf-8")
      if (content === expectedContent) {
        return content
      }
    } catch {
      content = undefined
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return content
}

async function waitForMinimumLineCount(
  filePath: string,
  minimum: number,
  timeoutMs = 10000,
  intervalMs = 500
): Promise<number> {
  const start = Date.now()
  let count = 0
  while (Date.now() - start < timeoutMs) {
    try {
      count = readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean).length
      if (count >= minimum) return count
    } catch {
      count = 0
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return count
}

/**
 * Run OpenCode with a prompt and capture its successful output.
 */
async function runOpenCode(prompt: string): Promise<string> {
  const result = await runOpenCodeCommand(["-m", E2E_MODEL, "run", prompt])
  await new Promise(resolve => setTimeout(resolve, 2000))
  return `${result.stdout}${result.stderr}`
}

describe.skipIf(!E2E_ENABLED)("V1 headless real-host E2E", () => {
  beforeAll(async () => {
    createTestSandbox()

    const archive = (await $`npm pack --ignore-scripts --pack-destination ${TEST_SANDBOX_DIR}`
      .cwd(REPOSITORY_ROOT)
      .text())
      .trim()
      .split("\n")
      .at(-1)
    if (!archive) throw new Error("npm pack did not return an archive name")
    writeFileSync(join(TEST_SANDBOX_DIR, "package.json"), JSON.stringify({ private: true }))
    await $`npm install --ignore-scripts ${join(TEST_SANDBOX_DIR, archive)}`
      .cwd(TEST_SANDBOX_DIR)
      .quiet()
    TEST_PLUGIN_DIR = join(TEST_SANDBOX_DIR, "node_modules", "opencode-command-hooks")

    // Verify the executable works in the same isolated environment as the tests.
    await runOpenCodeCommand(["--version"])
    if (!E2E_MODEL) {
      const models = await runOpenCodeCommand(["models", "opencode"])
      E2E_MODEL = selectFreeOpenCodeModel(models.stdout)
    }

    // Enable the plugin in the test opencode config
    writeTestOpencodeConfig()
  }, 120_000)

  afterAll(() => {
    if (TEST_SANDBOX_DIR) {
      rmSync(TEST_SANDBOX_DIR, { recursive: true, force: true })
    }
  })

  it("runs one write after-hook transaction with isolated observable evidence", async () => {
    const uniqueId = generateUniqueId()
    const writtenFileName = `e2e-write-${uniqueId}.txt`
    const writtenContent = `MODEL_WRITE_${uniqueId}`
    const hookProofFileName = `e2e-write-hook-${uniqueId}.txt`
    const hookProofContent = `WRITE_AFTER_HOOK_${uniqueId}`
    const hookStdout = `WRITE_AFTER_STDOUT_${uniqueId}`
    const injectedMarker = `Reply only DONE. WRITE_AFTER_INJECT_${uniqueId}:${hookStdout}`
    const toastMarker = `WRITE_AFTER_TOAST_${uniqueId}`
    const writtenFilePath = join(TEST_CONFIG_DIR, writtenFileName)
    const hookProofFilePath = join(TEST_CONFIG_DIR, hookProofFileName)

    const config = {
      tool: [
        {
          id: `e2e-write-after-${uniqueId}`,
          when: { phase: "after", tool: "*" },
          run: `printf '%s' '${hookProofContent}' > '${hookProofFileName}'; printf '%s' '${hookStdout}'`,
          inject: `Reply only DONE. WRITE_AFTER_INJECT_${uniqueId}:{stdout}`,
          toast: {
            title: "E2E write after-hook",
            message: toastMarker,
            variant: "info",
          },
        },
      ],
    }
    writeTestConfig(config)

    try {
      const opencodeResponse = await runOpenCode(
        `Use the write tool, not bash, to create ${writtenFileName} with exactly this content and no trailing newline: ${writtenContent}`
      )
      expect(await waitForFileContent(writtenFilePath, writtenContent)).toBe(writtenContent)
      expect(await waitForFileContent(hookProofFilePath, hookProofContent)).toBe(hookProofContent)
      const logContent = await waitForLogMatch(content => content.includes(injectedMarker))
      expect(logContent).toContain(injectedMarker)
      expect(opencodeResponse).not.toContain(toastMarker)
    } finally {
      for (const filePath of [writtenFilePath, hookProofFilePath]) {
        if (existsSync(filePath)) {
          unlinkSync(filePath)
        }
      }
    }
  }, 150000)

  it("filters real child-session idle events by default and supports opting out", async () => {
    const uniqueId = generateUniqueId()
    const rootOnlyFileName = `root-idle-${uniqueId}.txt`
    const allSessionsFileName = `all-idle-${uniqueId}.txt`
    const rootOnlyFilePath = join(TEST_CONFIG_DIR, rootOnlyFileName)
    const allSessionsFilePath = join(TEST_CONFIG_DIR, allSessionsFileName)
    const runSubagent = () => runOpenCode(
      "Use the task tool to invoke the e2e-worker subagent. Ask it to reply exactly WORKER_DONE, then reply exactly PARENT_DONE."
    )

    writeTestAgent("e2e-worker", `---
description: E2E worker that returns a fixed response
mode: subagent
model: ${E2E_MODEL}
---

Reply exactly WORKER_DONE.
`)

    try {
      writeTestConfig({
        session: [
          {
            id: `root-idle-${uniqueId}`,
            when: { event: "session.idle" },
            run: `printf 'idle\\n' >> '${rootOnlyFileName}'`,
          },
        ],
      })

      await runSubagent()
      expect(await waitForMinimumLineCount(rootOnlyFilePath, 1)).toBe(1)

      const logContent = getRecentLogContent()
      const childCreation = logContent
        .split("\n")
        .find(line => line.includes("message=created") && line.includes("agent=e2e-worker"))
      expect(childCreation).toBeDefined()
      expect(childCreation).not.toContain("parentID=undefined")

      writeTestConfig({
        session: [
          {
            id: `all-idle-${uniqueId}`,
            when: { event: "session.idle", rootSessionOnly: false },
            run: `printf 'idle\\n' >> '${allSessionsFileName}'`,
          },
        ],
      })

      await runSubagent()
      expect(await waitForMinimumLineCount(allSessionsFilePath, 2)).toBeGreaterThanOrEqual(2)
    } finally {
      for (const filePath of [rootOnlyFilePath, allSessionsFilePath]) {
        if (existsSync(filePath)) unlinkSync(filePath)
      }
    }
  }, 300000)
})
