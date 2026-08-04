import { spawn } from "node:child_process";

export const CODEX_CONTENTION_MESSAGE =
  "Codex is also open. Quit Codex to use MIC and send with Claude. Louder Bridge will reconnect automatically.";

const DIALOG_SCRIPT =
  'display dialog (item 1 of argv) with title "Louder Bridge" buttons {"OK"} default button 1 with icon caution';

export function showCodexContentionNotice({
  run = spawn,
  onError = () => {},
} = {}) {
  try {
    const child = run(
      "/usr/bin/osascript",
      ["-e", DIALOG_SCRIPT, "--", CODEX_CONTENTION_MESSAGE],
      { detached: true, stdio: "ignore" },
    );
    child.on?.("error", onError);
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
