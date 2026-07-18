import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { $ } from "bun"

const enabled = process.env.OPENCODE2_E2E === "1"
const cliVersion = "0.0.0-next-15800"
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
    }
    const request = async (args: string[]) => {
      const processHandle = Bun.spawn([binary, ...args], {
        cwd: projectDirectory,
        env: environment,
        stdout: "pipe",
        stderr: "pipe",
      })
      const timeout = setTimeout(() => processHandle.kill(), 60_000)
      const [exitCode, stdout, stderr] = await Promise.all([
        processHandle.exited,
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
      ])
      clearTimeout(timeout)
      return { exitCode, stdout, stderr }
    }

    const { exitCode, stdout, stderr } = await request([
      "api",
      "--standalone",
      "get",
      "/api/plugin",
    ])

    const logDirectory = join(home, ".local", "share", "opencode", "log")
    let logs = ""
    try {
      const files = await readdir(logDirectory)
      logs = (await Promise.all(files.map(file => readFile(join(logDirectory, file), "utf8")))).join("\n")
    } catch {
      // The assertion below still reports stdout and stderr when no log was written.
    }

    expect(exitCode, `${stderr}\n${logs}`).toBe(0)
    expect(stdout, `${stderr}\n${logs}`).toContain("opencode-command-hooks.v2")
  }, 90_000)
})
