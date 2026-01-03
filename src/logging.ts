import type { OpencodeClient } from "@opencode-ai/sdk"

export type LogLevel = "debug" | "info" | "error"

/**
 * Creates a logger that uses OpenCode's SDK logging.
 * Logs are written to ~/.local/share/opencode/log/
 */
export const createLogger = (client: OpencodeClient) => {
  const log = (level: LogLevel, message: string): void => {
    if (client?.app?.log) {
      client.app.log({
        body: {
          service: "opencode-command-hooks",
          level,
          message,
        },
      }).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[opencode-command-hooks] Failed to log: ${errorMessage}`)
      })
    }
  }

  return {
    debug: (message: string) => log("debug", message),
    info: (message: string) => log("info", message),
    error: (message: string) => log("error", message),
  }
}

export type Logger = ReturnType<typeof createLogger>

/**
 * Global logger instance.
 * Set once during plugin initialization with the SDK client.
 */
let logger: Logger = {
  debug: () => {},
  info: () => {},
  error: () => {},
}

/**
 * Set the global logger instance.
 * Called once during plugin initialization with the SDK client.
 */
export const setGlobalLogger = (newLogger: Logger): void => {
  logger = newLogger
}

/**
 * Check if debug logging is enabled
 */
export const isDebugEnabled = (): boolean => {
  return process.env.OPENCODE_HOOKS_DEBUG === "1" || process.env.OPENCODE_HOOKS_DEBUG === "true"
}

export { logger }
