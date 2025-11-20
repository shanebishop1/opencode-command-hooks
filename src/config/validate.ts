/**
 * Configuration validation for hook configurations
 *
 * Validates hook configurations against the schema defined in types/hooks.ts.
 * Returns validation errors without throwing - allows graceful error handling.
 *
 * Validation includes:
 * - Required fields (id, when, run)
 * - Field types and values
 * - Injection configuration structure
 * - Event types for session hooks
 * - Phase values for tool hooks
 */

import type {
  CommandHooksConfig,
  HookValidationError,
} from "../types/hooks.js"
import { getGlobalLogger } from "../logging.js"

const DEBUG = process.env.OPENCODE_HOOKS_DEBUG === "1"
const log = getGlobalLogger()

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Check if a value is a string or array of strings
 */
function isStringOrStringArray(value: unknown): boolean {
  if (typeof value === "string") {
    return true
  }
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string")
  }
  return false
}

/**
 * Check if a value is a string or string array (or undefined)
 */
function isOptionalStringOrStringArray(value: unknown): boolean {
  if (value === undefined) {
    return true
  }
  return isStringOrStringArray(value)
}

/**
 * Validate injection configuration structure
 *
 * Checks that inject object (if present) has valid field values.
 * Returns array of validation errors (empty if valid).
 *
 * @param inject - Injection configuration to validate
 * @param hookId - Hook ID for error reporting
 * @returns Array of validation errors
 */
function validateInjection(
  inject: unknown,
  hookId: string,
): HookValidationError[] {
  const errors: HookValidationError[] = []

  if (inject === undefined) {
    return errors
  }

  if (typeof inject !== "object" || inject === null) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": inject must be an object`,
      severity: "error",
    })
    return errors
  }

  const inj = inject as Record<string, unknown>

  // Validate target if present
  if (inj.target !== undefined) {
    if (typeof inj.target !== "string") {
      errors.push({
        hookId,
        type: "invalid_injection_target",
        message: `Hook "${hookId}": inject.target must be a string`,
        severity: "error",
      })
    } else if (inj.target !== "callingSession") {
      errors.push({
        hookId,
        type: "invalid_injection_target",
        message: `Hook "${hookId}": inject.target must be "callingSession", got "${inj.target}"`,
        severity: "error",
      })
    }
  }

  // Validate as if present
  if (inj.as !== undefined) {
    if (typeof inj.as !== "string") {
      errors.push({
        hookId,
        type: "invalid_injection_as",
        message: `Hook "${hookId}": inject.as must be a string`,
        severity: "error",
      })
    } else if (!["user", "assistant"].includes(inj.as)) {
       errors.push({
         hookId,
         type: "invalid_injection_as",
         message: `Hook "${hookId}": inject.as must be "user" or "assistant", got "${inj.as}"`,
         severity: "error",
       })
    }
  }

  // Validate template if present (just check it's a string)
  if (inj.template !== undefined && typeof inj.template !== "string") {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": inject.template must be a string`,
      severity: "error",
    })
  }

  return errors
}

/**
 * Validate that run field is present and valid
 *
 * @param run - Run field to validate
 * @param hookId - Hook ID for error reporting
 * @returns Array of validation errors
 */
function validateRunField(run: unknown, hookId: string): HookValidationError[] {
  const errors: HookValidationError[] = []

  if (run === undefined) {
    errors.push({
      hookId,
      type: "missing_run",
      message: `Hook "${hookId}": missing required field "run"`,
      severity: "error",
    })
    return errors
  }

  if (!isStringOrStringArray(run)) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": run must be a string or array of strings`,
      severity: "error",
    })
  }

  return errors
}

// ============================================================================
// TOOL HOOK VALIDATION
// ============================================================================

/**
 * Validate a tool hook configuration
 *
 * Checks:
 * - Required fields: id, when, run
 * - when.phase is "before" or "after"
 * - when.tool, when.callingAgent, when.slashCommand are strings or string arrays
 * - inject configuration is valid (if present)
 *
 * @param hook - Hook to validate (should be unknown to handle invalid input)
 * @returns Array of validation errors (empty if valid)
 */
export function validateToolHook(hook: unknown): HookValidationError[] {
  const errors: HookValidationError[] = []

  // Check if hook is an object
  if (typeof hook !== "object" || hook === null) {
    errors.push({
      type: "unknown",
      message: "Tool hook must be an object",
      severity: "error",
    })
    return errors
  }

  const h = hook as Record<string, unknown>

  // Validate id field
  if (h.id === undefined) {
    errors.push({
      type: "missing_id",
      message: "Tool hook: missing required field \"id\"",
      severity: "error",
    })
    // Can't continue without id for error reporting
    return errors
  }

  if (typeof h.id !== "string") {
    errors.push({
      hookId: String(h.id),
      type: "unknown",
      message: `Tool hook: id must be a string`,
      severity: "error",
    })
    return errors
  }

  const hookId = h.id

  // Validate when field
  if (h.when === undefined) {
    errors.push({
      hookId,
      type: "missing_when",
      message: `Hook "${hookId}": missing required field "when"`,
      severity: "error",
    })
    return errors
  }

  if (typeof h.when !== "object" || h.when === null) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": when must be an object`,
      severity: "error",
    })
    return errors
  }

  const when = h.when as Record<string, unknown>

  // Validate when.phase
  if (when.phase === undefined) {
    errors.push({
      hookId,
      type: "missing_when",
      message: `Hook "${hookId}": missing required field "when.phase"`,
      severity: "error",
    })
  } else if (typeof when.phase !== "string") {
    errors.push({
      hookId,
      type: "invalid_phase",
      message: `Hook "${hookId}": when.phase must be a string`,
      severity: "error",
    })
  } else if (!["before", "after"].includes(when.phase)) {
    errors.push({
      hookId,
      type: "invalid_phase",
      message: `Hook "${hookId}": when.phase must be "before" or "after", got "${when.phase}"`,
      severity: "error",
    })
  }

  // Validate when.tool (optional, string or string array)
  if (!isOptionalStringOrStringArray(when.tool)) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": when.tool must be a string or array of strings`,
      severity: "error",
    })
  }

  // Validate when.callingAgent (optional, string or string array)
  if (!isOptionalStringOrStringArray(when.callingAgent)) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": when.callingAgent must be a string or array of strings`,
      severity: "error",
    })
  }

  // Validate when.slashCommand (optional, string or string array)
  if (!isOptionalStringOrStringArray(when.slashCommand)) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": when.slashCommand must be a string or array of strings`,
      severity: "error",
    })
  }

  // Validate run field
  errors.push(...validateRunField(h.run, hookId))

  // Validate inject field (optional)
  errors.push(...validateInjection(h.inject, hookId))

  if (DEBUG && errors.length > 0) {
    log.debug(
      `Tool hook "${hookId}" validation errors: ${errors.length}`,
    )
  }

  return errors
}

// ============================================================================
// SESSION HOOK VALIDATION
// ============================================================================

/**
 * Validate a session hook configuration
 *
 * Checks:
 * - Required fields: id, when, run
 * - when.event is "session.start", "session.idle", or "session.end"
 * - when.agent is optional string or string array
 * - inject configuration is valid (if present)
 *
 * @param hook - Hook to validate (should be unknown to handle invalid input)
 * @returns Array of validation errors (empty if valid)
 */
export function validateSessionHook(hook: unknown): HookValidationError[] {
  const errors: HookValidationError[] = []

  // Check if hook is an object
  if (typeof hook !== "object" || hook === null) {
    errors.push({
      type: "unknown",
      message: "Session hook must be an object",
      severity: "error",
    })
    return errors
  }

  const h = hook as Record<string, unknown>

  // Validate id field
  if (h.id === undefined) {
    errors.push({
      type: "missing_id",
      message: "Session hook: missing required field \"id\"",
      severity: "error",
    })
    // Can't continue without id for error reporting
    return errors
  }

  if (typeof h.id !== "string") {
    errors.push({
      hookId: String(h.id),
      type: "unknown",
      message: `Session hook: id must be a string`,
      severity: "error",
    })
    return errors
  }

  const hookId = h.id

  // Validate when field
  if (h.when === undefined) {
    errors.push({
      hookId,
      type: "missing_when",
      message: `Hook "${hookId}": missing required field "when"`,
      severity: "error",
    })
    return errors
  }

  if (typeof h.when !== "object" || h.when === null) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": when must be an object`,
      severity: "error",
    })
    return errors
  }

  const when = h.when as Record<string, unknown>

  // Validate when.event
  if (when.event === undefined) {
    errors.push({
      hookId,
      type: "missing_when",
      message: `Hook "${hookId}": missing required field "when.event"`,
      severity: "error",
    })
  } else if (typeof when.event !== "string") {
    errors.push({
      hookId,
      type: "invalid_event",
      message: `Hook "${hookId}": when.event must be a string`,
      severity: "error",
    })
  } else if (
    !["session.start", "session.idle", "session.end"].includes(when.event)
  ) {
    errors.push({
      hookId,
      type: "invalid_event",
      message: `Hook "${hookId}": when.event must be "session.start", "session.idle", or "session.end", got "${when.event}"`,
      severity: "error",
    })
  }

  // Validate when.agent (optional, string or string array)
  if (!isOptionalStringOrStringArray(when.agent)) {
    errors.push({
      hookId,
      type: "unknown",
      message: `Hook "${hookId}": when.agent must be a string or array of strings`,
      severity: "error",
    })
  }

  // Validate run field
  errors.push(...validateRunField(h.run, hookId))

  // Validate inject field (optional)
  errors.push(...validateInjection(h.inject, hookId))

  if (DEBUG && errors.length > 0) {
    log.debug(
      `Session hook "${hookId}" validation errors: ${errors.length}`,
    )
  }

  return errors
}

// ============================================================================
// CONFIG VALIDATION
// ============================================================================

/**
 * Validate a complete command hooks configuration
 *
 * Validates all tool and session hooks in the configuration.
 * Returns all validation errors found across all hooks.
 *
 * @param config - Configuration to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateConfig(config: CommandHooksConfig): HookValidationError[] {
  const errors: HookValidationError[] = []

  // Validate tool hooks
  if (config.tool && Array.isArray(config.tool)) {
    for (let i = 0; i < config.tool.length; i++) {
      const hookErrors = validateToolHook(config.tool[i])
      errors.push(...hookErrors)
    }
  }

  // Validate session hooks
  if (config.session && Array.isArray(config.session)) {
    for (let i = 0; i < config.session.length; i++) {
      const hookErrors = validateSessionHook(config.session[i])
      errors.push(...hookErrors)
    }
  }

  if (DEBUG && errors.length > 0) {
    log.debug(
      `Config validation found ${errors.length} error(s)`,
    )
  }

  return errors
}
