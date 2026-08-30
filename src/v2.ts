import type { Plugin } from "@opencode-ai/plugin-v2"
import { createV2Plugin } from "./v2/plugin.js"

export default createV2Plugin() satisfies Plugin.Plugin
