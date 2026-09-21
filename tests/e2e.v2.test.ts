import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { $ } from "bun"

const enabled = process.env.OPENCODE2_E2E === "1"
const live = process.env.OPENCODE2_E2E_LIVE === "1"
const cliVersion = process.env.OPENCODE2_CLI_VERSION ?? "2.0.12"
const requestedLiveModel = process.env.OPENCODE2_E2E_MODEL?.trim() ?? ""
const repositoryRoot = process.cwd()
const workerFixture = resolve(repositoryRoot, "tests/fixtures/agents/e2e-worker.md")
const providerFixture = resolve(repositoryRoot, "tests/fixtures/local-openai-server.ts")

let projectDirectory = ""
let configPath = ""
let hooksPath = ""
let binary = ""
let homeDirectory = ""
let environment: Record<string, string> = {}
let hostProcess: Bun.ReadableSubprocess | undefined
let providerProcess: Bun.ReadableSubprocess | undefined
let hostUrl = ""
let providerUrl = ""
let hostOutput = ""
let hostError = ""
let providerOutput = ""
let providerError = ""
let liveModel = ""

type CommandResult = { exitCode: number; stdout: string; stderr: string }
type ProviderLog = {
  body: { messages?: unknown[]; tools?: unknown[] }
  decision?: { mode: string; tool?: string; schema?: Record<string, unknown> }
}
type SessionSummary = { id: string; parentID?: string; directory?: string }
type HostedModel = {
  id?: unknown
  modelID?: unknown
  providerID?: unknown
  name?: unknown
  enabled?: unknown
  status?: unknown
  capabilities?: { tools?: unknown }
  cost?: unknown
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const consumeOutput = async (
  stream: ReadableStream<Uint8Array>,
  append: (chunk: string) => void,
): Promise<void> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    append(decoder.decode(value, { stream: true }))
  }
  append(decoder.decode())
}

const waitFor = async <T>(read: () => Promise<T>, matches: (value: T) => boolean, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  let value = await read()
  while (!matches(value) && Date.now() < deadline) {
    await sleep(100)
    value = await read()
  }
  return value
}

const missingFiles = async (paths: string[]): Promise<string[]> => {
  const result = await Promise.all(paths.map(async path => {
    try {
      await access(path)
      return undefined
    } catch {
      return path
    }
  }))
  return result.filter((path): path is string => path !== undefined)
}

const waitForFiles = (paths: string[], timeoutMs = 15_000) =>
  waitFor(() => missingFiles(paths), missing => missing.length === 0, timeoutMs)

const runCommand = async (args: string[], timeoutMs = 90_000): Promise<CommandResult> => {
  const child = Bun.spawn([binary, ...args], {
    cwd: projectDirectory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    if (child.exitCode === null) child.kill(9)
  }, timeoutMs)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { exitCode: timedOut ? -1 : exitCode, stdout, stderr }
  } finally {
    clearTimeout(timeout)
  }
}

const stopProcess = async (child: Bun.ReadableSubprocess | undefined): Promise<void> => {
  if (!child) return
  if (child.exitCode === null) child.kill(9)
  await Promise.race([
    child.exited.then(() => undefined),
    sleep(5_000),
  ])
}

const readProviderLog = async (): Promise<ProviderLog[]> => {
  try {
    const content = await readFile(join(projectDirectory, "provider.jsonl"), "utf8")
    return content
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as ProviderLog)
  } catch {
    return []
  }
}

const readLineCount = async (path: string): Promise<number> => {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).length
  } catch {
    return 0
  }
}

const writeHooks = async (config: object): Promise<void> => {
  await writeFile(hooksPath, JSON.stringify(config, null, 2))
}

const writeHostConfig = async (plugins: string[], includeLocalProvider = true): Promise<void> => {
  const config: Record<string, unknown> = {
    "$schema": "https://opencode.ai/config.json",
    plugins,
  }
  if (includeLocalProvider) {
    config.model = "local/deterministic"
    config.providers = {
      local: {
        name: "Deterministic local provider",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: `${providerUrl}/v1` },
        models: {
          deterministic: {
            modelID: "deterministic",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 32_768, output: 4_096 },
          },
        },
      },
    }
  }
  await writeFile(configPath, JSON.stringify(config, null, 2))
}

const pluginIsLoaded = async (): Promise<boolean | undefined> => {
  try {
    const response = await fetch(`${hostUrl}/api/plugin`, { headers: apiHeaders(), signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return undefined
    return (await response.text()).includes("opencode-command-hooks.v2")
  } catch {
    return undefined
  }
}

const apiHeaders = (): Record<string, string> => ({
  "x-opencode-directory": projectDirectory,
  authorization: `Basic ${Buffer.from("opencode:v2-e2e-password").toString("base64")}`,
})

const modelReference = (model: HostedModel): string => {
  if (typeof model.id === "string" && model.id.includes("/")) return model.id
  if (typeof model.providerID === "string" && typeof model.modelID === "string") {
    return `${model.providerID}/${model.modelID}`
  }
  return typeof model.id === "string" ? model.id : ""
}

const isFreeOpenCodeModel = (model: HostedModel): boolean => {
  const reference = modelReference(model)
  const provider = typeof model.providerID === "string" ? model.providerID : reference.split("/", 1)[0]
  const modelID = typeof model.modelID === "string" ? model.modelID : reference.split("/").at(-1) ?? ""
  const hasNoUsageCost = Array.isArray(model.cost) && model.cost.every(cost => {
    if (typeof cost !== "object" || cost === null) return false
    const value = cost as { input?: unknown; output?: unknown; cache?: { read?: unknown; write?: unknown } }
    return value.input === 0
      && value.output === 0
      && typeof value.cache === "object"
      && value.cache !== null
      && value.cache.read === 0
      && value.cache.write === 0
  })
  return provider === "opencode"
    && reference.startsWith("opencode/")
    && modelID.endsWith("-free")
    && model.enabled !== false
    && model.status !== "deprecated"
    && hasNoUsageCost
    && model.capabilities?.tools === true
}

const readHostedModels = async (): Promise<{ models: HostedModel[]; detail: string }> => {
  const url = new URL(`${hostUrl}/api/model`)
  url.searchParams.set("location[directory]", projectDirectory)
  try {
    const response = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(3_000) })
    const body = await response.text()
    if (!response.ok) return { models: [], detail: `HTTP ${response.status}: ${body}` }
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      return { models: [], detail: `invalid JSON: ${body}` }
    }
    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
      return { models: [], detail: `unexpected /api/model payload: ${body}` }
    }
    return { models: (payload as { data: unknown[] }).data.filter(model => typeof model === "object" && model !== null) as HostedModel[], detail: body }
  } catch (error) {
    return { models: [], detail: String(error) }
  }
}

const discoverLiveModel = async (): Promise<string> => {
  if (requestedLiveModel && (!requestedLiveModel.startsWith("opencode/") || !requestedLiveModel.endsWith("-free"))) {
    throw new Error(`OPENCODE2_E2E_MODEL must be an opencode/*-free model; refusing paid or non-OpenCode override: ${requestedLiveModel}`)
  }

  const preferred = ["opencode/mimo-v2.5-free", "opencode/north-mini-code-free"]
  const deadline = Date.now() + 60_000
  let lastDetail = "no catalog response"
  while (Date.now() < deadline) {
    const catalog = await readHostedModels()
    lastDetail = catalog.detail
    const models = catalog.models
    const selected = requestedLiveModel
      ? models.find(model => isFreeOpenCodeModel(model) && modelReference(model) === requestedLiveModel)
      : preferred.map(reference => models.find(model => isFreeOpenCodeModel(model) && modelReference(model) === reference)).find(Boolean)
        ?? models.find(isFreeOpenCodeModel)
    if (selected) return modelReference(selected)
    await sleep(500)
  }

  throw new Error(
    `OpenCode V2 did not advertise a credential-free, tool-capable opencode/*-free model from /api/model` +
    `${requestedLiveModel ? ` matching ${requestedLiveModel}` : ""}. Last response: ${lastDetail}`,
  )
}

const listSessions = async (): Promise<SessionSummary[]> => {
  try {
    const query = new URLSearchParams({ directory: projectDirectory, limit: "100", order: "asc" })
    const response = await fetch(`${hostUrl}/api/session?${query}`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return []
    const payload = await response.json() as { data?: unknown }
    if (!Array.isArray(payload.data)) return []
    return payload.data.map(session => {
      const value = typeof session === "object" && session !== null ? session as Record<string, unknown> : {}
      const location = typeof value.location === "object" && value.location !== null
        ? value.location as Record<string, unknown>
        : {}
      return {
        id: String(value.id ?? ""),
        parentID: typeof value.parentID === "string" ? value.parentID : undefined,
        directory: typeof location.directory === "string" ? location.directory : undefined,
      }
    }).filter(session => session.id !== "")
  } catch {
    return []
  }
}

const sessionEvidence = async (sessionID: string): Promise<string> => {
  const urls = [
    `${hostUrl}/api/session/${encodeURIComponent(sessionID)}/inbox`,
    `${hostUrl}/api/session/${encodeURIComponent(sessionID)}/message`,
  ]
  const responses = await Promise.all(urls.map(async url => {
    try {
      const response = await fetch(url, { headers: apiHeaders(), signal: AbortSignal.timeout(2_000) })
      return response.ok ? response.text() : ""
    } catch {
      return ""
    }
  }))
  return responses.join("\n")
}

const sessionMessageEvidence = async (sessionID: string): Promise<string> => {
  try {
    const response = await fetch(`${hostUrl}/api/session/${encodeURIComponent(sessionID)}/message`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok ? response.text() : ""
  } catch {
    return ""
  }
}

const diagnostics = (): string =>
  `host stdout:\n${hostOutput}\nhost stderr:\n${hostError}\nprovider stdout:\n${providerOutput}\nprovider stderr:\n${providerError}`

const startFixture = async (): Promise<{ process: Bun.ReadableSubprocess; url: string }> => {
  const child = Bun.spawn([process.execPath, providerFixture, "0", join(projectDirectory, "provider.jsonl")], {
    cwd: projectDirectory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  const readOutput = consumeOutput(child.stdout, chunk => { providerOutput += chunk })
  const errorOutput = consumeOutput(child.stderr, chunk => { providerError += chunk })
  void readOutput
  void errorOutput
  const url = await waitFor(
    async () => providerOutput.match(/READY (http:\/\/\S+)/)?.[1] ?? "",
    value => value !== "",
    10_000,
  )
  if (!url) {
    await stopProcess(child)
    await errorOutput
    throw new Error(`Local provider did not become ready.\n${diagnostics()}`)
  }
  return { process: child, url }
}

const startHost = async (): Promise<{ process: Bun.ReadableSubprocess; url: string }> => {
  const child = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: projectDirectory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  const readOutput = consumeOutput(child.stdout, chunk => { hostOutput += chunk })
  void readOutput
  const errorOutput = consumeOutput(child.stderr, chunk => { hostError += chunk })
  void errorOutput
  const url = await waitFor(
    async () => hostOutput.match(/server listening on (http:\/\/\S+)/)?.[1] ?? "",
    value => value !== "",
    20_000,
  )
  if (!url) {
    await stopProcess(child)
    await errorOutput
    throw new Error(`OpenCode server did not become ready.\n${diagnostics()}`)
  }
  return { process: child, url }
}

describe.skipIf(!enabled)("OpenCode V2 deterministic and opt-in hosted/free-model real-host E2E", () => {
  beforeAll(async () => {
    projectDirectory = await mkdtemp(join(tmpdir(), "opencode-hooks-v2-e2e-"))
    configPath = join(projectDirectory, "opencode.jsonc")
    hooksPath = join(projectDirectory, ".opencode", "command-hooks.jsonc")
    homeDirectory = join(projectDirectory, "home")
    const temporaryDirectory = join(projectDirectory, "tmp")
    await mkdir(join(projectDirectory, ".opencode", "agents"), { recursive: true })
    await mkdir(homeDirectory, { recursive: true })
    await mkdir(temporaryDirectory, { recursive: true })

    const inheritedKeys = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "TZ"]
    const inherited = inheritedKeys
      .map(key => [key, process.env[key]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    environment = Object.fromEntries(inherited) as Record<string, string>
    Object.assign(environment, {
      PWD: projectDirectory,
      HOME: homeDirectory,
      TMPDIR: temporaryDirectory,
      TMP: temporaryDirectory,
      TEMP: temporaryDirectory,
      XDG_CONFIG_HOME: join(homeDirectory, ".config"),
      XDG_DATA_HOME: join(homeDirectory, ".local", "share"),
      XDG_CACHE_HOME: join(homeDirectory, ".cache"),
      OPENCODE_CONFIG: configPath,
      OPENCODE_LOG_LEVEL: "error",
      OPENCODE_PASSWORD: "v2-e2e-password",
      OPENCODE_SERVER_PASSWORD: "v2-e2e-password",
      CI: "1",
    })

    if (!live) {
      const fixture = await startFixture()
      providerProcess = fixture.process
      providerUrl = fixture.url
    }

    const archive = (await $`npm run build && npm pack --ignore-scripts --pack-destination ${projectDirectory}`
      .cwd(repositoryRoot)
      .text())
      .trim()
      .split("\n")
      .at(-1)
    if (!archive) throw new Error("npm pack did not return an archive name")

    await writeFile(join(projectDirectory, "package.json"), JSON.stringify({ private: true, type: "module" }))
    await $`npm install --no-audit --no-fund ${join(projectDirectory, archive)} ${`@opencode/cli@${cliVersion}`}`
      .cwd(projectDirectory)
      .quiet()
    binary = resolve(projectDirectory, "node_modules", ".bin", "opencode")

    await writeFile(join(projectDirectory, ".opencode", "command-hooks.jsonc"), JSON.stringify({ tool: [], session: [] }))
    await writeFile(join(projectDirectory, ".opencode", "agents", "e2e-worker.md"), await readFile(workerFixture, "utf8"))
    await writeHostConfig([join(projectDirectory, "node_modules", "opencode-command-hooks")], !live)

    const host = await startHost()
    hostProcess = host.process
    hostUrl = host.url
    const loaded = await waitFor(pluginIsLoaded, value => value === true, 20_000)
    if (loaded !== true) throw new Error(`Packed V2 plugin was not loaded.\n${diagnostics()}`)
    if (live) {
      liveModel = await discoverLiveModel()
      console.log(`[V2 live] host=${hostUrl} cli=${cliVersion} model=${liveModel}`)
    }
  }, 180_000)

  afterAll(async () => {
    await stopProcess(hostProcess)
    await stopProcess(providerProcess)
    if (projectDirectory) await rm(projectDirectory, { recursive: true, force: true })
  })

  it.skipIf(live)("executes real shell hooks and proves injection reached the provider context", async () => {
    const shellFile = join(projectDirectory, "model-shell.txt")
    const beforeFile = join(projectDirectory, "tool-before.txt")
    const afterFile = join(projectDirectory, "tool-after.txt")
    const startFile = join(projectDirectory, "session-start.txt")
    const idleFile = join(projectDirectory, "session-idle.txt")
    const injectedMarker = "V2_REAL_AFTER_INJECTION:V2_REAL_AFTER_OUTPUT"

    await writeHooks({
      tool: [
        { id: "real-before", when: { phase: "before", tool: "*" }, run: "printf before > tool-before.txt" },
        {
          id: "real-after",
          when: { phase: "after", tool: "*" },
          run: "printf after > tool-after.txt; printf V2_REAL_AFTER_OUTPUT",
          inject: "V2_REAL_AFTER_INJECTION:{stdout}",
        },
      ],
      session: [
        { id: "real-start", when: { event: "session.start" }, run: "printf started > session-start.txt" },
        { id: "real-idle", when: { event: "session.idle" }, run: "printf idle > session-idle.txt" },
      ],
    })

    const result = await runCommand([
      "run", "--server", hostUrl, "--model", "local/deterministic", "--auto",
      `V2_E2E_SHELL V2_E2E_SHELL_FILE=${shellFile} END. Use the shell tool to execute the requested command, then reply DONE.`,
    ])
    expect(result.exitCode, `${result.stdout}\n${result.stderr}\n${diagnostics()}`).toBe(0)

    const evidence = [shellFile, beforeFile, afterFile, startFile, idleFile]
    const missing = await waitForFiles(evidence)
    expect(missing, `${result.stdout}\n${result.stderr}\n${diagnostics()}`).toEqual([])
    expect(await readFile(beforeFile, "utf8")).toBe("before")
    expect(await readFile(afterFile, "utf8")).toBe("after")
    expect(await readFile(startFile, "utf8")).toBe("started")
    expect(await readFile(idleFile, "utf8")).toBe("idle")
    expect(await readFile(shellFile, "utf8")).toBe("V2_MODEL_SHELL")

    const requests = await waitFor(readProviderLog, logs => logs.some(log => JSON.stringify(log).includes(injectedMarker)))
    const shellRequest = requests.find(log => log.decision?.mode === "shell" && log.decision.tool)
    expect(shellRequest, JSON.stringify(requests)).toBeDefined()
    const shellSchema = shellRequest?.decision?.schema
    expect(shellSchema && typeof shellSchema === "object", JSON.stringify(requests.map(log => log.decision))).toBe(true)
    expect(Object.prototype.hasOwnProperty.call((shellSchema as Record<string, unknown>).properties, "command"), JSON.stringify(shellRequest?.decision)).toBe(true)
    expect(requests.some(log => JSON.stringify(log).includes(injectedMarker))).toBe(true)
  }, 120_000)

  it.skipIf(live)("runs a real subagent, its frontmatter hooks, and root/child idle rules", async () => {
    const childBeforeFile = join(projectDirectory, "child-before.txt")
    const childAfterFile = join(projectDirectory, "child-after.txt")
    const markerSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const rootIdleMarker = `V2_ROOT_IDLE_${markerSuffix}`
    const allIdleMarker = `V2_ALL_IDLE_${markerSuffix}`

    await writeHooks({
      session: [
        { id: "root-idle", when: { event: "session.idle" }, inject: rootIdleMarker },
        { id: "all-idle", when: { event: "session.idle", rootSessionOnly: false }, inject: allIdleMarker },
      ],
    })

    const sessionsBefore = await listSessions()
    const sessionIdsBefore = new Set(sessionsBefore.map(session => session.id))
    const result = await runCommand([
      "run", "--server", hostUrl, "--model", "local/deterministic", "--auto",
      "V2_E2E_SUBAGENT_ROOT: invoke the e2e-worker subagent and then reply PARENT_DONE.",
    ])
    expect(result.exitCode, `${result.stdout}\n${result.stderr}\n${diagnostics()}`).toBe(0)

    expect(await waitForFiles([childBeforeFile, childAfterFile])).toEqual([])
    const sessionsAfter = await waitFor(
      listSessions,
      sessions => sessions.some(session => session.parentID && !sessionIdsBefore.has(session.id)),
      20_000,
    )
    const childSession = sessionsAfter.find(session => session.parentID && !sessionIdsBefore.has(session.id))
    expect(childSession, JSON.stringify(sessionsAfter)).toMatchObject({ directory: projectDirectory })
    expect(childSession?.parentID).toBeTruthy()
    const rootSessionID = childSession?.parentID
    if (!rootSessionID) throw new Error(`Child session did not include parent ID: ${JSON.stringify(childSession)}`)
    const idleEvidence = await waitFor(
      async () => ({
        root: await sessionEvidence(rootSessionID),
        child: await sessionEvidence(childSession.id),
      }),
      evidence => evidence.root.includes(rootIdleMarker)
        && evidence.root.includes(allIdleMarker)
        && evidence.child.includes(allIdleMarker)
        && !evidence.child.includes(rootIdleMarker),
      20_000,
    )
    expect(idleEvidence.root, JSON.stringify(idleEvidence)).toContain(rootIdleMarker)
    expect(idleEvidence.root, JSON.stringify(idleEvidence)).toContain(allIdleMarker)
    expect(idleEvidence.child, JSON.stringify(idleEvidence)).toContain(allIdleMarker)
    expect(idleEvidence.child, JSON.stringify(idleEvidence)).not.toContain(rootIdleMarker)

    const requests = await readProviderLog()
    const subagentRequest = requests.find(log => log.decision?.mode === "subagent" && log.decision.tool)
    expect(subagentRequest, JSON.stringify(requests)).toBeDefined()
    const subagentSchema = subagentRequest?.decision?.schema
    expect(subagentSchema && typeof subagentSchema === "object", JSON.stringify(requests.map(log => log.decision))).toBe(true)
    expect(Object.prototype.hasOwnProperty.call((subagentSchema as Record<string, unknown>).properties, "agent"), JSON.stringify(subagentRequest?.decision)).toBe(true)
    expect(requests.some(log => JSON.stringify(log).includes("V2_CHILD_FRONTMATTER:V2_CHILD_AFTER_OUTPUT"))).toBe(true)
  }, 120_000)

  it.skipIf(live)("cleans registrations on disable/reload and never duplicates a hook", async () => {
    const hitFile = join(projectDirectory, "reload-hit.txt")
    const firstModelFile = join(projectDirectory, "reload-first.txt")
    const secondModelFile = join(projectDirectory, "reload-second.txt")
    const thirdModelFile = join(projectDirectory, "reload-third.txt")
    const idleFile = join(projectDirectory, "reload-idle.txt")
    await writeHooks({
      tool: [{ id: "reload-after", when: { phase: "after", tool: "*" }, run: "printf 'hit\n' >> reload-hit.txt" }],
      session: [{ id: "reload-idle", when: { event: "session.idle" }, run: "printf 'idle\n' >> reload-idle.txt" }],
    })

    const runReloadProbe = async (file: string) => {
      const result = await runCommand([
        "run", "--server", hostUrl, "--model", "local/deterministic", "--auto",
        `V2_E2E_RELOAD V2_E2E_SHELL V2_E2E_SHELL_FILE=${file} END. Use the shell tool, then reply DONE.`,
      ])
      expect(result.exitCode, `${result.stdout}\n${result.stderr}\n${diagnostics()}`).toBe(0)
      expect(await waitForFiles([file]), `${file}\n${diagnostics()}`).toEqual([])
      expect(await readFile(file, "utf8")).toBe("V2_MODEL_SHELL")
    }

    await runReloadProbe(firstModelFile)
    expect(await waitFor(() => readLineCount(hitFile), count => count === 1)).toBe(1)
    expect(await waitFor(() => readLineCount(idleFile), count => count === 1)).toBe(1)

    await writeHostConfig([])
    expect(await waitFor(pluginIsLoaded, value => value === false, 20_000)).toBe(false)
    await runReloadProbe(secondModelFile)
    expect(await readLineCount(hitFile)).toBe(1)
    expect(await readLineCount(idleFile)).toBe(1)

    await writeHostConfig([join(projectDirectory, "node_modules", "opencode-command-hooks")])
    expect(await waitFor(pluginIsLoaded, value => value === true, 20_000)).toBe(true)
    await runReloadProbe(thirdModelFile)
    expect(await waitFor(() => readLineCount(hitFile), count => count === 2)).toBe(2)
    expect(await waitFor(() => readLineCount(idleFile), count => count === 2)).toBe(2)
  }, 150_000)

  it.skipIf(!live)("uses a hosted free model for shell hooks and persists synthetic injection evidence", async () => {
    const markerSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const shellFile = join(projectDirectory, "live-model-shell.txt")
    const beforeFile = join(projectDirectory, "live-tool-before.txt")
    const afterFile = join(projectDirectory, "live-tool-after.txt")
    const startFile = join(projectDirectory, "live-session-start.txt")
    const idleFile = join(projectDirectory, "live-session-idle.txt")
    const shellContent = "V2_LIVE_MODEL_SHELL"
    const hookStdout = `V2_LIVE_AFTER_OUTPUT_${markerSuffix}`
    const injectedMarker = `V2_LIVE_AFTER_INJECTION_${markerSuffix}:${hookStdout}`
    const prompt = `Use the shell tool to create ${shellFile} with exactly this content and no trailing newline: ${shellContent}. After the shell command succeeds, reply DONE.`

    await writeHooks({
      tool: [
        { id: "live-before-shell", when: { phase: "before", tool: "shell" }, run: "printf before > live-tool-before.txt" },
        {
          id: "live-after-shell",
          when: { phase: "after", tool: "shell" },
          run: `printf after > live-tool-after.txt; printf '%s' '${hookStdout}'`,
          inject: `V2_LIVE_AFTER_INJECTION_${markerSuffix}:{stdout}`,
        },
      ],
      session: [
        { id: "live-session-start", when: { event: "session.start" }, run: "printf started > live-session-start.txt" },
        { id: "live-session-idle", when: { event: "session.idle" }, run: "printf idle > live-session-idle.txt" },
      ],
    })

    const sessionsBefore = await listSessions()
    const sessionIdsBefore = new Set(sessionsBefore.map(session => session.id))
    expect(prompt).not.toContain(injectedMarker)
    const result = await runCommand(["run", "--server", hostUrl, "--model", liveModel, "--auto", prompt], 150_000)
    expect(result.exitCode, `${result.stdout}\n${result.stderr}\n${diagnostics()}`).toBe(0)

    const evidence = [shellFile, beforeFile, afterFile, startFile, idleFile]
    expect(await waitForFiles(evidence, 30_000), `${result.stdout}\n${result.stderr}\n${diagnostics()}`).toEqual([])
    expect(await readFile(beforeFile, "utf8")).toBe("before")
    expect(await readFile(afterFile, "utf8")).toBe("after")
    expect(await readFile(startFile, "utf8")).toBe("started")
    expect(await readFile(idleFile, "utf8")).toBe("idle")
    expect(await readFile(shellFile, "utf8")).toBe(shellContent)

    const sessionsAfter = await waitFor(
      listSessions,
      sessions => sessions.some(session => !session.parentID && !sessionIdsBefore.has(session.id) && session.directory === projectDirectory),
      30_000,
    )
    const session = sessionsAfter.find(session => !session.parentID && !sessionIdsBefore.has(session.id) && session.directory === projectDirectory)
    expect(session, JSON.stringify(sessionsAfter)).toBeDefined()
    if (!session) throw new Error(`Hosted model session was not persisted: ${JSON.stringify(sessionsAfter)}`)

    const persistedMessages = await waitFor(
      () => sessionMessageEvidence(session.id),
      messages => messages.includes(injectedMarker),
      30_000,
    )
    expect(persistedMessages, `${persistedMessages}\n${diagnostics()}`).toContain(injectedMarker)
  }, 210_000)
})
