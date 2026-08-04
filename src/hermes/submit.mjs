import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class HermesAccessibilitySubmit {
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
      await this.run(this.launcher, ["--hermes-submit"], {
        timeout: 5000,
        windowsHide: true,
      });
    } catch (error) {
      const detail = error?.stderr?.trim() || error?.message || String(error);
      throw new Error(detail);
    }
  }
}

export function createHermesSubmit(options) {
  return new HermesAccessibilitySubmit(options);
}
