import { CommandHooksPlugin } from "./index.js"
import { createV2Plugin } from "./v2/plugin.js"

/**
 * Plugin definition for every host that reads the `./server` export:
 * OpenCode V1 1.3.4+ uses `server`, and OpenCode V2 uses `setup`.
 */
const plugin = {
  id: "opencode-command-hooks",
  server: CommandHooksPlugin,
  setup: createV2Plugin().setup,
}

export default plugin
