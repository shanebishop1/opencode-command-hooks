import type { OpencodeClient } from "@opencode-ai/sdk"

export type LogLevel = "debug" | "info" | "error"

/**
 * Creates a logger that uses OpenCode's SDK logging.
 * Logs are written to ~/.local/share/opencode/log/
 */
export function createLogger(client: OpencodeClient) {
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

// Internal global logger state
let globalLogger: Logger | null = null

// No-op logger for when no client is available
const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  error: () => {},
}

/**
 * Set the global logger instance.
 * Called once during plugin initialization with the SDK client.
 */
export function setGlobalLogger(newLogger: Logger): void {
  globalLogger = newLogger
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return process.env.OPENCODE_HOOKS_DEBUG === "1" || process.env.OPENCODE_HOOKS_DEBUG === "true"
}

/**
 * Proxy logger that always delegates to the current global logger.
 * This allows modules to import `logger` at load time, and it will
 * correctly use the real logger once it's initialized.
 */
export const logger: Logger = {
  get debug() {
    return (globalLogger ?? noopLogger).debug
  },
  get info() {
    return (globalLogger ?? noopLogger).info
  },
  get error() {
    return (globalLogger ?? noopLogger).error
  },
} as Logger
