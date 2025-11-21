/**
 * Unified hook executor for opencode-command-hooks
 *
 * Consolidates the logic for executing hooks across all event types (tool.execute.before,
 * tool.execute.after, session.start, session.idle, etc.). This module provides a single
 * entry point for hook execution that handles:
 *
 * 1. Filtering hooks based on execution context (event type, tool name, agent, etc.)
 * 2. Executing hook commands via shell
 * 3. Capturing and formatting command output
 * 4. Injecting results into sessions via OpenCode SDK
 * 5. Graceful error handling with non-blocking semantics
 *
 * Non-blocking error semantics: Hook failures never prevent tool/session execution.
 * Errors are logged and optionally injected into the session, but never thrown.
 */

import type { OpencodeClient } from "@opencode-ai/sdk"
import type {
  ToolHook,
  SessionHook,
  TemplateContext,
  HookExecutionContext,
} from "./types/hooks.js"
import { executeCommands } from "./execution/shell.js"
import { interpolateTemplate } from "./execution/template.js"
import { getGlobalLogger } from "./logging.js"

const log = getGlobalLogger()

/**
 * Format an error message for injection into the session
 *
 * Creates a user-friendly error message that explains what went wrong
 * with the hook execution.
 *
 * @param hookId - Hook ID that failed
 * @param error - Error message or object
 * @returns Formatted error message
 */
function formatErrorMessage(hookId: string, error: unknown): string {
  const errorText =
    error instanceof Error ? error.message : String(error || "Unknown error")
  return `[opencode-command-hooks] Hook "${hookId}" failed: ${errorText}`
}

/**
 * Inject a message into a session using the OpenCode SDK
 *
 * Uses client.session.prompt() with noReply: true to inject context
 * without triggering an AI response.
 *
 * @param client - OpenCode SDK client
 * @param sessionId - Session ID to inject into
 * @param message - Message text to inject
 * @returns Promise that resolves when message is injected
 */
async function injectMessage(
  client: OpencodeClient,
  sessionId: string,
  message: string
): Promise<void> {
  try {
    log.debug(`Injecting message into session ${sessionId}`)

    await client.session.prompt({
      path: { id: sessionId },
      body: {
        noReply: true,
        parts: [{ type: "text", text: message }],
      },
    })

    log.debug(`Message injected successfully`)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error)
    log.error(`Failed to inject message into session: ${errorMessage}`)
    throw error
  }
}

/**
 * Execute a single tool hook
 *
 * Runs the hook's commands, interpolates the template if configured,
 * and injects the result into the session if configured.
 *
 * @param hook - The tool hook to execute
 * @param context - Execution context (tool name, session ID, agent, etc.)
 * @param client - OpenCode SDK client for message injection
 * @returns Promise that resolves when hook execution is complete
 */
async function executeToolHook(
  hook: ToolHook,
  context: HookExecutionContext,
  client: OpencodeClient
): Promise<void> {
  log.debug(
    `Executing tool hook "${hook.id}" for tool "${context.tool}"`
  )

  try {
    // Execute the hook's commands
    const results = await executeCommands(hook.run, hook.id)

    log.debug(
      `Hook "${hook.id}" executed ${results.length} command(s)`
    )

     // If inject is configured, prepare and inject the message
     if (hook.inject) {
       // Use the last command's result for template interpolation
       const lastResult = results[results.length - 1]

       // Build template context
       const templateContext: TemplateContext = {
         id: hook.id,
         agent: context.agent,
         tool: context.tool,
         cmd: Array.isArray(hook.run) ? hook.run[0] : hook.run,
         stdout: lastResult?.stdout,
         stderr: lastResult?.stderr,
         exitCode: lastResult?.exitCode,
       }

       // Interpolate template
       const message = interpolateTemplate(hook.inject, templateContext)

       // Inject into session
       await injectMessage(client, context.sessionId, message)
     }

    // If consoleLog is configured, interpolate and log to console
    if (hook.consoleLog) {
      // Use the last command's result for template interpolation
      const lastResult = results[results.length - 1]

      // Build template context
      const templateContext: TemplateContext = {
        id: hook.id,
        agent: context.agent,
        tool: context.tool,
        cmd: Array.isArray(hook.run) ? hook.run[0] : hook.run,
        stdout: lastResult?.stdout,
        stderr: lastResult?.stderr,
        exitCode: lastResult?.exitCode,
      }

      // Interpolate consoleLog template
      const consoleMessage = interpolateTemplate(hook.consoleLog, templateContext)

      // Log directly to OpenCode's console
      log.info(consoleMessage)
    }
  } catch (error) {
    // Log the error but don't throw - this is non-blocking
    const errorMessage = formatErrorMessage(hook.id, error)
    log.error(errorMessage)

    // Optionally inject error message into session
    try {
      await injectMessage(client, context.sessionId, errorMessage)
    } catch (injectionError) {
      // If error injection fails, just log it
      const injectionErrorMsg =
        injectionError instanceof Error
          ? injectionError.message
          : String(injectionError)
      log.error(
        `Failed to inject error message for hook "${hook.id}": ${injectionErrorMsg}`
      )
    }
  }
}

/**
 * Execute a single session hook
 *
 * Runs the hook's commands, interpolates the template if configured,
 * and injects the result into the session if configured.
 *
 * @param hook - The session hook to execute
 * @param context - Execution context (session ID, agent, etc.)
 * @param client - OpenCode SDK client for message injection
 * @returns Promise that resolves when hook execution is complete
 */
async function executeSessionHook(
  hook: SessionHook,
  context: HookExecutionContext,
  client: OpencodeClient
): Promise<void> {
  log.debug(
    `Executing session hook "${hook.id}"`
  )

  try {
    // Execute the hook's commands
    const results = await executeCommands(hook.run, hook.id)

    log.debug(
      `Hook "${hook.id}" executed ${results.length} command(s)`
    )

     // If inject is configured, prepare and inject the message
     if (hook.inject) {
       // Use the last command's result for template interpolation
       const lastResult = results[results.length - 1]

       // Build template context
       const templateContext: TemplateContext = {
         id: hook.id,
         agent: context.agent,
         cmd: Array.isArray(hook.run) ? hook.run[0] : hook.run,
         stdout: lastResult?.stdout,
         stderr: lastResult?.stderr,
         exitCode: lastResult?.exitCode,
       }

       // Interpolate template
       const message = interpolateTemplate(hook.inject, templateContext)

       // Inject into session
       await injectMessage(client, context.sessionId, message)
     }

     // If consoleLog is configured, interpolate and log to console
     if (hook.consoleLog) {
       // Use the last command's result for template interpolation
       const lastResult = results[results.length - 1]

       // Build template context
       const templateContext: TemplateContext = {
         id: hook.id,
        agent: context.agent,
        cmd: Array.isArray(hook.run) ? hook.run[0] : hook.run,
        stdout: lastResult?.stdout,
        stderr: lastResult?.stderr,
        exitCode: lastResult?.exitCode,
      }

      // Interpolate consoleLog template
      const consoleMessage = interpolateTemplate(hook.consoleLog, templateContext)

      // Log directly to OpenCode's console
      log.info(consoleMessage)
    }
  } catch (error) {
    // Log the error but don't throw - this is non-blocking
    const errorMessage = formatErrorMessage(hook.id, error)
    log.error(errorMessage)

    // Optionally inject error message into session
    try {
      await injectMessage(client, context.sessionId, errorMessage)
    } catch (injectionError) {
      // If error injection fails, just log it
      const injectionErrorMsg =
        injectionError instanceof Error
          ? injectionError.message
          : String(injectionError)
      log.error(
        `Failed to inject error message for hook "${hook.id}": ${injectionErrorMsg}`
      )
    }
  }
}

/**
 * Check if a hook is a tool hook
 *
 * @param hook - Hook to check
 * @returns true if the hook is a ToolHook
 */
function isToolHook(hook: ToolHook | SessionHook): hook is ToolHook {
  return "when" in hook && "phase" in (hook as ToolHook).when
}

/**
 * Execute a collection of hooks
 *
 * Main entry point for hook execution. Handles both tool and session hooks,
 * executing each matched hook in sequence. Implements non-blocking error semantics:
 * any errors during hook execution are logged and optionally injected into the
 * session, but never prevent the tool/session from executing.
 *
 * This function consolidates the logic that was previously duplicated across
 * individual event handlers (tool-before, tool-after, session-start, session-idle).
 *
 * @param hooks - Array of hooks to execute (can be tool or session hooks)
 * @param context - Execution context with session ID, agent, tool name, etc.
 * @param client - OpenCode SDK client for message injection
 * @returns Promise that resolves when all hooks are processed
 *
 * @example
 * ```typescript
 * // Execute tool hooks for a tool.execute.before event
 * await executeHooks(matchedToolHooks, {
 *   sessionId: "session-123",
 *   agent: "build",
 *   tool: "task",
 *   slashCommand: undefined,
 *   callId: "call-456"
 * }, client)
 *
 * // Execute session hooks for a session.start event
 * await executeHooks(matchedSessionHooks, {
 *   sessionId: "session-123",
 *   agent: "build"
 * }, client)
 * ```
 */
export async function executeHooks(
  hooks: (ToolHook | SessionHook)[],
  context: HookExecutionContext,
  client: OpencodeClient
): Promise<void> {
  try {
    log.debug(
      `executeHooks called with ${hooks.length} hook(s) for session "${context.sessionId}"`
    )

    // Execute each hook
    for (const hook of hooks) {
      try {
        if (isToolHook(hook)) {
          await executeToolHook(hook, context, client)
        } else {
          await executeSessionHook(hook, context, client)
        }
      } catch (error) {
        // Catch errors from individual hook execution and continue
        // (errors are already logged and injected by the hook execution functions)
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        log.error(
          `Unexpected error executing hook "${hook.id}": ${errorMessage}`
        )
      }
    }

    log.debug(`executeHooks completed for ${hooks.length} hook(s)`)
  } catch (error) {
    // Catch-all for unexpected errors
    const errorMessage =
      error instanceof Error ? error.message : String(error)
    log.error(
      `Unexpected error in executeHooks: ${errorMessage}`
    )
    // Don't throw - this is non-blocking
  }
}
