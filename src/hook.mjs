import { BRIDGE_URL } from "./config.mjs";
import { readAuthToken } from "./setup/auth-token.mjs";

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
if (isGhosttyTerminal()) payload.host = "ghostty";

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
