// Type assertions for both entry points. The OpenCode 1 types come from
// `@opencode-ai/plugin`, and the OpenCode 2 beta types from the
// `@opencode-ai/plugin-v2` alias of the same package.
import type {
  Config,
  Hooks,
  PluginInput,
  PluginOptions as V1PluginOptions,
} from "@opencode-ai/plugin";
import type {
  Mcp,
  Plugin,
  PluginOptions as V2PluginOptions,
} from "@opencode-ai/plugin-v2";
import type { CommandInvocation } from "@opencode-ai/plugin-v2/promise/command";
import type { PermissionEvaluation } from "@opencode-ai/plugin-v2/promise/permission";
import type { SessionContext } from "@opencode-ai/plugin-v2/promise/session";
import { createOpencodeClient } from "@opencode-ai/sdk";

import v1 from "../src/v1.js";
import v2 from "../src/v2.js";
import { createContext } from "./context.js";

// --- OpenCode 1 -----------------------------------------------------------

const client = createOpencodeClient({
  baseUrl: "http://opencode.test",
  fetch: async () =>
    new Response(JSON.stringify({ sprites: { status: "connected" } }), {
      headers: { "content-type": "application/json" },
    }),
});

declare const shell: PluginInput["$"];

const v1Input = {
  client,
  project: { id: "test-project", worktree: "/work", time: { created: 0 } },
  directory: "/work",
  worktree: "/work",
  experimental_workspace: { register() {} },
  serverUrl: new URL("http://opencode.test"),
  $: shell,
} satisfies PluginInput;

const v1Options = {
  mcpName: "sprites-staging",
  url: "https://staging.example.test/mcp",
  timeout: 15_000,
  headers: { "X-Test": "yes" },
  mcp: true,
  commands: true,
  guidance: true,
  permissions: true,
} satisfies V1PluginOptions;

async function exerciseV1(hooks: Hooks) {
  const config: Config = {};
  await hooks.config?.(config);
  await hooks["tool.execute.before"]?.(
    { tool: "sprites_list_sprites", sessionID: "session", callID: "call" },
    { args: {} },
  );
  await hooks["experimental.chat.system.transform"]?.(
    {
      sessionID: "session",
      model: {} as Parameters<
        NonNullable<Hooks["experimental.chat.system.transform"]>
      >[0]["model"],
    },
    { system: [] },
  );
}

void v1.server(v1Input, v1Options).then(exerciseV1);

// --- OpenCode 2 -----------------------------------------------------------

const v2Contract: Plugin.Plugin = v2;

const v2Options = {
  ...v1Options,
  timeout: { startup: 15_000, catalog: 15_000, execution: 600_000 },
  oauth: { client_id: "client", callback_port: 19_876 },
  codemode: false,
} satisfies V2PluginOptions;

const server: Mcp.ServerConfig = {
  type: "remote",
  url: v2Options.url,
  headers: v2Options.headers,
  oauth: false,
  codemode: v2Options.codemode,
  timeout: v2Options.timeout,
};

declare const invocation: CommandInvocation;
declare const evaluation: PermissionEvaluation;
declare const sessionContext: SessionContext;

async function exerciseV2(setupContext: Plugin.Context) {
  const cleanup = await v2Contract.setup(setupContext);
  if (typeof cleanup === "function") await cleanup();

  await setupContext.session.prompt({
    sessionID: invocation.sessionID,
    text: invocation.prompt.text,
    delivery: invocation.delivery,
  });

  evaluation.effect = "ask";
  evaluation.message = "needs approval";
  sessionContext.system.push({ type: "text", text: "guidance" });
}

// The fake plugin context must not invent a friendlier API than the runtime.
type Fake = ReturnType<typeof createContext>["ctx"];
declare const fake: Fake;

const conformance: {
  app: Plugin.Context["app"];
  location: Plugin.Context["location"];
  options: Plugin.Context["options"];
  mcpList: Plugin.Context["mcp"]["list"];
  mcpTransform: Plugin.Context["mcp"]["transform"];
  commandList: Plugin.Context["command"]["list"];
  commandTransform: Plugin.Context["command"]["transform"];
  permissionHook: Plugin.Context["permission"]["hook"];
  sessionHook: Plugin.Context["session"]["hook"];
  sessionPrompt: Plugin.Context["session"]["prompt"];
  toolHook: Plugin.Context["tool"]["hook"];
  eventSubscribe: Plugin.Context["event"]["subscribe"];
} = {
  app: fake.app,
  location: fake.location,
  options: fake.options,
  mcpList: fake.mcp.list,
  mcpTransform: fake.mcp.transform,
  commandList: fake.command.list,
  commandTransform: fake.command.transform,
  permissionHook: fake.permission.hook,
  sessionHook: fake.session.hook,
  sessionPrompt: fake.session.prompt,
  toolHook: fake.tool.hook,
  eventSubscribe: fake.event.subscribe,
};

export { conformance, exerciseV2, server };
