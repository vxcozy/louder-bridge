import { BRIDGE_URL } from "./config.mjs";
import { readAuthToken } from "./setup/auth-token.mjs";

const ALLOWED_FIELDS = [
  "session_id",
  "hook_event_name",
  "notification_type",
];

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
payload.surface = "claude";

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
