import type { PluginInput } from "@opencode-ai/plugin"
import { CommandHooksPlugin } from "./index.js"
import plugin from "./server.js"

/**
 * Package root for OpenCode V1 before 1.3.4, which ignores the `./server`
 * export and calls every root export as a plugin function. Current hosts
 * resolve `./server` first, so they never load this module.
 */
const legacyPlugin = Object.assign((input: PluginInput) => CommandHooksPlugin(input), plugin)

export default legacyPlugin
