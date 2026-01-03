/**
 * Zod schemas for command hooks configuration
 *
 * Provides runtime validation and type safety for hook configurations.
 * Replaces manual validation with declarative, composable schemas.
 */

import { z } from "zod";

// ============================================================================
// PRIMITIVE SCHEMAS
// ============================================================================

/**
 * String or array of strings - used for flexible matching fields
 */
const StringOrArray = z.union([z.string(), z.array(z.string())]);

/**
 * Phase for tool hooks: "before" or "after"
 */
const PhaseSchema = z.enum(["before", "after"]);

/**
 * Session event types
 * Note: "session.start" maps to "session.created" internally
 */
const SessionEventSchema = z.enum(["session.created", "session.idle", "session.end", "session.start"]);

// ============================================================================
// TOOL HOOK SCHEMAS
// ============================================================================

/**
 * Matching conditions for tool hooks
 */
const ToolHookWhenSchema = z.object({
  phase: PhaseSchema,
  tool: StringOrArray.optional(),
  callingAgent: StringOrArray.optional(),
  slashCommand: StringOrArray.optional(),
});

/**
 * Toast notification configuration
 */
const ToastSchema = z.object({
   title: z.string().optional(),
   message: z.string(),
   variant: z.enum(["info", "success", "warning", "error"]).optional(),
   duration: z.number().optional(),
}).optional();

/**
 * Tool hook configuration
 *
 * Runs shell command(s) before or after a tool execution. Hooks can be filtered
 * by tool name, calling agent, and slash command context. Results can optionally
 * be injected into the session as messages.
 */
export const ToolHookSchema = z.object({
    id: z.string().min(1, "Hook ID must not be empty"),
    when: ToolHookWhenSchema,
    run: z.union([z.string(), z.array(z.string())]),
    inject: z.string().optional(),
    toast: ToastSchema,
});

// ============================================================================
// SESSION HOOK SCHEMAS
// ============================================================================

/**
 * Matching conditions for session hooks
 */
const SessionHookWhenSchema = z.object({
  event: SessionEventSchema,
  agent: StringOrArray.optional(),
});

/**
 * Session hook configuration
 *
 * Runs shell command(s) on session lifecycle events (start, idle, end).
 * Can be filtered by agent name. Results can optionally be injected into
 * the session as messages.
 */
export const SessionHookSchema = z.object({
    id: z.string().min(1, "Hook ID must not be empty"),
    when: SessionHookWhenSchema,
    run: z.union([z.string(), z.array(z.string())]),
    inject: z.string().optional(),
    toast: ToastSchema,
});

// ============================================================================
// CONFIGURATION SCHEMAS
// ============================================================================

/**
 * Top-level command hooks configuration
 *
 * This is the root configuration object that appears in opencode.json/.opencode.jsonc
 * under the "command_hooks" key, or in YAML frontmatter of agent/slash-command markdown.
 */
export const ConfigSchema = z.object({
  truncationLimit: z.number().int().positive().optional(),
  tool: z.array(ToolHookSchema).optional(),
  session: z.array(SessionHookSchema).optional(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Inferred TypeScript types from Zod schemas
 * These provide type safety throughout the codebase
 */
export type ToolHookWhen = z.infer<typeof ToolHookWhenSchema>;
export type SessionHookWhen = z.infer<typeof SessionHookWhenSchema>;
export type ToolHook = z.infer<typeof ToolHookSchema>;
export type SessionHook = z.infer<typeof SessionHookSchema>;
export type CommandHooksConfig = z.infer<typeof ConfigSchema>;

// ============================================================================
// PARSING FUNCTIONS
// ============================================================================

/**
 * Safe configuration parser with fallback defaults
 *
 * Parses unknown input and returns a valid CommandHooksConfig.
 * On validation failure, returns safe defaults (empty arrays).
 *
 * @param input - Unknown configuration object to parse
 * @returns Valid CommandHooksConfig with safe defaults on failure
 */
export const parseConfig = (input: unknown): CommandHooksConfig => {
  const result = ConfigSchema.safeParse(input);

  if (!result.success) {
    // Return safe defaults on validation failure
    return {
      tool: [],
      session: [],
    };
  }

  // For successful parses, keep undefined fields as-is
  // This allows callers to distinguish between "not provided" vs "provided"
  return result.data;
}

/**
 * Parse a single tool hook with error details
 *
 * @param input - Unknown hook object to parse
 * @returns Parsed hook or null if invalid
 */
export const parseToolHook = (input: unknown): ToolHook | null => {
  const result = ToolHookSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * Parse a single session hook with error details
 *
 * @param input - Unknown hook object to parse
 * @returns Parsed hook or null if invalid
 */
export const parseSessionHook = (input: unknown): SessionHook | null => {
  const result = SessionHookSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * Get detailed validation errors for debugging
 *
 * @param input - Unknown configuration object to validate
 * @returns Validation errors if any, or null if valid
 */
export const getConfigValidationErrors = (
  input: unknown
): z.ZodError | null => {
  const result = ConfigSchema.safeParse(input);
  return result.success ? null : result.error;
}

/**
 * Check if a value is a valid CommandHooksConfig object
 */
export const isValidCommandHooksConfig = (
  value: unknown,
): value is CommandHooksConfig => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Both tool and session are optional
  if (obj.tool !== undefined && !Array.isArray(obj.tool)) {
    return false;
  }

  if (obj.session !== undefined && !Array.isArray(obj.session)) {
    return false;
  }

  return true;
}
