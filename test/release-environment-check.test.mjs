import test from "node:test";
import assert from "node:assert/strict";
import {
  checkReleaseEnvironment,
} from "../scripts/release-environment-check.mjs";

function response(stdout, status = 0) {
  return { status, stdout: `${JSON.stringify(stdout)}\n`, stderr: "" };
}

function scripted(responses) {
  const calls = [];
  return {
    calls,
    execute(args) {
      calls.push(args);
      const next = responses.shift();
      assert.ok(next, `Unexpected gh call: ${args.join(" ")}`);
      return next;
    },
  };
}

const releaseSecrets = [
  "MACOS_CERTIFICATE",
  "MACOS_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER_ID",
  "APPLE_NOTARY_PRIVATE_KEY",
];

test("accepts a reviewed production environment restricted to release tags", () => {
  const gh = scripted([
    response({ nameWithOwner: "vxcozy/louder-bridge" }),
    response({
      canAdminsBypass: false,
      customPolicies: true,
      reviewers: ["vxcozy"],
    }),
    response({ policies: [{ name: "v*", type: "tag" }] }),
    response({ names: releaseSecrets }),
  ]);

  assert.deepEqual(checkReleaseEnvironment({ execute: gh.execute }), {
    repository: "vxcozy/louder-bridge",
    environment: "production",
    reviewers: ["vxcozy"],
    secretCount: 7,
  });
  assert.equal(gh.calls.length, 4);
  assert.deepEqual(gh.calls[0], ["repo", "view", "--json", "nameWithOwner"]);
  assert.deepEqual(gh.calls[3], [
    "api",
    "repos/vxcozy/louder-bridge/environments/production/secrets?per_page=100",
    "--jq",
    "{names: [.secrets[].name]}",
  ]);
});

test("reports every missing production protection", () => {
  const gh = scripted([
    response({ nameWithOwner: "vxcozy/louder-bridge" }),
    response({
      canAdminsBypass: true,
      customPolicies: false,
      reviewers: [],
    }),
    response({ policies: [{ name: "v*", type: "branch" }] }),
    response({ names: [] }),
  ]);

  assert.throws(
    () => checkReleaseEnvironment({ execute: gh.execute }),
    (error) => {
      assert.equal(error.name, "AggregateError");
      assert.deepEqual(
        error.errors.map((failure) => failure.message),
        [
          "Add a required reviewer to the production environment.",
          "Disable administrator bypass at https://github.com/vxcozy/louder-bridge/settings/environments.",
          "Enable custom deployment branch and tag policies.",
          "Add a v* deployment policy for tags.",
          `Add the missing production environment secrets: ${releaseSecrets.join(", ")}.`,
        ],
      );
      return true;
    },
  );
});

test("reports only missing release secret names", () => {
  const gh = scripted([
    response({ nameWithOwner: "vxcozy/louder-bridge" }),
    response({
      canAdminsBypass: false,
      customPolicies: true,
      reviewers: ["vxcozy"],
    }),
    response({ policies: [{ name: "v*", type: "tag" }] }),
    response({ names: releaseSecrets.slice(0, -2) }),
  ]);

  assert.throws(
    () => checkReleaseEnvironment({ execute: gh.execute }),
    (error) => {
      assert.deepEqual(
        error.errors.map((failure) => failure.message),
        [
          "Add the missing production environment secrets: APPLE_NOTARY_ISSUER_ID, APPLE_NOTARY_PRIVATE_KEY.",
        ],
      );
      return true;
    },
  );
});

test("does not treat GitHub API failures as missing protection", () => {
  const gh = scripted([
    response({ nameWithOwner: "vxcozy/louder-bridge" }),
    { status: 1, stdout: "", stderr: "gh: Forbidden (HTTP 403)" },
  ]);

  assert.throws(
    () => checkReleaseEnvironment({ execute: gh.execute }),
    /HTTP 403/,
  );
  assert.equal(gh.calls.length, 2);
});
