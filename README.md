# Sprites for OpenCode

Use [Fly.io Sprites](https://sprites.dev) from OpenCode as persistent, isolated Linux environments for builds, tests, sandboxes, previews, and long-running services.

The plugin connects OpenCode to the hosted Sprites MCP server, uses OpenCode's browser-based OAuth flow, adds Sprites commands and workflow guidance, and asks for approval before destructive remote operations. You do not need to install the Sprites CLI or create an API token.

## Requirements

- OpenCode 1.18.23 or newer in the 1.x series

## Install

Add the package to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@flydotio/sprites-opencode-plugin"]
}
```

OpenCode installs npm plugins automatically with Bun at startup. Restart OpenCode after changing the configuration.

If the package is not yet available from npm, clone this repository and point OpenCode at the checkout instead:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/sprites-opencode-plugin"]
}
```

Use an absolute `file://` URL. This installation form has the same features as the npm package.

## Authenticate

Run `/sprites-status` or ask OpenCode to list your Sprites. The first Sprites request should start OpenCode's browser OAuth flow.

If the browser does not open, authenticate the plugin-provided server explicitly:

```sh
opencode mcp auth sprites
```

Then retry the original request. An empty Sprite list is a successful authenticated result.

## Use Sprites

You can ask OpenCode to:

- List or create Sprites.
- Clone a repository into a Sprite and run its build or test suite remotely.
- Start a long-running development server or preview as a Sprite service.
- Create a filesystem checkpoint before a risky change and restore it later.
- Inspect or update a Sprite's outbound network policy.

The plugin also adds two slash commands:

- `/sprites-status` performs a read-only connectivity and authentication check.
- `/sprites-smoke` walks through a list → create → exec smoke test. Destroying the test Sprite still requires explicit intent.

OpenCode itself continues to run outside the Sprite. Local workspace and shell operations stay on your machine; Sprites MCP tools perform remote work. In particular:

- One-off remote commands use `sprites_exec`.
- Long-running remote processes use `sprites_service_*` tools.
- Reversible filesystem snapshots use `sprites_checkpoint_*` tools.
- Outbound access is governed by `sprites_policy_network_*` tools.

There is no dedicated MCP file-write tool. For substantial work, clone a repository into the Sprite. For small generated files, ask OpenCode to transfer base64-encoded content rather than relying on nested shell quoting.

## What the plugin adds

- Hosted MCP access at `https://sprites.dev/mcp`.
- Sprites workflow and safety guidance in relevant sessions without adding that context to unrelated work.
- Session inheritance so a subagent working with Sprites receives the same guidance as its parent.
- Approval prompts for Sprite destruction, checkpoint restore, and complete network-policy replacement.
- Compaction guidance that preserves active Sprite names, service state, checkpoints, and pending approvals.

## Options

OpenCode accepts an options object alongside the package specifier:

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

OpenCode uses the same timeout for the initial remote connection and tool discovery. The 60-second default limits startup stalls when `sprites.dev` is unreachable; increase it only when a slower endpoint warrants the longer connection wait.

## Configuration and permissions

The plugin adds defaults without overwriting user-owned values:

- An existing MCP entry with the configured name wins completely.
- Existing `sprites-status` or `sprites-smoke` commands win.
- Existing exact permission rules win.
- A global `"deny"` is preserved.
- A broad rule such as `"sprites_*": "allow"` is overridden by the plugin's later destructive-tool patterns. Use exact rules for the guarded tools, or set `permissions` to `false`, when blanket approval is intentional.
- Setting the configured MCP server's `enabled` field to `false` suppresses injected guidance.

The guarded patterns are `sprites_*destroy_sprite`, `sprites_*checkpoint_restore`, and `sprites_*policy_network_update`.

`opencode run` rejects `ask` permissions in non-interactive mode unless `--auto` is supplied; `--auto` approves them. For automation, set exact tool permissions intentionally and review the safety consequences rather than relying on an interactive prompt.

The MCP connection sends fixed client-attribution headers:

```text
Fly-Client-Agent: opencode
Fly-Client-Interactive: false
```

These headers contain no user-, machine-, organization-, repository-, or prompt-specific information. They are not used for authentication or authorization.

## OAuth access restrictions

Restricted connector tokens use a non-empty Sprite-name prefix and may limit how many Sprites the connector can create. The common default is `mcp-`, but the prefix can be customized during OAuth. The plugin tells OpenCode to learn the actual restriction from the API and retry a failed creation once with the required prefix.

Choosing full access during OAuth removes the prefix restriction and grants access to every Sprite in the organization. Use it only when organization-wide control is intentional.

## Safety

Sprite state is durable:

- Destroying a Sprite permanently deletes its filesystem, services, checkpoints, and URL.
- Restoring a checkpoint discards newer filesystem state.
- Updating a network policy replaces the complete rule set rather than merging it.

Treat anything served through a Sprite URL as potentially internet-accessible. Never expose secrets, environment variables, tokens, arbitrary files, admin or debug endpoints, or unfiltered logs over HTTP.

## Troubleshooting

If Sprites tools are missing:

1. Run `opencode mcp list` and confirm the configured server is present.
2. Restart OpenCode so plugin and MCP configuration are reloaded.
3. Run `opencode mcp auth sprites` if the server is present but unauthorized.
4. Use `opencode mcp debug sprites` to inspect OAuth discovery and connectivity.

Replace `sprites` in those commands if you configured another `mcpName`.

Do not install the Sprites CLI, use raw Sprites API calls, invent access tokens, or register a second Sprites MCP server as an authentication workaround.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, testing, implementation notes, and the release process.

## License

MIT
