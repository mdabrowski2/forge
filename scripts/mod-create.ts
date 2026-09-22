// usage: bun scripts/mod-create.ts <dirName> [--dir <modsDir>]
import { modsDir as defaultModsDir } from "../src/mods/loader"
import { scaffoldMod } from "../src/mods/scaffold"
const fail = (m: string): never => {
  console.error(m)
  process.exit(1)
}
const name = process.argv[2] ?? fail("usage: bun scripts/mod-create.ts <dirName> [--dir <modsDir>]")
const flag = process.argv.indexOf("--dir")
const dir = flag === -1 ? defaultModsDir : (process.argv[flag + 1] ?? fail("missing value for --dir"))
try {
  console.log("created: " + scaffoldMod(name, dir))
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}
