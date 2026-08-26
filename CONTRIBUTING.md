# Contributing

Thanks for helping improve the Sprites plugin for OpenCode.

## Requirements

- Node.js 20 or newer
- OpenCode 1.18.23 or newer in the 1.x series for integration testing
- Bun when running the Bun smoke test locally

## Set up the repository

Install the locked development dependencies:

```sh
npm ci
```

Point OpenCode at the checkout while developing:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/sprites-opencode-plugin"]
}
```

The directory form lets OpenCode resolve the package's `./server` export and enforce its `engines.opencode` range.

For a quick drop-in test, you can instead copy `index.js` to `.opencode/plugins/sprites.js`; global drop-ins live at `~/.config/opencode/plugins/`. OpenCode loads drop-ins as bare file specifiers, so they cannot receive a plugin options object. Use the package-directory form when testing non-default options.

## Run checks

Run the same primary checks used in CI:

```sh
npm run check
npm pack --dry-run
```

`npm run check` verifies formatting, runs strict TypeScript checking, and executes the Node test suite. The integration tests run `opencode debug config` in isolated XDG directories so configuration is exercised by the real OpenCode CLI.

OpenCode installs npm plugins with Bun, so CI also runs an import and configuration smoke test under Bun:

```sh
npm run test:bun
```

CI runs the Node suite on Node.js 20 and 24.

## Implementation notes

- `index.js` is the package entry point and exports the preferred OpenCode v1 plugin module. The `./server` export supports package-directory loading.
- The plugin registers the Sprites MCP server, commands, permission defaults, session-scoped system guidance, compaction guidance, and event handling.
- Guidance activates only for explicit Sprites signals or Sprites tool calls. Active state propagates to child sessions and is removed when a session is deleted.
- OpenCode always prefixes MCP tools with the server name. Destructive permission patterns intentionally cover both the verified raw Sprites tool names and redundantly prefixed variants.
- OpenCode's system-transform hook does not identify small-model calls. After a session becomes active, title or summary generation that reuses the session ID may also receive the Sprites guidance.
- OpenCode's MCP timeout controls both initial connection and tool discovery. Keep changes to the 60-second default mindful of startup stalls when the endpoint is unavailable.
- The MCP status cache is deliberately longer than one model step and is invalidated by MCP tool-change events.

When changing hooks or configuration behavior, update the unit tests and the SDK contract assertions in `test/type-contract.ts`. When changing package loading or option handling, update the real OpenCode integration tests as well.

## Pull requests

Keep changes focused, explain user-visible behavior, and include tests for behavior changes. Before opening a pull request, run the checks above and ensure `git diff --check` reports no whitespace errors.

## Release process

Publishing requires access to the `@flydotio` npm organization.

For the initial package publish, configure an `NPM_TOKEN` secret in the repository's `npm` GitHub environment. Publishing a GitHub release then runs the release workflow with provenance.

After the package exists on npmjs.com, configure npm trusted publishing for this repository and remove the `NODE_AUTH_TOKEN` fallback from `.github/workflows/release.yml`.
