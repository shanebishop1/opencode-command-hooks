/**
 * Global configuration parser for loading hooks from .opencode/command-hooks.jsonc
 *
 * Searches for .opencode/command-hooks.jsonc starting from the current working
 * directory and walking up the directory tree. Parses JSONC format as CommandHooksConfig.
 */

import type { CommandHooksConfig } from "../types/hooks.js";
import { join, dirname } from "path";
import { logger } from "../logging.js";

/**
 * In-memory cache for global configuration
 * Stores the loaded config to avoid repeated file system reads on every tool call.
 * Set to null to force a reload on the next loadGlobalConfig() call.
 */
let cachedConfig: CommandHooksConfig | null = null;

/**
 * Strip comments from JSONC content
 * Handles both line comments and block comments
 */
function stripJsoncComments(content: string): string {
  let result = "";
  let i = 0;

  while (i < content.length) {
    // Check for line comment
    if (content[i] === "/" && content[i + 1] === "/") {
      // Skip until end of line
      while (i < content.length && content[i] !== "\n") {
        i++;
      }
      // Keep the newline
      if (i < content.length) {
        result += "\n";
        i++;
      }
      continue;
    }

    // Check for block comment
    if (content[i] === "/" && content[i + 1] === "*") {
      // Skip until */
      i += 2;
      while (i < content.length - 1) {
        if (content[i] === "*" && content[i + 1] === "/") {
          i += 2;
          break;
        }
        // Preserve newlines to maintain line numbers
        if (content[i] === "\n") {
          result += "\n";
        }
        i++;
      }
      continue;
    }

    // Regular character
    result += content[i];
    i++;
  }

  return result;
}

/**
 * Parse JSON content, handling parse errors gracefully
 */
function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON: ${message}`);
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
 * Find command hooks config file by walking up directory tree
 * Looks for .opencode/command-hooks.jsonc
 */
async function findConfigFile(startDir: string): Promise<string | null> {
   let currentDir = startDir;

   // Limit search depth to avoid infinite loops
   const maxDepth = 20;
   let depth = 0;

   while (depth < maxDepth) {
     // Try .opencode/command-hooks.jsonc
     const configPath = join(currentDir, ".opencode", "command-hooks.jsonc");
    try {
      const file = Bun.file(configPath);
       if (await file.exists()) {
         logger.debug(`Found config file: ${configPath}`);
         return configPath;
       }
    } catch {
      // Continue searching
    }

    // Move up one directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }

    currentDir = parentDir;
    depth++;
  }

    logger.debug(
      `No config file found after searching ${depth} directories`,
    );

   return null;
}

/**
 * Load and parse global command hooks configuration
 *
 * Searches for .opencode/command-hooks.jsonc starting from the current working
 * directory and walking up. Parses the entire file as CommandHooksConfig.
 *
 * **Caching:** This function implements in-memory caching to avoid repeated file
 * system reads on every tool call. The cache is checked first; if null, the config
 * is loaded from disk and cached for subsequent calls.
 *
 * Error handling:
 * - If no config file found: returns empty config (not an error)
 * - If config file is malformed: logs warning, returns empty config
 * - If file is not a valid CommandHooksConfig: logs warning, returns empty config
 * - Never throws errors - always returns a valid config
 *
 * @returns Promise resolving to CommandHooksConfig (may be empty)
 */
export async function loadGlobalConfig(): Promise<CommandHooksConfig> {
   // Check cache first
   if (cachedConfig !== null) {
      logger.debug(`Returning cached global config: ${cachedConfig.tool?.length ?? 0} tool hooks, ${cachedConfig.session?.length ?? 0} session hooks`);
     return cachedConfig;
   }

   try {
     // Find config file
     const configPath = await findConfigFile(process.cwd());

       if (!configPath) {
          logger.debug(
            `No .opencode/command-hooks.jsonc file found, using empty config`,
          );
         const emptyConfig = { tool: [], session: [] };
         cachedConfig = emptyConfig;
         return emptyConfig;
       }

     // Read file
     let content: string;
     try {
       const file = Bun.file(configPath);
       content = await file.text();
     } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
        logger.info(
          `Failed to read config file ${configPath}: ${message}`,
        );
       const emptyConfig = { tool: [], session: [] };
       cachedConfig = emptyConfig;
       return emptyConfig;
     }

     // Parse JSONC
     let parsed: unknown;
     try {
       const stripped = stripJsoncComments(content);
       parsed = parseJson(stripped);
     } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
        logger.info(
          `Failed to parse config file ${configPath}: ${message}`,
        );
       const emptyConfig = { tool: [], session: [] };
       cachedConfig = emptyConfig;
       return emptyConfig;
     }

     // Validate entire file as CommandHooksConfig
     if (!isValidCommandHooksConfig(parsed)) {
        logger.info(
          `Config file is not a valid CommandHooksConfig (expected { tool?: [], session?: [] }), using empty config`,
        );
       const emptyConfig = { tool: [], session: [] };
       cachedConfig = emptyConfig;
       return emptyConfig;
     }

     // Return with defaults for missing arrays
     const result: CommandHooksConfig = {
       tool: parsed.tool ?? [],
       session: parsed.session ?? [],
     };

       logger.debug(
         `Loaded global config: ${result.tool?.length ?? 0} tool hooks, ${result.session?.length ?? 0} session hooks`,
       );

      // Cache the result
      cachedConfig = result;
      return result;
   } catch (error) {
     // Catch-all for unexpected errors
     const message = error instanceof Error ? error.message : String(error);
      logger.info(
        `Unexpected error loading global config: ${message}`,
      );
     const emptyConfig = { tool: [], session: [] };
     cachedConfig = emptyConfig;
     return emptyConfig;
   }
}

/**
 * Clear the global config cache
 *
 * Forces the next call to loadGlobalConfig() to reload from disk.
 * Useful for testing or when config files may have changed.
 *
 * @internal For testing purposes
 */
export function clearGlobalConfigCache(): void {
   logger.debug("Clearing global config cache");
   cachedConfig = null;
}
