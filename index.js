const DEFAULT_MCP_NAME = "sprites";
const DEFAULT_MCP_URL = "https://sprites.dev/mcp";
const DEFAULT_MCP_TIMEOUT_MS = 60_000;
const STATUS_CACHE_MS = 30_000;

const DEFAULT_HEADERS = Object.freeze({
  "Fly-Client-Interactive": "false",
  "Fly-Client-Agent": "opencode",
});

const RISKY_RAW_TOOLS = Object.freeze([
  "destroy_sprite",
  "checkpoint_restore",
  "policy_network_update",
]);

const SPRITES_TRIGGER =
  /\bsprites\.dev\b|\bfly\s+sprites?\b|\bsprites_[a-zA-Z0-9_-]*/i;

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

/** @param {string} value */
function sanitize(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** @param {string} mcpName @param {string} rawName */
function toolName(mcpName, rawName) {
  return `${sanitize(mcpName)}_${sanitize(rawName)}`;
}

/** @param {string} mcpName @param {string} rawName */
function toolPermissionPattern(mcpName, rawName) {
  return `${sanitize(mcpName)}_*${sanitize(rawName)}`;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asRecord(value) {
  return isRecord(value) ? value : {};
}

/** @param {unknown} value @param {string} name @param {string} fallback */
function stringOption(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `Sprites plugin option ${name} must be a non-empty string`,
    );
  }
  return value.trim();
}

/** @param {unknown} value @param {string} name @param {boolean} fallback */
function booleanOption(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`Sprites plugin option ${name} must be a boolean`);
  }
  return value;
}

/** @param {unknown} value */
function headersOption(value) {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new TypeError(
      "Sprites plugin option headers must be a string-to-string object",
    );
  }
  /** @type {Record<string, string>} */
  const headers = {};
  for (const [key, header] of Object.entries(value)) {
    if (typeof header !== "string") {
      throw new TypeError(`Sprites plugin header ${key} must be a string`);
    }
    headers[key] = header;
  }
  return headers;
}

/** @param {import("@opencode-ai/plugin").PluginOptions | undefined} raw */
function parseOptions(raw) {
  const input = raw ?? {};
  const mcpName = stringOption(input.mcpName, "mcpName", DEFAULT_MCP_NAME);
  const url = stringOption(input.url, "url", DEFAULT_MCP_URL);
  const parsedURL = new URL(url);
  if (parsedURL.protocol !== "https:" && parsedURL.protocol !== "http:") {
    throw new TypeError("Sprites plugin option url must use http or https");
  }

  const timeoutValue = input.timeout ?? DEFAULT_MCP_TIMEOUT_MS;
  if (!Number.isInteger(timeoutValue) || Number(timeoutValue) <= 0) {
    throw new TypeError(
      "Sprites plugin option timeout must be a positive integer",
    );
  }

  return {
    mcpName,
    url: parsedURL.toString(),
    timeout: Number(timeoutValue),
    headers: { ...DEFAULT_HEADERS, ...headersOption(input.headers) },
    mcp: booleanOption(input.mcp, "mcp", true),
    commands: booleanOption(input.commands, "commands", true),
    guidance: booleanOption(input.guidance, "guidance", true),
    permissions: booleanOption(input.permissions, "permissions", true),
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

/** @param {string} mcpName */
function commandDefaults(mcpName) {
  const list = toolName(mcpName, "list_sprites");
  return {
    "sprites-status": {
      description: "Check Sprites connectivity and list visible environments",
      template: [
        "Perform a read-only Sprites integration check.",
        `Call ${list} and summarize each Sprite's exact name, status, and URL.`,
        "An empty list is a successful authenticated result.",
        "Do not create, modify, restore, stop, or destroy anything.",
        `If authentication is required, tell me to complete OpenCode's OAuth flow for the ${mcpName} MCP server, then retry once.`,
      ].join(" "),
    },
    "sprites-smoke": {
      description: "Run a safe list, create, and exec Sprites smoke test",
      template: [
        `Run a Sprites smoke test using only ${sanitize(mcpName)}_* MCP tools: list Sprites, create a short-lived task-named Sprite,`,
        "then run `echo smoke-ok` in it and report the exit status and output.",
        "Do not destroy the Sprite unless I explicitly request cleanup after seeing its exact name; otherwise leave it running and report it.",
        "Additional request: $ARGUMENTS",
      ].join(" "),
    },
  };
}

/** @param {string} mcpName */
function systemGuidance(mcpName) {
  const prefix = sanitize(mcpName);
  const list = toolName(mcpName, "list_sprites");
  const create = toolName(mcpName, "create_sprite");
  const exec = toolName(mcpName, "exec");
  return `## Sprites plugin

Sprites are persistent, isolated remote Linux development environments. OpenCode is outside each Sprite: the local workspace and shell are not the Sprite filesystem. Use the \`${prefix}_*\` MCP tools as the control plane for Sprites, remote sandboxes, and isolated compute.

- List with \`${list}\`; an empty list is authenticated success. Create with \`${create}\`. Every Sprite-scoped call needs the exact returned Sprite name.
- Restricted OAuth connectors require a name prefix, commonly \`mcp-\` but possibly customized. If create reports a required prefix, retry once with that exact prefix and report the actual name. Do not invent credentials or fall back to raw HTTP or a Sprites CLI.
- Use \`${exec}\` for short remote commands and \`${prefix}_service_*\` for long-running processes. Use \`${prefix}_checkpoint_*\` for reversible filesystem work and \`${prefix}_policy_network_*\` for outbound access.
- There is no dedicated remote file-write tool. Prefer cloning repositories. For small generated files, encode content locally as base64 and use a simple remote decode command; avoid fragile heredocs and nested shell quoting.
- If no target was named, list Sprites and choose only an obvious match; ask when ambiguous. Keep responses focused on names, status, URLs, exit codes, service state, and checkpoint IDs.
- \`${toolName(mcpName, "destroy_sprite")}\` is irreversible: call it only after explicit delete/destroy/remove intent for the exact Sprite.
- \`${toolName(mcpName, "checkpoint_restore")}\` discards newer filesystem state: confirm the exact Sprite and checkpoint and offer to checkpoint the current state first.
- \`${toolName(mcpName, "policy_network_update")}\` replaces the complete outbound rule set: read the current policy first and send the intended complete policy.
- Before risky installs, migrations, or destructive commands through \`${exec}\`, create a checkpoint. If a created service has an HTTP port, treat it as internet-accessible and never expose secrets, environment variables, arbitrary files, admin/debug endpoints, or unfiltered logs.
- OpenCode handles OAuth for the remote MCP server. If automatic authentication does not start, direct the user to \`opencode mcp auth ${mcpName}\`, wait for completion, and retry the original tool once.`;
}

/** @param {unknown} parts @param {string} toolPrefix */
function mentionsSprites(parts, toolPrefix) {
  if (!Array.isArray(parts)) return false;
  return parts.some(
    (part) =>
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string" &&
      (SPRITES_TRIGGER.test(part.text) ||
        part.text.toLowerCase().includes(toolPrefix.toLowerCase())),
  );
}

/** @type {import("@opencode-ai/plugin").Plugin} */
const SpritesPlugin = async ({ client, directory }, rawOptions) => {
  const options = parseOptions(rawOptions);
  const commands = commandDefaults(options.mcpName);
  const guidance = systemGuidance(options.mcpName);
  const riskyPermissions = RISKY_RAW_TOOLS.map((name) => ({
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
      if (guidanceEnabled && mentionsSprites(output.parts, toolPrefix))
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
      const context = `Preserve active Sprites state: exact target names, the learned OAuth name prefix, relevant URLs, service states, checkpoint IDs, network-policy decisions, and pending destructive-operation approvals. Keep local OpenCode state distinct from remote Sprite state. The MCP server name is ${options.mcpName}.`;
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
