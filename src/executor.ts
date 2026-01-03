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
import { logger } from "./logging.js"

/**
 * Check if a value matches a pattern (string, array of strings, or wildcard)
 */
export const matches = (pattern: string | string[] | undefined, value: string | undefined): boolean => {
  if (!pattern) return true // Omitted pattern matches all
  if (pattern === "*") return true // Wildcard matches all
  if (Array.isArray(pattern)) return value ? pattern.includes(value) : false
  return value === pattern
}

/**
 * Filter session hooks that match the given criteria
 */
export const filterSessionHooks = (
  hooks: SessionHook[],
  criteria: { event: string; agent: string | undefined }
): SessionHook[] => {
  return hooks.filter((hook) => {
    // Normalize session.start to session.created
    let normalizedEvent = hook.when.event
    if (normalizedEvent === "session.start") {
      normalizedEvent = "session.created"
    }
    
    if (normalizedEvent !== criteria.event) return false
    return matches(hook.when.agent, criteria.agent)
  })
}

/**
 * Filter tool hooks that match the given criteria
 */
export const filterToolHooks = (
  hooks: ToolHook[],
  criteria: {
    phase: "before" | "after"
    toolName: string | undefined
    callingAgent: string | undefined
    slashCommand: string | undefined
    toolArgs?: Record<string, unknown>
  }
): ToolHook[] => {
  return hooks.filter((hook) => {
    if (hook.when.phase !== criteria.phase) return false
    if (!matches(hook.when.tool, criteria.toolName)) return false
    if (!matches(hook.when.callingAgent, criteria.callingAgent)) return false
    if (!matches(hook.when.slashCommand, criteria.slashCommand)) return false
    
    // Match tool args if specified in the hook
    if (hook.when.toolArgs) {
      // If hook specifies toolArgs but we don't have them, we can't match
      // (this happens for async tools in tool.result event)
      if (!criteria.toolArgs) {
        logger.debug(
          `Hook ${hook.id} requires toolArgs but none were provided for tool ${criteria.toolName}`
        )
        return false
      }

      for (const [key, expectedValue] of Object.entries(hook.when.toolArgs)) {
        const actualValue = criteria.toolArgs[key]
        if (!matches(expectedValue, actualValue as string | undefined)) {
          logger.debug(
            `Hook ${hook.id} toolArgs mismatch for ${key}: expected ${JSON.stringify(expectedValue)}, actual ${JSON.stringify(actualValue)}`
          )
          return false
        }
      }
    }
    
    return true
  })
}

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
const formatErrorMessage = (hookId: string, error: unknown): string => {
    const errorText =
      error instanceof Error ? error.message : String(error || "Unknown error")
    return `[opencode-command-hooks] Hook "${hookId}" failed: ${errorText}`
}

/**
 * Show a toast notification to the user
 *
 * Uses client.tui.showToast() to display a toast notification with the
 * provided title, message, variant, and duration.
 *
 * @param client - OpenCode SDK client
 * @param title - Optional title for the toast (defaults to "OpenCode Command Hook")
 * @param message - Message text for the toast
 * @param variant - Visual variant (info, success, warning, error)
 * @param duration - Optional duration in milliseconds
 * @returns Promise that resolves when toast is shown
 */
const showToast = async (
    client: OpencodeClient,
    title: string | undefined,
    message: string,
    variant: "info" | "success" | "warning" | "error" = "info",
    duration?: number
): Promise<void> => {
    try {
        const finalTitle = title || "OpenCode Command Hook"
        logger.debug(`Showing toast: title="${finalTitle}", message="${message.substring(0, 50)}...", variant="${variant}", duration=${duration}`)

        await client.tui.showToast({
            body: {
                title: finalTitle,
                message,
                variant,
                duration,
            },
        })

        logger.info(`[toast] ${finalTitle}: ${message}`)
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error)
        logger.error(`Failed to show toast: ${errorMessage}`)
        // Don't throw - this is non-blocking
    }
}

/**
 * Inject a message into a session using the OpenCode SDK
 *
 * Uses client.session.promptAsync() with noReply: true to inject context
 * without triggering an AI response.
 *
 * @param client - OpenCode SDK client
 * @param sessionId - Session ID to inject into
 * @param message - Message text to inject
 * @returns Promise that resolves when message is injected
 */
const injectMessage = async (
   client: OpencodeClient,
   sessionId: string,
   message: string
): Promise<void> => {
    try {
       logger.debug(`Injecting message into session ${sessionId}`)

     await client.session.promptAsync({
       path: { id: sessionId },
       body: {
         noReply: true,
         parts: [{ type: "text", text: message }],
       },
     })

       logger.info(`[inject] Message injected into session ${sessionId}: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`)
     } catch (error) {
       const errorMessage =
         error instanceof Error ? error.message : String(error)
       logger.error(`Failed to inject message into session: ${errorMessage}`)
     throw error
   }
}

/**
 * Execute a single hook (tool or session)
 *
 * Runs the hook's commands, interpolates the template if configured,
 * and injects the result into the session if configured. Handles both
 * ToolHook and SessionHook types with unified logic.
 *
 * @param hook - The hook to execute (tool or session)
 * @param context - Execution context (tool name, session ID, agent, etc.)
 * @param client - OpenCode SDK client for message injection
 * @param truncationLimit - Optional truncation limit for command output
 * @returns Promise that resolves when hook execution is complete
 */
const executeHook = async (
   hook: ToolHook | SessionHook,
   context: HookExecutionContext,
   client: OpencodeClient,
   truncationLimit?: number
): Promise<void> => {
   const hookType = isToolHook(hook) ? "tool" : "session"
   logger.debug(
     `Executing ${hookType} hook "${hook.id}"${context.tool ? ` for tool "${context.tool}"` : ""}, truncationLimit: ${truncationLimit}`
   )

   try {
     // Execute the hook's commands
     if (truncationLimit !== undefined) {
       logger.debug(`Executing with truncateOutput: ${truncationLimit}`)
     } else {
       logger.debug(`Executing with default truncation (30000)`)
     }
     const results = await executeCommands(hook.run, hook.id, truncationLimit !== undefined ? { truncateOutput: truncationLimit } : undefined)

     logger.debug(
       `Hook "${hook.id}" executed ${results.length} command(s)`
     )

     // If inject is configured, prepare and inject the message
     if (hook.inject) {
       const lastResult = results[results.length - 1]

       const templateContext: TemplateContext = {
         id: hook.id,
         agent: context.agent,
         tool: context.tool, // Will be undefined for session hooks
         cmd: Array.isArray(hook.run) ? hook.run[0] : hook.run,
         stdout: lastResult?.stdout,
         stderr: lastResult?.stderr,
         exitCode: lastResult?.exitCode,
       }

       const message = interpolateTemplate(hook.inject, templateContext)
       await injectMessage(client, context.sessionId, message)
     }

     // If toast is configured, interpolate and show toast notification
     if (hook.toast) {
       const lastResult = results[results.length - 1]

       const templateContext: TemplateContext = {
         id: hook.id,
         agent: context.agent,
         tool: context.tool,
         cmd: Array.isArray(hook.run) ? hook.run[0] : hook.run,
         stdout: lastResult?.stdout,
         stderr: lastResult?.stderr,
         exitCode: lastResult?.exitCode,
       }

       const toastTitle = hook.toast.title ? interpolateTemplate(hook.toast.title, templateContext) : undefined
       const toastMessage = interpolateTemplate(hook.toast.message, templateContext)

       await showToast(
         client,
         toastTitle,
         toastMessage,
         hook.toast.variant || "info",
         hook.toast.duration
       )
     }
   } catch (error) {
     const errorMessage = formatErrorMessage(hook.id, error)
     logger.error(errorMessage)

     try {
       await injectMessage(client, context.sessionId, errorMessage)
     } catch (injectionError) {
       const injectionErrorMsg =
         injectionError instanceof Error
           ? injectionError.message
           : String(injectionError)
       logger.error(
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
const isToolHook = (hook: ToolHook | SessionHook): hook is ToolHook => {
   return "phase" in hook.when
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
 * @param truncationLimit - Optional truncation limit for command output (overrides default 30,000)
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
   client: OpencodeClient,
   truncationLimit?: number
): Promise<void> {
     try {
        logger.debug(
          `executeHooks called with ${hooks.length} hook(s) for session "${context.sessionId}", truncationLimit: ${truncationLimit}`
        )

       // Execute each hook
       for (const hook of hooks) {
         try {
           await executeHook(hook, context, client, truncationLimit)
        } catch (error) {
          // Catch errors from individual hook execution and continue
          // (errors are already logged and injected by the hook execution functions)
          const errorMessage =
            error instanceof Error ? error.message : String(error)
           logger.error(
             `Unexpected error executing hook "${hook.id}": ${errorMessage}`
           )
        }
      }

       logger.debug(`executeHooks completed for ${hooks.length} hook(s)`)
    } catch (error) {
      // Catch-all for unexpected errors
      const errorMessage =
        error instanceof Error ? error.message : String(error)
       logger.error(
         `Unexpected error in executeHooks: ${errorMessage}`
       )
     // Don't throw - this is non-blocking
   }
}
