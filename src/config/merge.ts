/**
 * Configuration merging and precedence logic for combining global and markdown configs
 *
 * Implements the precedence rules from PRD section 5.3:
 * 1. Start with global hooks
 * 2. Markdown hooks with same `id` replace global hooks (no error)
 * 3. Markdown hooks with unique `id` are added
 * 4. Duplicate IDs within same source are errors
 */

import type {
    CommandHooksConfig,
    ToolHook,
    SessionHook,
    HookValidationError,
} from "../types/hooks.js"
import { logger } from "../logging.js"

/**
 * Find duplicate IDs within a hook array
 *
 * Scans through an array of hooks and returns a list of IDs that appear
 * more than once. Useful for validation of both tool and session hooks.
 *
 * @param hooks - Array of hooks to check (ToolHook[] or SessionHook[])
 * @returns Array of duplicate IDs (empty if no duplicates found)
 *
 * @example
 * ```typescript
 * const hooks = [
 *   { id: "hook-1", ... },
 *   { id: "hook-2", ... },
 *   { id: "hook-1", ... }  // duplicate
 * ]
 * findDuplicateIds(hooks)  // Returns ["hook-1"]
 * ```
 */
export const findDuplicateIds = (hooks: (ToolHook | SessionHook)[]): string[] => {
   const idCounts = new Map<string, number>()

   // Count occurrences of each ID
   for (const hook of hooks) {
     const count = idCounts.get(hook.id) ?? 0
     idCounts.set(hook.id, count + 1)
   }

   // Return IDs that appear more than once
   return Array.from(idCounts.entries())
     .filter(([, count]) => count > 1)
     .map(([id]) => id)
}

/**
 * Validate a single config source for duplicate IDs
 *
 * Checks both tool and session hooks for duplicates and returns
 * validation errors for any found.
 *
 * @param config - Configuration to validate
 * @param source - Source identifier for error reporting (e.g., "global", "markdown")
 * @returns Array of validation errors (empty if no duplicates)
 */
const validateConfigForDuplicates = (
   config: CommandHooksConfig,
   source: string,
): HookValidationError[] => {
   const errors: HookValidationError[] = []

   // Check tool hooks for duplicates
   if (config.tool && config.tool.length > 0) {
     const toolDuplicates = findDuplicateIds(config.tool)
     for (const id of toolDuplicates) {
       errors.push({
         hookId: id,
         type: "duplicate_id",
         message: `Duplicate hook ID "${id}" found in ${source} tool hooks`,
         severity: "error",
       })
     }
   }

   // Check session hooks for duplicates
   if (config.session && config.session.length > 0) {
     const sessionDuplicates = findDuplicateIds(config.session)
     for (const id of sessionDuplicates) {
       errors.push({
         hookId: id,
         type: "duplicate_id",
         message: `Duplicate hook ID "${id}" found in ${source} session hooks`,
         severity: "error",
       })
     }
   }

   return errors
}

/**
 * Merge two hook arrays with markdown taking precedence
 *
 * Combines global and markdown hooks, where markdown hooks with the same ID
 * replace global hooks. Markdown hooks with unique IDs are appended.
 *
 * Order is preserved: global hooks first (except those replaced), then new markdown hooks.
 *
 * @param globalHooks - Hooks from global config
 * @param markdownHooks - Hooks from markdown config
 * @returns Merged hook array
 *
 * @example
 * ```typescript
 * const global = [
 *   { id: "hook-1", ... },
 *   { id: "hook-2", ... }
 * ]
 * const markdown = [
 *   { id: "hook-1", ... },  // replaces global hook-1
 *   { id: "hook-3", ... }   // new hook
 * ]
 * mergeHookArrays(global, markdown)
 * // Returns: [{ id: "hook-1", ... (markdown version) }, { id: "hook-2", ... }, { id: "hook-3", ... }]
 * ```
 */
const mergeHookArrays = <T extends ToolHook | SessionHook>(
   globalHooks: T[],
   markdownHooks: T[],
): T[] => {
   // Create a map of markdown hooks by ID for quick lookup
   const markdownMap = new Map<string, T>()
   const markdownIds = new Set<string>()

   for (const hook of markdownHooks) {
     markdownMap.set(hook.id, hook)
     markdownIds.add(hook.id)
   }

   // Start with global hooks, replacing those that appear in markdown
   const result: T[] = []
   const processedIds = new Set<string>()

   for (const hook of globalHooks) {
     if (markdownMap.has(hook.id)) {
       // Replace with markdown version
       result.push(markdownMap.get(hook.id)!)
     } else {
       // Keep global hook
       result.push(hook)
     }
     processedIds.add(hook.id)
   }

   // Add markdown hooks that weren't replacements
   for (const hook of markdownHooks) {
     if (!processedIds.has(hook.id)) {
       result.push(hook)
     }
   }

   return result
}

/**
 * Merge global and markdown configs with proper precedence
 *
 * Implements the precedence rules from PRD section 5.3:
 * 1. Start with global hooks
 * 2. Markdown hooks with same `id` replace global hooks (no error)
 * 3. Markdown hooks with unique `id` are added
 * 4. Duplicate IDs within same source are errors
 *
 * Returns both the merged config and any validation errors found.
 * Errors are returned but don't prevent merging - the caller can decide
 * how to handle them.
 *
 * @param global - Global configuration from opencode.json
 * @param markdown - Markdown configuration from agent/command .md file
 * @returns Object with merged config and validation errors
 *
 * @example
 * ```typescript
 * const global = {
 *   tool: [{ id: "hook-1", when: { phase: "after" }, run: "echo global" }],
 *   session: []
 * }
 * const markdown = {
 *   tool: [{ id: "hook-1", when: { phase: "after" }, run: "echo markdown" }],
 *   session: []
 * }
 * const result = mergeConfigs(global, markdown)
 * // result.config.tool[0].run === "echo markdown" (markdown replaced global)
 * // result.errors === [] (no duplicates)
 * ```
 */
export const mergeConfigs = (
   global: CommandHooksConfig,
   markdown: CommandHooksConfig,
): { config: CommandHooksConfig; errors: HookValidationError[] } => {
   const errors: HookValidationError[] = []

   // Validate global config for duplicates
   const globalErrors = validateConfigForDuplicates(global, "global")
   errors.push(...globalErrors)

   // Validate markdown config for duplicates
   const markdownErrors = validateConfigForDuplicates(markdown, "markdown")
   errors.push(...markdownErrors)

   // Merge tool hooks
   const globalToolHooks = global.tool ?? []
   const markdownToolHooks = markdown.tool ?? []
   const mergedToolHooks = mergeHookArrays(globalToolHooks, markdownToolHooks)

    // Merge session hooks
    const globalSessionHooks = global.session ?? []
    const markdownSessionHooks = markdown.session ?? []
    const mergedSessionHooks = mergeHookArrays(
      globalSessionHooks,
      markdownSessionHooks,
    )

    // Build merged config
     // Preserve truncationLimit from global config (markdown cannot override this)
     const mergedConfig: CommandHooksConfig = {
       truncationLimit: global.truncationLimit,
       tool: mergedToolHooks.length > 0 ? mergedToolHooks : [],
       session: mergedSessionHooks.length > 0 ? mergedSessionHooks : [],
     }

      logger.debug(
        `Merged configs: ${mergedToolHooks.length} tool hooks, ${mergedSessionHooks.length} session hooks, truncationLimit: ${mergedConfig.truncationLimit}, ${errors.length} errors`,
      )

     return { config: mergedConfig, errors }
}
