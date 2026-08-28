import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opencode = path.join(root, "node_modules", ".bin", "opencode2");

// These tests drive the real OpenCode 2 background service. `npm ci` installs
// that binary, so a missing binary is a failure, not a skip: a silent skip
// would let `npm run check` pass while nothing runs against the real runtime.
// Set SPRITES_SKIP_OPENCODE_TESTS to opt out on purpose.
const optOut = process.env.SPRITES_SKIP_OPENCODE_TESTS
  ? "SPRITES_SKIP_OPENCODE_TESTS is set"
  : false;

function requireOpenCode() {
  assert.ok(
    existsSync(opencode),
    `OpenCode 2 is not installed at ${opencode}. Run npm ci, or set SPRITES_SKIP_OPENCODE_TESTS=1 to skip these tests.`,
  );
}

/** Reserves a port so an isolated service does not collide with a running one. */
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (
    server.address()
  );
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startWorkspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "sprites-opencode2-"));
  const environment = {
    ...process.env,
    XDG_CACHE_HOME: path.join(directory, ".xdg", "cache"),
    XDG_CONFIG_HOME: path.join(directory, ".xdg", "config"),
    XDG_DATA_HOME: path.join(directory, ".xdg", "data"),
    XDG_STATE_HOME: path.join(directory, ".xdg", "state"),
  };

  const run = (args, timeout = 120_000) =>
    spawnSync(opencode, args, {
      cwd: directory,
      encoding: "utf8",
      timeout,
      env: environment,
    });

  // The plugin points at a closed port, so the server reaches a failed state
  // quickly without any network access.
  const port = await freePort();
  writeFileSync(
    path.join(directory, "opencode.jsonc"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      plugins: [
        {
          package: root,
          options: {
            url: `http://127.0.0.1:${port}/mcp`,
            oauth: false,
            timeout: { startup: 1_000, catalog: 1_000 },
          },
        },
      ],
    }),
  );

  run(["service", "set", "port", String(await freePort())]);
  t.after(() => {
    run(["service", "stop"], 30_000);
    rmSync(directory, { recursive: true, force: true });
  });

  return { directory, run };
}

/** Polls until the location finishes loading its plugins. */
async function until(check, attempts = 12) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = check();
    if (last !== undefined) return last;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return last;
}

test(
  "OpenCode 2 registers the plugin's MCP server",
  { skip: optOut },
  async (t) => {
    requireOpenCode();
    const { run } = await startWorkspace(t);

    const output = await until(() => {
      const result = run(["mcp", "list"]);
      return result.stdout?.includes("sprites") ? result.stdout : undefined;
    });

    assert.match(output ?? "", /sprites/);
  },
);

test(
  "OpenCode 2 registers the Sprites commands",
  { skip: optOut },
  async (t) => {
    requireOpenCode();
    const { directory, run } = await startWorkspace(t);
    const query = `/api/command?location[directory]=${directory}`;

    const commands = await until(() => {
      const result = run(["api", "GET", query]);
      try {
        const names = JSON.parse(result.stdout).data.map(
          (/** @type {{name: string}} */ command) => command.name,
        );
        return names.includes("sprites-status") ? names : undefined;
      } catch {
        return undefined;
      }
    });

    assert.ok(commands?.includes("sprites-status"), JSON.stringify(commands));
    assert.ok(commands?.includes("sprites-smoke"), JSON.stringify(commands));
  },
);
