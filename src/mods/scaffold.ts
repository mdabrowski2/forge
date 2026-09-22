import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs"
import { join } from "path"

export const MOD_TEMPLATE = `export default {
  name: "__MOD_NAME__",
  version: "0.1.0",
  setup(api) {
    api.commands.register({
      name: "hello",
      description: "says hello (rename me)",
      run: (args) => "hello " + (args || "world"),
    })
  },
}
`

const VALID = /^[a-z0-9][a-z0-9-_]*$/

export function scaffoldMod(dirName: string, modsDir: string): string {
  if (!VALID.test(dirName)) throw new Error(`invalid mod name "${dirName}" (use lowercase letters, digits, - _)`)
  const dir = join(modsDir, dirName)
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`already exists and is not empty: ${dir}`)
  mkdirSync(dir, { recursive: true })
  const entry = join(dir, "index.js")
  writeFileSync(entry, MOD_TEMPLATE.replaceAll("__MOD_NAME__", dirName))
  return entry
}
