/**
 * Shell command execution module for opencode-command-hooks
 *
 * Provides functions to execute shell commands using Bun's $ template literals
 * with proper error handling, output capture, and truncation.
 *
 * Key features:
 * - Execute single or multiple commands sequentially
 * - Capture stdout, stderr, and exit codes
 * - Truncate output to configurable limit
 * - Never throw errors - always return results
 * - Support debug logging via OPENCODE_HOOKS_DEBUG
 */

import { $ } from "bun"
import type { HookExecutionResult } from "../types/hooks"

const LOG_PREFIX = "[opencode-command-hooks]"
const DEFAULT_TRUNCATE_LIMIT = 4000

/**
 * Check if debug logging is enabled
 */
function isDebugEnabled(): boolean {
  return process.env.OPENCODE_HOOKS_DEBUG === "1" || process.env.OPENCODE_HOOKS_DEBUG === "true"
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string | undefined, limit: number): string {
  if (!text) return ""
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n... (truncated, ${text.length - limit} more chars)`
}

/**
 * Execute a single shell command
 *
 * @param command - Shell command to execute
 * @param options - Execution options
 * @returns HookExecutionResult with command output and exit code
 *
 * @example
 * ```typescript
 * const result = await executeCommand("pnpm test")
 * console.log(result.exitCode, result.stdout)
 * ```
 */
export async function executeCommand(
  command: string,
  options?: { truncateOutput?: number }
): Promise<HookExecutionResult> {
  const truncateLimit = options?.truncateOutput ?? DEFAULT_TRUNCATE_LIMIT
  const hookId = "command" // Will be set by caller

  if (isDebugEnabled()) {
    console.log(`${LOG_PREFIX} Executing command: ${command}`)
  }

  try {
    // Execute command using Bun's $ template literal with nothrow to prevent throwing on non-zero exit
    // We need to use dynamic template literal evaluation
    const result = await executeShellCommand(command)

    const stdout = truncateText(result.stdout, truncateLimit)
    const stderr = truncateText(result.stderr, truncateLimit)
    const exitCode = result.exitCode ?? 0
    const success = exitCode === 0

    if (isDebugEnabled()) {
      console.log(
        `${LOG_PREFIX} Command completed: exit ${exitCode}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`
      )
    }

    return {
      hookId,
      success,
      exitCode,
      stdout,
      stderr,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_PREFIX} Failed to execute command: ${errorMessage}`)

    return {
      hookId,
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Execute multiple shell commands sequentially
 *
 * Commands run one after another, even if earlier commands fail.
 * Each command's result is captured and returned separately.
 *
 * @param commands - Single command string or array of command strings
 * @param hookId - Hook ID for tracking (included in results)
 * @param options - Execution options
 * @returns Array of HookExecutionResult, one per command
 *
 * @example
 * ```typescript
 * const results = await executeCommands(
 *   ["pnpm lint", "pnpm test"],
 *   "my-hook",
 *   { truncateOutput: 2000 }
 * )
 * results.forEach(r => console.log(r.exitCode))
 * ```
 */
export async function executeCommands(
  commands: string | string[],
  hookId: string,
  options?: { truncateOutput?: number }
): Promise<HookExecutionResult[]> {
  const truncateLimit = options?.truncateOutput ?? DEFAULT_TRUNCATE_LIMIT
  const commandArray = Array.isArray(commands) ? commands : [commands]

  if (isDebugEnabled()) {
    console.log(`${LOG_PREFIX} Executing ${commandArray.length} command(s) for hook "${hookId}"`)
  }

  const results: HookExecutionResult[] = []

  for (const command of commandArray) {
    try {
      if (isDebugEnabled()) {
        console.log(`${LOG_PREFIX} [${hookId}] Executing: ${command}`)
      }

      const result = await executeShellCommand(command)

      const stdout = truncateText(result.stdout, truncateLimit)
      const stderr = truncateText(result.stderr, truncateLimit)
      const exitCode = result.exitCode ?? 0
      const success = exitCode === 0

      if (isDebugEnabled()) {
        console.log(
          `${LOG_PREFIX} [${hookId}] Command completed: exit ${exitCode}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`
        )
      }

      results.push({
        hookId,
        success,
        exitCode,
        stdout,
        stderr,
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`${LOG_PREFIX} [${hookId}] Failed to execute command: ${errorMessage}`)

      results.push({
        hookId,
        success: false,
        error: errorMessage,
      })
    }
  }

  return results
}

/**
 * Internal helper to execute a shell command using Bun's $ API
 *
 * This function handles the actual shell execution with proper error handling.
 * We use a helper function to work around TypeScript's template literal typing.
 *
 * @param command - Shell command to execute
 * @returns Object with stdout, stderr, and exitCode
 */
async function executeShellCommand(
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Use Bun's $ template literal to execute the command
  // The nothrow() method prevents throwing on non-zero exit codes
  // The quiet() method suppresses output and returns Buffers
  const result = await $`sh -c ${command}`.nothrow().quiet()

  // Extract stdout and stderr as text
  // result.stdout and result.stderr are Buffers, convert to string
  const stdout = result.stdout instanceof Buffer ? result.stdout.toString() : String(result.stdout)
  const stderr = result.stderr instanceof Buffer ? result.stderr.toString() : String(result.stderr)
  const exitCode = result.exitCode ?? 0

  return {
    stdout,
    stderr,
    exitCode,
  }
}
