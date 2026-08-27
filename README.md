# Sprites for OpenCode

Use [Fly.io Sprites](https://sprites.dev) from OpenCode as persistent, isolated Linux environments for builds, tests, sandboxes, previews, and long-running services.

One package supports both OpenCode releases. OpenCode 1 loads the package's `./server` export, and OpenCode 2 loads its `.` export. Each entry point uses the plugin API of its own release, and both share the same server defaults, tool names, guidance, commands, and destructive-tool rules.

The plugin connects OpenCode to the hosted Sprites MCP server, uses OpenCode's browser-based OAuth flow, adds Sprites commands and workflow guidance, and asks for approval before destructive remote operations. You do not need to install the Sprites CLI or create an API token.

## Requirements

- OpenCode 1.18.23 or later in the 1.x series, or
- OpenCode 2 (the `opencode2` beta CLI)

## Install

For OpenCode 1, add the package to `opencode.json`. The key is `plugin`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@flydotio/sprites-opencode-plugin"]
}
```

For OpenCode 2, add it to `opencode.jsonc`. The key is `plugins`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@flydotio/sprites-opencode-plugin"],
}
```

OpenCode 2 can also install the package with its CLI:

```sh
opencode2 plugin add @flydotio/sprites-opencode-plugin
```

If the package is not yet available from npm, clone this repository and point OpenCode at the checkout. OpenCode 1 needs an absolute `file://` URL. OpenCode 2 accepts a path or a `file://` URL:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/sprites-opencode-plugin"]
}
```

Point OpenCode at the package directory, not at one source file. The two entry points come from the package export map, and a drop-in file plugin cannot receive an options object.

Restart OpenCode after you change the configuration.

## Authenticate

Run `/sprites-status`, or ask OpenCode to list your Sprites. The first Sprites request starts OpenCode's browser OAuth flow.

If the browser does not open, authenticate the server. Use `opencode` for OpenCode 1, and `opencode2` for OpenCode 2:

```sh
opencode mcp auth sprites
opencode2 mcp auth sprites
```

Then do the original request again. An empty Sprite list is a successful authenticated result.

## Use Sprites

You can ask OpenCode to:

- List or create Sprites.
- Clone a repository into a Sprite and run its build or test suite remotely.
- Start a long-running development server or preview as a Sprite service.
- Create a filesystem checkpoint before a risky change, and restore it later.
- Read, write, and move files in the Sprite filesystem.
- Examine or change a Sprite's outbound network policy.

The plugin also adds two commands:

- `/sprites-status` does a read-only connectivity and authentication check.
- `/sprites-smoke` does a list, create, and exec smoke test. To destroy the test Sprite, you must ask for it.

OpenCode continues to run outside the Sprite. Local workspace and shell operations stay on your machine. The Sprites MCP tools do the remote work:

- One-off remote commands use `sprites_exec`.
- Long-running remote processes use the `sprites_service_*` tools.
- Reversible filesystem snapshots use the `sprites_checkpoint_*` tools.
- Remote files use the `sprites_file_*` tools.
- Outbound access uses the `sprites_policy_network_*` tools.

OpenCode 2 groups MCP tools in Code Mode by default. The model then calls these tools as `tools.sprites.<tool>(input)`. The permission action stays `sprites_<tool>`. To put the tools on the model's native tool list instead, set the `codemode` option to `false`.

## What the plugin adds

- Hosted MCP access at `https://sprites.dev/mcp`.
- Sprites workflow and safety guidance in relevant sessions, but not in unrelated work.
- Session inheritance, so a subagent that works with Sprites gets the same guidance as its parent.
- Approval prompts for Sprite destruction, checkpoint restore, and complete network-policy replacement.
- Under OpenCode 1, compaction guidance that keeps the active Sprite names, service state, checkpoints, and pending approvals. OpenCode 2 has no compaction hook, so that instruction is part of the guidance itself.

## Options

OpenCode passes an options object to the plugin. OpenCode 1 uses a tuple, and OpenCode 2 uses an object:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@flydotio/sprites-opencode-plugin",
      { "mcpName": "sprites-staging", "timeout": 15000 }
    ]
  ]
}
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@flydotio/sprites-opencode-plugin",
      "options": {
        "mcpName": "sprites-staging",
        "url": "https://staging.example.com/mcp",
        "timeout": { "startup": 15000, "catalog": 15000 },
        "headers": { "X-Environment": "staging" },
        "oauth": false,
        "codemode": false,
        "mcp": true,
        "commands": true,
        "guidance": true,
        "permissions": true,
      },
    },
  ],
}
```

| Option        | OpenCode | Default                   | Meaning                                                    |
| ------------- | -------- | ------------------------- | ---------------------------------------------------------- |
| `mcpName`     | 1 and 2  | `sprites`                 | MCP server name and generated tool-name prefix.            |
| `url`         | 1 and 2  | `https://sprites.dev/mcp` | Remote MCP endpoint. Must use HTTP or HTTPS.               |
| `timeout`     | 1 and 2  | see below                 | MCP timeouts in milliseconds.                              |
| `headers`     | 1 and 2  | `{}`                      | Headers merged over the plugin's attribution headers.      |
| `mcp`         | 1 and 2  | `true`                    | Register the default MCP server.                           |
| `commands`    | 1 and 2  | `true`                    | Register `/sprites-status` and `/sprites-smoke`.           |
| `guidance`    | 1 and 2  | `true`                    | Add workflow guidance to relevant sessions.                |
| `permissions` | 1 and 2  | `true`                    | Guard the destructive Sprites tools.                       |
| `oauth`       | 2 only   | OAuth enabled             | OAuth client settings, or `false` for a header credential. |
| `codemode`    | 2 only   | OpenCode default (`true`) | Show the Sprites tools through Code Mode.                  |

OpenCode 1 uses one timeout for the connection and for tool discovery. Its default is 60 seconds. OpenCode 2 separates the timeouts, and this plugin then leaves OpenCode's own defaults in place: 30 seconds for `startup`, 30 seconds for `catalog`, and 12 hours for `execution`. Under OpenCode 2, `timeout` accepts an object with `startup`, `catalog`, and `execution`, or a single number that applies to `startup` and `catalog`.

The `oauth` field accepts the OpenCode 2 snake_case fields: `client_id`, `client_secret`, `scope`, `callback_port`, and `redirect_uri`. OpenCode 2 ignores an option that belongs to the other release, and so does OpenCode 1.

## Configuration and permissions

The plugin adds defaults, but it does not replace your values:

- An MCP server that your configuration already defines with the same name wins completely.
- To disable the Sprites server, set `enabled` to `false` (OpenCode 1) or `disabled` to `true` (OpenCode 2) on that server. The plugin then adds no guidance.

Under OpenCode 1, the plugin also keeps your commands and your exact permission rules, and it preserves a global `"deny"`. Its guarded permission patterns are `sprites_*destroy_sprite`, `sprites_*checkpoint_restore`, and `sprites_*policy_network_update`. A broad rule such as `"sprites_*": "allow"` is overridden by those later patterns. Use exact rules for the guarded tools, or set `permissions` to `false`, when blanket approval is intentional.

OpenCode 2 gives plugins no permission draft, so there the plugin examines each decision as it happens:

- A configured `deny` is final. OpenCode does not call the plugin.
- A configured or default `ask` stays an `ask`.
- An `allow` for `sprites_*destroy_sprite`, `sprites_*checkpoint_restore`, or `sprites_*policy_network_update` becomes an `ask`, and the plugin adds the reason.

Set the `permissions` option to `false` when you intend to allow these tools without a prompt.

`opencode run` and `opencode2 run` reject `ask` permissions in non-interactive mode. Supply `--auto` to approve them. For automation, set exact permission rules on purpose, and examine the safety consequences.

The MCP connection sends fixed client-attribution headers:

```text
Fly-Client-Agent: opencode
Fly-Client-Interactive: false
```

These headers contain no user, machine, organization, repository, or prompt information. They are not used for authentication or authorization.

## OAuth access restrictions

Restricted connector tokens use a non-empty Sprite-name prefix, and they can limit how many Sprites the connector creates. The usual default is `mcp-`, but the prefix is configurable during OAuth. The plugin tells OpenCode to learn the actual restriction from the API, and to try a failed creation again one time with the required prefix.

Full access during OAuth removes the prefix restriction and gives access to every Sprite in the organization. Use it only when organization-wide control is your intention.

## Safety

Sprite state is durable:

- Destruction of a Sprite permanently deletes its filesystem, services, checkpoints, and URL.
- Restoration of a checkpoint discards newer filesystem state.
- An update of a network policy replaces the complete rule set. It does not merge the rules.

Anything that a Sprite URL serves can be accessible from the internet. Do not expose secrets, environment variables, tokens, arbitrary files, admin or debug endpoints, or unfiltered logs over HTTP.

## Troubleshooting

If the Sprites tools are not available:

1. Run `opencode mcp list`, or `opencode2 mcp list`, and make sure that the server is in the list.
2. Restart OpenCode to load the plugin and its MCP configuration again. Under OpenCode 2, `opencode2 service restart` does this.
3. Run `opencode mcp auth sprites`, or `opencode2 mcp auth sprites`, if the server is in the list but is not authorized.
4. Under OpenCode 1, `opencode mcp debug sprites` reports OAuth discovery and connectivity.

Replace `sprites` in these commands if you set a different `mcpName`.

Do not install the Sprites CLI, use raw Sprites API calls, invent access tokens, or register a second Sprites MCP server as an authentication workaround.

## Contributing

Refer to [CONTRIBUTING.md](CONTRIBUTING.md) for local development, tests, implementation notes, and the release process.

## License

MIT
