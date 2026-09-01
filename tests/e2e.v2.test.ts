import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { $ } from "bun"

const enabled = process.env.OPENCODE2_E2E === "1"
const cliVersion = "beta"
let projectDirectory = ""
let binary = ""
let homeDirectory = ""
let environment: Record<string, string | undefined> = {}

const runCommand = async (args: string[], timeoutMs = 120_000) => {
  const process = Bun.spawn([binary, ...args], {
    cwd: projectDirectory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => process.kill(9), timeoutMs)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timeout)
  }
}

const selectFreeModel = (output: string): string => {
  const models = output.split("\n").map(line => line.trim())
  const model = ["opencode/mimo-v2.5-free", "opencode/ling-3.0-flash-fin-free"]
    .find(candidate => models.includes(candidate))
    ?? models.find(candidate => candidate.startsWith("opencode/") && candidate.endsWith("-free"))
  if (!model) throw new Error(`OpenCode 2 did not advertise a credential-free model:\n${output}`)
  return model
}

const missingFiles = async (paths: string[]): Promise<string[]> => {
  const checked = await Promise.all(paths.map(async path => {
    try {
      await access(path)
      return undefined
    } catch {
      return path
    }
  }))
  return checked.filter((path): path is string => path !== undefined)
}

const waitForFiles = async (paths: string[], timeoutMs = 10_000): Promise<string[]> => {
  const deadline = Date.now() + timeoutMs
  let missing = await missingFiles(paths)
  while (missing.length > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
    missing = await missingFiles(paths)
  }
  return missing
}

describe("OpenCode V2 package E2E", () => {
  beforeAll(async () => {
    if (!enabled) return

    projectDirectory = await mkdtemp(join(tmpdir(), "opencode-hooks-v2-e2e-"))
    await $`git init -q`.cwd(projectDirectory)
    await $`npm run build`.quiet()
    const archive = (await $`npm pack --ignore-scripts --pack-destination ${projectDirectory}`.text())
      .trim()
      .split("\n")
      .at(-1)
    if (!archive) throw new Error("npm pack did not return an archive name")
    await writeFile(
      join(projectDirectory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    )
    await $`npm install ${join(projectDirectory, archive)} ${`@opencode-ai/cli@${cliVersion}`}`
      .cwd(projectDirectory)
      .quiet()
    await mkdir(join(projectDirectory, ".opencode"), { recursive: true })
    await writeFile(
      join(projectDirectory, "opencode.jsonc"),
      JSON.stringify({
        // Keep the V1 config shape while loading the installed package directory.
        plugin: [join(projectDirectory, "node_modules", "opencode-command-hooks")],
      }),
    )
    await writeFile(
      join(projectDirectory, ".opencode", "command-hooks.jsonc"),
      JSON.stringify({ tool: [], session: [] }),
    )
    binary = resolve(projectDirectory, "node_modules", ".bin", "opencode2")
    homeDirectory = join(projectDirectory, "home")
    await mkdir(homeDirectory, { recursive: true })
    environment = {
      ...process.env,
      PWD: projectDirectory,
      HOME: homeDirectory,
      XDG_CONFIG_HOME: join(homeDirectory, ".config"),
      XDG_DATA_HOME: join(homeDirectory, ".local", "share"),
      XDG_CACHE_HOME: join(homeDirectory, ".cache"),
      OPENCODE_CONFIG: join(projectDirectory, "opencode.jsonc"),
      OPENCODE_LOG_LEVEL: "trace",
      OPENCODE_PASSWORD: "v2-e2e-password",
      OPENCODE_SERVER_PASSWORD: "v2-e2e-password",
    }
  }, 120_000)

  afterAll(async () => {
    if (projectDirectory) {
      await rm(projectDirectory, { recursive: true, force: true })
    }
  })

  it("loads the packed plugin in the current OpenCode 2 beta host", async () => {
    if (!enabled) {
      console.log("Skipping V2 E2E: set OPENCODE2_E2E=1 to run")
      return
    }

    const server = Bun.spawn([
      binary,
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ], {
      cwd: projectDirectory,
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    })
    let serverOutput = ""
    let baseUrl = ""
    const serverStdout = (async () => {
      const reader = server.stdout.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        serverOutput += decoder.decode(value, { stream: true })
        baseUrl ||= serverOutput.match(/server listening on (http:\/\/\S+)/)?.[1] ?? ""
      }
      serverOutput += decoder.decode()
    })()
    const serverStderr = new Response(server.stderr).text()
    const stopServer = async (): Promise<void> => {
      if (server.exitCode === null) server.kill(9)
      await Promise.race([
        server.exited.then(() => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 5_000)),
      ])
    }
    const headers = {
      "x-opencode-directory": projectDirectory,
      authorization: `Basic ${Buffer.from("opencode:v2-e2e-password").toString("base64")}`,
    }
    const logDirectory = join(homeDirectory, ".local", "share", "opencode", "log")
    const readLogs = async (): Promise<string> => {
      try {
        const files = await readdir(logDirectory)
        return (await Promise.all(files.map(file => readFile(join(logDirectory, file), "utf8")))).join("\n")
      } catch {
        return ""
      }
    }
    let pluginResponse = ""

    try {
      const serverDeadline = Date.now() + 20_000
      while (!baseUrl && server.exitCode === null && Date.now() < serverDeadline) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      if (!baseUrl) {
        await stopServer()
        await serverStdout
        throw new Error(
          `V2 server did not become ready (exit=${server.exitCode})\nstdout:\n${serverOutput}\nstderr:\n${await serverStderr}`,
        )
      }

      const pluginDeadline = Date.now() + 30_000
      while (Date.now() < pluginDeadline) {
        try {
          const response = await fetch(`${baseUrl}/api/plugin`, { headers })
          pluginResponse = await response.text()
          if (response.ok && pluginResponse.includes("opencode-command-hooks.v2")) break
        } catch {
          // The server is still starting.
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (!pluginResponse.includes("opencode-command-hooks.v2")) {
        await stopServer()
        await serverStdout
        throw new Error(
          `V2 plugin did not load (server exit=${server.exitCode}): ${pluginResponse}\nstdout:\n${serverOutput}\nstderr:\n${await serverStderr}\n${await readLogs()}`,
        )
      }

    } finally {
      await stopServer()
      await serverStdout
    }

    const logs = await readLogs()

    expect(pluginResponse, logs).toContain("opencode-command-hooks.v2")
  }, 90_000)

  it("executes tool and session hooks in the current OpenCode 2 beta host", async () => {
    if (!enabled) return

    const evidence = {
      before: join(projectDirectory, "tool-before.txt"),
      after: join(projectDirectory, "tool-after.txt"),
      started: join(projectDirectory, "session-started.txt"),
      idle: join(projectDirectory, "session-idle.txt"),
      model: join(projectDirectory, "model-tool.txt"),
    }
    await writeFile(
      join(projectDirectory, ".opencode", "command-hooks.jsonc"),
      JSON.stringify({
        tool: [
          {
            id: "v2-real-before",
            when: { phase: "before", tool: "*" },
            run: "printf before > tool-before.txt",
          },
          {
            id: "v2-real-after",
            when: { phase: "after", tool: "*" },
            run: "printf after > tool-after.txt",
            inject: "V2_AFTER_HOOK_EXECUTED",
          },
        ],
        session: [
          {
            id: "v2-real-start",
            when: { event: "session.start" },
            run: "printf started > session-started.txt",
          },
          {
            id: "v2-real-idle",
            when: { event: "session.idle" },
            run: "printf idle > session-idle.txt",
          },
        ],
      }),
    )

    const models = await runCommand(["models", "--standalone"])
    expect(models.exitCode, models.stderr).toBe(0)
    const model = selectFreeModel(models.stdout)
    const result = await runCommand([
      "run",
      "--standalone",
      "--auto",
      "--model",
      model,
      "Use the shell tool to run exactly: printf model-tool > model-tool.txt. Then reply DONE.",
    ])

    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
    const evidencePaths = Object.values(evidence)
    const missing = await waitForFiles(evidencePaths)
    const logDirectory = join(homeDirectory, ".local", "share", "opencode", "log")
    const logs = await readdir(logDirectory)
      .then(files => Promise.all(files.map(file => readFile(join(logDirectory, file), "utf8"))))
      .then(files => files.join("\n"))
      .catch(() => "")
    expect(missing, `${result.stdout}\n${result.stderr}\n${logs}`).toEqual([])
    expect(logs).not.toContain("Failed to handle tool.execute.after")
    expect(logs).not.toContain("Failed to inject message")
    expect(await readFile(evidence.before, "utf8")).toBe("before")
    expect(await readFile(evidence.after, "utf8")).toBe("after")
    expect(await readFile(evidence.started, "utf8")).toBe("started")
    expect(await readFile(evidence.idle, "utf8")).toBe("idle")
    expect(await readFile(evidence.model, "utf8")).toBe("model-tool")
  }, 180_000)
})
