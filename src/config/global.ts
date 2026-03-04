/**
 * Global configuration parser for loading hooks from .opencode/command-hooks.jsonc
 *
 * Loads both user global config (~/.config/opencode/command-hooks.jsonc) and
 * project config (.opencode/command-hooks.jsonc), merging them with project taking precedence.
 *
 * Supports:
 * - `ignoreGlobalConfig: true` in project config to skip user global entirely
 * - `overrideGlobal: true` on individual hooks to suppress matching global hooks
 */

import type { CommandHooksConfig } from "../types/hooks.js";
import { ConfigSchema } from "../schemas.js";
import { mergeConfigs } from "./merge.js";
import { join, dirname } from "path";
import { homedir } from "os";
import { stat } from "fs/promises";
import { logger } from "../logging.js";

/**
 * Get the user's global config directory path
 * Uses ~/.config/opencode/ following XDG convention
 */
const getUserConfigPath = (): string => {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const baseHome = envHome && envHome.length > 0 ? envHome : homedir();
  return join(baseHome, ".config", "opencode", "command-hooks.jsonc");
};

export type GlobalConfigResult = {
  config: CommandHooksConfig;
  error: string | null;
};

const CONFIG_CACHE_TTL_MS = 250;

type ProjectConfigPathCacheEntry = {
  path: string | null;
  cachedAt: number;
};

type ConfigBlobCacheEntry = GlobalConfigResult & {
  mtimeMs: number | null;
  cachedAt: number;
};

const projectConfigPathCache = new Map<string, ProjectConfigPathCacheEntry>();
const configBlobCache = new Map<string, ConfigBlobCacheEntry>();

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

const getFileMtimeMs = async (path: string): Promise<number | null> => {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return null;
    }
    return stats.mtimeMs;
  } catch {
    return null;
  }
}


/**
 * Find project config file by walking up directory tree
 * Looks for .opencode/command-hooks.jsonc in project directories
 */
const findProjectConfigFile = async (startDir: string): Promise<string | null> => {
   const now = Date.now();
   const cached = projectConfigPathCache.get(startDir);
   if (cached && now - cached.cachedAt < CONFIG_CACHE_TTL_MS) {
     if (cached.path === null) {
       return null;
     }

     const cachedPathStillExists = (await getFileMtimeMs(cached.path)) !== null;
     if (cachedPathStillExists) {
       return cached.path;
     }
   }

   let currentDir = startDir;

   // Limit search depth to avoid infinite loops
   const maxDepth = 20;
   let depth = 0;

   while (depth < maxDepth) {
     const configPath = join(currentDir, ".opencode", "command-hooks.jsonc");
     const mtimeMs = await getFileMtimeMs(configPath);
       if (mtimeMs !== null) {
         logger.debug(`Found project config file: ${configPath}`);
         projectConfigPathCache.set(startDir, { path: configPath, cachedAt: now });
         return configPath;
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

  logger.debug(`No project config file found after searching ${depth} directories`);
  projectConfigPathCache.set(startDir, { path: null, cachedAt: now });
  return null;
}

const emptyConfig = (): CommandHooksConfig => ({ tool: [], session: [] });

export const clearGlobalConfigCacheForTests = (): void => {
  projectConfigPathCache.clear();
  configBlobCache.clear();
}

/**
 * Load and parse config from a specific file path
 *
 * @param configPath - Path to the config file
 * @param source - Source identifier for logging ("project" or "user global")
 * @returns GlobalConfigResult with parsed config or error
 */
const loadConfigFromPath = async (
  configPath: string,
  source: string
): Promise<GlobalConfigResult> => {
  const now = Date.now();
  const mtimeMs = await getFileMtimeMs(configPath);
  const cached = configBlobCache.get(configPath);

  if (cached) {
    if (mtimeMs === null && cached.mtimeMs === null && now - cached.cachedAt < CONFIG_CACHE_TTL_MS) {
      return { config: cached.config, error: cached.error };
    }

    if (mtimeMs !== null && cached.mtimeMs === mtimeMs) {
      return { config: cached.config, error: cached.error };
    }
  }

  if (mtimeMs === null) {
    const missingResult: GlobalConfigResult = { config: emptyConfig(), error: null };
    configBlobCache.set(configPath, { ...missingResult, mtimeMs: null, cachedAt: now });
    return missingResult;
  }

  // Read file
  let content: string;
  try {
    content = await Bun.file(configPath).text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.info(`Failed to read ${source} config file ${configPath}: ${message}`);
    const readErrorResult: GlobalConfigResult = {
      config: emptyConfig(),
      error: `Failed to read ${source} config file ${configPath}: ${message}`,
    };
    configBlobCache.set(configPath, { ...readErrorResult, mtimeMs, cachedAt: now });
    return readErrorResult;
  }

  // Parse JSONC
  let parsed: unknown;
  try {
    const stripped = stripJsoncComments(content);
    parsed = parseJson(stripped);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.info(`Failed to parse ${source} config file ${configPath}: ${message}`);
    const parseErrorResult: GlobalConfigResult = {
      config: emptyConfig(),
      error: `Failed to parse ${source} config file ${configPath}: ${message}`,
    };
    configBlobCache.set(configPath, { ...parseErrorResult, mtimeMs, cachedAt: now });
    return parseErrorResult;
  }

  // Validate and parse with the full schema
  const parseResult = ConfigSchema.safeParse(parsed);
  if (!parseResult.success) {
    const issueSummary = parseResult.error.issues
      .map(issue => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    logger.info(
      `${source} config file failed schema validation, using empty config: ${issueSummary}`
    );
    const validationErrorResult: GlobalConfigResult = {
      config: emptyConfig(),
      error: `${source} config file failed schema validation`,
    };
    configBlobCache.set(configPath, { ...validationErrorResult, mtimeMs, cachedAt: now });
    return validationErrorResult;
  }

  // Return with defaults for missing arrays
  const result: CommandHooksConfig = {
    truncationLimit: parseResult.data.truncationLimit,
    ignoreGlobalConfig: parseResult.data.ignoreGlobalConfig,
    tool: parseResult.data.tool ?? [],
    session: parseResult.data.session ?? [],
  };

  logger.debug(
    `Loaded ${source} config: truncationLimit=${result.truncationLimit}, ${result.tool?.length ?? 0} tool hooks, ${result.session?.length ?? 0} session hooks`,
  );

  const successResult: GlobalConfigResult = { config: result, error: null };
  configBlobCache.set(configPath, { ...successResult, mtimeMs, cachedAt: now });
  return successResult;
}

/**
 * Load and merge command hooks configuration from both sources
 *
 * Loads both user global config (~/.config/opencode/command-hooks.jsonc) and
 * project config (.opencode/command-hooks.jsonc), then merges them.
 *
 * Merge behavior:
 * - If project config has `ignoreGlobalConfig: true`, skip user global entirely
 * - Otherwise, merge with project hooks taking precedence:
 *   - Same hook `id` → project version wins
 *   - Hook with `overrideGlobal: true` → suppresses matching global hooks
 *   - Different `id` without override → both run (concatenation)
 *
 * Error handling:
 * - If no config files found: returns empty config (not an error)
 * - If user global has parse error: warns and uses project config only
 * - If project has parse error: returns error
 * - Never throws errors - always returns a valid config
 *
 * @returns Promise resolving to GlobalConfigResult
 */
export const loadGlobalConfig = async (): Promise<GlobalConfigResult> => {
  try {
    logger.debug(`loadGlobalConfig: starting search from: ${process.cwd()}`);

    // Step 1: Load project config first (to check ignoreGlobalConfig flag)
    const projectConfigPath = await findProjectConfigFile(process.cwd());
    const projectResult = projectConfigPath
      ? await loadConfigFromPath(projectConfigPath, "project")
      : { config: emptyConfig(), error: null };

    // If project config had an error, return it
    if (projectResult.error) {
      return projectResult;
    }

    // Step 2: If project says ignore global, return project only
    if (projectResult.config.ignoreGlobalConfig) {
      logger.debug("Project config has ignoreGlobalConfig: true, skipping user global");
      return projectResult;
    }

    // Step 3: Load user global config
    const userGlobalPath = getUserConfigPath();
    const userGlobalResult = await loadConfigFromPath(userGlobalPath, "user global");

    // Step 4: If user global had parse error, log and use project only
    if (userGlobalResult.error) {
      logger.info(
        `Failed to load user global config (${userGlobalPath}): ${userGlobalResult.error}. Using project config only.`
      );
      return projectResult;
    }

    // Step 5: If neither config has hooks, return empty
    const hasUserGlobalHooks =
      (userGlobalResult.config.tool?.length ?? 0) > 0 ||
      (userGlobalResult.config.session?.length ?? 0) > 0;
    const hasProjectHooks =
      (projectResult.config.tool?.length ?? 0) > 0 ||
      (projectResult.config.session?.length ?? 0) > 0;

    if (!hasUserGlobalHooks && !hasProjectHooks) {
      logger.debug("No hooks found in either config, using empty config");
      return { config: emptyConfig(), error: null };
    }

    // Step 6: Merge configs - user global as base, project as override
    const { config: mergedConfig } = mergeConfigs(
      userGlobalResult.config,
      projectResult.config
    );

    logger.debug(
      `Merged configs: ${mergedConfig.tool?.length ?? 0} tool hooks, ${mergedConfig.session?.length ?? 0} session hooks`
    );

    return { config: mergedConfig, error: null };
  } catch (error) {
    // Catch-all for unexpected errors
    const message = error instanceof Error ? error.message : String(error);
    logger.info(`Unexpected error loading global config: ${message}`);
    return {
      config: emptyConfig(),
      error: `Unexpected error loading global config: ${message}`,
    };
  }
}
