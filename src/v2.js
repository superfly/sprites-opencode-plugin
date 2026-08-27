/**
 * The OpenCode 2 entry point, loaded through the package's "." export.
 *
 * OpenCode 2 has no configuration hook. A plugin registers servers and
 * commands with transforms, and intercepts live operations with hooks.
 */

import {
  RISKY_RAW_TOOLS,
  booleanOption,
  commandTemplates,
  commonOptions,
  isRecord,
  mentionsSprites,
  millisecondsOption,
  riskyReason,
  sanitize,
  systemGuidance,
  toolName,
} from "./shared.js";

const STATUS_CACHE_MS = 30_000;
const MAX_ACTIVE_SESSIONS = 1_000;

/**
 * @typedef {object} SpritesOptions
 * @property {string=} mcpName Name used to register the MCP server.
 * @property {string=} url Sprites MCP endpoint, including staging or self-hosted endpoints.
 * @property {number | {startup?: number, catalog?: number, execution?: number}=} timeout MCP timeout overrides in milliseconds.
 * @property {Record<string, string>=} headers Additional or replacement request headers.
 * @property {false | Record<string, string | number>=} oauth OAuth client settings, or false for header credentials.
 * @property {boolean=} codemode Expose Sprites tools through Code Mode.
 * @property {boolean=} mcp Register the default MCP server.
 * @property {boolean=} commands Register the Sprites slash commands.
 * @property {boolean=} guidance Inject Sprites workflow guidance for relevant sessions.
 * @property {boolean=} permissions Ask before destructive Sprites tools run.
 */

/**
 * OpenCode v2 separates connection, discovery, and execution timeouts. A plain
 * number keeps the v1 spelling and applies to connection and discovery only.
 *
 * @param {unknown} value
 */
function timeoutOption(value) {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    const timeout = millisecondsOption(value, "timeout");
    return { startup: timeout, catalog: timeout };
  }
  if (!isRecord(value)) {
    throw new TypeError(
      "Sprites plugin option timeout must be a positive integer or an object",
    );
  }
  /** @type {{startup?: number, catalog?: number, execution?: number}} */
  const timeout = {};
  for (const key of /** @type {const} */ ([
    "startup",
    "catalog",
    "execution",
  ])) {
    if (value[key] === undefined) continue;
    timeout[key] = millisecondsOption(value[key], `timeout.${key}`);
  }
  if (Object.keys(timeout).length === 0) return undefined;
  return timeout;
}

/** @param {unknown} value */
function oauthOption(value) {
  if (value === undefined) return undefined;
  if (value === false) return /** @type {const} */ (false);
  if (!isRecord(value)) {
    throw new TypeError(
      "Sprites plugin option oauth must be false or an OAuth client object",
    );
  }
  /** @type {Record<string, string | number>} */
  const oauth = {};
  for (const [key, setting] of Object.entries(value)) {
    if (typeof setting !== "string" && typeof setting !== "number") {
      throw new TypeError(
        `Sprites plugin oauth field ${key} must be a string or number`,
      );
    }
    oauth[key] = setting;
  }
  return oauth;
}

/** @param {import("@opencode-ai/plugin-v2").PluginOptions | undefined} raw */
function parseOptions(raw) {
  const input = raw ?? {};
  return {
    ...commonOptions(input),
    timeout: timeoutOption(input.timeout),
    oauth: oauthOption(input.oauth),
    codemode:
      input.codemode === undefined
        ? undefined
        : booleanOption(input.codemode, "codemode", true),
  };
}

/** @param {ReturnType<typeof parseOptions>} options */
function serverConfig(options) {
  /** @type {Record<string, unknown>} */
  const config = {
    type: "remote",
    url: options.url,
    headers: { ...options.headers },
  };
  if (options.oauth !== undefined) config.oauth = options.oauth;
  if (options.codemode !== undefined) config.codemode = options.codemode;
  if (options.timeout !== undefined) config.timeout = { ...options.timeout };
  return /** @type {import("@opencode-ai/plugin-v2").Mcp.ServerConfig} */ (
    /** @type {unknown} */ (config)
  );
}

/**
 * Returns the attachment key only when it carries entries, and strips the
 * mention offsets that no longer line up once a command rewrites the prompt
 * text around the caller's arguments.
 *
 * @template {{mention?: unknown}} T
 * @param {string} key
 * @param {ReadonlyArray<T> | undefined} entries
 */
function withoutMentions(key, entries) {
  if (!entries?.length) return {};
  return {
    [key]: entries.map(({ mention: _mention, ...entry }) => entry),
  };
}

/** @type {import("@opencode-ai/plugin-v2").Plugin.Plugin} */
const SpritesPlugin = {
  id: "sprites",
  async setup(ctx) {
    const options = parseOptions(ctx.options);
    const toolPrefix = `${sanitize(options.mcpName)}_`;
    const guidance = systemGuidance(options.mcpName, {
      cli: "opencode2",
      // OpenCode 2 has no compaction hook, so the instruction lives in the
      // guidance itself.
      compaction: true,
    });
    const templates = commandTemplates(options.mcpName, { cli: "opencode2" });

    /** @type {Set<string>} */
    const activeSessions = new Set();
    let statusCache = { checkedAt: 0, usable: false };

    /** @param {string | undefined} sessionID */
    function activate(sessionID) {
      if (!options.guidance || !sessionID) return;
      activeSessions.delete(sessionID);
      activeSessions.add(sessionID);
      // Session deletion is best-effort, so bound the set rather than trusting
      // every session to announce its end.
      while (activeSessions.size > MAX_ACTIVE_SESSIONS) {
        const oldest = activeSessions.values().next().value;
        if (oldest === undefined) break;
        activeSessions.delete(oldest);
      }
    }

    async function serverIsUsable() {
      const now = Date.now();
      if (now - statusCache.checkedAt < STATUS_CACHE_MS)
        return statusCache.usable;
      try {
        const servers = (await ctx.mcp.list()).data ?? [];
        const server = servers.find((entry) => entry.name === options.mcpName);
        // An empty catalog usually means MCP configuration has not been
        // materialized yet, so treat it as unknown rather than caching a
        // missing server.
        if (server === undefined && servers.length === 0) return true;
        statusCache = {
          checkedAt: now,
          // A missing server means nothing registered it. Only an explicit
          // disabled state suppresses otherwise relevant guidance; a failed or
          // unauthenticated server still needs the recovery instructions.
          usable: server !== undefined && server.status.status !== "disabled",
        };
      } catch {
        statusCache = { checkedAt: now, usable: true };
      }
      return statusCache.usable;
    }

    if (options.mcp) {
      await ctx.mcp.transform((draft) => {
        // A server that configuration or an earlier plugin already defined
        // wins completely.
        if (draft.get(options.mcpName) !== undefined) return;
        draft.set(options.mcpName, serverConfig(options));
      });
    }

    if (options.commands) {
      // OpenCode replays this transform on every reload, and a reload sees the
      // previous registration's commands, so registration cannot be
      // conditional on the current catalog without erasing itself.
      const definitions = Object.entries(templates).map(
        ([name, { description, template }]) => ({
          name,
          description,
          /** @param {import("@opencode-ai/plugin-v2/promise/command").CommandInvocation} input */
          execute: async ({ sessionID, prompt, delivery }) => {
            activate(sessionID);
            const args =
              typeof prompt.text === "string" ? prompt.text.trim() : "";
            // Attachment keys must be absent when there is nothing to send.
            // An explicit undefined fails prompt validation.
            await ctx.session.prompt({
              sessionID,
              text: args
                ? `${template}\n\nAdditional request: ${args}`
                : template,
              ...withoutMentions("files", prompt.files),
              ...withoutMentions("agents", prompt.agents),
              ...withoutMentions("skills", prompt.skills),
              delivery,
            });
          },
        }),
      );

      await ctx.command.transform((draft) => {
        for (const definition of definitions) draft.add(definition);
      });
    }

    if (options.guidance || options.permissions) {
      await ctx.permission.hook("evaluate", (input) => {
        if (!input.action.startsWith(toolPrefix)) return;
        activate(input.sessionID);
        if (!options.permissions) return;
        const reason = riskyReason(input.action);
        // An explicit deny never reaches this hook, and an existing ask needs
        // no escalation.
        if (reason === undefined || input.effect !== "allow") return;
        input.effect = "ask";
        input.message ??= reason;
      });
    }

    if (options.guidance) {
      await ctx.tool.hook("execute.before", (input) => {
        if (input.tool.startsWith(toolPrefix)) activate(input.sessionID);
      });

      await ctx.session.hook("prompt", (input) => {
        if (mentionsSprites(input.prompt.text, toolPrefix))
          activate(input.sessionID);
      });

      await ctx.session.hook("context", async (input) => {
        if (!activeSessions.has(input.sessionID)) return;
        if (!(await serverIsUsable())) return;
        if (input.system.some((part) => part.text === guidance)) return;
        input.system.push({ type: "text", text: guidance });
      });
    }

    const events = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: events.signal,
        })) {
          switch (event.type) {
            case "session.created":
              // A subagent working on Sprites needs the same guidance as the
              // session that started the work.
              if (
                event.data.parentID !== undefined &&
                activeSessions.has(event.data.parentID)
              ) {
                activate(event.data.sessionID);
              }
              break;
            case "session.deleted":
              activeSessions.delete(event.data.sessionID);
              break;
            case "mcp.status.changed":
              if (event.data.server === options.mcpName)
                statusCache = { checkedAt: 0, usable: statusCache.usable };
              break;
          }
        }
      } catch {
        // The stream ends when the plugin unloads or the server goes away.
      }
    })();

    return () => {
      events.abort();
      activeSessions.clear();
    };
  },
};

export default SpritesPlugin;
