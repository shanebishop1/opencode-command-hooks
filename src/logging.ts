import type { OpencodeClient } from "@opencode-ai/sdk"

export type LogLevel = "debug" | "info" | "error"

/**
 * Creates a logger bound to a specific client.
 * Logs are sent to OpenCode's logging system without awaiting.
 * Falls back to console if client.app.log is not available.
 */
export function createLogger(client: OpencodeClient) {
  const logToClient = (level: LogLevel, message: string) => {
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
    } else {
      // Fallback to console for development/testing
      const prefix = `[opencode-command-hooks]`
      if (level === "debug" && process.env.OPENCODE_HOOKS_DEBUG === "1") {
        console.debug(`${prefix} ${message}`)
      } else if (level === "info") {
        console.log(`${prefix} ${message}`)
      } else if (level === "error") {
        console.error(`${prefix} ${message}`)
      }
    }
  }

  return {
    debug(message: string): void {
      logToClient("debug", message)
    },
    info(message: string): void {
      logToClient("info", message)
    },
    error(message: string): void {
      logToClient("error", message)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>

/**
 * Global logger instance for when client is not available.
 * Falls back to console for development/debugging.
 */
let globalLogger: Logger | null = null

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger
}

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    // Fallback logger using console for development
    return {
      debug: (message: string) => {
        if (process.env.OPENCODE_HOOKS_DEBUG === "1") {
          console.debug(`[opencode-command-hooks] ${message}`)
        }
      },
      info: (message: string) => console.log(`[opencode-command-hooks] ${message}`),
      error: (message: string) => console.error(`[opencode-command-hooks] ${message}`),
    }
  }
  return globalLogger
}
