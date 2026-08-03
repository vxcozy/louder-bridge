import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let cached;

export function applicationMetadata() {
  if (!cached) {
    const metadata = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    cached = {
      name: metadata.name,
      version: metadata.version,
      buildRevision: metadata.louderBridge?.buildRevision ?? null,
    };
  }
  return { ...cached };
}
