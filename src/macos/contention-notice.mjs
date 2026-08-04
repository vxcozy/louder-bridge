import { spawn } from "node:child_process";

export const CODEX_CONTENTION_MESSAGE =
  "Codex is open too. Quit Codex to use the Micro in Claude Desktop. Louder Bridge will reconnect when Codex closes.";

export function codexContentionMessage(surface = "Claude Desktop") {
  return surface === "Claude Desktop"
    ? CODEX_CONTENTION_MESSAGE
    : `Codex is open too. Quit Codex to use the Micro in ${surface}. Louder Bridge will reconnect when Codex closes.`;
}

const DIALOG_SCRIPT =
  'display dialog (item 1 of argv) with title "Louder Bridge" buttons {"OK"} default button 1 with icon caution';

export function showCodexContentionNotice({
  surface = "Claude Desktop",
  run = spawn,
  onError = () => {},
} = {}) {
  try {
    const child = run(
      "/usr/bin/osascript",
      ["-e", DIALOG_SCRIPT, "--", codexContentionMessage(surface)],
      { detached: true, stdio: "ignore" },
    );
    child.on?.("error", onError);
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
