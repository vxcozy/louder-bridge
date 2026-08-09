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
  const config = path.join(root, ".hermes", "config.yaml");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "plugin.yaml"), "name: louder-bridge\n");
  fs.writeFileSync(path.join(source, "__init__.py"), "VERSION = 2\n");
  return { root, source, config, target: hermesPluginPath(root) };
}

function fakeHermes(initial = {}, configPath = "/tmp/hermes/config.yaml") {
  let activeConfigPath = configPath;
  const initialHome = path.dirname(configPath);
  const configs = new Map([
    [initialHome, new Map(Object.entries(initial))],
  ]);
  const persist = (hermesHome, config) => {
    fs.mkdirSync(hermesHome, { recursive: true });
    fs.writeFileSync(
      path.join(hermesHome, "config.yaml"),
      `${JSON.stringify(Object.fromEntries(config), null, 2)}\n`,
    );
  };
  persist(initialHome, configs.get(initialHome));
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push([command, ...args]);
    if (args[0] === "config" && args[1] === "path") {
      return { stdout: `${activeConfigPath}\n` };
    }
    const hermesHome = options.env?.HERMES_HOME ?? path.dirname(activeConfigPath);
    let config = configs.get(hermesHome);
    if (!config) {
      config = new Map();
      configs.set(hermesHome, config);
    }
    const configFile = path.join(hermesHome, "config.yaml");
    if (fs.existsSync(configFile)) {
      const saved = JSON.parse(fs.readFileSync(configFile, "utf8"));
      config.clear();
      for (const [key, value] of Object.entries(saved)) config.set(key, value);
    }
    if (args[0] === "plugins" && args[1] === "enable") {
      const enabled = config.get("plugins.enabled") ?? [];
      config.set("plugins.enabled", [...new Set([...enabled, "louder-bridge"])]);
      config.set(
        "plugins.entries.louder-bridge.allow_tool_override",
        false,
      );
      persist(hermesHome, config);
      return { stdout: "" };
    }
    if (args[0] === "plugins" && args[1] === "disable") {
      const enabled = config.get("plugins.enabled") ?? [];
      const disabled = config.get("plugins.disabled") ?? [];
      config.set(
        "plugins.enabled",
        enabled.filter((name) => name !== "louder-bridge"),
      );
      config.set(
        "plugins.disabled",
        [...new Set([...disabled, "louder-bridge"])],
      );
      persist(hermesHome, config);
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
      persist(hermesHome, config);
      return { stdout: "" };
    }
    if (args[0] === "config" && args[1] === "unset") {
      const key = args[2];
      const match = key.match(/^(.*)\.(\d+)$/);
      let removed = false;
      if (match && Array.isArray(config.get(match[1]))) {
        const values = config.get(match[1]);
        const index = Number(match[2]);
        if (index >= 0 && index < values.length) {
          values.splice(index, 1);
          removed = true;
        }
      } else {
        removed = config.delete(key);
      }
      if (!removed) {
        const error = new Error("not set");
        error.stderr = `Config key not set: ${key}\n`;
        throw error;
      }
      persist(hermesHome, config);
      return { stdout: "" };
    }
    throw new Error(`Unexpected Hermes command: ${args.join(" ")}`);
  };
  return {
    calls,
    config: configs.get(initialHome),
    configs,
    run,
    setActiveConfigPath(configFile) {
      activeConfigPath = configFile;
    },
    setConfig(configFile, values) {
      const hermesHome = path.dirname(configFile);
      const config = new Map(Object.entries(values));
      configs.set(hermesHome, config);
      persist(hermesHome, config);
    },
  };
}

function readFakeConfig(configFile) {
  return new Map(
    Object.entries(JSON.parse(fs.readFileSync(configFile, "utf8"))),
  );
}

function writeFakeConfig(configFile, config) {
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
}

test("keeps the Hermes plugin version aligned with the package", () => {
  const metadata = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const manifest = fs.readFileSync(
    "src/hermes/plugin/plugin.yaml",
    "utf8",
  );
  const version = manifest
    .split("\n")
    .find((line) => line.startsWith("version:"));
  assert.equal(version, `version: "${metadata.version}"`);
});

test("installs, enables, and commits the managed Hermes plugin", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes({
    "plugins.enabled": ["existing-plugin"],
    "plugins.disabled": ["disabled-plugin"],
  }, files.config);

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

test("rolls a Hermes plugin upgrade back to its prior membership", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  fs.writeFileSync(path.join(files.target, "__init__.py"), "VERSION = 1\n");
  const hermes = fakeHermes({
    "plugins.enabled": ["louder-bridge", "existing-plugin"],
    "plugins.disabled": ["disabled-plugin"],
    "plugins.entries.louder-bridge.allow_tool_override": true,
  }, files.config);

  const transaction = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run: hermes.run,
  });
  await rollbackHermesPluginInstallation(transaction);

  assert.equal(fs.readFileSync(path.join(files.target, "__init__.py"), "utf8"), "VERSION = 1\n");
  const restored = readFakeConfig(files.config);
  assert.deepEqual(new Set(restored.get("plugins.enabled")), new Set([
    "louder-bridge",
    "existing-plugin",
  ]));
  assert.equal(
    restored.get("plugins.entries.louder-bridge.allow_tool_override"),
    true,
  );
});

test("revalidates an existing plugin immediately before upgrading", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  const hermes = fakeHermes(
    { "plugins.enabled": ["louder-bridge"] },
    files.config,
  );
  let replaced = false;
  const run = async (...args) => {
    const replaceAfterRead =
      !replaced &&
      args[1][0] === "config" &&
      args[1][1] === "get" &&
      args[1][2] === "plugins.entries.louder-bridge.allow_tool_override";
    try {
      return await hermes.run(...args);
    } finally {
      if (replaceAfterRead) {
        replaced = true;
        fs.rmSync(files.target, { recursive: true });
        fs.mkdirSync(files.target);
        fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
      }
    }
  };

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run,
    }),
    /does not own/,
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
});

test("requires Hermes to leave the installed plugin enabled", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes(
    { "plugins.enabled": ["existing-plugin"] },
    files.config,
  );
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (args[1][0] === "plugins" && args[1][1] === "enable") {
      const changed = Object.fromEntries(readFakeConfig(files.config));
      changed["plugins.enabled"] = ["existing-plugin"];
      changed["plugins.disabled"] = ["louder-bridge"];
      changed["plugins.entries.louder-bridge.allow_tool_override"] = true;
      writeFakeConfig(files.config, changed);
    }
    return result;
  };

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run,
    }),
    /settings changed before setup finished/,
  );

  assert.equal(fs.existsSync(files.target), false);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "existing-plugin",
  ]);
});

test("preserves a replacement during failed-install cleanup", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes(
    { "plugins.enabled": ["existing-plugin"] },
    files.config,
  );
  let replaceDuringCleanup = false;
  let replaced = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (args[1][0] === "plugins" && args[1][1] === "enable") {
      const changed = Object.fromEntries(readFakeConfig(files.config));
      changed["plugins.enabled"] = ["existing-plugin"];
      writeFakeConfig(files.config, changed);
      replaceDuringCleanup = true;
    } else if (
      replaceDuringCleanup &&
      !replaced &&
      args[1][0] === "config" &&
      args[1][1] === "unset"
    ) {
      replaced = true;
      fs.rmSync(files.target, { recursive: true });
      fs.mkdirSync(files.target);
      fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
    }
    return result;
  };

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run,
    }),
    /could not be fully rolled back/,
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
});

test("does not restore old settings onto a replacement plugin", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  const hermes = fakeHermes({
    "plugins.enabled": ["louder-bridge"],
    "plugins.entries.louder-bridge.allow_tool_override": true,
  }, files.config);
  let enabled = false;
  let replaced = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (args[1][0] === "plugins" && args[1][1] === "enable") {
      enabled = true;
    } else if (
      enabled &&
      !replaced &&
      args[1][0] === "config" &&
      args[1][1] === "get" &&
      args[1][2] === "plugins.entries.louder-bridge.allow_tool_override"
    ) {
      replaced = true;
      fs.rmSync(files.target, { recursive: true });
      fs.mkdirSync(files.target);
      fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
    }
    return result;
  };

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run,
    }),
    /could not be fully rolled back/,
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
  assert.equal(
    readFakeConfig(files.config).get(
      "plugins.entries.louder-bridge.allow_tool_override",
    ),
    false,
  );
});

test("rechecks ownership after failed-install cleanup reads", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  const hermes = fakeHermes({
    "plugins.enabled": ["louder-bridge"],
    "plugins.entries.louder-bridge.allow_tool_override": true,
  }, files.config);
  let cleanupReady = false;
  let replaced = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (args[1][0] === "plugins" && args[1][1] === "enable") {
      const changed = Object.fromEntries(readFakeConfig(files.config));
      changed["plugins.enabled"] = [];
      writeFakeConfig(files.config, changed);
    } else if (
      args[1][0] === "config" &&
      args[1][1] === "get" &&
      args[1][2] === "plugins.entries.louder-bridge.allow_tool_override"
    ) {
      cleanupReady = true;
    } else if (
      cleanupReady &&
      !replaced &&
      args[1][0] === "config" &&
      args[1][1] === "get"
    ) {
      replaced = true;
      fs.rmSync(files.target, { recursive: true });
      fs.mkdirSync(files.target);
      fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
    }
    return result;
  };

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run,
    }),
    /could not be fully rolled back/,
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
  assert.equal(
    readFakeConfig(files.config).get(
      "plugins.entries.louder-bridge.allow_tool_override",
    ),
    false,
  );
});

test("revalidates the installed plugin before reporting success", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes({}, files.config);
  let enabled = false;
  let replaced = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (args[1][0] === "plugins" && args[1][1] === "enable") {
      enabled = true;
    } else if (
      enabled &&
      !replaced &&
      args[1][0] === "config" &&
      args[1][1] === "get" &&
      args[1][2] === "plugins.entries.louder-bridge.allow_tool_override"
    ) {
      replaced = true;
      fs.rmSync(files.target, { recursive: true });
      fs.mkdirSync(files.target);
      fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
    }
    return result;
  };

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run,
    }),
    /could not be fully rolled back/,
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
});

test("verifies restored settings before removing an installed plugin", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes({}, files.config);
  let overrideUnsets = 0;
  let rollbackChanged = false;
  const run = async (...args) => {
    const isOverrideUnset =
      args[1][0] === "config" &&
      args[1][1] === "unset" &&
      args[1][2] === "plugins.entries.louder-bridge.allow_tool_override";
    try {
      return await hermes.run(...args);
    } finally {
      if (isOverrideUnset && ++overrideUnsets === 2) {
        rollbackChanged = true;
        writeFakeConfig(files.config, {
          "plugins.enabled": ["louder-bridge"],
          "plugins.entries.louder-bridge.allow_tool_override": false,
        });
      }
    }
  };
  const transaction = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run,
  });

  await assert.rejects(
    rollbackHermesPluginInstallation(transaction),
    /settings changed during rollback/,
  );

  assert.equal(rollbackChanged, true);
  assert.equal(fs.existsSync(files.target), true);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "louder-bridge",
  ]);
});

test("rejects a missing plugin before reporting setup success", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes({}, files.config);
  let enabled = false;
  let removed = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (args[1][0] === "plugins" && args[1][1] === "enable") {
      enabled = true;
    } else if (
      enabled &&
      !removed &&
      args[1][0] === "config" &&
      args[1][1] === "get" &&
      args[1][2] === "plugins.entries.louder-bridge.allow_tool_override"
    ) {
      removed = true;
      fs.rmSync(files.target, { recursive: true });
    }
    return result;
  };

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run,
    }),
    /managed Hermes plugin is missing/,
  );

  assert.equal(fs.existsSync(files.target), false);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), []);
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
      run: fakeHermes({}, files.config).run,
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
  }, files.config);

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
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
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

test("installs and removes the plugin for the active Hermes profile", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const profileConfig = path.join(
    files.root,
    ".hermes",
    "profiles",
    "writer",
    "config.yaml",
  );
  const target = hermesPluginPath(files.root, profileConfig);
  const existingPlugin = path.join(path.dirname(target), "existing-plugin");
  fs.mkdirSync(existingPlugin, { recursive: true });
  fs.writeFileSync(path.join(existingPlugin, "keep.txt"), "keep\n");
  const hermes = fakeHermes(
    { "plugins.enabled": ["existing-plugin"] },
    profileConfig,
  );

  const installation = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run: hermes.run,
  });

  assert.equal(installation.target, target);
  assert.equal(fs.existsSync(target), true);
  assert.equal(fs.existsSync(files.target), false);
  assert.equal(
    fs.readFileSync(path.join(existingPlugin, "keep.txt"), "utf8"),
    "keep\n",
  );
  commitHermesPluginInstallation(installation);

  const removal = await removeHermesPlugin({
    homeDirectory: files.root,
    hermes: "/hermes",
    run: hermes.run,
  });
  commitHermesPluginRemoval(removal);

  assert.equal(removal.target, target);
  assert.equal(fs.existsSync(target), false);
  assert.equal(
    fs.readFileSync(path.join(existingPlugin, "keep.txt"), "utf8"),
    "keep\n",
  );
});

test("pins install and rollback to the profile selected at startup", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const writerConfig = path.join(
    files.root,
    ".hermes",
    "profiles",
    "writer",
    "config.yaml",
  );
  const reviewerConfig = path.join(
    files.root,
    ".hermes",
    "profiles",
    "reviewer",
    "config.yaml",
  );
  const hermes = fakeHermes(
    { "plugins.enabled": ["writer-plugin"] },
    writerConfig,
  );
  hermes.setConfig(reviewerConfig, {
    "plugins.enabled": ["reviewer-plugin"],
  });
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (args[1][0] === "config" && args[1][1] === "path") {
      hermes.setActiveConfigPath(reviewerConfig);
    }
    return result;
  };

  const installation = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run,
  });

  const writer = hermes.configs.get(path.dirname(writerConfig));
  const reviewer = hermes.configs.get(path.dirname(reviewerConfig));
  assert.deepEqual(writer.get("plugins.enabled"), [
    "writer-plugin",
    "louder-bridge",
  ]);
  assert.deepEqual(reviewer.get("plugins.enabled"), ["reviewer-plugin"]);

  await rollbackHermesPluginInstallation(installation);
  assert.deepEqual(readFakeConfig(writerConfig).get("plugins.enabled"), [
    "writer-plugin",
  ]);
  assert.deepEqual(readFakeConfig(reviewerConfig).get("plugins.enabled"), [
    "reviewer-plugin",
  ]);
});

test("preserves unrelated config edits during install rollback", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes(
    { "plugins.enabled": ["existing-plugin"] },
    files.config,
  );
  const installation = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run: hermes.run,
  });
  const edited = Object.fromEntries(readFakeConfig(files.config));
  edited["model.provider"] = "work-provider";
  writeFakeConfig(files.config, edited);

  await rollbackHermesPluginInstallation(installation);

  const restored = readFakeConfig(files.config);
  assert.equal(restored.get("model.provider"), "work-provider");
  assert.deepEqual(restored.get("plugins.enabled"), ["existing-plugin"]);
  assert.equal(fs.existsSync(files.target), false);
});

test("preserves unrelated plugin edits during install rollback", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermes = fakeHermes(
    {
      "plugins.enabled": ["existing-plugin"],
      "plugins.disabled": ["disabled-plugin"],
    },
    files.config,
  );
  const installation = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run: hermes.run,
  });
  const edited = Object.fromEntries(readFakeConfig(files.config));
  edited["plugins.enabled"].push("concurrent-plugin");
  edited["plugins.disabled"].push("concurrent-disabled-plugin");
  writeFakeConfig(files.config, edited);

  await rollbackHermesPluginInstallation(installation);

  const restored = readFakeConfig(files.config);
  assert.deepEqual(restored.get("plugins.enabled"), [
    "existing-plugin",
    "concurrent-plugin",
  ]);
  assert.deepEqual(restored.get("plugins.disabled"), [
    "disabled-plugin",
    "concurrent-disabled-plugin",
  ]);
  assert.equal(fs.existsSync(files.target), false);
});

test("revalidates the installed plugin before rollback deletes it", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  fs.writeFileSync(path.join(files.target, "previous.txt"), "previous\n");
  const hermes = fakeHermes(
    { "plugins.enabled": ["louder-bridge"] },
    files.config,
  );
  let replaceDuringRollback = false;
  let replaced = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (
      replaceDuringRollback &&
      !replaced &&
      args[1][0] === "config" &&
      args[1][1] === "unset"
    ) {
      replaced = true;
      fs.rmSync(files.target, { recursive: true });
      fs.mkdirSync(files.target);
      fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
    }
    return result;
  };
  const installation = await installHermesPlugin({
    homeDirectory: files.root,
    source: files.source,
    hermes: "/hermes",
    run,
  });
  replaceDuringRollback = true;

  await assert.rejects(
    rollbackHermesPluginInstallation(installation),
    /does not own/,
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
  assert.equal(fs.existsSync(installation.backup), true);
});

test("removes managed plugins and settings from every Hermes profile", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const writerConfig = path.join(
    files.root,
    ".hermes",
    "profiles",
    "writer",
    "config.yaml",
  );
  const writerTarget = hermesPluginPath(files.root, writerConfig);
  for (const target of [files.target, writerTarget]) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, ".louder-bridge-owned"), "owned\n");
  }
  const hermes = fakeHermes(
    { "plugins.enabled": ["default-plugin", "louder-bridge"] },
    files.config,
  );
  hermes.setConfig(writerConfig, {
    "plugins.enabled": ["writer-plugin", "louder-bridge"],
    "plugins.entries.louder-bridge.allow_tool_override": false,
  });
  hermes.setActiveConfigPath(writerConfig);

  const removal = await removeHermesPlugin({
    homeDirectory: files.root,
    hermes: "/hermes",
    run: hermes.run,
  });

  assert.deepEqual(new Set(removal.targets), new Set([
    files.target,
    writerTarget,
  ]));
  assert.equal(fs.existsSync(files.target), false);
  assert.equal(fs.existsSync(writerTarget), false);
  assert.deepEqual(hermes.config.get("plugins.enabled"), ["default-plugin"]);
  assert.deepEqual(
    hermes.configs.get(path.dirname(writerConfig)).get("plugins.enabled"),
    ["writer-plugin"],
  );

  await rollbackHermesPluginRemoval(removal);
  assert.equal(fs.existsSync(files.target), true);
  assert.equal(fs.existsSync(writerTarget), true);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "default-plugin",
    "louder-bridge",
  ]);
  assert.deepEqual(
    readFakeConfig(writerConfig).get("plugins.enabled"),
    ["writer-plugin", "louder-bridge"],
  );
});

test("rechecks a restored plugin before replaying removal state", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  const hermes = fakeHermes({
    "plugins.enabled": ["louder-bridge"],
    "plugins.entries.louder-bridge.allow_tool_override": true,
  }, files.config);
  let rollbackStarted = false;
  let replaced = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (
      rollbackStarted &&
      !replaced &&
      args[1][0] === "config" &&
      args[1][1] === "get"
    ) {
      replaced = true;
      fs.rmSync(files.target, { recursive: true });
      fs.mkdirSync(files.target);
      fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
    }
    return result;
  };
  const transaction = await removeHermesPlugin({
    homeDirectory: files.root,
    hermes: "/hermes",
    run,
  });
  rollbackStarted = true;

  await assert.rejects(
    rollbackHermesPluginRemoval(transaction),
    (error) =>
      error instanceof AggregateError &&
      error.errors.some((cause) => /does not own/.test(cause.message)),
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), []);
});

test("leaves an unowned same-name plugin in another profile untouched", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const writerConfig = path.join(
    files.root,
    ".hermes",
    "profiles",
    "writer",
    "config.yaml",
  );
  const writerTarget = hermesPluginPath(files.root, writerConfig);
  for (const target of [files.target, writerTarget]) {
    fs.mkdirSync(target, { recursive: true });
  }
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  fs.writeFileSync(path.join(writerTarget, "unrelated.txt"), "keep\n");
  const hermes = fakeHermes(
    { "plugins.enabled": ["louder-bridge"] },
    files.config,
  );
  hermes.setConfig(writerConfig, {
    "plugins.enabled": ["louder-bridge"],
  });

  const removal = await removeHermesPlugin({
    homeDirectory: files.root,
    hermes: "/hermes",
    run: hermes.run,
  });

  assert.deepEqual(removal.targets, [files.target]);
  assert.equal(fs.existsSync(files.target), false);
  assert.equal(
    fs.readFileSync(path.join(writerTarget, "unrelated.txt"), "utf8"),
    "keep\n",
  );
  assert.deepEqual(readFakeConfig(writerConfig).get("plugins.enabled"), [
    "louder-bridge",
  ]);
  commitHermesPluginRemoval(removal);
});

test("attempts every profile rollback after a target conflict", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const writerConfig = path.join(
    files.root,
    ".hermes",
    "profiles",
    "writer",
    "config.yaml",
  );
  const writerTarget = hermesPluginPath(files.root, writerConfig);
  for (const target of [files.target, writerTarget]) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, ".louder-bridge-owned"), "owned\n");
  }
  const hermes = fakeHermes(
    { "plugins.enabled": ["louder-bridge"] },
    files.config,
  );
  hermes.setConfig(writerConfig, {
    "plugins.enabled": ["louder-bridge"],
  });
  const removal = await removeHermesPlugin({
    homeDirectory: files.root,
    hermes: "/hermes",
    run: hermes.run,
  });
  fs.mkdirSync(writerTarget);
  fs.writeFileSync(path.join(writerTarget, "new.txt"), "keep\n");

  await assert.rejects(
    rollbackHermesPluginRemoval(removal),
    /could not be fully rolled back/,
  );

  assert.equal(fs.existsSync(files.target), true);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "louder-bridge",
  ]);
  assert.equal(
    fs.readFileSync(path.join(writerTarget, "new.txt"), "utf8"),
    "keep\n",
  );
  assert.deepEqual(readFakeConfig(writerConfig).get("plugins.enabled"), []);
});

test("revalidates each profile target immediately before removal", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const writerConfig = path.join(
    files.root,
    ".hermes",
    "profiles",
    "writer",
    "config.yaml",
  );
  const writerTarget = hermesPluginPath(files.root, writerConfig);
  for (const target of [files.target, writerTarget]) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, ".louder-bridge-owned"), "owned\n");
  }
  const hermes = fakeHermes(
    { "plugins.enabled": ["louder-bridge"] },
    files.config,
  );
  hermes.setConfig(writerConfig, {
    "plugins.enabled": ["louder-bridge"],
  });
  let replaced = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    const hermesHome = args[2].env?.HERMES_HOME;
    if (
      !replaced &&
      hermesHome === path.dirname(files.config) &&
      args[1][0] === "config" &&
      args[1][1] === "unset"
    ) {
      replaced = true;
      fs.rmSync(writerTarget, { recursive: true });
      fs.mkdirSync(writerTarget);
      fs.writeFileSync(path.join(writerTarget, "unrelated.txt"), "keep\n");
    }
    return result;
  };

  await assert.rejects(
    removeHermesPlugin({
      homeDirectory: files.root,
      hermes: "/hermes",
      run,
    }),
    /does not own/,
  );

  assert.equal(fs.existsSync(files.target), true);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "louder-bridge",
  ]);
  assert.equal(
    fs.readFileSync(path.join(writerTarget, "unrelated.txt"), "utf8"),
    "keep\n",
  );
});

test("stops uninstall when a plugin list changes before indexed removal", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  const hermes = fakeHermes(
    { "plugins.enabled": ["louder-bridge", "existing-plugin"] },
    files.config,
  );
  let configReads = 0;
  const run = async (...args) => {
    const isConfigRead = args[1][0] === "config" && args[1][1] === "get";
    const readNumber = isConfigRead ? ++configReads : 0;
    try {
      return await hermes.run(...args);
    } finally {
      if (readNumber === 3) {
        const changed = Object.fromEntries(readFakeConfig(files.config));
        changed["plugins.enabled"].unshift("concurrent-plugin");
        writeFakeConfig(files.config, changed);
      }
    }
  };

  await assert.rejects(
    removeHermesPlugin({
      homeDirectory: files.root,
      hermes: "/hermes",
      run,
    }),
    /configuration changed during setup/,
  );

  assert.equal(fs.existsSync(files.target), true);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "concurrent-plugin",
    "louder-bridge",
    "existing-plugin",
  ]);
});

test("rolls uninstall back when Hermes re-enables the plugin", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  const hermes = fakeHermes(
    {
      "plugins.enabled": ["existing-plugin", "louder-bridge"],
      "plugins.entries.louder-bridge.allow_tool_override": false,
    },
    files.config,
  );
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (
      args[1][0] === "config" &&
      args[1][1] === "unset" &&
      args[1][2] === "plugins.entries.louder-bridge.allow_tool_override"
    ) {
      const changed = Object.fromEntries(readFakeConfig(files.config));
      changed["plugins.enabled"].push("louder-bridge");
      changed["plugins.entries.louder-bridge.allow_tool_override"] = false;
      writeFakeConfig(files.config, changed);
    }
    return result;
  };

  await assert.rejects(
    removeHermesPlugin({
      homeDirectory: files.root,
      hermes: "/hermes",
      run,
    }),
    /settings changed during removal/,
  );

  assert.equal(fs.existsSync(files.target), true);
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "existing-plugin",
    "louder-bridge",
  ]);
});

test("preserves a replacement during failed-removal rollback", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  fs.mkdirSync(files.target, { recursive: true });
  fs.writeFileSync(path.join(files.target, ".louder-bridge-owned"), "owned\n");
  const hermes = fakeHermes(
    { "plugins.enabled": ["louder-bridge"] },
    files.config,
  );
  let failed = false;
  const run = async (...args) => {
    const result = await hermes.run(...args);
    if (
      !failed &&
      args[1][0] === "config" &&
      args[1][1] === "unset"
    ) {
      failed = true;
      fs.mkdirSync(files.target);
      fs.writeFileSync(path.join(files.target, "unrelated.txt"), "keep\n");
      throw new Error("simulated removal failure");
    }
    return result;
  };

  await assert.rejects(
    removeHermesPlugin({
      homeDirectory: files.root,
      hermes: "/hermes",
      run,
    }),
    /could not be fully rolled back/,
  );

  assert.equal(
    fs.readFileSync(path.join(files.target, "unrelated.txt"), "utf8"),
    "keep\n",
  );
  assert.deepEqual(readFakeConfig(files.config).get("plugins.enabled"), [
    "louder-bridge",
  ]);
  const backups = fs
    .readdirSync(path.dirname(files.target))
    .filter((name) => name.endsWith(".removing"));
  assert.equal(backups.length, 1);
});

test("rejects an active Hermes config outside the user Hermes directory", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run: fakeHermes({}, path.join(files.root, "other", "config.yaml")).run,
    }),
    /outside the expected Hermes directory/,
  );
  assert.equal(fs.existsSync(files.target), false);
});

test("rejects a named Hermes profile reached through a symbolic link", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const hermesDirectory = path.join(files.root, ".hermes");
  const realProfiles = path.join(hermesDirectory, "real-profiles");
  const profiles = path.join(hermesDirectory, "profiles");
  const writer = path.join(realProfiles, "writer");
  const profileConfig = path.join(profiles, "writer", "config.yaml");
  fs.mkdirSync(writer, { recursive: true });
  fs.symlinkSync(realProfiles, profiles);
  const hermes = fakeHermes({}, profileConfig);

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run: hermes.run,
    }),
    /profile uses a symbolic link/,
  );
  assert.equal(fs.existsSync(hermesPluginPath(files.root, profileConfig)), false);
});

test("rejects a symbolic link used as the active Hermes profile", async (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.root, { recursive: true }));
  const profiles = path.join(files.root, ".hermes", "profiles");
  const realWriter = path.join(files.root, ".hermes", "real-writer");
  const writer = path.join(profiles, "writer");
  const profileConfig = path.join(writer, "config.yaml");
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(realWriter);
  fs.symlinkSync(realWriter, writer);
  const hermes = fakeHermes({}, profileConfig);

  await assert.rejects(
    installHermesPlugin({
      homeDirectory: files.root,
      source: files.source,
      hermes: "/hermes",
      run: hermes.run,
    }),
    /profile uses a symbolic link/,
  );
  assert.equal(fs.existsSync(hermesPluginPath(files.root, profileConfig)), false);
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
