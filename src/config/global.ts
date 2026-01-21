/**
 * Global configuration parser for loading hooks from .opencode/command-hooks.jsonc
 *
 * Searches for .opencode/command-hooks.jsonc starting from the current working
 * directory and walking up the directory tree. Parses JSONC format as CommandHooksConfig.
 */

import type { CommandHooksConfig } from "../types/hooks.js";
import { isValidCommandHooksConfig } from "../schemas.js";
import { join, dirname } from "path";
import { homedir } from "os";
import { logger } from "../logging.js";

/**
 * Get the user's global config directory path
 * Uses ~/.config/opencode/ following XDG convention
 */
const getUserConfigPath = (): string => {
  return join(homedir(), ".config", "opencode", "command-hooks.jsonc");
};

export type GlobalConfigResult = {
  config: CommandHooksConfig;
  error: string | null;
};

/**
 * Strip comments from JSONC content
 * Handles both line comments and block comments
 */
const stripJsoncComments = (content: string): string => {
  let result = "";
  let i = 0;
  let inString = false;
  let stringQuote: "\"" | "'" | null = null;
  let isEscaped = false;

  while (i < content.length) {
    const current = content[i];
    const next = content[i + 1];

    if (inString) {
      result += current;
      if (isEscaped) {
        isEscaped = false;
      } else if (current === "\\") {
        isEscaped = true;
      } else if (current === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      i++;
      continue;
    }

    if (current === "\"" || current === "'") {
      inString = true;
      stringQuote = current as "\"" | "'";
      result += current;
      i++;
      continue;
    }

    // Check for line comment
    if (current === "/" && next === "/") {
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
    if (current === "/" && next === "*") {
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
    result += current;
    i++;
  }

  return result;
}

/**
 * Parse JSON content, handling parse errors gracefully
 */
const parseJson = (content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON: ${message}`);
  }
}



/**
 * Find command hooks config file by walking up directory tree
 * Looks for .opencode/command-hooks.jsonc in project directories,
 * then falls back to user global config at ~/.config/opencode/command-hooks.jsonc
 */
const findConfigFile = async (startDir: string): Promise<string | null> => {
   let currentDir = startDir;

   // Limit search depth to avoid infinite loops
   const maxDepth = 20;
   let depth = 0;

   // First, search project directories walking up
   while (depth < maxDepth) {
     // Try .opencode/command-hooks.jsonc
     const configPath = join(currentDir, ".opencode", "command-hooks.jsonc");
    try {
      const file = Bun.file(configPath);
       if (await file.exists()) {
         logger.debug(`Found project config file: ${configPath}`);
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
    `No project config file found after searching ${depth} directories, checking user global config`,
  );

  // Fall back to user global config
  const userConfigPath = getUserConfigPath();
  try {
    const file = Bun.file(userConfigPath);
    if (await file.exists()) {
      logger.debug(`Found user global config file: ${userConfigPath}`);
      return userConfigPath;
    }
  } catch {
    // User config doesn't exist or isn't accessible
  }

  logger.debug(`No config file found (checked project dirs and ${userConfigPath})`);
  return null;
}

/**
 * Load and parse global command hooks configuration
 *
 * Searches for .opencode/command-hooks.jsonc starting from the current working
 * directory and walking up. Parses the entire file as CommandHooksConfig.
 *
 * Error handling:
 * - If no config file found: returns empty config (not an error)
 * - If config file is malformed: logs warning, returns empty config
 * - If file is not a valid CommandHooksConfig: logs warning, returns empty config
 * - Never throws errors - always returns a valid config
 *
 * @returns Promise resolving to GlobalConfigResult
 */
export const loadGlobalConfig = async (): Promise<GlobalConfigResult> => {
   let configPath: string | null = null;
   try {
     // Find config file
     logger.debug(`loadGlobalConfig: starting search from: ${process.cwd()}`)
     configPath = await findConfigFile(process.cwd());

    if (!configPath) {
      logger.debug(
        "No .opencode/command-hooks.jsonc file found, using empty config",
      );
      return { config: { tool: [], session: [] }, error: null };
    }

    // Read file
    let content: string;
    try {
      const file = Bun.file(configPath);
      content = await file.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(`Failed to read config file ${configPath}: ${message}`);
      return {
        config: { tool: [], session: [] },
        error: `Failed to read config file ${configPath}: ${message}`,
      };
    }

    // Parse JSONC
    let parsed: unknown;
    try {
      const stripped = stripJsoncComments(content);
      parsed = parseJson(stripped);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(`Failed to parse config file ${configPath}: ${message}`);
      return {
        config: { tool: [], session: [] },
        error: `Failed to parse config file ${configPath}: ${message}`,
      };
    }

    // Validate entire file as CommandHooksConfig
    if (!isValidCommandHooksConfig(parsed)) {
      logger.info(
        "Config file is not a valid CommandHooksConfig (expected { tool?: [], session?: [] }), using empty config",
      );
      return {
        config: { tool: [], session: [] },
        error:
          "Config file is not a valid CommandHooksConfig (expected { tool?: [], session?: [] })",
      };
    }

     // Return with defaults for missing arrays
     const result: CommandHooksConfig = {
       truncationLimit: parsed.truncationLimit,
       tool: parsed.tool ?? [],
       session: parsed.session ?? [],
     };

     logger.debug(
       `Loaded global config: truncationLimit=${result.truncationLimit}, ${result.tool?.length ?? 0} tool hooks, ${result.session?.length ?? 0} session hooks`,
     );

     return { config: result, error: null };
  } catch (error) {
    // Catch-all for unexpected errors
    const message = error instanceof Error ? error.message : String(error);
    logger.info(`Unexpected error loading global config: ${message}`);
    return {
      config: { tool: [], session: [] },
      error: `Unexpected error loading global config: ${message}`,
    };
  }
}
