import { spawn } from "node:child_process";

const OPEN_TIMEOUT_MS = 5000;

export function claudeResumeUrl(sessionId) {
  return `claude://resume?session=${encodeURIComponent(sessionId)}`;
}

export function openClaudeSession(
  sessionId,
  platform = process.platform,
  spawnProcess = spawn,
  timeoutMs = OPEN_TIMEOUT_MS,
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
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(url);
    };
    const timer = setTimeout(() => {
      finish(new Error("Claude session navigation did not start in time."));
    }, timeoutMs);
    child.once("spawn", () => finish());
    child.once("error", finish);
  });
}
