import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const hook = path.join(root, "src", "hook.mjs");
const token = "c".repeat(64);

function fixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "louder-hook-"));
  const support = path.join(
    home,
    "Library",
    "Application Support",
    "LouderBridge",
  );
  fs.mkdirSync(support, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(support, "auth-token"), `${token}\n`, {
    mode: 0o600,
  });
  return home;
}

function runHook({ home, port, input, environment = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        LOUDER_BRIDGE_HOST: "127.0.0.1",
        LOUDER_BRIDGE_PORT: String(port),
        TERM_PROGRAM: "",
        TERM: "xterm-256color",
        ...environment,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test("the hook sends only allowlisted lifecycle fields", { timeout: 2000 }, async (context) => {
  const home = fixtureHome();
  context.after(() => fs.rmSync(home, { recursive: true }));
  let received;
  const requestReceived = new Promise((resolve) => {
    received = resolve;
  });
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received({
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      });
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await runHook({
    home,
    port: server.address().port,
    input: {
      session_id: "session-a",
      cwd: "/work/project",
      hook_event_name: "UserPromptSubmit",
      notification_type: "permission_prompt",
      reason: "private stop reason",
      source: "private source",
      model: "claude-model",
      tool_name: "private tool name",
      agent_id: "private-agent-id",
      prompt: "private prompt",
      transcript: "private transcript",
      tool_input: { command: "private command" },
      tool_response: "private output",
      assistant_response: "private response",
    },
  });
  const request = await requestReceived;

  assert.deepEqual(result, {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
  });
  assert.equal(request.authorization, `Bearer ${token}`);
  assert.deepEqual(request.body, {
    surface: "claude",
    session_id: "session-a",
    hook_event_name: "UserPromptSubmit",
    notification_type: "permission_prompt",
  });
});

test("the hook identifies Codex sessions running in Ghostty", { timeout: 2000 }, async (context) => {
  const home = fixtureHome();
  context.after(() => fs.rmSync(home, { recursive: true }));
  const launcher = path.join(home, "LouderBridge");
  fs.writeFileSync(
    launcher,
    "#!/bin/sh\nprintf '%s\\n' 'terminal-codex'\n",
    { mode: 0o700 },
  );
  let receive;
  const received = new Promise((resolve) => { receive = resolve; });
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      receive(JSON.parse(body));
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await runHook({
    home,
    port: server.address().port,
    environment: {
      LOUDER_AGENT_SURFACE: "codex",
      LOUDER_BRIDGE_LAUNCHER: launcher,
      TERM_PROGRAM: "ghostty",
    },
    input: {
      session_id: "session-b",
      hook_event_name: "SessionStart",
      prompt: "private prompt",
    },
  });

  assert.equal(result.code, 0);
  assert.deepEqual(await received, {
    surface: "codex",
    host: "ghostty",
    terminal_id: "terminal-codex",
    session_id: "session-b",
    hook_event_name: "SessionStart",
  });
});

test("the hook exits successfully when the bridge is absent", async (context) => {
  const home = fixtureHome();
  context.after(() => fs.rmSync(home, { recursive: true }));
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const startedAt = Date.now();
  const result = await runHook({
    home,
    port,
    input: {
      session_id: "session-a",
      hook_event_name: "SessionStart",
    },
  });

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.ok(Date.now() - startedAt < 1500);
});
