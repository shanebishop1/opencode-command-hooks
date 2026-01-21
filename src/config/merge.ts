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
 * Merge two hook arrays with project/markdown taking precedence
 *
 * Combines global and project hooks with the following rules:
 * 1. Project hooks with `overrideGlobal: true` suppress global hooks matching the same event key
 * 2. Project hooks with same `id` replace global hooks
 * 3. Project hooks with unique `id` are appended
 *
 * Order is preserved: global hooks first (except those filtered/replaced), then new project hooks.
 *
 * @param globalHooks - Hooks from user global config (~/.config/opencode/)
 * @param projectHooks - Hooks from project config (.opencode/) or markdown
 * @param getEventKey - Function to extract the event key for override matching
 * @returns Merged hook array
 *
 * @example
 * ```typescript
 * const global = [
 *   { id: "hook-1", when: { event: "session.created" }, ... },
 *   { id: "hook-2", when: { event: "session.idle" }, ... }
 * ]
 * const project = [
 *   { id: "hook-3", when: { event: "session.created" }, overrideGlobal: true, ... }
 * ]
 * mergeHookArrays(global, project, h => h.when.event)
 * // Returns: [{ id: "hook-2", ... }, { id: "hook-3", ... }]
 * // hook-1 was filtered out because hook-3 has overrideGlobal for same event
 * ```
 */
const mergeHookArrays = <T extends ToolHook | SessionHook>(
   globalHooks: T[],
   projectHooks: T[],
   getEventKey: (hook: T) => string,
): T[] => {
   // Step 1: Find project hooks with overrideGlobal: true and collect their event keys
   const overriddenKeys = new Set<string>()
   const wildcardOverridePhases = new Set<string>()

   for (const hook of projectHooks) {
     if (hook.overrideGlobal) {
       const key = getEventKey(hook)
       overriddenKeys.add(key)

       // For tool hooks: if tool is "*", mark the phase as fully overridden
       // Key format for tool hooks is "phase:tool", e.g., "after:\"*\"" or "after:\"bash\""
       if (key.includes('"*"')) {
         const phase = key.split(':')[0]
         wildcardOverridePhases.add(phase)
         logger.debug(`Wildcard override for phase "${phase}" from project hook "${hook.id}"`)
       }
     }
   }

   // Step 2: Filter out global hooks that match overridden keys
   const filteredGlobalHooks = globalHooks.filter(hook => {
     const key = getEventKey(hook)

     // Check for wildcard phase override (tool hooks only)
     const phase = key.split(':')[0]
     if (wildcardOverridePhases.has(phase)) {
       logger.debug(`Skipping global hook "${hook.id}" due to wildcard overrideGlobal on phase "${phase}"`)
       return false
     }

     // Check for exact event key override
     if (overriddenKeys.has(key)) {
       logger.debug(`Skipping global hook "${hook.id}" due to overrideGlobal on event key "${key}"`)
       return false
     }

     return true
   })

   // Step 3: Create a map of project hooks by ID for quick lookup
   const projectMap = new Map<string, T>()
   for (const hook of projectHooks) {
     projectMap.set(hook.id, hook)
   }

   // Step 4: Start with filtered global hooks, replacing those that appear in project
   const result: T[] = []
   const processedIds = new Set<string>()

   for (const hook of filteredGlobalHooks) {
     if (projectMap.has(hook.id)) {
       // Replace with project version
       result.push(projectMap.get(hook.id)!)
     } else {
       // Keep global hook
       result.push(hook)
     }
     processedIds.add(hook.id)
   }

   // Step 5: Add project hooks that weren't replacements
   for (const hook of projectHooks) {
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

   // Merge tool hooks with phase+tool matching for overrideGlobal
   const globalToolHooks = global.tool ?? []
   const markdownToolHooks = markdown.tool ?? []
   const mergedToolHooks = mergeHookArrays(
     globalToolHooks,
     markdownToolHooks,
     (hook: ToolHook) => `${hook.when.phase}:${JSON.stringify(hook.when.tool ?? "*")}`
   )

    // Merge session hooks with event matching for overrideGlobal
    const globalSessionHooks = global.session ?? []
    const markdownSessionHooks = markdown.session ?? []
    const mergedSessionHooks = mergeHookArrays(
      globalSessionHooks,
      markdownSessionHooks,
      (hook: SessionHook) => hook.when.event
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
