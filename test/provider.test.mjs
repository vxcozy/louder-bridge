import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ExternalWorkLouderProvider,
  LegacyChatGptProvider,
  createDeviceProvider,
} from "../src/device/provider.mjs";

test("keeps the private ChatGPT runtime explicitly experimental", () => {
  const provider = createDeviceProvider({});
  assert.equal(provider.metadata().id, "chatgpt-asar");
  assert.equal(provider.metadata().support, "experimental");
});

test("reports an unavailable legacy runtime without throwing", () => {
  const provider = new LegacyChatGptProvider({
    archivePath: "/path/that/does/not/exist",
  });
  assert.deepEqual(provider.inspect(), {
    id: "chatgpt-asar",
    support: "experimental",
    version: null,
    available: false,
    error: "The experimental ChatGPT device runtime was not found.",
  });
});

test("loads a configured external provider and reports its version", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-provider-"));
  const moduleFile = path.join(directory, "index.cjs");
  fs.writeFileSync(moduleFile, "module.exports = {};\n");
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  const requireModule = () => ({ expected: true });
  requireModule.resolve = () => moduleFile;
  const provider = new ExternalWorkLouderProvider({
    moduleSpecifier: "fixture",
    support: "official",
    requireModule,
  });

  assert.deepEqual(provider.load(), { expected: true });
  assert.deepEqual(provider.metadata(), {
    id: "worklouder-sdk",
    support: "official",
    version: "1.2.3",
  });
  fs.rmSync(directory, { recursive: true });
});
