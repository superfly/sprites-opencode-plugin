/**
 * The OpenCode 1 entry point, loaded through the package's "./server" export.
 *
 * OpenCode 1 has a configuration hook, so this entry point writes the MCP
 * server, the commands, and the permission defaults into the configuration.
 */

import {
  DEFAULT_HEADERS,
  RISKY_RAW_TOOLS,
  booleanOption,
  commandTemplates,
  commonOptions,
  compactionContext,
  isRecord,
  mentionsSprites,
  millisecondsOption,
  sanitize,
  systemGuidance,
  toolName,
} from "./shared.js";

const DEFAULT_MCP_TIMEOUT_MS = 60_000;
const STATUS_CACHE_MS = 30_000;

/**
 * @typedef {object} SpritesOptions
 * @property {string=} mcpName Name used to register the MCP server.
 * @property {string=} url Sprites MCP endpoint, including staging or self-hosted endpoints.
 * @property {number=} timeout MCP connection and discovery timeout in milliseconds.
 * @property {Record<string, string>=} headers Additional or replacement request headers.
 * @property {boolean=} mcp Register the default MCP server.
 * @property {boolean=} commands Register the Sprites slash commands.
 * @property {boolean=} guidance Inject Sprites workflow guidance for relevant sessions.
 * @property {boolean=} permissions Add approval defaults for destructive Sprites tools.
 */

/** @param {string} mcpName @param {string} rawName */
function toolPermissionPattern(mcpName, rawName) {
  return `${sanitize(mcpName)}_*${sanitize(rawName)}`;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
  return isRecord(value) ? value : {};
}

/** @param {import("@opencode-ai/plugin").PluginOptions | undefined} raw */
function parseOptions(raw) {
  const input = raw ?? {};
  return {
    ...commonOptions(input),
    // OpenCode 1 uses one timeout for the connection and for tool discovery.
    timeout: millisecondsOption(
      input.timeout ?? DEFAULT_MCP_TIMEOUT_MS,
      "timeout",
    ),
  };
}

/** @template T @param {Record<string, T>} record @param {string} key @param {T} value */
function addDefault(record, key, value) {
  if (!Object.hasOwn(record, key)) record[key] = value;
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return structuredClone(value);
}

/** @param {unknown} parts @param {string} toolPrefix */
function mentionsParts(parts, toolPrefix) {
  if (!Array.isArray(parts)) return false;
  return parts.some(
    (part) =>
      isRecord(part) &&
      part.type === "text" &&
      mentionsSprites(part.text, toolPrefix),
  );
}

/** @type {import("@opencode-ai/plugin").Plugin} */
const SpritesPlugin = async ({ client, directory }, rawOptions) => {
  const options = parseOptions(rawOptions);
  const commands = commandTemplates(options.mcpName, {
    cli: "opencode",
    argumentsSuffix: "Additional request: $ARGUMENTS",
  });
  const guidance = systemGuidance(options.mcpName, { cli: "opencode" });
  const riskyPermissions = Object.keys(RISKY_RAW_TOOLS).map((name) => ({
    pattern: toolPermissionPattern(options.mcpName, name),
    exact: [
      toolName(options.mcpName, name),
      toolName(options.mcpName, `sprites_${name}`),
    ],
  }));
  const toolPrefix = `${sanitize(options.mcpName)}_`;
  const activeSessions = new Set();
  let guidanceEnabled = options.guidance;
  let serverConfigured = false;
  let statusCache = { checkedAt: 0, usable: true };

  async function serverIsUsable() {
    if (!serverConfigured) return false;
    const now = Date.now();
    if (now - statusCache.checkedAt < STATUS_CACHE_MS)
      return statusCache.usable;
    try {
      const result = await client.mcp.status({ query: { directory } });
      const status = result.data?.[options.mcpName];
      statusCache = {
        checkedAt: now,
        // Missing or failed status should not break an LLM request. Only an
        // explicit disabled state suppresses otherwise relevant guidance.
        usable: status?.status !== "disabled",
      };
    } catch {
      statusCache = { checkedAt: now, usable: true };
    }
    return statusCache.usable;
  }

  return {
    config: async (config) => {
      const mcp = config.mcp ?? {};
      Object.assign(config, { mcp });
      if (options.mcp) {
        addDefault(mcp, options.mcpName, {
          type: "remote",
          url: options.url,
          enabled: true,
          oauth: {},
          headers: clone(options.headers),
          timeout: options.timeout,
        });
      }
      serverConfigured = Object.hasOwn(mcp, options.mcpName);
      const configuredServer = mcp[options.mcpName];
      guidanceEnabled =
        options.guidance &&
        (!isRecord(configuredServer) || configuredServer.enabled !== false);

      if (options.commands) {
        const commandConfig = config.command ?? {};
        Object.assign(config, { command: commandConfig });
        for (const [name, command] of Object.entries(commands)) {
          addDefault(commandConfig, name, clone(command));
        }
      }

      if (options.permissions) {
        /** @type {Record<string, unknown>} */
        let permission;
        if (typeof config.permission === "string") {
          permission = { "*": config.permission };
          Object.assign(config, { permission });
        } else if (isRecord(config.permission)) {
          permission = config.permission;
        } else {
          permission = {};
          Object.assign(config, { permission });
        }

        if (permission["*"] !== "deny") {
          for (const risky of riskyPermissions) {
            // OpenCode evaluates permission rules from last to first. Append
            // our suffix wildcard after broad user rules, then re-append any
            // user-owned exact rules so they remain the final authority.
            const exactRules = risky.exact
              .filter((tool) => Object.hasOwn(permission, tool))
              .map((tool) => ({ tool, action: permission[tool] }));
            const action = Object.hasOwn(permission, risky.pattern)
              ? permission[risky.pattern]
              : "ask";
            delete permission[risky.pattern];
            permission[risky.pattern] = action;
            for (const exact of exactRules) {
              delete permission[exact.tool];
              permission[exact.tool] = exact.action;
            }
          }
        }
      }
    },

    "chat.message": async (input, output) => {
      if (guidanceEnabled && mentionsParts(output.parts, toolPrefix))
        activeSessions.add(input.sessionID);
    },

    "command.execute.before": async (input) => {
      if (
        guidanceEnabled &&
        (input.command === "sprites-status" ||
          input.command === "sprites-smoke")
      ) {
        activeSessions.add(input.sessionID);
      }
    },

    "tool.execute.before": async (input) => {
      if (guidanceEnabled && input.tool.startsWith(toolPrefix))
        activeSessions.add(input.sessionID);
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (
        !input.sessionID ||
        !guidanceEnabled ||
        !activeSessions.has(input.sessionID)
      )
        return;
      if (!(await serverIsUsable())) return;
      if (!output.system.includes(guidance)) output.system.push(guidance);
    },

    "experimental.session.compacting": async (input, output) => {
      if (!guidanceEnabled || !activeSessions.has(input.sessionID)) return;
      const context = compactionContext(options.mcpName);
      if (!output.context.includes(context)) output.context.push(context);
    },

    event: async ({ event }) => {
      if (
        event.type === "session.created" &&
        event.properties.info.parentID &&
        activeSessions.has(event.properties.info.parentID)
      ) {
        activeSessions.add(event.properties.info.id);
      }

      if (event.type === "session.deleted") {
        activeSessions.delete(event.properties.info.id);
      }

      // mcp.tools.changed reaches hooks at runtime but is not yet represented
      // in the v1 Event union used by @opencode-ai/plugin.
      const eventType = /** @type {string} */ (event.type);
      const properties = asRecord(event.properties);
      if (
        eventType === "mcp.tools.changed" &&
        properties.server === options.mcpName
      ) {
        statusCache.checkedAt = 0;
      }
    },

    dispose: async () => {
      activeSessions.clear();
    },
  };
};

/** @type {import("@opencode-ai/plugin").PluginModule} */
const plugin = {
  id: "sprites",
  server: SpritesPlugin,
};

export default plugin;
