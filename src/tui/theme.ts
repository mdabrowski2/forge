// golden-hour palette (from the opencode theme of the same name)
import { RGBA } from "@opentui/core"

export interface ForgeTheme {
  bg: RGBA
  panel: RGBA
  element: RGBA
  border: RGBA
  borderActive: RGBA
  text: RGBA
  muted: RGBA
  gold: RGBA
  amber: RGBA
  ember: RGBA
  olive: RGBA
  rose: RGBA
  teal: RGBA
}

export const goldenHour: ForgeTheme = {
  bg: RGBA.fromHex("#221B14"),
  panel: RGBA.fromHex("#2A2118"),
  element: RGBA.fromHex("#322719"),
  border: RGBA.fromHex("#4A3B28"),
  borderActive: RGBA.fromHex("#6E593A"),
  text: RGBA.fromHex("#F5EAD5"),
  muted: RGBA.fromHex("#A7987C"),
  gold: RGBA.fromHex("#E0A93D"),
  amber: RGBA.fromHex("#F0BE66"),
  ember: RGBA.fromHex("#C97B3D"),
  olive: RGBA.fromHex("#A9B04A"),
  rose: RGBA.fromHex("#D96A5B"),
  teal: RGBA.fromHex("#7FA0A6"),
}