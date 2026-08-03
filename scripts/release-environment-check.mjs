#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REQUIRED_RELEASE_CREDENTIALS } from "./release-credential-names.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function commandFailure(args, result) {
  const detail =
    result.error?.message ||
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    `exit ${result.status ?? "unknown"}`;
  return new Error(`GitHub CLI failed (${args.join(" ")}): ${detail}`);
}

export function runGitHub(args, { cwd = root } = {}) {
  const result = spawnSync("gh", args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function runJson(execute, args, label) {
  const result = execute(args);
  if (result.status !== 0) throw commandFailure(args, result);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`GitHub returned invalid ${label}: ${error.message}`);
  }
}

export function checkReleaseEnvironment({
  environment = "production",
  execute = runGitHub,
} = {}) {
  if (!/^[A-Za-z0-9_.-]+$/.test(environment)) {
    throw new Error("The GitHub environment name is invalid.");
  }
  const repository = runJson(
    execute,
    ["repo", "view", "--json", "nameWithOwner"],
    "repository metadata",
  ).nameWithOwner;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GitHub did not identify the current repository.");
  }

  const endpoint = `repos/${repository}/environments/${encodeURIComponent(environment)}`;
  const settings = runJson(
    execute,
    [
      "api",
      endpoint,
      "--jq",
      "{canAdminsBypass: .can_admins_bypass, customPolicies: .deployment_branch_policy.custom_branch_policies, reviewers: [.protection_rules[] | select(.type == \"required_reviewers\") | .reviewers[]?.reviewer.login]}",
    ],
    "environment metadata",
  );
  const policies = runJson(
    execute,
    [
      "api",
      `${endpoint}/deployment-branch-policies`,
      "--jq",
      "{policies: [.branch_policies[] | {name: .name, type: .type}]}",
    ],
    "deployment policy metadata",
  );
  const secrets = runJson(
    execute,
    [
      "api",
      `${endpoint}/secrets?per_page=100`,
      "--jq",
      "{names: [.secrets[].name]}",
    ],
    "environment secret metadata",
  );

  const failures = [];
  if (!Array.isArray(settings.reviewers) || settings.reviewers.length === 0) {
    failures.push("Add a required reviewer to the production environment.");
  }
  if (settings.canAdminsBypass !== false) {
    failures.push(
      `Disable administrator bypass at https://github.com/${repository}/settings/environments.`,
    );
  }
  if (settings.customPolicies !== true) {
    failures.push("Enable custom deployment branch and tag policies.");
  }
  if (
    !Array.isArray(policies.policies) ||
    !policies.policies.some(
      (policy) => policy?.name === "v*" && policy?.type === "tag",
    )
  ) {
    failures.push("Add a v* deployment policy for tags.");
  }
  const configuredSecrets = new Set(
    Array.isArray(secrets.names) ? secrets.names : [],
  );
  const missingSecrets = REQUIRED_RELEASE_CREDENTIALS.filter(
    (name) => !configuredSecrets.has(name),
  );
  if (missingSecrets.length > 0) {
    failures.push(
      `Add the missing production environment secrets: ${missingSecrets.join(", ")}.`,
    );
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((message) => new Error(message)),
      "The production release environment needs attention.",
    );
  }
  return {
    repository,
    environment,
    reviewers: settings.reviewers,
    secretCount: REQUIRED_RELEASE_CREDENTIALS.length,
  };
}

function isMainModule() {
  return (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  try {
    const result = checkReleaseEnvironment();
    console.log(
      `Release environment ready for ${result.repository} (${result.reviewers.join(", ")}; ${result.secretCount} release secrets configured).`,
    );
  } catch (error) {
    console.error(error.message);
    for (const failure of error.errors ?? []) {
      console.error(`- ${failure.message}`);
    }
    process.exitCode = 1;
  }
}
