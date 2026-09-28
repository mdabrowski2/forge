// skill accounting verification — run from the forge project root:
// bun scripts/skills-accounting-test.ts (throws on first failure)
import { strict as assert } from "node:assert"
import { rmSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir, homedir } from "os"
import { registry } from "../src/mods/registry"
import { saveSessionMeta } from "../src/sessions/store"
import { defaultConfig } from "../src/config"

// fresh process: no active session -> empty meta, no crash
assert.deepStrictEqual(registry.getLoadedSkillMeta(), [])

registry.reset()
registry.registerSkill("m", { name: "s1", description: "d1", content: "x".repeat(100) })
registry.registerSkill("m", { name: "s2", description: "d2", content: "y".repeat(7) })
registry.registerSkill("off-mod", { name: "s3", description: "d3", content: "z".repeat(50) })
registry.setGlobalConfig({ ...defaultConfig(), mods: { "off-mod": { enabled: false } } })
// disabled mod: excluded everywhere, even when pinned in loadedSkills
assert.ok(!registry.getAllSkills().some((s) => s.name === "s3"))
const all = registry.getAllSkills()
assert.strictEqual(all.find((s) => s.name === "s1")?.bytes, 100)
assert.strictEqual(all.find((s) => s.name === "s1")?.estTokens, 25)
assert.strictEqual(all.find((s) => s.name === "s2")?.estTokens, 2) // ceil(7/4)

// event data shape: names + sizes only, never content
const sid = "skills-accounting-test"
registry.setActiveSession({ id: sid, cwd: "/tmp" })
saveSessionMeta(sid, { loadedSkills: ["s1", "s3"] })
const meta = registry.getLoadedSkillMeta()
assert.deepStrictEqual(meta, [{ name: "s1", bytes: 100, estTokens: 25 }])
for (const m of meta) assert.deepStrictEqual(Object.keys(m).sort(), ["bytes", "estTokens", "name"])
// index guardrail: registered descriptions stay under budget by construction
const indexChars = all.reduce((n, s) => n + s.name.length + s.description.length, 0)
assert.ok(indexChars < 16384, `skill index budget exceeded: ${indexChars} chars`)
for (const s of all) assert.strictEqual(typeof s.estTokens, "number")
const metaFile = join(homedir(), ".forge", "sessions", `${sid}.meta.json`)
if (existsSync(metaFile)) rmSync(metaFile)
registry.reset()
console.log("section 1 green")
