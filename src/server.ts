import type { PluginModule } from "@opencode-ai/plugin"
import { CommandHooksPlugin } from "./index.js"

const plugin = {
  id: "opencode-command-hooks",
  server: CommandHooksPlugin,
} satisfies PluginModule

export default plugin
