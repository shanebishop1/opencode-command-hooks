/**
 * Global configuration parser for loading hooks from opencode.json/.opencode.jsonc
 *
 * Searches for opencode.jsonc or opencode.json starting from the current working
 * directory and walking up the directory tree. Parses JSONC format and extracts
 * command_hooks configuration.
 */

import type { CommandHooksConfig } from "../types/hooks";
import { join, dirname } from "path";

const LOG_PREFIX = "[opencode-command-hooks]";
const DEBUG = process.env.OPENCODE_HOOKS_DEBUG === "1";

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
 * Find opencode config file by walking up directory tree
 * Looks for opencode.jsonc first, then opencode.json
 */
async function findConfigFile(startDir: string): Promise<string | null> {
  let currentDir = startDir;

  // Limit search depth to avoid infinite loops
  const maxDepth = 20;
  let depth = 0;

  while (depth < maxDepth) {
    // Try opencode.jsonc first
    const jsoncPath = join(currentDir, "opencode.jsonc");
    try {
      const file = Bun.file(jsoncPath);
      if (await file.exists()) {
        if (DEBUG) {
          console.log(`${LOG_PREFIX} Found config file: ${jsoncPath}`);
        }
        return jsoncPath;
      }
    } catch {
      // Continue searching
    }

    // Try opencode.json
    const jsonPath = join(currentDir, "opencode.json");
    try {
      const file = Bun.file(jsonPath);
      if (await file.exists()) {
        if (DEBUG) {
          console.log(`${LOG_PREFIX} Found config file: ${jsonPath}`);
        }
        return jsonPath;
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

  if (DEBUG) {
    console.log(
      `${LOG_PREFIX} No config file found after searching ${depth} directories`,
    );
  }

  return null;
}

/**
 * Load and parse global command hooks configuration
 *
 * Searches for opencode.jsonc or opencode.json starting from the current working
 * directory and walking up. Extracts the command_hooks configuration.
 *
 * Error handling:
 * - If no config file found: returns empty config (not an error)
 * - If config file is malformed: logs warning, returns empty config
 * - If command_hooks is not an object: logs warning, returns empty config
 * - Never throws errors - always returns a valid config
 *
 * @returns Promise resolving to CommandHooksConfig (may be empty)
 */
export async function loadGlobalConfig(): Promise<CommandHooksConfig> {
  try {
    // Find config file
    const configPath = await findConfigFile(process.cwd());

    if (!configPath) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} No opencode config file found, using empty config`,
        );
      }
      return { tool: [], session: [] };
    }

    // Read file
    let content: string;
    try {
      const file = Bun.file(configPath);
      content = await file.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `${LOG_PREFIX} Failed to read config file ${configPath}: ${message}`,
      );
      return { tool: [], session: [] };
    }

    // Parse JSONC
    let parsed: unknown;
    try {
      const stripped = stripJsoncComments(content);
      parsed = parseJson(stripped);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `${LOG_PREFIX} Failed to parse config file ${configPath}: ${message}`,
      );
      return { tool: [], session: [] };
    }

    // Extract command_hooks
    if (typeof parsed !== "object" || parsed === null) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} Config file is not an object, using empty config`,
        );
      }
      return { tool: [], session: [] };
    }

    const config = parsed as Record<string, unknown>;
    const commandHooks = config.command_hooks;

    if (commandHooks === undefined) {
      if (DEBUG) {
        console.log(
          `${LOG_PREFIX} No command_hooks field in config, using empty config`,
        );
      }
      return { tool: [], session: [] };
    }

    // Validate command_hooks structure
    if (!isValidCommandHooksConfig(commandHooks)) {
      console.warn(
        `${LOG_PREFIX} command_hooks field is not a valid object (expected { tool?: [], session?: [] }), using empty config`,
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
        `${LOG_PREFIX} Loaded global config: ${result.tool?.length ?? 0} tool hooks, ${result.session?.length ?? 0} session hooks`,
      );
    }

    return result;
  } catch (error) {
    // Catch-all for unexpected errors
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `${LOG_PREFIX} Unexpected error loading global config: ${message}`,
    );
    return { tool: [], session: [] };
  }
}
