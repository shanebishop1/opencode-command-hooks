import { describe, expect, it } from "bun:test"
import { $ } from "bun"

// Each OpenCode host resolves the package differently; these assertions mirror
// what each loader requires so one npm package works everywhere by name.
describe("dual-host package artifact", () => {
  it("serves every OpenCode host from one package", async () => {
    await $`npm run build`.quiet()
    const output = await $`npm pack --dry-run --json --ignore-scripts`.text()
    const [pack] = JSON.parse(output) as Array<{
      id: string
      files: Array<{ path: string }>
    }>
    const manifest = await Bun.file("package.json").json() as {
      name: string
      exports: Record<string, unknown>
    }
    const files = pack.files.map(file => file.path)

    expect(pack.id).toStartWith("opencode-command-hooks@")
    expect(manifest.name).toBe("opencode-command-hooks")
    for (const file of ["dist/entry.js", "dist/server.js", "index.js", "server.js"]) {
      expect(files).toContain(file)
    }

    // V1 1.3.4+ and V2 both resolve `./server` first: V1 reads `server`, and
    // V2's schema requires a plain object with `setup`.
    const server = await import("opencode-command-hooks/server")
    expect(Object.keys(server)).toEqual(["default"])
    expect(typeof server.default).toBe("object")
    expect(server.default.id).toBe("opencode-command-hooks")
    expect(typeof server.default.server).toBe("function")
    expect(typeof server.default.setup).toBe("function")

    // V1 before 1.3.4 imports the root and calls every export as a plugin.
    const root = await import("opencode-command-hooks")
    expect(Object.keys(root)).toEqual(["default"])
    expect(typeof root.default).toBe("function")

    // Local directory installs load `server.js`, falling back to `index.js`.
    expect((await import("../server.js")).default).toBe(server.default)
    expect((await import("../index.js")).default).toBe(root.default)
  }, 30_000)
})
