import { describe, expect, it } from "bun:test"
import { $ } from "bun"

describe("dual-host package artifact", () => {
  it("exports V2 at the root and V1 through the server entrypoint", async () => {
    await $`npm run build`.quiet()
    const output = await $`npm pack --dry-run --json --ignore-scripts`.text()
    const [pack] = JSON.parse(output) as Array<{
      id: string
      files: Array<{ path: string }>
    }>
    const manifest = await Bun.file("package.json").json() as {
      name: string
      exports: Record<string, unknown>
      engines: Record<string, string>
    }

    expect(pack.id).toStartWith("opencode-command-hooks@")
    expect(pack.files.map(file => file.path)).toContain("dist/v2.js")
    expect(pack.files.map(file => file.path)).toContain("dist/server.js")
    expect(manifest.name).toBe("opencode-command-hooks")
    expect(manifest.exports["."]).toBeDefined()
    expect(manifest.exports["./server"]).toBeDefined()
    expect(manifest.engines.opencode).toBe(">=1.18.23")

    const v2 = await import("opencode-command-hooks")
    const v1 = await import("opencode-command-hooks/server")
    expect(v2.default.id).toBe("opencode-command-hooks.v2")
    expect(typeof v2.default.setup).toBe("function")
    expect(v1.default.id).toBe("opencode-command-hooks")
    expect(typeof v1.default.server).toBe("function")
  })
})
