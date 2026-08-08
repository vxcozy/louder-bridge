import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BRIDGE_URL } from "./config.mjs";
import { readAuthToken } from "./setup/auth-token.mjs";

const execFileAsync = promisify(execFile);
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TERMINAL_ID_EVENTS = new Set(["SessionStart", "UserPromptSubmit"]);

const ALLOWED_FIELDS = [
  "session_id",
  "hook_event_name",
  "notification_type",
];
const ALLOWED_SURFACES = new Set(["claude", "codex"]);

function isGhosttyTerminal() {
  return (
    process.env.TERM_PROGRAM?.toLowerCase() === "ghostty" ||
    process.env.TERM?.toLowerCase() === "xterm-ghostty"
  );
}

async function currentGhosttyTerminalId(eventName) {
  const launcher = process.env.LOUDER_BRIDGE_LAUNCHER;
  if (!launcher || !TERMINAL_ID_EVENTS.has(eventName)) return null;
  try {
    const { stdout } = await execFileAsync(
      launcher,
      ["--ghostty-front-terminal-id"],
      { timeout: 500, maxBuffer: 4096, windowsHide: true },
    );
    const terminalId = stdout.trim();
    return TERMINAL_ID_PATTERN.test(terminalId) ? terminalId : null;
  } catch {
    return null;
  }
}

async function stdinJson() {
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    body += chunk;
    if (body.length > 1024 * 1024) return {};
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

const input = await stdinJson();
const payload = Object.fromEntries(
  ALLOWED_FIELDS.filter((field) => input[field] !== undefined).map((field) => [
    field,
    input[field],
  ]),
);
const requestedSurface = process.env.LOUDER_AGENT_SURFACE ?? "claude";
payload.surface = ALLOWED_SURFACES.has(requestedSurface)
  ? requestedSurface
  : "claude";
if (isGhosttyTerminal()) {
  payload.host = "ghostty";
  const terminalId = await currentGhosttyTerminalId(payload.hook_event_name);
  if (terminalId) payload.terminal_id = terminalId;
}

try {
  const authToken = readAuthToken();
  await fetch(`${BRIDGE_URL}/hook`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(400),
  });
} catch {
  // A stopped bridge should not interrupt Claude Code.
}
