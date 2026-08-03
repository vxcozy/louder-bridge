import { spawn } from "node:child_process";

export function showActivationDialog(
  message,
  { error = false, settingsLabel, run = spawn } = {},
) {
  const icon = error ? "stop" : "note";
  const script = `set buttonLabel to item 2 of argv
display dialog (item 1 of argv) with title "Louder Bridge" buttons {buttonLabel} default button 1 with icon ${icon}`;
  try {
    const child = run(
      "/usr/bin/osascript",
      ["-e", script, "--", String(message), settingsLabel ?? "OK"],
      { detached: true, stdio: "ignore" },
    );
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
