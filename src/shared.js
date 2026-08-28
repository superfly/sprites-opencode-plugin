/**
 * Behavior that the OpenCode 1 and OpenCode 2 entry points have in common.
 *
 * The two plugin APIs are different, but the Sprites rules are not: the same
 * server defaults, the same tool names, the same guidance, the same commands,
 * and the same destructive tools. Keep those here so the two entry points
 * cannot drift apart.
 */

export const DEFAULT_MCP_NAME = "sprites";
export const DEFAULT_MCP_URL = "https://sprites.dev/mcp";

export const DEFAULT_HEADERS = Object.freeze({
  "Fly-Client-Interactive": "false",
  "Fly-Client-Agent": "opencode",
});

/** Raw Sprites tool names that need explicit approval before they run. */
export const RISKY_RAW_TOOLS = Object.freeze({
  destroy_sprite:
    "Destroying a Sprite permanently deletes its filesystem, services, checkpoints, and URL.",
  checkpoint_restore:
    "Restoring a checkpoint discards filesystem state newer than the checkpoint.",
  policy_network_update:
    "Updating a network policy replaces the complete outbound rule set.",
});

const SPRITES_TRIGGER =
  /\bsprites\.dev\b|\bfly\s+sprites?\b|\bsprites_[a-zA-Z0-9_-]*/i;

/** @param {string} value */
export function sanitize(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** @param {string} mcpName @param {string} rawName */
export function toolName(mcpName, rawName) {
  return `${sanitize(mcpName)}_${sanitize(rawName)}`;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {string} name @param {string} fallback */
export function stringOption(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `Sprites plugin option ${name} must be a non-empty string`,
    );
  }
  return value.trim();
}

/** @param {unknown} value @param {string} name @param {boolean} fallback */
export function booleanOption(value, name, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`Sprites plugin option ${name} must be a boolean`);
  }
  return value;
}

/** @param {unknown} value @param {string} name */
export function millisecondsOption(value, name) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError(
      `Sprites plugin option ${name} must be a positive integer`,
    );
  }
  return Number(value);
}

/** @param {unknown} value */
export function headersOption(value) {
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

/** @param {unknown} value */
export function endpointOption(value) {
  const url = stringOption(value, "url", DEFAULT_MCP_URL);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("Sprites plugin option url must use http or https");
  }
  return parsed.toString();
}

/** Options that both entry points accept the same way. */
export function commonOptions(/** @type {Record<string, unknown>} */ input) {
  return {
    mcpName: stringOption(input.mcpName, "mcpName", DEFAULT_MCP_NAME),
    url: endpointOption(input.url),
    headers: { ...DEFAULT_HEADERS, ...headersOption(input.headers) },
    mcp: booleanOption(input.mcp, "mcp", true),
    commands: booleanOption(input.commands, "commands", true),
    guidance: booleanOption(input.guidance, "guidance", true),
    permissions: booleanOption(input.permissions, "permissions", true),
  };
}

/** @param {unknown} text @param {string} toolPrefix */
export function mentionsSprites(text, toolPrefix) {
  if (typeof text !== "string") return false;
  return (
    SPRITES_TRIGGER.test(text) ||
    text.toLowerCase().includes(toolPrefix.toLowerCase())
  );
}

/**
 * Reports why a tool needs approval, or undefined when it does not. The suffix
 * match covers the verified raw tool names and any prefixed variant of them.
 *
 * @param {string} action
 */
export function riskyReason(action) {
  for (const [rawName, reason] of Object.entries(RISKY_RAW_TOOLS)) {
    if (action.endsWith(sanitize(rawName))) return reason;
  }
  return undefined;
}

/**
 * @param {string} mcpName
 * @param {object} [runtime]
 * @param {string} [runtime.cli] Command name that authenticates the MCP server.
 * @param {string} [runtime.argumentsSuffix] Text that carries the caller's own request.
 */
export function commandTemplates(mcpName, runtime = {}) {
  const { cli = "opencode", argumentsSuffix } = runtime;
  const list = toolName(mcpName, "list_sprites");
  const smoke = [
    `Run a Sprites smoke test using only ${sanitize(mcpName)}_* MCP tools: list Sprites, create a short-lived task-named Sprite,`,
    "then run `echo smoke-ok` in it and report the exit status and output.",
    "Do not destroy the Sprite unless I explicitly request cleanup after seeing its exact name; otherwise leave it running and report it.",
  ];
  if (argumentsSuffix) smoke.push(argumentsSuffix);

  return {
    "sprites-status": {
      description: "Check Sprites connectivity and list visible environments",
      template: [
        "Perform a read-only Sprites integration check.",
        `Call ${list} and summarize each Sprite's exact name, status, and URL.`,
        "An empty list is a successful authenticated result.",
        "Do not create, modify, restore, stop, or destroy anything.",
        `If authentication is required, tell me to run \`${cli} mcp auth ${mcpName}\`, then retry once.`,
      ].join(" "),
    },
    "sprites-smoke": {
      description: "Run a safe list, create, and exec Sprites smoke test",
      template: smoke.join(" "),
    },
  };
}

/**
 * @param {string} mcpName
 * @param {object} [runtime]
 * @param {string} [runtime.cli] Command name that authenticates the MCP server.
 * @param {boolean} [runtime.files] The MCP server offers remote file tools.
 * @param {boolean} [runtime.compaction] The entry point has no compaction hook.
 */
export function systemGuidance(mcpName, runtime = {}) {
  const { cli = "opencode", files = true, compaction = false } = runtime;
  const prefix = sanitize(mcpName);
  const list = toolName(mcpName, "list_sprites");
  const create = toolName(mcpName, "create_sprite");
  const exec = toolName(mcpName, "exec");

  const transfer = files
    ? `- Move files with \`${prefix}_file_read\`, \`${prefix}_file_write\`, \`${prefix}_file_list\`, \`${prefix}_file_delete\`, \`${prefix}_file_rename\`, and \`${prefix}_file_copy\` instead of heredocs and nested shell quoting. Prefer cloning a repository over transferring many files.`
    : "- There is no dedicated remote file-write tool. Prefer cloning repositories. For small generated files, encode content locally as base64 and use a simple remote decode command; avoid fragile heredocs and nested shell quoting.";

  const lines = [
    `## Sprites plugin`,
    "",
    `Sprites are persistent, isolated remote Linux development environments. OpenCode is outside each Sprite: the local workspace and shell are not the Sprite filesystem. Use the \`${prefix}_*\` MCP tools as the control plane for Sprites, remote sandboxes, and isolated compute.`,
    "",
    `- List with \`${list}\`; an empty list is authenticated success. Create with \`${create}\`. Every Sprite-scoped call needs the exact returned Sprite name.`,
    "- Restricted OAuth connectors require a name prefix, commonly `mcp-` but possibly customized. If create reports a required prefix, retry once with that exact prefix and report the actual name. Do not invent credentials or fall back to raw HTTP or a Sprites CLI.",
    `- Use \`${exec}\` for short remote commands and \`${prefix}_service_*\` for long-running processes. Use \`${prefix}_checkpoint_*\` for reversible filesystem work and \`${prefix}_policy_network_*\` for outbound access.`,
    transfer,
    "- If no target was named, list Sprites and choose only an obvious match; ask when ambiguous. Keep responses focused on names, status, URLs, exit codes, service state, and checkpoint IDs.",
    `- \`${toolName(mcpName, "destroy_sprite")}\` is irreversible: call it only after explicit delete/destroy/remove intent for the exact Sprite.`,
    `- \`${toolName(mcpName, "checkpoint_restore")}\` discards newer filesystem state: confirm the exact Sprite and checkpoint and offer to checkpoint the current state first.`,
    `- \`${toolName(mcpName, "policy_network_update")}\` replaces the complete outbound rule set: read the current policy first and send the intended complete policy.`,
    `- Before risky installs, migrations, or destructive commands through \`${exec}\`, create a checkpoint. If a created service has an HTTP port, treat it as internet-accessible and never expose secrets, environment variables, arbitrary files, admin/debug endpoints, or unfiltered logs.`,
    `- OpenCode handles OAuth for the remote MCP server. If automatic authentication does not start, direct the user to \`${cli} mcp auth ${mcpName}\`, wait for completion, and retry the original tool once.`,
  ];

  if (compaction) {
    lines.push(
      "- Compaction drops detail: before summarizing, restate the exact Sprite names, the learned OAuth name prefix, relevant URLs, service states, checkpoint IDs, and pending destructive-operation approvals.",
    );
  }

  return lines.join("\n");
}

/** Context that survives compaction, for entry points with a compaction hook. */
export function compactionContext(/** @type {string} */ mcpName) {
  return `Preserve active Sprites state: exact target names, the learned OAuth name prefix, relevant URLs, service states, checkpoint IDs, network-policy decisions, and pending destructive-operation approvals. Keep local OpenCode state distinct from remote Sprite state. The MCP server name is ${mcpName}.`;
}
