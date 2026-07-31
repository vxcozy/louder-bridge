import os from "node:os";
import path from "node:path";

export const BRIDGE_HOST = process.env.LOUDER_BRIDGE_HOST ?? "127.0.0.1";
export const BRIDGE_PORT = Number(process.env.LOUDER_BRIDGE_PORT ?? 47831);
export const BRIDGE_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;
export const SLOT_COUNT = 6;

export function claudeSettingsPath() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, "settings.json")
    : path.join(os.homedir(), ".claude", "settings.json");
}
