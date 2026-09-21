import { Plugin } from "@opencode/plugin"
import { createV2Plugin } from "./v2/plugin.js"

export default Plugin.define(createV2Plugin())
