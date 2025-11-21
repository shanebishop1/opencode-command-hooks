import type { Plugin } from "@opencode-ai/plugin"

export const DebugToolInput: Plugin = async ({ client }) => {
  return {
    config: async (_input) => {
      void _input
    },
    "tool.execute.before": async (input: any) => {
      console.log(`\n🔍 tool.execute.before full input:`)
      console.log(JSON.stringify(input, null, 2))
    },
  }
}
