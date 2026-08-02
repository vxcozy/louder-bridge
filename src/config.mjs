import os from "node:os";
import path from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function assertLocalAddress(host, port) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Refusing to expose Louder Bridge on non-loopback address "${host}".`,
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid Louder Bridge port "${port}".`);
  }
}

export function bridgeUrl(host, port) {
  assertLocalAddress(host, port);
  const urlHost = host.includes(":") ? `[${host}]` : host;
  return `http://${urlHost}:${port}`;
}

export const BRIDGE_HOST = process.env.LOUDER_BRIDGE_HOST ?? "127.0.0.1";
export const BRIDGE_PORT = Number(process.env.LOUDER_BRIDGE_PORT ?? 47831);
export const BRIDGE_URL = bridgeUrl(BRIDGE_HOST, BRIDGE_PORT);
export const SLOT_COUNT = 6;

export function claudeSettingsPath() {
  return process.env.CLAUDE_CONFIG_DIR
    ? path.join(process.env.CLAUDE_CONFIG_DIR, "settings.json")
    : path.join(os.homedir(), ".claude", "settings.json");
}
