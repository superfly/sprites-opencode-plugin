# Contributing

Thank you for your help with the Sprites plugin for OpenCode.

## Requirements

- Node.js 20 or later
- Bun, to run the Bun smoke test locally
- The OpenCode 1 and OpenCode 2 CLIs, which `npm install` adds as development dependencies

## Set up the repository

Install the locked development dependencies:

```sh
npm ci
```

npm 12 and later block install scripts. The `allowScripts` field in `package.json` lets `@opencode-ai/cli` select its platform binary.

Point OpenCode at the checkout while you develop. Use `plugin` with a `file://` URL for OpenCode 1, and `plugins` for OpenCode 2:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/sprites-opencode-plugin"],
}
```

OpenCode 2 watches the plugin files and loads them again when they change. If a change does not become active, run `opencode2 service restart`.

## Layout

One package serves both OpenCode releases through its export map:

| Path            | Export       | Release    |
| --------------- | ------------ | ---------- |
| `src/v1.js`     | `./server`   | OpenCode 1 |
| `src/v2.js`     | `.`          | OpenCode 2 |
| `src/shared.js` | not exported | both       |

OpenCode 1 resolves the package's `./server` subpath, and OpenCode 2 resolves `.`, so neither release loads the other's file. `test/exports.test.js` asserts that split through Node's own resolution.

`src/shared.js` holds what does not differ between the releases: the server defaults, the naming rules, the guidance text, the command templates, the trigger pattern, and the destructive tools. Put a Sprites rule there, and put an API difference in the entry point that needs it.

## Run the checks

Run the same primary checks that CI runs:

```sh
npm run check
npm pack --dry-run
```

`npm run check` examines the format, runs strict TypeScript checks, and runs the Node test suite.

The Node suite has these parts:

- `test/exports.test.js` asserts that the export map gives each release its own entry point.
- `test/v1.test.js` and `test/v2.test.js` drive each entry point directly. The v2 tests use a fake plugin context from `test/context.js`.
- `test/opencode1.integration.test.js` runs `opencode debug config` in isolated XDG directories, so the real OpenCode 1 CLI resolves the configuration.
- `test/opencode2.integration.test.js` starts an isolated OpenCode 2 background service. It makes sure that the real runtime registers the MCP server and the commands. These tests are slow, because the service must start.

The integration tests fail when the `opencode2` binary is absent. `npm ci` installs that binary, so an absent binary is an error. A silent skip would let `npm run check` report success while nothing runs against the real runtime. To skip these tests on purpose, set `SPRITES_SKIP_OPENCODE_TESTS=1`.

The fake context in `test/context.js` keeps the same rules as the runtime:

- It keeps the transforms and replays them each time it materializes the configuration. A test can therefore run `setup` two times and find the same result as a plugin reload.
- A registration removes its own contribution when you dispose it.
- `emit` gives the event to the subscriber and waits until the plugin processes it. The tests do not use timers.
- Each server has its own status, and `setStatus` changes it. The tests can therefore move a server between states, and can give two servers different states.
- Each method has the type of its runtime signature, and `test/type-contract.ts` asserts that the assembled context is assignable to the real contract. The type check fails if the fake becomes more permissive than the runtime.

OpenCode installs plugins with Bun, so CI also runs a Bun smoke test:

```sh
npm run test:bun
```

## Implementation notes

- `src/v2.js` exports an OpenCode 2 plugin object with an `id` and a `setup` function. `setup` registers the MCP server and the commands with transforms, and registers permission, tool, and session hooks. It returns a cleanup function.
- `src/v1.js` exports an OpenCode 1 plugin module with an `id` and a `server` function. It writes the MCP server, the commands, and the permission defaults into the configuration.
- The plugin has no runtime dependencies. Types come from `@opencode-ai/plugin` for OpenCode 1, and from the `@opencode-ai/plugin-v2` alias of the same package for the OpenCode 2 beta. Both are development dependencies.
- Command registration is unconditional. OpenCode replays the transform after a reload, and the replay sees the commands from the previous registration. A conditional registration therefore deletes its own commands.
- OpenCode 2 gives plugins no permission draft. The plugin changes a decision from `allow` to `ask` in the `permission.evaluate` hook. A configured `deny` never reaches the hook.
- Guidance becomes active only for an explicit Sprites signal, a Sprites tool call, a Sprites permission decision, or a Sprites command. The active state moves to child sessions, and the plugin removes it when a session is deleted.
- The MCP status cache is longer than one model step. The `mcp.status.changed` event clears it. An empty server list counts as unknown, because MCP configuration can be later than the first check.
- OpenCode 2 has no compaction hook. Under OpenCode 2 the compaction instruction is part of the system guidance instead. OpenCode 1 keeps its compaction hook.
- The plugin sets `codemode` to `false` on its MCP server. Code Mode reaches MCP tools through a dispatcher, and the Sprites MCP server does not support that call shape yet. With Code Mode off, the `sprites_*` tools are on the model's own tool list. Remove the default when the server supports the dispatcher.
- OpenCode does not enforce `engines.opencode`. The field records intent, and it does not gate loading in either release.
- The session `context` hook does not run for title or compaction requests. Those requests do not receive the guidance.

When you change hooks or configuration behavior, update the unit tests and the type assertions in `test/type-contract.ts`. When you change plugin loading or option handling, update the OpenCode 2 integration tests too.

## Pull requests

Keep changes small, explain the user-visible behavior, and include tests for changes in behavior. Before you open a pull request, run the checks above, and make sure that `git diff --check` reports no whitespace errors.

## Release process

Publication needs access to the `@flydotio` npm organization.

For the first publication, configure an `NPM_TOKEN` secret in the repository's `npm` GitHub environment. The release workflow then runs with provenance when you publish a GitHub release.

After the package is on npmjs.com, configure npm trusted publishing for this repository, and remove the `NODE_AUTH_TOKEN` fallback from `.github/workflows/release.yml`.

The OpenCode 2 plugin API is in beta. Publish a compatible plugin update when the v2 entry points or contracts change.
