/**
 * Markdown configuration parser for loading hooks from agent and slash-command markdown files
 *
 * Parses YAML frontmatter from markdown files and extracts command_hooks configuration.
 * Supports both agent markdown files (typically in .opencode/agents/) and slash-command
 * markdown files (typically in .opencode/commands/).
 */

import type { CommandHooksConfig } from "../types/hooks.js";
import { load as parseYaml } from "js-yaml";

const LOG_PREFIX = "[opencode-command-hooks]";
const DEBUG = process.env.OPENCODE_HOOKS_DEBUG === "1";

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
export function extractYamlFrontmatter(content: string): string | null {
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
export function parseYamlFrontmatter(content: string): unknown {
  try {
    const parsed = parseYaml(content);
    return parsed === undefined ? null : parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (DEBUG) {
      console.log(`${LOG_PREFIX} Failed to parse YAML: ${message}`);
    }
    return null;
  }
}

/**
 * Check if a value is a valid CommandHooksConfig object
 */
function isValidCommandHooksConfig(
  value: unknown,
): value is CommandHooksConfig {
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

/**
 * Load and parse command hooks configuration from a markdown file
 *
 * Reads a markdown file, extracts YAML frontmatter, parses it, and extracts
 * the command_hooks field if present.
 *
 * Error handling:
 * - If file doesn't exist: returns empty config (not an error)
 * - If no frontmatter found: returns empty config
 * - If YAML is malformed: logs warning, returns empty config
 * - If command_hooks is invalid: logs warning, returns empty config
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
export async function loadMarkdownConfig(
  filePath: string,
): Promise<CommandHooksConfig> {
  try {
    // Try to read the file
    let content: string;
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        if (DEBUG) {
          console.log(`${LOG_PREFIX} Markdown file not found: ${filePath}`);
        }
        return { tool: [], session: [] };
      }
      content = await file.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Failed to read markdown file ${filePath}: ${message}`,
        );
      }
      return { tool: [], session: [] };
    }

    // Extract YAML frontmatter
    const yamlContent = extractYamlFrontmatter(content);

    if (!yamlContent) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} No YAML frontmatter found in ${filePath}`,
        );
      }
      return { tool: [], session: [] };
    }

    // Parse YAML
    const parsed = parseYamlFrontmatter(yamlContent);

    if (parsed === null) {
      console.warn(
        `${LOG_PREFIX} Failed to parse YAML frontmatter in ${filePath}`,
      );
      return { tool: [], session: [] };
    }

    // Extract command_hooks field
    if (typeof parsed !== "object" || parsed === null) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Parsed YAML is not an object in ${filePath}`,
        );
      }
      return { tool: [], session: [] };
    }

    const config = parsed as Record<string, unknown>;
    const commandHooks = config.command_hooks;

    if (commandHooks === undefined) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} No command_hooks field in ${filePath}`,
        );
      }
      return { tool: [], session: [] };
    }

    // Validate command_hooks structure
    if (!isValidCommandHooksConfig(commandHooks)) {
      console.warn(
        `${LOG_PREFIX} command_hooks field is not a valid object in ${filePath} (expected { tool?: [], session?: [] })`,
      );
      return { tool: [], session: [] };
    }

    // Return with defaults for missing arrays
    const result: CommandHooksConfig = {
      tool: commandHooks.tool ?? [],
      session: commandHooks.session ?? [],
    };

    if (DEBUG) {
      console.log(
        `${LOG_PREFIX} Loaded markdown config from ${filePath}: ${result.tool?.length ?? 0} tool hooks, ${result.session?.length ?? 0} session hooks`,
      );
    }

    return result;
  } catch (error) {
    // Catch-all for unexpected errors
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `${LOG_PREFIX} Unexpected error loading markdown config from ${filePath}: ${message}`,
    );
    return { tool: [], session: [] };
  }
}
