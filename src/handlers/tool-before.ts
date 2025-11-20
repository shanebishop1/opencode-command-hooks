/**
 * Tool execution before-hook handler for opencode-command-hooks
 *
 * Implements the tool.execute.before event handler that:
 * 1. Extracts context from the event (toolName, sessionId, callingAgent, slashCommand)
 * 2. Loads global and markdown configurations
 * 3. Merges and validates configurations
 * 4. Matches hooks using matchToolHooks with phase="before"
 * 5. For each matched hook:
 *    - Executes commands
 *    - Interpolates template (if inject configured)
 *    - Injects message into session (if inject configured)
 * 6. Handles errors gracefully with logging and optional error message injection
 *
 * Non-blocking error semantics: Hook failures never prevent tool execution.
 */

import type { OpencodeClient } from "@opencode-ai/sdk"
import type { ToolHook, TemplateContext } from "../types/hooks.js"
import { loadGlobalConfig } from "../config/global.js"
import { mergeConfigs } from "../config/merge.js"
import { validateConfig } from "../config/validate.js"
import { matchToolHooks } from "../matching/matcher.js"
import { executeCommands } from "../execution/shell.js"
import { interpolateTemplate } from "../execution/template.js"
import { getGlobalLogger } from "../logging.js"

const log = getGlobalLogger()

/**
 * Tool execution before event structure
 *
 * This is the event object passed to the tool.execute.before hook.
 * Based on research report findings about OpenCode plugin hooks.
 */
interface ToolExecuteBeforeEvent {
  /**
   * Tool name being executed (e.g., "task", "bash", "write", "read")
   */
  tool: string

  /**
   * Tool arguments/input
   */
  input: Record<string, unknown>

  /**
   * Tool output/metadata (can be modified)
   */
  output?: Record<string, unknown>

  /**
   * Session ID where the tool is being called
   */
  sessionId?: string

  /**
   * Calling agent name (if available)
   */
  callingAgent?: string

  /**
   * Slash command name (if applicable)
   */
  slashCommand?: string

}

/**
 * Extract context from a tool.execute.before event
 *
 * Safely extracts all relevant context information from the event,
 * with sensible defaults for missing values.
 *
 * @param event - The tool.execute.before event
 * @returns Extracted context object
 */
function extractEventContext(event: ToolExecuteBeforeEvent): {
  toolName: string
  sessionId: string
  callingAgent?: string
  slashCommand?: string
} {
  return {
    toolName: event.tool || "unknown",
    sessionId: event.sessionId || "unknown",
    callingAgent: event.callingAgent,
    slashCommand: event.slashCommand,
  }
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
   * @param role - Message role: "user" or "assistant"
   * @returns Promise that resolves when injection is complete
   */
  async function injectMessage(
    client: OpencodeClient,
    sessionId: string,
    message: string,
    role: "user" | "assistant" = "user"
  ): Promise<void> {
   try {
     log.debug(
       `Injecting message into session ${sessionId} as ${role}`
     )

      // Note: The role parameter is logged for debugging but the OpenCode SDK
     // doesn't currently support role specification in session.prompt()
     // Future versions may support this capability

     await client.session.prompt({
       path: { id: sessionId },
       body: {
         noReply: true,
         parts: [{ type: "text", text: message }],
       },
     })

     // Add a small delay to ensure the message is fully processed before continuing
     // This helps ensure "before" hook messages appear before the tool output
     await new Promise(resolve => setTimeout(resolve, 100))

     log.debug(`Message injected successfully`)
   } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error(
      `Failed to inject message into session: ${errorMessage}`
    )
    // Don't throw - this is non-blocking
  }
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
function formatErrorMessage(hookId: string, error: unknown): string {
  const errorText =
    error instanceof Error ? error.message : String(error || "Unknown error")
  return `Hook "${hookId}" failed: ${errorText}`
}

/**
 * Execute a single matched hook
 *
 * Runs the hook's commands, interpolates the template if configured,
 * and injects the result into the session if configured.
 *
 * @param hook - The hook to execute
 * @param context - Execution context (tool name, session ID, agent, etc.)
 * @param client - OpenCode SDK client for message injection
 * @returns Promise that resolves when hook execution is complete
 */
async function executeHook(
  hook: ToolHook,
  context: {
    toolName: string
    sessionId: string
    callingAgent?: string
    slashCommand?: string
  },
  client: OpencodeClient
): Promise<void> {
   log.debug(
     `Executing hook "${hook.id}" for tool "${context.toolName}"`
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
        agent: context.callingAgent,
        tool: context.toolName,
        cmd: Array.isArray(hook.run) ? hook.run[0] : hook.run,
        stdout: lastResult?.stdout,
        stderr: lastResult?.stderr,
        exitCode: lastResult?.exitCode,
      }

      // Interpolate template
      const template = hook.inject.template || ""
      const message = interpolateTemplate(template, templateContext)

       // Determine message role (default to "user")
       const role = (hook.inject.as || "user") as "user" | "assistant"

       // Inject into session
       await injectMessage(client, context.sessionId, message, role)
    }
  } catch (error) {
    // Log the error but don't throw - this is non-blocking
    const errorMessage = formatErrorMessage(hook.id, error)
    log.error(errorMessage)

     // Optionally inject error message into session
     try {
       await injectMessage(client, context.sessionId, errorMessage, "user")
     } catch (injectionError) {
      // If error injection fails, just log it
      const injectionErrorMsg =
        injectionError instanceof Error
          ? injectionError.message
          : String(injectionError)
      log.error(
        `Failed to inject error message: ${injectionErrorMsg}`
      )
    }
  }
}

/**
 * Handle tool.execute.before event
 *
 * Main entry point for the tool.execute.before hook. Orchestrates the entire
 * flow of loading configs, matching hooks, and executing them.
 *
 * This function implements non-blocking error semantics: any errors during
 * hook execution are logged and optionally injected into the session, but
 * never prevent the tool from executing.
 *
 * @param event - The tool.execute.before event
 * @param client - OpenCode SDK client for message injection
 * @returns Promise that resolves when all hooks are processed
 */
export async function handleToolExecuteBefore(
  event: ToolExecuteBeforeEvent,
  client: OpencodeClient
): Promise<void> {
   try {
     log.debug(`handleToolExecuteBefore called with tool: ${event.tool}, sessionId: ${event.sessionId}, callingAgent: ${event.callingAgent}`)

     // Extract context from event
    const context = extractEventContext(event)

    // Load global config
    const globalConfig = await loadGlobalConfig()

    // Load markdown config (if agent/command file path is available)
    // Note: In the current implementation, we don't have the file path from the event
    // This would need to be provided by the plugin context or extracted from the agent metadata
    // For now, we'll use an empty markdown config
    const markdownConfig = { tool: [], session: [] }

    // Merge configs
    const { config: mergedConfig, errors: mergeErrors } = mergeConfigs(
      globalConfig,
      markdownConfig
    )

    // Validate merged config
    const validationErrors = validateConfig(mergedConfig)
     const allErrors = [...mergeErrors, ...validationErrors]

     if (allErrors.length > 0) {
       log.debug(
         `Found ${allErrors.length} validation error(s)`
       )

        // Inject validation errors into session
       for (const error of allErrors) {
         const errorMsg = `Configuration error: ${error.message}`
         try {
           await injectMessage(client, context.sessionId, errorMsg, "user")
         } catch (injectionError) {
          log.error(
            `Failed to inject validation error: ${injectionError}`
          )
        }
      }
    }

    // Match hooks using matchToolHooks with phase="before"
    const matchedHooks = matchToolHooks(mergedConfig.tool || [], {
      phase: "before",
      toolName: context.toolName,
      callingAgent: context.callingAgent,
       slashCommand: context.slashCommand,
     })

     log.debug(
       `Matched ${matchedHooks.length} hook(s) for phase="before" tool="${context.toolName}"`
     )

     // Execute each matched hook
    for (const hook of matchedHooks) {
      await executeHook(hook, context, client)
    }


     log.debug(`handleToolExecuteBefore completed`)
   } catch (error) {
    // Catch-all for unexpected errors
    const errorMessage =
      error instanceof Error ? error.message : String(error)
    log.error(
      `Unexpected error in handleToolExecuteBefore: ${errorMessage}`
    )
    // Don't throw - this is non-blocking
  }
}
