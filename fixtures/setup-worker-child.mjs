import fs from "node:fs";
import { runInterruptibleSetup } from "../src/setup/transaction-signals.mjs";

const marker = process.env.LOUDER_SETUP_TEST_MARKER;
if (!marker) throw new Error("A setup-worker test marker is required.");

const result = await runInterruptibleSetup({
  operation(signal) {
    process.send?.({ type: "ready", workerPid: process.pid });
    return new Promise((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("setup parent exited")),
        { once: true },
      );
    });
  },
  async rollback() {
    fs.writeFileSync(marker, "rolled-back", { mode: 0o600 });
  },
});

process.exitCode = result.signal === "SIGTERM" ? 0 : 1;
