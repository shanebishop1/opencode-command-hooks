import { describe, expect, it } from "bun:test"
import { $ } from "bun"

describe("V2 package artifact", () => {
  it("builds and packs the isolated beta package with exact host dependencies", async () => {
    await $`npm run build:v2`.quiet()
    const output = await $`npm pack --dry-run --json --ignore-scripts`.cwd("packages/v2").text()
    const [pack] = JSON.parse(output) as Array<{
      id: string
      files: Array<{ path: string }>
    }>
    const manifest = await Bun.file("packages/v2/package.json").json() as {
      dependencies: Record<string, string>
    }

    expect(pack.id).toStartWith("opencode-command-hooks-v2@0.1.0-beta.")
    expect(pack.files.map(file => file.path)).toContain("dist/index.js")
    expect(manifest.dependencies["@opencode-ai/plugin"]).toBe("0.0.0-beta-18684")
  })
})
