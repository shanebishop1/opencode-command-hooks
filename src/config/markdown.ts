/**
 * Markdown configuration parser for loading hooks from agent and slash-command markdown files
 *
 * Parses YAML frontmatter from markdown files and extracts command_hooks configuration.
 * Supports both agent markdown files (typically in .opencode/agents/) and slash-command
 * markdown files (typically in .opencode/commands/).
 */

import type { CommandHooksConfig } from "../types/hooks.js";
import { load as parseYaml } from "js-yaml";
import { logger } from "../logging.js";

/**
 * In-memory cache for markdown configurations
 * Maps file paths to their parsed CommandHooksConfig to avoid repeated file reads.
 * Entries are cached indefinitely; clear manually if config files change.
 */
const markdownConfigCache = new Map<string, CommandHooksConfig>();

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
     logger.debug(`Failed to parse YAML: ${message}`);
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
 * **Caching:** This function implements in-memory caching per file path to avoid
 * repeated file reads. The cache is checked first; if not found, the file is read
 * from disk and cached for subsequent calls.
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
   // Check cache first
   if (markdownConfigCache.has(filePath)) {
     const cached = markdownConfigCache.get(filePath)!;
      logger.debug(`Returning cached markdown config from ${filePath}: ${cached.tool?.length ?? 0} tool hooks, ${cached.session?.length ?? 0} session hooks`);
     return cached;
   }

   try {
     // Try to read the file
     let content: string;
     try {
       const file = Bun.file(filePath);
       if (!(await file.exists())) {
          logger.debug(`Markdown file not found: ${filePath}`);
         const emptyConfig = { tool: [], session: [] };
         markdownConfigCache.set(filePath, emptyConfig);
         return emptyConfig;
       }
       content = await file.text();
     } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
        logger.debug(
          `Failed to read markdown file ${filePath}: ${message}`,
        );
       const emptyConfig = { tool: [], session: [] };
       markdownConfigCache.set(filePath, emptyConfig);
       return emptyConfig;
     }

     // Extract YAML frontmatter
     const yamlContent = extractYamlFrontmatter(content);

     if (!yamlContent) {
        logger.debug(
          `No YAML frontmatter found in ${filePath}`,
        );
       const emptyConfig = { tool: [], session: [] };
       markdownConfigCache.set(filePath, emptyConfig);
       return emptyConfig;
     }

     // Parse YAML
     const parsed = parseYamlFrontmatter(yamlContent);

     if (parsed === null) {
        logger.info(
          `Failed to parse YAML frontmatter in ${filePath}`,
        );
       const emptyConfig = { tool: [], session: [] };
       markdownConfigCache.set(filePath, emptyConfig);
       return emptyConfig;
     }

     // Extract command_hooks field
     if (typeof parsed !== "object" || parsed === null) {
        logger.debug(
          `Parsed YAML is not an object in ${filePath}`,
        );
       const emptyConfig = { tool: [], session: [] };
       markdownConfigCache.set(filePath, emptyConfig);
       return emptyConfig;
     }

     const config = parsed as Record<string, unknown>;
     const commandHooks = config.command_hooks;

     if (commandHooks === undefined) {
        logger.debug(
          `No command_hooks field in ${filePath}`,
        );
       const emptyConfig = { tool: [], session: [] };
       markdownConfigCache.set(filePath, emptyConfig);
       return emptyConfig;
     }

     // Validate command_hooks structure
     if (!isValidCommandHooksConfig(commandHooks)) {
        logger.info(
          `command_hooks field is not a valid object in ${filePath} (expected { tool?: [], session?: [] })`,
        );
       const emptyConfig = { tool: [], session: [] };
       markdownConfigCache.set(filePath, emptyConfig);
       return emptyConfig;
     }

     // Return with defaults for missing arrays
     const result: CommandHooksConfig = {
       tool: commandHooks.tool ?? [],
       session: commandHooks.session ?? [],
     };

      logger.debug(
        `Loaded markdown config from ${filePath}: ${result.tool?.length ?? 0} tool hooks, ${result.session?.length ?? 0} session hooks`,
      );

     // Cache the result
     markdownConfigCache.set(filePath, result);
     return result;
   } catch (error) {
     // Catch-all for unexpected errors
     const message = error instanceof Error ? error.message : String(error);
      logger.info(
        `Unexpected error loading markdown config from ${filePath}: ${message}`,
      );
     const emptyConfig = { tool: [], session: [] };
     markdownConfigCache.set(filePath, emptyConfig);
     return emptyConfig;
   }
}

/**
 * Clear the markdown config cache for a specific file
 *
 * Forces the next call to loadMarkdownConfig() for this file to reload from disk.
 * Useful for testing or when config files may have changed.
 *
 * @param filePath - Path to clear from cache, or undefined to clear all
 * @internal For testing purposes
 */
export function clearMarkdownConfigCache(filePath?: string): void {
   if (filePath) {
     logger.debug(`Clearing markdown config cache for ${filePath}`);
     markdownConfigCache.delete(filePath);
   } else {
     logger.debug("Clearing all markdown config cache");
     markdownConfigCache.clear();
   }
}
