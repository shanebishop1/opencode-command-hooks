import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { $ } from "bun"
import { existsSync } from "fs"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"

/**
 * Installs the packed plugin by package name, the way users configure it, in
 * each supported OpenCode host. Directory-path installs bypass package
 * exports, so only a registry install proves which entrypoint a host selects.
 */

const enabled = process.env.OPENCODE_HOSTS_E2E === "1"
const repositoryRoot = resolve(import.meta.dir, "..")
const providerFixture = resolve(repositoryRoot, "tests/fixtures/local-openai-server.ts")

interface Host {
  name: string
  generation: "v1" | "v2"
  spec: string
  // Old V1 `run` can exit before the idle hook finishes, so idle is asserted
  // only where the host reliably waits for it.
  idle: boolean
}

const hosts: Host[] = [
  { name: "V1 1.3.3 (package root)", generation: "v1", spec: "opencode-ai@1.3.3", idle: false },
  { name: "V1 1.3.4 (./server)", generation: "v1", spec: "opencode-ai@1.3.4", idle: false },
  { name: "V1 latest", generation: "v1", spec: "opencode-ai@latest", idle: true },
  { name: "V2 latest", generation: "v2", spec: "@opencode/cli@latest", idle: true },
]

let workspace = ""
let registryUrl = ""
let registry: Bun.Subprocess | undefined
let provider: Bun.ReadableSubprocess | undefined
let providerUrl = ""

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

const readUntil = async (stream: ReadableStream<Uint8Array>, pattern: RegExp, timeoutMs: number): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + timeoutMs
  let output = ""
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => undefined)])
    if (!chunk || chunk.done) break
    output += decoder.decode(chunk.value)
    const match = output.match(pattern)
    if (match) {
      reader.releaseLock()
      return match[1] ?? match[0]
    }
  }
  throw new Error(`Timed out waiting for ${pattern}:\n${output}`)
}

const freePort = (): number => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  return port
}

const stop = async (child: Bun.Subprocess | undefined) => {
  if (!child || child.exitCode !== null) return
  child.kill(9)
  await Promise.race([child.exited, sleep(5_000)])
}

const startRegistry = async () => {
  const directory = join(workspace, "registry")
  await mkdir(directory, { recursive: true })
  const port = freePort()
  await writeFile(join(directory, "config.yaml"), [
    "storage: ./storage",
    "auth:",
    "  htpasswd:",
    "    file: ./htpasswd",
    "uplinks:",
    "  npmjs:",
    "    url: https://registry.npmjs.org/",
    "    timeout: 60s",
    "packages:",
    "  'opencode-command-hooks':",
    "    access: $all",
    "    publish: $all",
    "  '**':",
    "    access: $all",
    "    proxy: npmjs",
    `listen: 127.0.0.1:${port}`,
    "log: { type: stdout, format: pretty, level: warn }",
    "",
  ].join("\n"))
  registry = Bun.spawn(["npx", "--yes", "verdaccio@6.10.4", "--config", "config.yaml"], {
    cwd: directory,
    stdout: "ignore",
    stderr: "ignore",
  })
  registryUrl = `http://127.0.0.1:${port}/`
  for (let attempt = 0; attempt < 120; attempt++) {
    const ready = await fetch(`${registryUrl}-/ping`).then(response => response.ok).catch(() => false)
    if (ready) return
    await sleep(500)
  }
  throw new Error("Local npm registry did not start")
}

const publishPackage = async () => {
  const userconfig = join(workspace, "publish.npmrc")
  await writeFile(userconfig, `registry=${registryUrl}\n//${registryUrl.slice("http://".length)}:_authToken=e2e\n`)
  await $`npm run build`.cwd(repositoryRoot).quiet()
  const archive = (await $`npm pack --ignore-scripts --pack-destination ${workspace}`.cwd(repositoryRoot).text())
    .trim().split("\n").at(-1)
  if (!archive) throw new Error("npm pack did not return an archive name")
  await $`npm publish ${join(workspace, archive)} --userconfig ${userconfig} --tag latest`.quiet()
}

const hostConfig = (host: Host) => {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    // Unchanged V1-style configuration, which V2 migrates.
    plugin: ["opencode-command-hooks"],
    model: "local/deterministic",
  }
  if (host.generation === "v1") {
    config.provider = {
      local: {
        npm: "@ai-sdk/openai-compatible",
        name: "Deterministic local provider",
        options: { baseURL: `${providerUrl}/v1` },
        models: { deterministic: { name: "Deterministic", tool_call: true } },
      },
    }
  } else {
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
  return config
}

const runHost = async (host: Host) => {
  const root = await mkdtemp(join(workspace, "host-"))
  const install = join(root, "install")
  const project = join(root, "project")
  const home = join(root, "home")
  for (const directory of [install, join(project, ".opencode"), home, join(root, "tmp")]) {
    await mkdir(directory, { recursive: true })
  }
  await writeFile(join(install, "package.json"), "{\"private\":true}")
  await $`npm install --no-audit --no-fund ${host.spec}`.cwd(install).quiet()
  const binary = join(install, "node_modules", ".bin", "opencode")

  await writeFile(join(home, ".npmrc"), `registry=${registryUrl}\n`)
  await writeFile(join(project, "opencode.json"), JSON.stringify(hostConfig(host), null, 2))
  await writeFile(join(project, ".opencode", "command-hooks.jsonc"), JSON.stringify({
    tool: [
      { id: "hosts-before", when: { phase: "before", tool: "*" }, run: "printf before > hook-before.txt" },
      { id: "hosts-after", when: { phase: "after", tool: "*" }, run: "printf after > hook-after.txt" },
    ],
    session: [{ id: "hosts-idle", when: { event: "session.idle" }, run: "printf idle > hook-idle.txt" }],
  }))

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    PWD: project,
    HOME: home,
    TMPDIR: join(root, "tmp"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    npm_config_registry: registryUrl,
    BUN_CONFIG_REGISTRY: registryUrl,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    CI: "1",
  }
  // V1 `run` talks to its in-process server without credentials.
  if (host.generation === "v2") Object.assign(env, { OPENCODE_PASSWORD: "hosts-e2e", OPENCODE_SERVER_PASSWORD: "hosts-e2e" })

  const run = async (args: string[]) => {
    const child = Bun.spawn([binary, ...args], { cwd: project, env, stdout: "pipe", stderr: "pipe" })
    const timer = setTimeout(() => child.kill(9), 150_000)
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    clearTimeout(timer)
    return { exitCode, output: `${stdout}\n${stderr}` }
  }

  const prompt = "V2_E2E_SHELL V2_E2E_SHELL_FILE=model-shell.txt"
  let logs = ""
  let server: Bun.ReadableSubprocess | undefined
  try {
    if (host.generation === "v1") {
      // The first run installs the plugin; older hosts can race that install.
      logs += (await run(["run", "--print-logs", "-m", "local/deterministic", "Reply DONE."])).output
      for (const file of ["hook-before.txt", "hook-after.txt", "hook-idle.txt"]) await rm(join(project, file), { force: true })
      logs += (await run(["run", "--print-logs", "-m", "local/deterministic", prompt])).output
    } else {
      server = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"], {
        cwd: project, env, stdout: "pipe", stderr: "pipe",
      })
      const url = await readUntil(server.stdout, /listening on (http:\/\/\S+)/, 120_000)
      logs += (await run(["run", "--server", url, "--model", "local/deterministic", "--auto", prompt])).output
    }
    const expected = ["model-shell.txt", "hook-before.txt", "hook-after.txt", ...(host.idle ? ["hook-idle.txt"] : [])]
    for (let attempt = 0; attempt < 30 && expected.some(file => !existsSync(join(project, file))); attempt++) await sleep(500)
    return Object.fromEntries(expected.map(file => [file, existsSync(join(project, file))])) as Record<string, boolean> & { logs?: string }
  } finally {
    await stop(server)
    if (!process.env.OPENCODE_HOSTS_E2E_KEEP) await rm(root, { recursive: true, force: true })
    if (logs) await writeFile(join(workspace, `${host.spec.replaceAll(/[@/]/g, "_")}.log`), logs)
  }
}

describe.skipIf(!enabled)("package-name installs across OpenCode hosts", () => {
  beforeAll(async () => {
    // Canonical paths keep each host in one project location when tmpdir is a symlink (macOS).
    workspace = await realpath(await mkdtemp(join(tmpdir(), "opencode-hooks-hosts-")))
    provider = Bun.spawn([process.execPath, providerFixture, "0"], { stdout: "pipe", stderr: "ignore" })
    providerUrl = await readUntil(provider.stdout, /READY (http:\/\/\S+)/, 10_000)
    await startRegistry()
    await publishPackage()
  }, 300_000)

  afterAll(async () => {
    await stop(provider)
    await stop(registry)
    if (workspace && !process.env.OPENCODE_HOSTS_E2E_KEEP) await rm(workspace, { recursive: true, force: true })
  })

  for (const host of hosts) {
    it(`runs tool and session hooks in ${host.name}`, async () => {
      const result = await runHost(host)
      const log = await readFile(join(workspace, `${host.spec.replaceAll(/[@/]/g, "_")}.log`), "utf8").catch(() => "")
      const context = `${host.spec}\n${log.split("\n").filter(line => /plugin|command-hooks|error/i.test(line)).join("\n")}`
      for (const [file, present] of Object.entries(result)) {
        expect(present, `${file} missing\n${context}`).toBe(true)
      }
    }, 300_000)
  }
})
