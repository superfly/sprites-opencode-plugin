import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../src/v2.js";
import { createContext } from "./context.js";

async function setup(options, overrides) {
  const harness = createContext({ options, ...overrides });
  const cleanup = await plugin.setup(harness.ctx);
  return { ...harness, cleanup };
}

function sessionCreated(sessionID, parentID) {
  return {
    type: "session.created",
    id: `evt-${sessionID}`,
    created: 0,
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: {
      sessionID,
      parentID,
      projectID: "test",
      location: { directory: "/work" },
      slug: sessionID,
      version: "0.0.0-test",
    },
  };
}

test("exports an OpenCode v2 plugin", () => {
  assert.equal(plugin.id, "sprites");
  assert.equal(typeof plugin.setup, "function");
  assert.deepEqual(Object.keys(plugin).sort(), ["id", "setup"]);
});

test("registers the Sprites MCP server", async () => {
  const { servers } = await setup();

  assert.deepEqual(servers().get("sprites"), {
    type: "remote",
    url: "https://sprites.dev/mcp",
    headers: {
      "Fly-Client-Interactive": "false",
      "Fly-Client-Agent": "opencode",
    },
    // Code Mode reaches MCP tools through a dispatcher, and the Sprites MCP
    // server does not support that call shape yet.
    codemode: false,
  });
});

test("keeps Code Mode off unless it is asked for", async () => {
  const off = await setup();
  assert.equal(off.servers().get("sprites").codemode, false);

  const on = await setup({ codemode: true });
  assert.equal(on.servers().get("sprites").codemode, true);
});

test("supports custom MCP settings and optional features", async () => {
  const { servers, commands, ctx, has } = await setup({
    mcpName: "sprites-staging",
    url: "https://staging.example.test/mcp",
    timeout: 15_000,
    headers: { "X-Test": "yes" },
    oauth: false,
    codemode: false,
    commands: false,
    guidance: false,
    permissions: false,
  });

  assert.deepEqual(servers().get("sprites-staging"), {
    type: "remote",
    url: "https://staging.example.test/mcp",
    headers: {
      "Fly-Client-Interactive": "false",
      "Fly-Client-Agent": "opencode",
      "X-Test": "yes",
    },
    oauth: false,
    codemode: false,
    timeout: { startup: 15_000, catalog: 15_000 },
  });
  assert.deepEqual(commands(), []);
  assert.equal(has("session.context"), false);
  assert.equal(has("permission.evaluate"), false);
  assert.equal(ctx.options.mcpName, "sprites-staging");
});

test("accepts separate v2 timeouts and OAuth client settings", async () => {
  const { servers } = await setup({
    timeout: { catalog: 45_000, execution: 600_000 },
    oauth: { client_id: "abc", callback_port: 19876 },
  });

  const server = servers().get("sprites");
  assert.deepEqual(server.timeout, { catalog: 45_000, execution: 600_000 });
  assert.deepEqual(server.oauth, { client_id: "abc", callback_port: 19876 });
});

test("leaves a server that configuration already defines untouched", async () => {
  const existing = { type: "remote", url: "https://example.test/mcp" };
  const { servers } = await setup(undefined, {
    servers: { sprites: existing },
  });

  assert.equal(servers().get("sprites"), existing);
});

test("skips MCP registration when mcp is false", async () => {
  const { servers } = await setup({ mcp: false });

  assert.equal(servers().size, 0);
});

test("registers commands that prompt the session", async () => {
  const harness = await setup();
  const status = harness.command("sprites-status");
  const smoke = harness.command("sprites-smoke");

  assert.equal(
    status.description,
    "Check Sprites connectivity and list visible environments",
  );
  assert.ok(smoke);

  await status.execute({
    sessionID: "cmd",
    prompt: { text: "" },
    delivery: "steer",
  });
  await smoke.execute({
    sessionID: "cmd",
    prompt: {
      text: "use a big Sprite",
      files: [
        { uri: "file:///note.md", mention: { start: 0, end: 1, text: "" } },
      ],
    },
    delivery: "queue",
  });

  assert.match(harness.prompts[0].text, /sprites_list_sprites/);
  assert.equal(harness.prompts[0].delivery, "steer");
  assert.match(harness.prompts[1].text, /Additional request: use a big Sprite/);
  assert.equal(harness.prompts[1].delivery, "queue");
  assert.deepEqual(harness.prompts[1].files, [{ uri: "file:///note.md" }]);
});

test("a prompt with no attachments omits the attachment keys", async () => {
  // Prompt validation rejects an explicit undefined, so an empty attachment
  // list must not appear as a key at all.
  const harness = await setup();

  await harness
    .command("sprites-status")
    .execute({ sessionID: "cmd", prompt: { text: "" }, delivery: "steer" });

  const [input] = harness.prompts;
  for (const key of ["files", "agents", "skills"]) {
    assert.equal(key in input, false, key);
  }
  assert.deepEqual(Object.keys(input).sort(), [
    "delivery",
    "sessionID",
    "text",
  ]);
});

test("a command run marks its session active", async () => {
  const harness = await setup();

  await harness
    .command("sprites-status")
    .execute({ sessionID: "cmd", prompt: { text: "" }, delivery: "steer" });
  const context = await harness.fire("session.context", {
    sessionID: "cmd",
    system: [],
  });

  assert.equal(context.system.length, 1);
});

test("registers both commands regardless of the current catalog", async () => {
  // OpenCode replays the transform on reload, and that replay sees the
  // previous registration, so registration must not depend on the catalog.
  const harness = await setup(undefined, {
    commands: ["sprites-status", "sprites-smoke"],
  });

  assert.deepEqual(
    harness.commands().map((command) => command.name),
    ["sprites-status", "sprites-smoke"],
  );
  assert.equal(typeof harness.command("sprites-status").execute, "function");
});

test("a second setup keeps both commands and one MCP server", async () => {
  // A plugin reload runs setup again while the previous registration is still
  // active. Neither pass may delete the other's commands.
  const harness = createContext();
  await plugin.setup(harness.ctx);
  await plugin.setup(harness.ctx);

  assert.deepEqual(
    harness.commands().map((command) => command.name),
    ["sprites-status", "sprites-smoke"],
  );
  assert.equal(harness.servers().size, 1);
});

test("a disposed registration removes its commands and server", async () => {
  const harness = createContext();
  /** @type {{dispose: () => Promise<void>}[]} */
  const registrations = [];
  const ctx = {
    ...harness.ctx,
    mcp: {
      ...harness.ctx.mcp,
      transform: async (callback) => {
        const entry = await harness.ctx.mcp.transform(callback);
        registrations.push(entry);
        return entry;
      },
    },
    command: {
      ...harness.ctx.command,
      transform: async (callback) => {
        const entry = await harness.ctx.command.transform(callback);
        registrations.push(entry);
        return entry;
      },
    },
  };
  await plugin.setup(ctx);
  assert.equal(harness.commands().length, 2);

  for (const entry of registrations) await entry.dispose();

  assert.deepEqual(harness.commands(), []);
  assert.equal(harness.servers().size, 0);
});

test("escalates destructive Sprites tools to an approval prompt", async () => {
  const harness = await setup();

  for (const action of [
    "sprites_destroy_sprite",
    "sprites_checkpoint_restore",
    "sprites_policy_network_update",
  ]) {
    const evaluation = await harness.fire("permission.evaluate", {
      sessionID: "risky",
      action,
      resources: ["*"],
      effect: "allow",
    });
    assert.equal(evaluation.effect, "ask", action);
    assert.match(evaluation.message, /\S/);
  }

  const safe = await harness.fire("permission.evaluate", {
    sessionID: "risky",
    action: "sprites_list_sprites",
    resources: ["*"],
    effect: "allow",
  });
  assert.equal(safe.effect, "allow");

  const unrelated = await harness.fire("permission.evaluate", {
    sessionID: "risky",
    action: "shell",
    resources: ["rm -rf /"],
    effect: "allow",
  });
  assert.equal(unrelated.effect, "allow");
});

test("guards a redundantly prefixed tool name", async () => {
  const harness = await setup();

  const evaluation = await harness.fire("permission.evaluate", {
    sessionID: "risky",
    action: "sprites_sprites_destroy_sprite",
    resources: ["*"],
    effect: "allow",
  });

  assert.equal(evaluation.effect, "ask");
});

test("keeps an existing ask and never relaxes a decision", async () => {
  const harness = await setup();

  const asked = await harness.fire("permission.evaluate", {
    sessionID: "risky",
    action: "sprites_destroy_sprite",
    resources: ["*"],
    effect: "ask",
    message: "user message",
  });

  assert.equal(asked.effect, "ask");
  assert.equal(asked.message, "user message");
});

test("permissions false leaves destructive decisions alone but still tracks the session", async () => {
  const harness = await setup({ permissions: false });

  const evaluation = await harness.fire("permission.evaluate", {
    sessionID: "risky",
    action: "sprites_destroy_sprite",
    resources: ["*"],
    effect: "allow",
  });
  assert.equal(evaluation.effect, "allow");

  const context = await harness.fire("session.context", {
    sessionID: "risky",
    system: [],
  });
  assert.equal(context.system.length, 1);
});

test("injects guidance only for relevant, session-bound requests", async () => {
  const harness = await setup();

  const unrelated = await harness.fire("session.context", {
    sessionID: "unrelated",
    system: [],
  });
  assert.deepEqual(unrelated.system, []);

  await harness.fire("session.prompt", {
    sessionID: "sprite-session",
    prompt: { text: "Create an environment through sprites.dev" },
  });
  const relevant = { sessionID: "sprite-session", system: [] };
  await harness.fire("session.context", relevant);
  await harness.fire("session.context", relevant);

  assert.equal(relevant.system.length, 1);
  assert.equal(relevant.system[0].type, "text");
  assert.match(relevant.system[0].text, /destroy_sprite.*irreversible/s);
  assert.match(
    relevant.system[0].text,
    /policy_network_update.*replaces the complete/s,
  );
  assert.match(relevant.system[0].text, /sprites_file_write/);
});

test("does not activate for 2D graphics or generic remote environments", async () => {
  const harness = await setup();

  for (const [index, text] of [
    "Optimize this sprite sheet",
    "Fix the CSS sprites",
    "Preview the sprite animation",
    "Use a remote development environment",
    "Deploy this application to Fly.io",
  ].entries()) {
    const sessionID = `graphics-${index}`;
    await harness.fire("session.prompt", { sessionID, prompt: { text } });
    const context = await harness.fire("session.context", {
      sessionID,
      system: [],
    });
    assert.deepEqual(context.system, [], text);
  }
});

test("sprites.dev, fly sprites, and textual tool IDs activate guidance", async () => {
  const harness = await setup();

  for (const [index, text] of [
    "Create this through sprites.dev",
    "Use fly sprites for the build",
    "Call sprites_list_sprites first",
  ].entries()) {
    const sessionID = `signal-${index}`;
    await harness.fire("session.prompt", { sessionID, prompt: { text } });
    const context = await harness.fire("session.context", {
      sessionID,
      system: [],
    });
    assert.equal(context.system.length, 1, text);
  }
});

test("a Sprites tool call or permission check activates its session", async () => {
  const harness = await setup();

  await harness.fire("tool.execute.before", {
    tool: "sprites_list_sprites",
    sessionID: "tool-session",
  });
  await harness.fire("permission.evaluate", {
    sessionID: "permission-session",
    action: "sprites_exec",
    resources: ["*"],
    effect: "allow",
  });

  for (const sessionID of ["tool-session", "permission-session"]) {
    const context = await harness.fire("session.context", {
      sessionID,
      system: [],
    });
    assert.equal(context.system.length, 1, sessionID);
  }
});

test("active parent sessions propagate guidance to sub-sessions", async () => {
  const harness = await setup();
  await harness.fire("session.prompt", {
    sessionID: "parent",
    prompt: { text: "Use sprites.dev for this task" },
  });

  await harness.emit(sessionCreated("child", "parent"));
  const child = await harness.fire("session.context", {
    sessionID: "child",
    system: [],
  });
  assert.equal(child.system.length, 1);

  await harness.emit(sessionCreated("orphan", "someone-else"));
  const orphan = await harness.fire("session.context", {
    sessionID: "orphan",
    system: [],
  });
  assert.deepEqual(orphan.system, []);

  await harness.emit({
    type: "session.deleted",
    id: "evt-delete",
    created: 0,
    durable: { aggregateID: "child", seq: 2, version: 2 },
    data: { sessionID: "child" },
  });
  const deleted = await harness.fire("session.context", {
    sessionID: "child",
    system: [],
  });
  assert.deepEqual(deleted.system, []);

  await harness.cleanup();
});

test("a disabled MCP server suppresses guidance", async () => {
  const harness = await setup(undefined, { status: "disabled" });

  await harness.fire("session.prompt", {
    sessionID: "disabled-session",
    prompt: { text: "Call sprites_list_sprites" },
  });
  const context = await harness.fire("session.context", {
    sessionID: "disabled-session",
    system: [],
  });

  assert.deepEqual(context.system, []);
});

test("an unregistered MCP server suppresses guidance", async () => {
  const harness = await setup(
    { mcp: false },
    { servers: { other: { type: "remote", url: "https://example.test/mcp" } } },
  );

  await harness.fire("session.prompt", {
    sessionID: "unregistered",
    prompt: { text: "Call sprites_list_sprites" },
  });
  const context = await harness.fire("session.context", {
    sessionID: "unregistered",
    system: [],
  });

  assert.deepEqual(context.system, []);
});

test("a failed or unauthenticated server still receives recovery guidance", async () => {
  const harness = await setup(undefined, { status: "needs_auth" });

  await harness.fire("session.prompt", {
    sessionID: "needs-auth",
    prompt: { text: "Call sprites_list_sprites" },
  });
  const context = await harness.fire("session.context", {
    sessionID: "needs-auth",
    system: [],
  });

  assert.equal(context.system.length, 1);
  assert.match(context.system[0].text, /opencode2 mcp auth sprites/);
});

test("only the configured server controls guidance", async () => {
  const harness = await setup(undefined, {
    servers: { other: { type: "remote", url: "https://example.test/mcp" } },
  });
  harness.setStatus("other", "disabled");

  await harness.fire("tool.execute.before", {
    tool: "sprites_list_sprites",
    sessionID: "mixed",
  });
  const context = await harness.fire("session.context", {
    sessionID: "mixed",
    system: [],
  });

  assert.equal(context.system.length, 1);
});

test("follows the server from connected to disabled and back", async () => {
  const harness = await setup();
  await harness.fire("tool.execute.before", {
    tool: "sprites_list_sprites",
    sessionID: "transitions",
  });

  const statusChanged = {
    type: "mcp.status.changed",
    id: "evt-status",
    created: 0,
    data: { server: "sprites" },
  };

  const connected = await harness.fire("session.context", {
    sessionID: "transitions",
    system: [],
  });
  assert.equal(connected.system.length, 1);

  harness.setStatus("sprites", "disabled");
  await harness.emit(statusChanged);
  const disabled = await harness.fire("session.context", {
    sessionID: "transitions",
    system: [],
  });
  assert.deepEqual(disabled.system, []);

  harness.setStatus("sprites", "connected");
  await harness.emit(statusChanged);
  const recovered = await harness.fire("session.context", {
    sessionID: "transitions",
    system: [],
  });
  assert.equal(recovered.system.length, 1);
});

test("holds the cached status until an event invalidates it", async () => {
  const harness = await setup();
  await harness.fire("tool.execute.before", {
    tool: "sprites_list_sprites",
    sessionID: "stale",
  });
  await harness.fire("session.context", { sessionID: "stale", system: [] });

  // No event, so the plugin keeps the cached result for its cache window.
  harness.setStatus("sprites", "disabled");
  const cached = await harness.fire("session.context", {
    sessionID: "stale",
    system: [],
  });

  assert.equal(cached.system.length, 1);
});

test("caches MCP status and invalidates it on status changes", async () => {
  let statusCalls = 0;
  const harness = await setup(undefined, { onMcpList: () => statusCalls++ });
  await harness.fire("tool.execute.before", {
    tool: "sprites_list_sprites",
    sessionID: "cache-session",
  });

  await harness.fire("session.context", {
    sessionID: "cache-session",
    system: [],
  });
  await harness.fire("session.context", {
    sessionID: "cache-session",
    system: [],
  });
  assert.equal(statusCalls, 1);

  await harness.emit({
    type: "mcp.status.changed",
    id: "evt-mcp",
    created: 0,
    data: { server: "sprites" },
  });
  await harness.fire("session.context", {
    sessionID: "cache-session",
    system: [],
  });
  assert.equal(statusCalls, 2);

  await harness.emit({
    type: "mcp.status.changed",
    id: "evt-other",
    created: 0,
    data: { server: "other" },
  });
  await harness.fire("session.context", {
    sessionID: "cache-session",
    system: [],
  });
  assert.equal(statusCalls, 2);

  await harness.cleanup();
});

test("cleanup stops tracking sessions", async () => {
  const harness = await setup();
  await harness.fire("session.prompt", {
    sessionID: "cleanup-session",
    prompt: { text: "Use sprites.dev" },
  });

  await harness.cleanup();

  const context = await harness.fire("session.context", {
    sessionID: "cleanup-session",
    system: [],
  });
  assert.deepEqual(context.system, []);
});

test("rejects malformed plugin options", async () => {
  await assert.rejects(() => setup({ timeout: 0 }), /positive integer/);
  await assert.rejects(
    () => setup({ timeout: { catalog: -1 } }),
    /timeout\.catalog must be a positive integer/,
  );
  await assert.rejects(
    () => setup({ url: "file:///tmp/mcp" }),
    /http or https/,
  );
  await assert.rejects(() => setup({ commands: "no" }), /must be a boolean/);
  await assert.rejects(
    () => setup({ oauth: true }),
    /must be false or an OAuth/,
  );
});
