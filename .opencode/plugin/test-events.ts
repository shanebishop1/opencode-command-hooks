import type { Plugin } from "@opencode-ai/plugin"

export const TestEventsPlugin: Plugin = async ({ client }) => {
  return {
    config: async (_input) => {
      void _input
    },
    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      // Log all events to see what data is available
      if (event.type === "session.start" || event.type === "session.idle") {
        console.log(`\n📋 Event: ${event.type}`)
        console.log("Properties:", JSON.stringify(event.properties, null, 2))
      }
    },
  }
}
