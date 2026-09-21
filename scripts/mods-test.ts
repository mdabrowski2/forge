// mod skeleton verification (Phase A) — run from the forge project root
import { mkdtempSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadMods } from "../src/mods/loader"
import { registry } from "../src/mods/registry"
import { createTools } from "../src/agent/tools/index"
import { getSystemPrompt } from "../src/agent/prompt"
import { defaultConfig } from "../src/config"

const dir = mkdtempSync(join(tmpdir(), "forge-mods-test-"))
mkdirSync(join(dir, "test-mod"))
writeFileSync(
  join(dir, "test-mod", "index.js"),
  `export default {
  name: "test-mod",
  version: "1.0.0",
  setup(api) {
    api.tools.register({
      name: "hello",
      description: "says hello",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      execute: (input, ctx) => "hello " + input.name + " from " + ctx.cwd,
    })
    api.hooks.on("beforeTurn", (p) => console.log("[hook] beforeTurn model=" + p.model))
    api.commands.register({ name: "ping", description: "pong", run: () => "pong" })
    api.prompt.add("You can use the hello tool.")
  },
}`
)

const config = defaultConfig()
const result = await loadMods(config, dir)
console.log("loaded:", JSON.stringify(result.loaded))
console.log("failed:", JSON.stringify(result.failed))

// disabled mod is skipped
mkdirSync(join(dir, "disabled-mod"))
writeFileSync(
  join(dir, "disabled-mod", "index.js"),
  `export default { name: "disabled-mod", version: "1.0.0", setup() { throw new Error("should not run") } }`
)
const cfg2 = { ...defaultConfig(), mods: { "disabled-mod": { enabled: false } } }
const r2 = await loadMods(cfg2, dir)
console.log(
  "disabled skipped:",
  !r2.loaded.includes("disabled-mod") && !r2.failed.some((f) => f.name === "disabled-mod")
)

// broken mod is reported, not fatal
mkdirSync(join(dir, "broken-mod"))
writeFileSync(join(dir, "broken-mod", "index.js"), `export default { name: "broken-mod", setup() { throw new Error("boom") } }`)
const r3 = await loadMods(defaultConfig(), dir)
console.log("broken reported:", r3.failed.some((f) => f.name === "broken-mod" && f.error.includes("boom")))

const runtime = {
  cwd: "C:\\test",
  config,
  session: { id: "s1", messages: [] },
  emit: (e) => console.log("[emit]", e.type),
}
const tools = createTools(runtime)
console.log("tool names:", Object.keys(tools).join(", "))
const out = await tools["hello"].execute({ name: "world" }, { toolCallId: "tc1" })
console.log("hello output:", out)

console.log("prompt has mod section:", getSystemPrompt().includes("hello tool"))
console.log("commands:", registry.getCommands().map((c) => c.name).join(", "))

registry.emitHook("beforeTurn", { model: "m", cwd: "c", messages: [] })

registry.setEmitSink((e) => console.log("[sink]", JSON.stringify(e)))
registry.emitCustom("test-mod", { type: "custom", callId: "c1", name: "ping", data: { x: 1 } })