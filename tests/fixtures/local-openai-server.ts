import { appendFile } from "fs/promises"

const port = Number(process.argv[2] ?? "0")
const logPath = process.argv[3]
let callNumber = 0
type JsonObject = Record<string, unknown>

const asObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
})

const textOfMessages = (messages: unknown[]): string => JSON.stringify(messages)

const toolDetails = (tool: unknown): { name: string; schema: JsonObject } => {
  const wrapper = asObject(tool)
  const functionDetails = asObject(wrapper.function)
  const definition = Object.keys(functionDetails).length > 0 ? functionDetails : wrapper
  return {
    name: String(definition.name ?? ""),
    schema: asObject(definition.parameters ?? definition.input_schema),
  }
}

const chooseTool = (tools: unknown[], mode: "shell" | "subagent"): { name: string; schema: JsonObject } | undefined => {
  const details = tools.map(toolDetails)
  const expectedName = mode === "subagent" ? "subagent" : "shell"
  return details.find(tool => tool.name === expectedName)
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const shellArguments = (schema: JsonObject, target: string): Record<string, unknown> => {
  const properties = asObject(schema.properties)
  const args: Record<string, unknown> = {}
  if ("command" in properties) args.command = `printf V2_MODEL_SHELL > ${shellQuote(target)}`
  if ("description" in properties) args.description = "Write the deterministic E2E marker"
  if ("timeout" in properties) args.timeout = 10_000
  return args
}

const subagentArguments = (schema: JsonObject): Record<string, unknown> => {
  const properties = asObject(schema.properties)
  const args: Record<string, unknown> = {}
  const childPrompt = "V2_E2E_SUBAGENT_CHILD reply exactly WORKER_DONE."
  for (const key of Object.keys(properties)) {
    if (key === "agent" || key === "subagent_type") args[key] = "e2e-worker"
    else if (key === "prompt" || key === "task") args[key] = childPrompt
    else if (key === "description") args[key] = "Run the deterministic E2E worker"
    else if (key === "background") args[key] = false
  }
  return args
}

const response = (body: Record<string, unknown>, stream: boolean): Response => {
  if (!stream) return json(body)
  const encoder = new TextEncoder()
  const streamBody = new ReadableStream({
    start(controller) {
      const choices = (body.choices as Array<Record<string, unknown>>) ?? []
      const choice = asObject(choices[0])
      const message = asObject(choice.message)
      const delta: Record<string, unknown> = { role: "assistant" }
      if (message.tool_calls) {
        delta.tool_calls = (message.tool_calls as Array<JsonObject>).map((toolCall, index) => ({
          ...toolCall,
          index,
        }))
      }
      if (typeof message.content === "string") delta.content = message.content
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...body, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...body, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}\n\n`))
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
  return new Response(streamBody, { headers: { "content-type": "text/event-stream" } })
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/v1/models") {
      return json({ object: "list", data: [{ id: "deterministic", object: "model", owned_by: "e2e" }] })
    }
    if (url.pathname !== "/v1/chat/completions" || request.method !== "POST") return new Response("not found", { status: 404 })

    const body = await request.json() as { messages?: unknown[]; tools?: unknown[]; stream?: boolean }
    const messages = body.messages ?? []
    const prompt = textOfMessages(messages)
    const tools = body.tools ?? []
    const isChild = prompt.includes("V2_E2E_SUBAGENT_CHILD")
    const hasToolMessage = messages.some(message => asObject(message).role === "tool")
    const isSubagent = prompt.includes("V2_E2E_SUBAGENT_ROOT") && !hasToolMessage
    const isShell = prompt.includes("V2_E2E_SHELL") && !hasToolMessage
    const mode = isSubagent ? "subagent" : isShell ? "shell" : "text"
    const selected = mode === "subagent" || mode === "shell" ? chooseTool(tools, mode) : undefined
    const target = prompt.match(/V2_E2E_SHELL_FILE=([^\s"\\]+)/)?.[1] ?? "v2-e2e-model.txt"
    const id = `e2e-call-${++callNumber}`
    const toolCall = selected && mode !== "text"
      ? {
          id,
          type: "function",
          function: {
            name: selected.name,
            arguments: JSON.stringify(mode === "shell" ? shellArguments(selected.schema, target) : subagentArguments(selected.schema)),
          },
        }
      : undefined
    const content = isChild ? "WORKER_DONE" : "DONE"
    const completion = {
      id: `e2e-completion-${callNumber}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "deterministic",
      choices: [{
        index: 0,
        message: toolCall ? { role: "assistant", content: null, tool_calls: [toolCall] } : { role: "assistant", content },
        finish_reason: toolCall ? "tool_calls" : "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }

    if (logPath) {
      await appendFile(logPath, `${JSON.stringify({
        body,
        decision: { mode, tool: selected?.name, schema: selected?.schema },
      })}\n`)
    }
    return response(completion, body.stream === true)
  },
})

console.log(`READY http://127.0.0.1:${server.port}`)
