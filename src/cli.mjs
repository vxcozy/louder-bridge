#!/usr/bin/env node

try {
  await import("./cli-command.mjs");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Louder Bridge failed: ${message}`);
  process.exitCode = 1;
}
