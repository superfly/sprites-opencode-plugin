# Sprites for OpenCode

Use [Fly.io Sprites](https://sprites.dev) from OpenCode as persistent, isolated Linux development environments for builds, tests, sandboxes, previews, and long-running services.

The plugin uses OpenCode's current v1 plugin API. It registers the hosted Sprites MCP server, relies on OpenCode's OAuth support, adds session-scoped workflow guidance and slash commands, and asks for approval before destructive remote operations. No Sprites CLI or API token setup is required.

## Requirements

- OpenCode 1.18.23 or newer in the 1.x series
- Node.js 20 or newer for package development

## Install

Add the npm package to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@flydotio/sprites-opencode-plugin"]
}
```

OpenCode installs npm plugins automatically with Bun at startup. Restart OpenCode after changing plugin configuration.

The package name above is the intended public name. Until the first npm release, use the [local development](#local-development) setup.

## First use

Run `/sprites-status` or ask OpenCode to list your Sprites. The first MCP call should start OpenCode's browser OAuth flow. If it does not, authenticate the plugin-provided server explicitly:

```sh
opencode mcp auth sprites
```

Then retry the original request. An empty Sprite list is a successful authenticated result.

## What it provides

- Hosted MCP access at `https://sprites.dev/mcp`.
- Sprites workflow and safety guidance only in sessions that mention `sprites.dev`, say “fly sprites,” reference a `sprites_*` tool, invoke a Sprites command or tool, or inherit an active Sprites parent session.
- `/sprites-status` for a read-only connectivity and authentication check.
- `/sprites-smoke` for a list → create → exec smoke test; cleanup still requires explicit intent.
- OpenCode permission prompts for Sprite destruction, checkpoint restore, and complete network-policy replacement.
- Compaction guidance that preserves active Sprite names, service state, checkpoints, and pending approvals in relevant sessions.

With the plugin enabled, OpenCode can list and create Sprites, run remote commands and builds, manage long-running services, create and restore filesystem checkpoints, and inspect or update outbound network policy.

## How it works

OpenCode runs outside the Sprite. The plugin configures Sprites MCP as the remote control plane:

- Local workspace and shell commands remain on your machine.
- One-off remote commands use `sprites_exec`.
- Long-running remote processes use `sprites_service_*` tools.
- Reversible remote filesystem snapshots use `sprites_checkpoint_*` tools.
- Outbound access is governed by `sprites_policy_network_*` tools.

There is no dedicated MCP file-write tool. Prefer cloning a repository into a Sprite. For small generated files, the guidance recommends base64 transfer rather than fragile nested shell quoting.

## Options

OpenCode's v1 plugin format accepts an options object alongside the package specifier:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@flydotio/sprites-opencode-plugin",
      {
        "mcpName": "sprites-staging",
        "url": "https://staging.example.com/mcp",
        "timeout": 15000,
        "headers": { "X-Environment": "staging" },
        "commands": false,
        "guidance": true,
        "permissions": true,
        "mcp": true
      }
    ]
  ]
}
```

| Option        | Default                   | Meaning                                               |
| ------------- | ------------------------- | ----------------------------------------------------- |
| `mcpName`     | `sprites`                 | MCP server name and generated tool-name prefix.       |
| `url`         | `https://sprites.dev/mcp` | Remote MCP endpoint. Must use HTTP or HTTPS.          |
| `timeout`     | `60000`                   | MCP connection and discovery timeout in milliseconds. |
| `headers`     | `{}`                      | Headers merged over the plugin's attribution headers. |
| `mcp`         | `true`                    | Register the default MCP server.                      |
| `commands`    | `true`                    | Register `/sprites-status` and `/sprites-smoke`.      |
| `guidance`    | `true`                    | Add workflow guidance to relevant sessions.           |
| `permissions` | `true`                    | Add destructive-tool approval defaults.               |

When `mcp` is `false`, guidance is active only if an MCP entry with the configured `mcpName` already exists.

OpenCode currently uses the same MCP timeout for the initial remote connection and discovery. The 60-second default deliberately limits startup stalls when `sprites.dev` is unreachable; increase it only when a slower endpoint warrants the longer connection wait.

## Configuration and permissions

The plugin adds defaults without overwriting user-owned values:

- An existing MCP entry with the configured name wins completely.
- Existing `sprites-status` or `sprites-smoke` commands win.
- Existing exact permission rules win.
- A global `"deny"` is preserved.
- OpenCode normalizes a top-level permission string such as `"allow"` into `{ "*": "allow" }`. The plugin appends `"ask"` suffix patterns for its destructive MCP tools, which take precedence over that wildcard.
- A broad rule such as `"sprites_*": "allow"` is also overridden by the later destructive-tool patterns. Use exact rules for the guarded tools, or set `permissions` to `false`, when blanket approval is intentional.
- Setting the configured MCP server's `enabled` field to `false` suppresses injected guidance.

The default guarded patterns are `sprites_*destroy_sprite`, `sprites_*checkpoint_restore`, and `sprites_*policy_network_update`. They match both OpenCode's normal server prefix plus the verified Sprites MCP raw tool names and a redundantly prefixed raw name. Custom MCP names are sanitized the same way OpenCode sanitizes MCP tool IDs.

`opencode run` rejects `ask` permissions in non-interactive mode unless `--auto` is supplied; `--auto` approves them. For automation, set exact tool permissions intentionally and review the safety consequences rather than relying on an interactive prompt.

The MCP definition includes fixed, privacy-safe client attribution headers:

```text
Fly-Client-Agent: opencode
Fly-Client-Interactive: false
```

They contain nothing user-, machine-, organization-, repository-, or prompt-specific. They are not used for authentication or authorization.

## OAuth name restrictions

Restricted connector tokens use a non-empty Sprite-name prefix and may cap how many Sprites the connector can create. The common default is `mcp-`, but the prefix may be customized during OAuth. The plugin tells OpenCode to learn the actual restriction from the API and retry a failed create once with the required prefix.

Choosing full access during OAuth removes the prefix restriction and grants access to every Sprite in the organization. Use it only when organization-wide control is intentional.

## Safety

Sprite state is durable. Destroying a Sprite permanently deletes its filesystem, services, checkpoints, and URL. Restoring a checkpoint discards newer filesystem state. Updating a network policy replaces the complete rule set rather than merging it. These constraints are included in the session guidance because OpenCode's `tool.definition` hook does not run for MCP tools.

Treat anything served through a Sprite URL as potentially internet-accessible. Never expose secrets, environment variables, tokens, arbitrary files, admin/debug endpoints, or unfiltered logs over HTTP.

## Local development

Point OpenCode at the package directory from `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/sprites-opencode-plugin"]
}
```

The directory form lets OpenCode resolve the package's `./server` export and enforce its `engines.opencode` range. To make a drop-in project plugin instead, copy `index.js` to `.opencode/plugins/sprites.js`; global drop-ins live at `~/.config/opencode/plugins/`.

Drop-in plugins are loaded as bare file specifiers and cannot receive the options object shown above. Use npm or package-directory configuration when you need non-default options.

Install dependencies and run all checks:

```sh
npm ci
npm run check
```

The Node test suite includes a real `opencode debug config` integration test in isolated XDG directories. CI also runs a Bun import/configuration smoke test because OpenCode installs npm plugins with Bun.

OpenCode's system-transform hook does not identify small-model calls. Once a session is active, OpenCode title or summary generation that reuses the same session ID may therefore receive the Sprites guidance too; unrelated sessions remain unaffected.

## Troubleshooting

If Sprites tools are missing:

1. Run `opencode mcp list` and confirm the configured server is present.
2. Restart OpenCode so plugin and MCP configuration are reloaded.
3. Run `opencode mcp auth sprites` if the server is present but unauthorized.
4. Use `opencode mcp debug sprites` to inspect OAuth discovery and connectivity.

Replace `sprites` in those commands if you configured another `mcpName`.

Do not install the Sprites CLI, use raw Sprites API calls, invent access tokens, or register a second Sprites MCP server as an authentication workaround.

## Release

Publishing requires access to the `@flydotio` npm organization. For the initial package publish, configure an `NPM_TOKEN` secret in the repository's `npm` GitHub environment. Publishing a GitHub release then runs the release workflow with provenance. After the package exists on npmjs.com, configure trusted publishing for this repository and remove the `NODE_AUTH_TOKEN` fallback from the workflow.

## License

MIT
