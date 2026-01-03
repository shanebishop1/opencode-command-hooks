/**
 * Agent configuration resolution and loading for command hooks
 *
 * Handles finding and parsing agent markdown files (.opencode/agent/*.md or
 * ~/.config/opencode/agent/*.md) to extract command_hooks from YAML frontmatter.
 * These hooks are applied when the specific subagent is invoked via the task tool.
 */

import type { CommandHooksConfig } from "../types/hooks.js";
import { join } from "path";
import { homedir } from "os";
import { loadMarkdownConfig } from "./markdown.js";
import { logger } from "../logging.js";

/**
 * Resolve agent markdown file path by agent name
 *
 * Searches for agent markdown files in the following order:
 * 1. Project-level: .opencode/agent/{name}.md
 * 2. User-level: ~/.config/opencode/agent/{name}.md
 *
 * Returns the first existing path found, or null if no file exists.
 *
 * @param agentName - Name of the agent to resolve (without .md extension)
 * @returns Promise resolving to absolute path of the agent markdown file, or null if not found
 *
 * @example
 * ```typescript
 * const path = await resolveAgentPath("engineer");
 * // Returns: "/Users/example/project/.opencode/agent/engineer.md" (if exists)
 * // Or: "/Users/example/.config/opencode/agent/engineer.md" (if project path doesn't exist)
 * // Or: null (if neither exists)
 * ```
 */
export async function resolveAgentPath(agentName: string): Promise<string | null> {
  // Validate agent name to prevent directory traversal
  if (!agentName || agentName.includes("/") || agentName.includes("..")) {
    logger.debug(`Invalid agent name: ${agentName}`);
    return null;
  }

  const agentFileName = `${agentName}.md`;

  // Check project-level agent file
  const projectAgentPath = join(process.cwd(), ".opencode", "agent", agentFileName);
  try {
    const projectFile = Bun.file(projectAgentPath);
    if (await projectFile.exists()) {
      logger.debug(`Found project agent file: ${projectAgentPath}`);
      return projectAgentPath;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`Error checking project agent file ${projectAgentPath}: ${message}`);
  }

  // Check user-level agent file
  const userAgentPath = join(homedir(), ".config", "opencode", "agent", agentFileName);
  try {
    const userFile = Bun.file(userAgentPath);
    if (await userFile.exists()) {
      logger.debug(`Found user agent file: ${userAgentPath}`);
      return userAgentPath;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug(`Error checking user agent file ${userAgentPath}: ${message}`);
  }

  logger.debug(`No agent file found for: ${agentName}`);
  return null;
}

/**
 * Load command_hooks from an agent's markdown file
 *
 * Attempts to resolve the agent markdown file and extract command_hooks
 * from its YAML frontmatter. Returns an empty config if the file doesn't
 * exist or contains no valid hooks.
 *
 * **Caching:** This function uses the caching from loadMarkdownConfig() internally.
 * Multiple calls for the same agent will only read the file once.
 *
 * Error handling:
 * - If agent file doesn't exist: returns empty config
 * - If file exists but has no frontmatter: returns empty config
 * - If frontmatter is malformed: logs warning, returns empty config
 * - If no command_hooks field: returns empty config
 * - Never throws errors - always returns a valid config
 *
 * @param agentName - Name of the agent to load configuration for
 * @returns Promise resolving to CommandHooksConfig (may be empty)
 *
 * @example
 * ```typescript
 * const config = await loadAgentConfig("engineer");
 * // Returns: { tool: [...], session: [...] } with agent-specific hooks
 * // Or: { tool: [], session: [] } if no valid hooks found
 * ```
 */
export async function loadAgentConfig(agentName: string): Promise<CommandHooksConfig> {
  // Resolve the agent path
  const agentPath = await resolveAgentPath(agentName);

  if (!agentPath) {
    logger.debug(`No agent file found for: ${agentName}, returning empty config`);
    return { tool: [], session: [] };
  }

  // Load the markdown config using the existing function
  const config = await loadMarkdownConfig(agentPath);

  if (config.tool?.length === 0 && config.session?.length === 0) {
    logger.debug(`Agent ${agentName} has no command_hooks in frontmatter`);
  } else {
    logger.debug(
      `Loaded agent config for ${agentName}: ${config.tool?.length ?? 0} tool hooks, ${config.session?.length ?? 0} session hooks`,
    );
  }

  return config;
}

/**
 * Load and merge agent-specific configuration with global configuration
 *
 * Combines global command hooks with agent-specific hooks, where agent hooks
 * take precedence for the specific agent context. This is useful when you want
 * to apply both global hooks and agent-specific hooks together.
 *
 * The merge follows the same precedence rules as mergeConfigs:
 * - Agent hooks with the same ID replace global hooks
 * - Agent hooks with unique IDs are added alongside global hooks
 *
 * @param agentName - Name of the agent to load configuration for
 * @returns Promise resolving to merged CommandHooksConfig
 *
 * @example
 * ```typescript
 * const { config } = await loadAgentConfigWithGlobal("engineer");
 * // Returns merged config with both global and engineer-specific hooks
 * ```
 */
export async function loadAgentConfigWithGlobal(
  agentName: string,
): Promise<{ config: CommandHooksConfig; agentPath: string | null }> {
  const [globalResult, agentConfig] = await Promise.all([
    import("./global.js").then((m) => m.loadGlobalConfig()),
    loadAgentConfig(agentName),
  ]);

  const globalConfig = globalResult.config;

  return {
    config: {
      tool: [...(globalConfig.tool ?? []), ...(agentConfig.tool ?? [])],
      session: [...(globalConfig.session ?? []), ...(agentConfig.session ?? [])],
    },
    agentPath: await resolveAgentPath(agentName),
  };
}