import type { OpencodeClient } from "@opencode-ai/sdk"
import { appendFile, mkdir } from "fs/promises"
import { join } from "path"

export type LogLevel = "debug" | "info" | "error"

/**
 * Regex to strip ANSI color codes from strings
 */
const ANSI_COLOR_REGEX = /\x1b\[[0-9;]*m/g

/**
 * Map to track pending file writes per file path to prevent race conditions
 */
const pendingWrites = new Map<string, Promise<void>>()

/**
 * Writes a log entry to a file with serialized writes to prevent race conditions
 */
async function logToFile(filePath: string, entry: string): Promise<void> {
  try {
    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf("/"))
    await mkdir(dir, { recursive: true })

    // Get any existing write promise for this file
    const existingWrite = pendingWrites.get(filePath)

    // Chain the current write to the existing one, or start fresh
    const currentWrite = existingWrite
      ? existingWrite.then(() => appendFile(filePath, entry))
      : appendFile(filePath, entry)

    // Store the current write promise
    pendingWrites.set(filePath, currentWrite)

    // Clean up the promise after it completes
    currentWrite.finally(() => {
      if (pendingWrites.get(filePath) === currentWrite) {
        pendingWrites.delete(filePath)
      }
    })

    // Don't await - let it happen in the background
  } catch {
    // Silently ignore file operation errors to avoid breaking the plugin
  }
}

/**
 * Creates a logger bound to a specific client with hybrid logging.
 * 
 * Two-tier logging system:
 * - File Logger: All messages go to .opencode/logs/command-hooks.log with async write queue
 * - SDK Logger: Only info/error messages go to client.app.log() for UI visibility
 * 
 * @param client OpenCode client for SDK logging
 * @param directory Project directory for log file location
 */
export function createLogger(client: OpencodeClient, directory: string) {
  // Determine log directory from environment or use default
  const logDir = process.env.OPENCODE_DATA_DIR
    ? join(process.env.OPENCODE_DATA_DIR, "logs")
    : join(directory, ".opencode", "logs")

  const logFilePath = join(logDir, "command-hooks.log")

  /**
   * Log to file with timestamp and level prefix
   */
  const logToFileWithTimestamp = (level: LogLevel, message: string): void => {
    const timestamp = new Date().toISOString()
    // Strip ANSI colors from message for file logging
    const cleanMessage = message.replace(ANSI_COLOR_REGEX, "")
    const entry = `[${timestamp}] ${level.toUpperCase()}: ${cleanMessage}\n`
    void logToFile(logFilePath, entry)
  }

  /**
   * Log to SDK (UI) - only for info and error levels
   */
  const logToSDK = (level: LogLevel, message: string): void => {
    if (level === "debug") {
      // Don't send debug logs to SDK to avoid UI spam
      return
    }

    if (client?.app?.log) {
      client.app.log({
        body: {
          service: "opencode-command-hooks",
          level,
          message,
        },
      }).catch(() => {
        // Silently ignore logging errors
      })
    }
  }

  return {
    debug(message: string): void {
      // File only - no SDK, no UI spam
      logToFileWithTimestamp("debug", message)
    },
    info(message: string): void {
      // File + SDK
      logToFileWithTimestamp("info", message)
      logToSDK("info", message)
    },
    error(message: string): void {
      // File + SDK
      logToFileWithTimestamp("error", message)
      logToSDK("error", message)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>

/**
 * Global logger instance, set during plugin initialization.
 * Must be initialized before use via setGlobalLogger().
 */
let globalLogger: Logger | null = null

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger
}

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    throw new Error("Global logger not initialized. Call setGlobalLogger() first.")
  }
  return globalLogger
}
