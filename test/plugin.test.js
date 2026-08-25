import assert from "node:assert/strict";
import test from "node:test";
import { createOpencodeClient } from "@opencode-ai/sdk";

import plugin from "../index.js";

function fakeClient(status = "connected", onStatus = () => {}) {
  return createOpencodeClient({
    baseUrl: "http://opencode.test",
    fetch: async () => {
      onStatus();
      return new Response(JSON.stringify({ sprites: { status } }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
}

async function hooksFor(options, status, onStatus) {
  return plugin.server(
    {
      client: fakeClient(status, onStatus),
      directory: "/work",
    },
    options,
  );
}

function sessionInfo(id, parentID) {
  return {
    id,
    projectID: "test-project",
    directory: "/work",
    parentID,
    title: "Test session",
    version: "1.18.23",
    time: { created: 0, updated: 0 },
  };
}

test("exports the preferred OpenCode v1 plugin module", () => {
  assert.equal(plugin.id, "sprites");
  assert.equal(typeof plugin.server, "function");
  assert.deepEqual(Object.keys(plugin).sort(), ["id", "server"]);
});

test("registers the MCP server, commands, and destructive-tool approvals", async () => {
  const hooks = await hooksFor();
  const config = {};

  await hooks.config(config);

  assert.deepEqual(config.mcp.sprites, {
    type: "remote",
    url: "https://sprites.dev/mcp",
    enabled: true,
    oauth: {},
    headers: {
      "Fly-Client-Interactive": "false",
      "Fly-Client-Agent": "opencode",
    },
    timeout: 60_000,
  });
  assert.match(
    config.command["sprites-status"].template,
    /sprites_list_sprites/,
  );
  assert.match(config.command["sprites-smoke"].template, /\$ARGUMENTS/);
  assert.equal(config.permission["sprites_*destroy_sprite"], "ask");
  assert.equal(config.permission["sprites_*checkpoint_restore"], "ask");
  assert.equal(config.permission["sprites_*policy_network_update"], "ask");
});

test("preserves user-owned server, commands, and exact permission rules", async () => {
  const hooks = await hooksFor();
  const server = {
    type: "remote",
    url: "https://example.test/mcp",
    enabled: true,
  };
  const command = { template: "my status workflow" };
  const config = {
    mcp: { sprites: server },
    command: { "sprites-status": command },
    permission: {
      "*": "allow",
      sprites_destroy_sprite: "deny",
    },
  };

  await hooks.config(config);

  assert.equal(config.mcp.sprites, server);
  assert.equal(config.command["sprites-status"], command);
  assert.equal(config.permission.sprites_destroy_sprite, "deny");
  assert.equal(config.permission["sprites_*checkpoint_restore"], "ask");
  assert.ok(
    Object.keys(config.permission).indexOf("sprites_*destroy_sprite") <
      Object.keys(config.permission).indexOf("sprites_destroy_sprite"),
  );
});

test("mutates permission objects and narrows broad allows while preserving global deny", async () => {
  const allowHooks = await hooksFor();
  const permission = { "*": "allow", "sprites_*": "allow" };
  const allow = { permission };
  await allowHooks.config(allow);
  assert.equal(allow.permission, permission);
  assert.equal(allow.permission["*"], "allow");
  assert.equal(allow.permission["sprites_*"], "allow");
  assert.equal(allow.permission["sprites_*destroy_sprite"], "ask");

  const denyHooks = await hooksFor();
  const deny = { permission: { "*": "deny" } };
  await denyHooks.config(deny);
  assert.deepEqual(deny.permission, { "*": "deny" });
});

test("supports custom MCP settings and optional features", async () => {
  const hooks = await hooksFor({
    mcpName: "sprites-staging",
    url: "https://staging.example.test/mcp",
    timeout: 15_000,
    headers: { "X-Test": "yes" },
    commands: false,
    guidance: false,
    permissions: false,
  });
  const config = {};

  await hooks.config(config);

  assert.equal(
    config.mcp["sprites-staging"].url,
    "https://staging.example.test/mcp",
  );
  assert.equal(config.mcp["sprites-staging"].timeout, 15_000);
  assert.equal(config.mcp["sprites-staging"].headers["X-Test"], "yes");
  assert.equal(config.command, undefined);
  assert.equal(config.permission, undefined);
});

test("injects guidance only for relevant, session-bound requests", async () => {
  const hooks = await hooksFor();
  await hooks.config({});

  const unrelated = { system: [] };
  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "unrelated" },
    unrelated,
  );
  assert.deepEqual(unrelated.system, []);

  await hooks["chat.message"](
    { sessionID: "sprite-session" },
    {
      parts: [
        { type: "text", text: "Create an environment through sprites.dev" },
      ],
    },
  );
  const generatedAgent = { system: [] };
  await hooks["experimental.chat.system.transform"](
    { model: {} },
    generatedAgent,
  );
  assert.deepEqual(generatedAgent.system, []);

  const relevant = { system: [] };
  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "sprite-session" },
    relevant,
  );
  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "sprite-session" },
    relevant,
  );
  assert.equal(relevant.system.length, 1);
  assert.match(relevant.system[0], /destroy_sprite.*irreversible/s);
  assert.match(
    relevant.system[0],
    /policy_network_update.*replaces the complete/s,
  );
});

test("does not activate for 2D graphics or generic remote environments", async () => {
  const hooks = await hooksFor();
  await hooks.config({});

  for (const [index, text] of [
    "Optimize this sprite sheet",
    "Fix the CSS sprites",
    "Preview the sprite animation",
    "Use a remote development environment",
    "Deploy this application to Fly.io",
  ].entries()) {
    const sessionID = `graphics-${index}`;
    await hooks["chat.message"](
      { sessionID },
      { parts: [{ type: "text", text }] },
    );
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"](
      { model: {}, sessionID },
      output,
    );
    assert.deepEqual(output.system, []);
  }
});

test("sprites.dev, fly sprites, textual tool IDs, and slash commands activate guidance", async () => {
  const hooks = await hooksFor();
  await hooks.config({});

  const prompts = [
    "Create this through sprites.dev",
    "Use fly sprites for the build",
    "Call sprites_list_sprites first",
  ];
  for (const [index, text] of prompts.entries()) {
    const sessionID = `signal-${index}`;
    await hooks["chat.message"](
      { sessionID },
      { parts: [{ type: "text", text }] },
    );
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"](
      { model: {}, sessionID },
      output,
    );
    assert.equal(output.system.length, 1);
  }

  await hooks["command.execute.before"](
    { command: "sprites-status", sessionID: "command-session" },
    { parts: [] },
  );
  const commandOutput = { system: [] };
  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "command-session" },
    commandOutput,
  );
  assert.equal(commandOutput.system.length, 1);
});

test("a Sprites tool call activates guidance for its session", async () => {
  const hooks = await hooksFor();
  await hooks.config({});
  await hooks["tool.execute.before"]({
    tool: "sprites_list_sprites",
    sessionID: "tool-session",
  });
  const output = { system: [] };

  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "tool-session" },
    output,
  );

  assert.equal(output.system.length, 1);
});

test("active parent sessions propagate guidance to sub-sessions", async () => {
  const hooks = await hooksFor();
  await hooks.config({});
  await hooks["chat.message"](
    { sessionID: "parent" },
    { parts: [{ type: "text", text: "Use sprites.dev for this task" }] },
  );
  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: sessionInfo("child", "parent") },
    },
  });
  const output = { system: [] };

  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "child" },
    output,
  );

  assert.equal(output.system.length, 1);

  await hooks.event({
    event: {
      type: "session.deleted",
      properties: { info: sessionInfo("child", "parent") },
    },
  });
  const deletedOutput = { system: [] };
  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "child" },
    deletedOutput,
  );
  assert.deepEqual(deletedOutput.system, []);
});

test("disabled MCP state suppresses guidance", async () => {
  const hooks = await hooksFor(undefined, "disabled");
  await hooks.config({});
  await hooks["chat.message"](
    { sessionID: "disabled-session" },
    { parts: [{ type: "text", text: "Call sprites_list_sprites" }] },
  );
  const output = { system: [] };

  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "disabled-session" },
    output,
  );

  assert.deepEqual(output.system, []);
});

test("caches MCP status for 30 seconds and invalidates on tool changes", async () => {
  let statusCalls = 0;
  const hooks = await hooksFor(undefined, "connected", () => statusCalls++);
  await hooks.config({});
  await hooks["tool.execute.before"](
    {
      tool: "sprites_list_sprites",
      sessionID: "cache-session",
      callID: "call-1",
    },
    { args: {} },
  );

  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "cache-session" },
    { system: [] },
  );
  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "cache-session" },
    { system: [] },
  );
  assert.equal(statusCalls, 1);

  await hooks.event({
    event: {
      type: "mcp.tools.changed",
      properties: { server: "sprites" },
    },
  });
  await hooks["experimental.chat.system.transform"](
    { model: {}, sessionID: "cache-session" },
    { system: [] },
  );
  assert.equal(statusCalls, 2);
});

test("preserves active Sprites state across compaction", async () => {
  const hooks = await hooksFor();
  await hooks.config({});
  await hooks["chat.message"](
    { sessionID: "sprite-session" },
    { parts: [{ type: "text", text: "Use fly sprites for this task" }] },
  );
  const output = { context: [], prompt: undefined };

  await hooks["experimental.session.compacting"](
    { sessionID: "sprite-session" },
    output,
  );
  await hooks["experimental.session.compacting"](
    { sessionID: "sprite-session" },
    output,
  );

  assert.equal(output.context.length, 1);
  assert.match(output.context[0], /checkpoint IDs/);
});

test("rejects malformed plugin options", async () => {
  await assert.rejects(() => hooksFor({ timeout: 0 }), /positive integer/);
  await assert.rejects(
    () => hooksFor({ url: "file:///tmp/mcp" }),
    /http or https/,
  );
  await assert.rejects(() => hooksFor({ commands: "no" }), /must be a boolean/);
});
