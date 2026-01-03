/**
 * Markdown configuration parser for loading hooks from agent and slash-command markdown files
 *
 * Parses YAML frontmatter from markdown files and extracts command_hooks configuration.
 * Supports both agent markdown files (typically in .opencode/agents/) and slash-command
 * markdown files (typically in .opencode/commands/).
 */

import type { AgentHooks, AgentHookEntry, CommandHooksConfig, ToolHook } from "../types/hooks.js";
import { isValidCommandHooksConfig } from "../schemas.js";
import { load as parseYaml } from "js-yaml";
import { logger } from "../logging.js";



/**
 * Extract YAML frontmatter from markdown content
 *
 * Frontmatter is defined as content between the first `---` and second `---`
 * at the start of the file. Returns the raw YAML string (without delimiters).
 *
 * @param content - Full markdown file content
 * @returns Raw YAML string, or null if no frontmatter found
 *
 * @example
 * ```
 * ---
 * name: my-agent
 * command_hooks:
 *   tool: [...]
 * ---
 *
 * # Agent content
 * ```
 * Returns the YAML between the delimiters
 */
export const extractYamlFrontmatter = (content: string): string | null => {
  // Check if content starts with ---
  if (!content.startsWith("---")) {
    return null;
  }

  // Find the second --- delimiter
  // Start searching from position 3 (after the first ---)
  const secondDelimiterIndex = content.indexOf("---", 3);

  if (secondDelimiterIndex === -1) {
    // No closing delimiter found
    return null;
  }

  // Extract YAML between the delimiters
  const yamlContent = content.substring(3, secondDelimiterIndex).trim();

  return yamlContent;
}

/**
 * Parse YAML content and return the parsed object
 *
 * Handles YAML parsing errors gracefully by returning null.
 * Does not throw errors - callers should check for null return value.
 *
 * @param yamlContent - Raw YAML string to parse
 * @returns Parsed YAML object, or null if parsing failed
 */
export const parseYamlFrontmatter = (content: string): unknown => {
  try {
    const parsed = parseYaml(content);
    return parsed === undefined ? null : parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
     logger.debug(`Failed to parse YAML: ${message}`);
    return null;
  }
}

/**
 * Parse simplified agent hooks from YAML frontmatter content
 *
 * Extracts and validates the new simplified `hooks` format from agent markdown
 * frontmatter. Returns null if no hooks are present or if parsing fails.
 *
 * @param yamlContent - Raw YAML string from frontmatter
 * @param agentName - Name of the agent (used for auto-generating hook IDs)
 * @returns Parsed AgentHooks object, or null if no valid hooks found
 *
 * @example
 * ```yaml
 * hooks:
 *   before:
 *     - run: "echo starting"
 *   after:
 *     - run: ["npm run test"]
 *       inject: "Results:\n{stdout}"
 * ```
 */
export const parseAgentHooks = (
  yamlContent: string,
): AgentHooks | null => {
  const parsed = parseYamlFrontmatter(yamlContent);

   if (parsed === null || typeof parsed !== "object") {
     return null;
   }

  const config = parsed as Record<string, unknown>;
  const hooks = config.hooks;

  if (hooks === undefined) {
    return null;
  }

  if (typeof hooks !== "object" || hooks === null) {
    logger.debug("hooks field is not an object");
    return null;
  }

  const agentHooks = hooks as Record<string, unknown>;
  const result: AgentHooks = {};

  // Parse before array
  if (agentHooks.before !== undefined) {
    if (!Array.isArray(agentHooks.before)) {
      logger.debug("hooks.before is not an array");
      return null;
    }
    result.before = agentHooks.before as AgentHookEntry[];
  }

  // Parse after array
  if (agentHooks.after !== undefined) {
    if (!Array.isArray(agentHooks.after)) {
      logger.debug("hooks.after is not an array");
      return null;
    }
    result.after = agentHooks.after as AgentHookEntry[];
  }

  // Return null if both are empty/undefined
  if (!result.before?.length && !result.after?.length) {
    return null;
  }

  return result;
}

/**
 * Convert simplified agent hooks to internal CommandHooksConfig format
 *
 * Takes the simplified AgentHooks format and converts it to the internal
 * ToolHook[] format with auto-generated IDs and proper when clauses.
 *
 * @param agentHooks - Simplified agent hooks configuration
 * @param agentName - Name of the agent (used for hook ID generation)
 * @returns CommandHooksConfig with tool hooks converted to internal format
 *
 * @example
 * ```typescript
 * const simpleHooks: AgentHooks = {
 *   after: [{ run: "npm run test", inject: "Results: {stdout}" }]
 * };
 * const config = convertToCommandHooksConfig(simpleHooks, "engineer");
 * // Results in: { tool: [{ id: "engineer-after-0", when: {...}, run: ..., inject: ... }] }
 * ```
 */
export const convertToCommandHooksConfig = (
  agentHooks: AgentHooks,
  agentName: string,
): CommandHooksConfig => {
  const toolHooks: ToolHook[] = [];

  // Convert before hooks
  if (agentHooks.before) {
    agentHooks.before.forEach((hook, index) => {
      const toolHook = convertAgentHookEntryToToolHook(
        hook,
        agentName,
        "before",
        index,
      );
      if (toolHook) {
        toolHooks.push(toolHook);
      }
    });
  }

  // Convert after hooks
  if (agentHooks.after) {
    agentHooks.after.forEach((hook, index) => {
      const toolHook = convertAgentHookEntryToToolHook(
        hook,
        agentName,
        "after",
        index,
      );
      if (toolHook) {
        toolHooks.push(toolHook);
      }
    });
  }

  return {
    tool: toolHooks,
    session: [],
  };
}

/**
 * Convert a single AgentHookEntry to ToolHook format
 */
const convertAgentHookEntryToToolHook = (
  entry: AgentHookEntry,
  agentName: string,
  phase: "before" | "after",
  index: number,
): ToolHook | null => {
  if (!entry.run) {
    logger.debug("Hook entry missing required 'run' field");
    return null;
  }

  const hookId = `${agentName}-${phase}-${index}`;

  return {
    id: hookId,
    when: {
      phase: phase,
      tool: ["task"],
      callingAgent: [agentName], // Implicit scoping to this agent
    },
    run: entry.run,
    inject: entry.inject,
    toast: entry.toast,
  };
}



/**
 * Extract agent name from file path
 *
 * Takes an absolute path to an agent markdown file and extracts the agent name
 * (filename without .md extension).
 *
 * @param filePath - Absolute path to agent markdown file
 * @returns Agent name (filename without extension)
 *
 * @example
 * ```typescript
 * const name = extractAgentNameFromPath("/project/.opencode/agent/engineer.md");
 * // Returns: "engineer"
 * ```
 */
const extractAgentNameFromPath = (filePath: string): string => {
  const fileName = filePath.split("/").pop() || "";
  return fileName.replace(/\.md$/, "");
}

/**
 * Load and parse command hooks configuration from a markdown file
 *
 * Reads a markdown file, extracts YAML frontmatter, parses it, and extracts
 * either the new simplified `hooks` format or the legacy `command_hooks` format.
 *
 * Error handling:
 * - If file doesn't exist: returns empty config (not an error)
 * - If no frontmatter found: returns empty config
 * - If YAML is malformed: logs warning, returns empty config
 * - If hooks format is invalid: logs warning, returns empty config
 * - Never throws errors - always returns a valid config
 *
 * @param filePath - Absolute path to the markdown file
 * @returns Promise resolving to CommandHooksConfig (may be empty)
 *
 * @example
 * ```typescript
 * const config = await loadMarkdownConfig("/path/to/agent.md");
 * // Returns { tool: [...], session: [...] } or { tool: [], session: [] }
 * ```
 */
export const loadMarkdownConfig = async (
    filePath: string,
): Promise<CommandHooksConfig> => {
    try {
     // Try to read the file
     let content: string;
      try {
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
           logger.debug(`Markdown file not found: ${filePath}`);
          return { tool: [], session: [] };
        }
        content = await file.text();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
         logger.debug(
           `Failed to read markdown file ${filePath}: ${message}`,
         );
        return { tool: [], session: [] };
      }

      // Extract YAML frontmatter
      const yamlContent = extractYamlFrontmatter(content);

      if (!yamlContent) {
         logger.debug(
           `No YAML frontmatter found in ${filePath}`,
         );
        return { tool: [], session: [] };
      }

      // Parse YAML
      const parsed = parseYamlFrontmatter(yamlContent);

      if (parsed === null) {
         logger.info(
           `Failed to parse YAML frontmatter in ${filePath}`,
         );
        return { tool: [], session: [] };
      }

      // Extract command_hooks field
      if (typeof parsed !== "object" || parsed === null) {
         logger.debug(
           `Parsed YAML is not an object in ${filePath}`,
         );
        return { tool: [], session: [] };
      }

      const config = parsed as Record<string, unknown>;
      
       // First, try to parse the new simplified hooks format
       const agentName = extractAgentNameFromPath(filePath);
       const agentHooks = parseAgentHooks(yamlContent);
       
       if (agentHooks) {
         // Convert simplified format to internal format
         const result = convertToCommandHooksConfig(agentHooks, agentName);
         logger.debug(
           `Loaded simplified hooks from ${filePath}: ${result.tool?.length ?? 0} tool hooks`,
         );
         return result;
       }
      
       // Fall back to old command_hooks format
       const commandHooks = config.command_hooks;

       if (commandHooks === undefined) {
          logger.debug(
            `No hooks or command_hooks field in ${filePath}`,
          );
         return { tool: [], session: [] };
       }

       // Validate command_hooks structure
       if (!isValidCommandHooksConfig(commandHooks)) {
          logger.info(
            `command_hooks field is not a valid object in ${filePath} (expected { tool?: [], session?: [] })`,
          );
         return { tool: [], session: [] };
       }

       // Return with defaults for missing arrays
       const result: CommandHooksConfig = {
         tool: commandHooks.tool ?? [],
         session: commandHooks.session ?? [],
       };

        logger.debug(
          `Loaded command_hooks from ${filePath}: ${result.tool?.length ?? 0} tool hooks, ${result.session?.length ?? 0} session hooks`,
        );

      return result;
    } catch (error) {
      // Catch-all for unexpected errors
      const message = error instanceof Error ? error.message : String(error);
       logger.info(
         `Unexpected error loading markdown config from ${filePath}: ${message}`,
       );
      return { tool: [], session: [] };
    }
}

