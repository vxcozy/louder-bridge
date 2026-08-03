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

test("accepts a reviewed production environment restricted to release tags", () => {
  const gh = scripted([
    response({ nameWithOwner: "vxcozy/louder-bridge" }),
    response({
      canAdminsBypass: false,
      customPolicies: true,
      reviewers: ["vxcozy"],
    }),
    response({ policies: [{ name: "v*", type: "tag" }] }),
  ]);

  assert.deepEqual(checkReleaseEnvironment({ execute: gh.execute }), {
    repository: "vxcozy/louder-bridge",
    environment: "production",
    reviewers: ["vxcozy"],
  });
  assert.equal(gh.calls.length, 3);
  assert.deepEqual(gh.calls[0], ["repo", "view", "--json", "nameWithOwner"]);
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
