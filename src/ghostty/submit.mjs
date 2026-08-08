import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class GhosttySubmit {
  constructor({
    launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
    run = execFileAsync,
  } = {}) {
    this.launcher = launcher;
    this.run = run;
  }

  async submit() {
    if (!this.launcher) {
      throw new Error("The installed Louder Bridge launcher is unavailable.");
    }
    try {
      await this.run(this.launcher, ["--ghostty-submit"], {
        timeout: 5000,
        windowsHide: true,
      });
    } catch {
      throw new Error(
        "Ghostty did not accept Return. Bring its terminal forward and check Accessibility permission.",
      );
    }
  }
}

export function createGhosttySubmit(options) {
  return new GhosttySubmit(options);
}
