import { fileURLToPath } from "node:url";
import { startSetupWorker } from "../scripts/setup-worker.mjs";

const child = startSetupWorker({
  cli: fileURLToPath(new URL("./setup-worker-child.mjs", import.meta.url)),
});

child.on("message", (message) => process.send?.(message));
child.on("error", (error) => {
  process.send?.({ type: "error", detail: error.message });
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
