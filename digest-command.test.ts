import { strict as assert } from "node:assert";
import { test } from "node:test";

import { nodeRuntime, parseCommand, runDigestCommand } from "./digest-command.js";

const NO_ENV = { electron: false, execPath: "/n/node", env: {}, exists: () => false };

type Call = { file: string; args: string[]; env: NodeJS.ProcessEnv };

function recorder(calls: Call[]) {
  return async (file: string, args: string[], env: NodeJS.ProcessEnv) => {
    calls.push({ file, args, env });
  };
}

test("parseCommand splits on spaces and keeps double-quoted text together", () => {
  assert.deepEqual(parseCommand("  /a/digest.mjs  prefs digest "), ["/a/digest.mjs", "prefs", "digest"]);
  assert.deepEqual(parseCommand('"/Users/me/My Tools/digest.mjs" prefs'), ["/Users/me/My Tools/digest.mjs", "prefs"]);
  assert.deepEqual(parseCommand(""), []);
  assert.deepEqual(parseCommand("   "), []);
});

test("runDigestCommand runs a script with node and keeps the environment", async () => {
  const calls: Call[] = [];
  await runDigestCommand("/tools/digest.mjs prefs digest", {
    node: "/n/node",
    baseEnv: { PATH: "/x", BB_CLI: "/custom/bb" },
    bbCli: "/data/bin/bb",
    run: recorder(calls),
    log: () => assert.fail("no log expected"),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.file, "/n/node");
  assert.deepEqual(calls[0]!.args, ["/tools/digest.mjs", "prefs", "digest"]);
  // An existing BB_CLI wins over the server's guess.
  assert.equal(calls[0]!.env.BB_CLI, "/custom/bb");
  assert.equal(calls[0]!.env.PATH, "/x");
});

test("runDigestCommand runs any other program as it is and sets BB_CLI when missing", async () => {
  const calls: Call[] = [];
  await runDigestCommand("/usr/local/bin/rebuild-digest --quiet", {
    node: "/n/node",
    baseEnv: {},
    bbCli: "/data/bin/bb",
    run: recorder(calls),
  });
  assert.equal(calls[0]!.file, "/usr/local/bin/rebuild-digest");
  assert.deepEqual(calls[0]!.args, ["--quiet"]);
  assert.equal(calls[0]!.env.BB_CLI, "/data/bin/bb");
});

test("runDigestCommand leaves BB_CLI unset when nothing names it", async () => {
  const calls: Call[] = [];
  await runDigestCommand("script.cjs", { node: "/n/node", baseEnv: {}, run: recorder(calls) });
  assert.equal(calls[0]!.file, "/n/node");
  assert.equal("BB_CLI" in calls[0]!.env, false);
});

test("runDigestCommand does nothing for a blank command", async () => {
  const calls: Call[] = [];
  await runDigestCommand("  ", { node: "/n/node", run: recorder(calls) });
  assert.equal(calls.length, 0);
});

test("runDigestCommand logs and ignores a failing run", async () => {
  const logged: string[] = [];
  await runDigestCommand("/tools/digest.mjs prefs digest", {
    node: "/n/node",
    run: async () => {
      throw new Error("ENOENT digest.mjs");
    },
    log: (message) => logged.push(message),
  });
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /digest command failed.*ENOENT digest\.mjs/);
});

test("nodeRuntime is the server's own node outside Electron", () => {
  assert.equal(nodeRuntime(NO_ENV), "/n/node");
});

test("nodeRuntime under Electron prefers BB_NODE, then an installed node", () => {
  const electron = { ...NO_ENV, electron: true };
  assert.equal(nodeRuntime({ ...electron, env: { BB_NODE: "/mine/node" } }), "/mine/node");
  assert.equal(
    nodeRuntime({ ...electron, exists: (p) => p === "/usr/local/bin/node" }),
    "/usr/local/bin/node",
  );
  assert.equal(nodeRuntime({ ...electron, exists: () => true }), "/opt/homebrew/bin/node");
  assert.equal(nodeRuntime(electron), "node");
});
