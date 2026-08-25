import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opencode = path.join(root, "node_modules", ".bin", "opencode");
const pluginURL = pathToFileURL(root).href;

function resolvedConfig(config) {
  const temp = mkdtempSync(path.join(tmpdir(), "sprites-opencode-test-"));
  try {
    const result = spawnSync(opencode, ["debug", "config"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        XDG_CACHE_HOME: path.join(temp, "cache"),
        XDG_CONFIG_HOME: path.join(temp, "config"),
        XDG_DATA_HOME: path.join(temp, "data"),
        XDG_STATE_HOME: path.join(temp, "state"),
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test("OpenCode accepts the default MCP, command, and normalized permission config", () => {
  const config = resolvedConfig({
    plugin: [[pluginURL, { url: "http://127.0.0.1:9/mcp", timeout: 100 }]],
    permission: "allow",
  });

  assert.equal(config.mcp.sprites.type, "remote");
  assert.equal(config.mcp.sprites.url, "http://127.0.0.1:9/mcp");
  assert.match(
    config.command["sprites-status"].template,
    /sprites_list_sprites/,
  );
  assert.equal(config.permission["*"], "allow");
  assert.equal(config.permission["sprites_*destroy_sprite"], "ask");
  assert.equal(config.permission["sprites_*checkpoint_restore"], "ask");
});

test("OpenCode passes inline plugin options to the preferred v1 entrypoint", () => {
  const config = resolvedConfig({
    plugin: [
      [
        pluginURL,
        {
          mcpName: "sprites-staging",
          url: "http://127.0.0.1:9/staging-mcp",
          timeout: 100,
          commands: false,
          guidance: false,
          permissions: false,
        },
      ],
    ],
  });

  assert.equal(
    config.mcp["sprites-staging"].url,
    "http://127.0.0.1:9/staging-mcp",
  );
  assert.equal(config.command?.["sprites-status"], undefined);
  assert.equal(
    config.permission?.["sprites-staging_*destroy_sprite"],
    undefined,
  );
});
