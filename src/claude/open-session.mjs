import { spawn } from "node:child_process";

export function claudeResumeUrl(sessionId) {
  return `claude://resume?session=${encodeURIComponent(sessionId)}`;
}

export function openClaudeSession(
  sessionId,
  platform = process.platform,
  spawnProcess = spawn,
) {
  const url = claudeResumeUrl(sessionId);
  let command;
  let args;
  if (platform === "darwin") {
    command = "/usr/bin/open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawnProcess(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve(url));
    child.once("error", reject);
  });
}
