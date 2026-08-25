import { createOpencodeClient } from "@opencode-ai/sdk";
import type {
  Config,
  Hooks,
  PluginInput,
  PluginOptions,
} from "@opencode-ai/plugin";

import plugin from "../index.js";

const client = createOpencodeClient({
  baseUrl: "http://opencode.test",
  fetch: async () =>
    new Response(JSON.stringify({ sprites: { status: "connected" } }), {
      headers: { "content-type": "application/json" },
    }),
});

declare const shell: PluginInput["$"];

const input = {
  client,
  project: {
    id: "test-project",
    worktree: "/work",
    time: { created: 0 },
  },
  directory: "/work",
  worktree: "/work",
  experimental_workspace: { register() {} },
  serverUrl: new URL("http://opencode.test"),
  $: shell,
} satisfies PluginInput;

const options = {
  mcpName: "sprites-staging",
  url: "https://staging.example.test/mcp",
  timeout: 15_000,
  headers: { "X-Test": "yes" },
  mcp: true,
  commands: true,
  guidance: true,
  permissions: true,
} satisfies PluginOptions;

async function exerciseHooks(hooks: Hooks) {
  const config: Config = {};
  await hooks.config?.(config);
  await client.mcp.status({ query: { directory: input.directory } });

  const beforeTool: Parameters<NonNullable<Hooks["tool.execute.before"]>>[0] = {
    tool: "sprites_list_sprites",
    sessionID: "session",
    callID: "call",
  };
  await hooks["tool.execute.before"]?.(beforeTool, { args: {} });

  const systemInput: Parameters<
    NonNullable<Hooks["experimental.chat.system.transform"]>
  >[0] = {
    sessionID: "session",
    model: {} as Parameters<
      NonNullable<Hooks["experimental.chat.system.transform"]>
    >[0]["model"],
  };
  await hooks["experimental.chat.system.transform"]?.(systemInput, {
    system: [],
  });
}

void plugin.server(input, options).then(exerciseHooks);
