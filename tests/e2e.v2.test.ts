import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { $ } from "bun"

const enabled = process.env.OPENCODE2_E2E === "1"
const cliVersion = "0.0.0-next-15853"
let projectDirectory = ""

describe("OpenCode V2 package E2E", () => {
  beforeAll(async () => {
    if (!enabled) return

    projectDirectory = await mkdtemp(join(tmpdir(), "opencode-hooks-v2-e2e-"))
    await $`git init -q`.cwd(projectDirectory)
    await $`npm run build:v2`.quiet()
    await $`npm pack --ignore-scripts --pack-destination ${projectDirectory}`.cwd("packages/v2").quiet()
    await writeFile(
      join(projectDirectory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    )
    await $`npm install ${join(projectDirectory, "opencode-command-hooks-v2-0.1.0-beta.0.tgz")} @opencode-ai/cli@${cliVersion}`
      .cwd(projectDirectory)
      .quiet()
    await mkdir(join(projectDirectory, ".opencode"), { recursive: true })
    await writeFile(
      join(projectDirectory, "opencode.jsonc"),
      JSON.stringify({
        plugins: [join(projectDirectory, "node_modules", "opencode-command-hooks-v2", "dist", "index.js")],
      }),
    )
    await writeFile(
      join(projectDirectory, ".opencode", "command-hooks.jsonc"),
      JSON.stringify({ tool: [], session: [] }),
    )
  }, 120_000)

  afterAll(async () => {
    if (projectDirectory) {
      await rm(projectDirectory, { recursive: true, force: true })
    }
  })

  it("loads the packed plugin in the pinned OpenCode 2 host", async () => {
    if (!enabled) {
      console.log("Skipping V2 E2E: set OPENCODE2_E2E=1 to run")
      return
    }

    const binary = resolve(projectDirectory, "node_modules", ".bin", "opencode2")
    const config = join(projectDirectory, "opencode.jsonc")
    const home = join(projectDirectory, "home")
    await mkdir(home, { recursive: true })
    const environment = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      OPENCODE_CONFIG: config,
      OPENCODE_LOG_LEVEL: "trace",
      OPENCODE_PASSWORD: "v2-e2e-password",
      OPENCODE_SERVER_PASSWORD: "v2-e2e-password",
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
    const logDirectory = join(home, ".local", "share", "opencode", "log")
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
})
