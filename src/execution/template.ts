/**
 * Template interpolation module for opencode-command-hooks
 *
 * Provides functions to replace placeholders in template strings with values
 * from hook execution context. Supports graceful handling of missing values
 * and multi-line templates.
 *
 * Supported placeholders:
 * - {id} - hook ID
 * - {agent} - agent name (if available)
 * - {tool} - tool name (if available)
 * - {cmd} - command string (if available)
 * - {stdout} - command stdout (if available)
 * - {stderr} - command stderr (if available)
 * - {exitCode} - command exit code (if available)
 */

import type { TemplateContext } from "../types/hooks.js"
import { logger, isDebugEnabled } from "../logging.js"

/**
 * Replace a placeholder in a template string with a value
 *
 * @param template - The template string
 * @param placeholder - The placeholder name (without braces, e.g., "id", "stdout")
 * @param value - The value to replace with (undefined becomes empty string)
 * @returns The template with the placeholder replaced
 */
const replacePlaceholder = (template: string, placeholder: string, value: unknown): string => {
  // Convert value to string, handling undefined/null
  const stringValue = value === undefined || value === null ? "" : String(value)

  // Create regex to match {placeholder} globally
  const regex = new RegExp(`\\{${placeholder}\\}`, "g")
  return template.replace(regex, stringValue)
}

/**
 * Interpolate a template string by replacing placeholders with context values
 *
 * Replaces the following placeholders:
 * - {id} - hook ID (required, always available)
 * - {agent} - agent name (optional)
 * - {tool} - tool name (optional)
 * - {cmd} - command string (optional)
 * - {stdout} - command stdout (optional)
 * - {stderr} - command stderr (optional)
 * - {exitCode} - command exit code (optional)
 *
 * Missing values are replaced with empty strings. The function never throws
 * and always returns a valid string.
 *
 * @param template - Template string with placeholders
 * @param context - TemplateContext with values for substitution
 * @returns Interpolated string with placeholders replaced
 *
 * @example
 * ```typescript
 * const context: TemplateContext = {
 *   id: "tests-after-task",
 *   agent: "build",
 *   tool: "task",
 *   cmd: "pnpm test",
 *   stdout: "✓ All tests passed",
 *   stderr: "",
 *   exitCode: 0
 * }
 *
 * const template = "Hook {id} for {tool} completed: exit {exitCode}\n```\n{stdout}\n```"
 * const result = interpolateTemplate(template, context)
 * // Result: "Hook tests-after-task for task completed: exit 0\n```\n✓ All tests passed\n```"
 * ```
 */
export const interpolateTemplate = (template: string | undefined, context: TemplateContext): string => {
  // Handle null/undefined template
  if (!template) {
    return ""
  }

    if (isDebugEnabled()) {
      logger.debug(`Interpolating template with context: ${JSON.stringify({
        id: context.id,
        agent: context.agent,
        tool: context.tool,
        cmd: context.cmd ? `${context.cmd.substring(0, 50)}...` : undefined,
        stdout: context.stdout ? `${context.stdout.substring(0, 50)}...` : undefined,
        stderr: context.stderr ? `${context.stderr.substring(0, 50)}...` : undefined,
        exitCode: context.exitCode,
      })}`)
    }

  let result = template

  // Replace all placeholders
  // Order doesn't matter since each placeholder is unique
  result = replacePlaceholder(result, "id", context.id)
  result = replacePlaceholder(result, "agent", context.agent)
  result = replacePlaceholder(result, "tool", context.tool)
  result = replacePlaceholder(result, "cmd", context.cmd)
  result = replacePlaceholder(result, "stdout", context.stdout)
  result = replacePlaceholder(result, "stderr", context.stderr)
  result = replacePlaceholder(result, "exitCode", context.exitCode)

    if (isDebugEnabled()) {
      logger.debug(`Template interpolation complete, result length: ${result.length}`)
    }

  return result
}
