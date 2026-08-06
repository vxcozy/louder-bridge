import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  commitHermesPluginInstallation,
  commitHermesPluginRemoval,
  hermesPluginPath,
  installHermesPlugin,
  removeHermesPlugin,
  rollbackHermesPluginInstallation,
  rollbackHermesPluginRemoval,
} from "../src/setup/hermes-plugin.mjs";

const execFileAsync = promisify(execFile);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "louder-hermes-plugin-"));
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "plugin.yaml"), "name: louder-bridge\n");
  fs.writeFileSync(path.join(source, "__init__.py"), "VERSION = 2\n");
  return { root, source, target: hermesPluginPath(root) };
}

function fakeHermes(initial = {}) {
  const config = new Map(Object.entries(initial));
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "plugins" && args[1] === "enable") {
      const enabled = config.get("plugins.enabled") ?? [];
      config.set("plugins.enabled", [...new Set([...enabled, "louder-bridge"])]);
      config.set(
        "plugins.entries.louder-bridge.allow_tool_override",
        false,
      );
      return { stdout: "" };
    }
    if (args[0] === "config" && args[1] === "get") {
      const key = args[2];
      if (!config.has(key)) {
        const error = new Error("not set");
        error.stderr = `Config key not set: ${key}\n`;
        throw error;
      }
      return { stdout: `${JSON.stringify(config.get(key))}\n` };
    }
    if (args[0] === "config" && args[1] === "set") {
      const key = args[2] === "--force" ? args[3] : args[2];
      const value = args[2] === "--force" ? args[4] : args[3];
      config.set(key, JSON.parse(value));
      return { stdout: "" };
    }
    if (args[0] === "config" && args[1] === "unset") {
      const key = args[2];
      if (!config.delete(key)) {
        const error = new Error("not set");
        error.stderr = `Config key not set: ${key}\n`;
        throw error;
      }
      return { stdout: "" };
    }
    throw new Error(`Unexpected Hermes command: ${args.join(" ")}`);
  };
  return { calls, config, run };
}

test("installs, enables, and commits the managed Hermes plugin", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes({
    "plugins.enabled": ["existing-plugin"],
    "plugins.disabled": ["disabled-plugin"],
  });

  const transaction = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run: hermes.run,
  });

  assert.equal(transaction.installed, true);
  assert.equal(fs.readFileSync(path.join(files.target, "__init__.py"), "utf8"), "VERSION = 2\n");
  assert.equal(fs.existsSync(path.join(files.target, ".louder-bridge-owned")), true);
  assert.deepEqual(hermes.config.get("plugins.enabled"), [
    "existing-plugin",
    "louder-bridge",
  ]);
  assert.equal(
    hermes.config.get("plugins.entries.louder-bridge.allow_tool_override"),
    false,
  );
  commitHermesPluginInstallation(transaction);
});

test("rolls a Hermes plugin upgrade back to its exact prior state", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  fs.writeFileSync(path.join(files.target, "__init__.py"), "VERSION = 1\n");
  const hermes = fakeHermes({
    "plugins.enabled": ["louder-bridge", "existing-plugin"],
    "plugins.disabled": ["disabled-plugin"],
    "plugins.entries.louder-bridge.allow_tool_override": true,
  });

  const transaction = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run: hermes.run,
  });
  await rollbackHermesPluginInstallation(transaction);

  assert.equal(fs.readFileSync(path.join(files.target, "__init__.py"), "utf8"), "VERSION = 1\n");
  assert.deepEqual(hermes.config.get("plugins.enabled"), [
    "louder-bridge",
    "existing-plugin",
  ]);
  assert.equal(
    hermes.config.get("plugins.entries.louder-bridge.allow_tool_override"),
    true,
  );
});

test("does not overwrite an unrelated Hermes plugin with the same name", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, "private.txt"), "keep\n");

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run: fakeHermes().run,
    }),
    /does not own/,
  );
  assert.equal(fs.readFileSync(path.join(files.target, "private.txt"), "utf8"), "keep\n");
});

test("removes only the managed plugin and can roll the removal back", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  fs.writeFileSync(path.join(files.target, "__init__.py"), "VERSION = 1\n");
  const hermes = fakeHermes({
    "plugins.enabled": ["existing-plugin", "louder-bridge"],
    "plugins.disabled": ["disabled-plugin"],
    "plugins.entries.louder-bridge.allow_tool_override": false,
  });

  const transaction = await removeHermesPlugin({
    homeDirectory: files.root,
    hermes: "/hermes",
    run: hermes.run,
  });
  assert.equal(fs.existsSync(files.target), false);
  assert.deepEqual(hermes.config.get("plugins.enabled"), ["existing-plugin"]);
  assert.deepEqual(hermes.config.get("plugins.disabled"), ["disabled-plugin"]);

  await rollbackHermesPluginRemoval(transaction);
  assert.equal(fs.existsSync(files.target), true);
  assert.deepEqual(hermes.config.get("plugins.enabled"), [
    "existing-plugin",
    "louder-bridge",
  ]);

  const second = await removeHermesPlugin({
    homeDirectory: files.root,
    hermes: "/hermes",
    run: hermes.run,
  });
  commitHermesPluginRemoval(second);
  assert.equal(fs.existsSync(files.target), false);
});

test("Hermes lifecycle callbacks emit only surface, session, and state", async () => {
  const plugin = path.resolve("src/hermes/plugin/__init__.py");
  const script = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("louder_bridge", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
events = []
module._emit = lambda name, session: events.append({"surface": "hermes", "session_id": session, "hook_event_name": name})
module._on_session_start(session_id="one", prompt="private")
module._on_pre_llm_call(session_id="one", user_message="private")
module._on_post_llm_call(session_id="one", assistant_response="private")
module._on_approval_request(session_key="one", command="private")
module._on_approval_response(session_key="one", choice="once", command="private")
module._on_session_end(session_id="one", completed=False, interrupted=False, model="private")
module._on_session_finalize(session_id="one", platform="private")
print(json.dumps(events))
`;
  const { stdout } = await execFileAsync("python3", ["-c", script, plugin], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });

  assert.deepEqual(JSON.parse(stdout), [
    { surface: "hermes", session_id: "one", hook_event_name: "SessionStart" },
    { surface: "hermes", session_id: "one", hook_event_name: "UserPromptSubmit" },
    { surface: "hermes", session_id: "one", hook_event_name: "Stop" },
    { surface: "hermes", session_id: "one", hook_event_name: "PermissionRequest" },
    { surface: "hermes", session_id: "one", hook_event_name: "UserPromptSubmit" },
    { surface: "hermes", session_id: "one", hook_event_name: "StopFailure" },
    { surface: "hermes", session_id: "one", hook_event_name: "SessionEnd" },
  ]);
  assert.equal(stdout.includes("private"), false);
});

test("Hermes marks lifecycle events emitted from Ghostty", async () => {
  const plugin = path.resolve("src/hermes/plugin/__init__.py");
  const script = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("louder_bridge", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module._emit("SessionStart", "one")
print(json.dumps(module._EVENTS.get_nowait()))
`;
  const { stdout } = await execFileAsync("python3", ["-c", script, plugin], {
    env: {
      ...process.env,
      TERM_PROGRAM: "ghostty",
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });

  assert.deepEqual(JSON.parse(stdout), {
    surface: "hermes",
    host: "ghostty",
    session_id: "one",
    hook_event_name: "SessionStart",
  });
});

test("the Hermes plugin sends an authenticated loopback hook", { timeout: 2000 }, async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const token = "d".repeat(64);
  const support = path.join(
    files.root,
    "Library",
    "Application Support",
    "LouderBridge",
  );
  fs.mkdirSync(support, { recursive: true });
  fs.writeFileSync(path.join(support, "auth-token"), `${token}\n`);
  let receive;
  const received = new Promise((resolve) => {
    receive = resolve;
  });
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      receive({
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      });
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const plugin = path.resolve("src/hermes/plugin/__init__.py");
  const script = String.raw`
import importlib.util, sys
spec = importlib.util.spec_from_file_location("louder_bridge", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module._send({"surface": "hermes", "session_id": "one", "hook_event_name": "SessionStart"})
`;
  await execFileAsync("python3", ["-c", script, plugin], {
    env: {
      ...process.env,
      HOME: files.root,
      LOUDER_BRIDGE_HOST: "127.0.0.1",
      LOUDER_BRIDGE_PORT: String(server.address().port),
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });

  assert.deepEqual(await received, {
    authorization: `Bearer ${token}`,
    body: {
      surface: "hermes",
      session_id: "one",
      hook_event_name: "SessionStart",
    },
  });
});
