import assert from "node:assert/strict";
import test from "node:test";

// Node resolves a package's own name through its exports map, so these are the
// same specifiers OpenCode uses. OpenCode 1 loads "./server" and OpenCode 2
// loads ".".
const NAME = "@flydotio/sprites-opencode-plugin";

test("the package root is the OpenCode 2 plugin", async () => {
  const { default: plugin } = await import(NAME);

  assert.equal(plugin.id, "sprites");
  assert.equal(typeof plugin.setup, "function");
  assert.equal(plugin.server, undefined);
});

test("the server export is the OpenCode 1 plugin", async () => {
  const { default: plugin } = await import(`${NAME}/server`);

  assert.equal(plugin.id, "sprites");
  assert.equal(typeof plugin.server, "function");
  assert.equal(plugin.setup, undefined);
});

test("both entry points describe the same Sprites rules", async () => {
  const [{ default: v2 }, { default: v1 }] = await Promise.all([
    import(NAME),
    import(`${NAME}/server`),
  ]);
  const shared = await import("../src/shared.js");

  assert.equal(v1.id, v2.id);
  for (const rawName of Object.keys(shared.RISKY_RAW_TOOLS)) {
    assert.match(
      shared.systemGuidance("sprites"),
      new RegExp(shared.toolName("sprites", rawName)),
    );
  }
});
