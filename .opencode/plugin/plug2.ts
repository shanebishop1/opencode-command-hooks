// // .opencode/plugin/lint-on-tool.ts
// import type { Plugin } from "@opencode-ai/plugin"
//
// export const LintOnToolPlugin: Plugin = async ({ client, $ }) => {
//   // Tools that should trigger linting. Adjust as needed.
//   const LINT_TOOLS = new Set(["write", "edit", "patch"])
//
//   return {
//     // Runs after any tool executes
//     "tool.execute.after": async (input) => {
//       // input: { tool, sessionID, callID }
//       // output: { title, output, metadata }
//
//       if (!LINT_TOOLS.has(input.tool)) return
//
//       let status = "success"
//       let lintOutput = ""
//
//       try {
//         // Change this command if you prefer pnpm/yarn/etc:
//         //   await $`pnpm lint`.text()
//         //   await $`npm runlint`.text()
//         lintOutput = await $`npm run lint`.text()
//       } catch (err: any) {
//         status = "failed"
//
//         // Bun's $ throws on non-zero exit codes; try to salvage stdout/stderr.
//         const stdout = err?.stdout?.toString?.() ?? ""
//         const stderr = err?.stderr?.toString?.() ?? ""
//         const message = err?.message ?? String(err)
//
//         lintOutput =
//           [stdout, stderr, message]
//             .filter(Boolean)
//             .join("\n\n---\n\n")
//       }
//
//       // Avoid blowing up the context with massive lint logs
//       const MAX_CHARS = 8000
//       const truncated = lintOutput.slice(0, MAX_CHARS)
//
//       // Inject as context-only prompt so the model can react to lint results
//       await client.session.prompt({
//         path: { id: input.sessionID },
//         body: {
//           noReply: true, // don't trigger an immediate model response
//           parts: [
//             {
//               type: "text",
//               text: [
//                 `Lint results (${status}) after tool "${input.tool}":`,
//                 "",
//                 "```",
//                 truncated || "(no output from linter)",
//                 "```",
//                 "",
//                 "Use these lint results to fix any reported issues before continuing."
//               ].join("\n")
//             }
//           ]
//         }
//       })
//
//       // Optional: nice UX toast in the TUI
//       try {
//         await client.tui.showToast({
//           body: {
//             message:
//               status === "success"
//                 ? "npm run lint completed"
//                 : "npm run lint failed – see injected lint results",
//             variant: status === "success" ? "success" : "error"
//           }
//         })
//       } catch {
//         // TUI API might not be available in all contexts; ignore failures
//       }
//     }
//   }
// }
//
