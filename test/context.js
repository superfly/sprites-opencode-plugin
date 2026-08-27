/**
 * A stand-in for the OpenCode 2 plugin context.
 *
 * OpenCode keeps transforms and replays them on a fresh draft each time it
 * materializes the configuration, so this harness does the same. Registrations
 * remove their own contribution, and event delivery waits for the plugin to
 * process the event.
 *
 * Every method is typed with the signature from `@opencode-ai/plugin`, so the
 * harness cannot offer an easier API than the runtime. `test/type-contract.ts`
 * asserts the same thing for the assembled context.
 *
 * @typedef {import("@opencode-ai/plugin-v2").Plugin.Context} Context
 * @typedef {import("@opencode-ai/plugin-v2/promise/registration").Registration} Registration
 * @typedef {import("@opencode-ai/plugin-v2/promise/mcp").MCPDraft} MCPDraft
 * @typedef {import("@opencode-ai/plugin-v2/promise/command").CommandDraft} CommandDraft
 * @typedef {import("@opencode-ai/plugin-v2/promise/command").CommandDefinition} CommandDefinition
 * @typedef {Context["event"]["subscribe"] extends (...args: never[]) => AsyncIterable<infer E> ? E : never} ServerEvent
 */

/**
 * @param {object} [input]
 * @param {Record<string, unknown>} [input.options]
 * @param {Record<string, unknown>} [input.servers] Servers that configuration already defines.
 * @param {string[]} [input.commands] Command names that configuration already defines.
 * @param {"connected" | "pending" | "disabled" | "failed" | "needs_auth"} [input.status]
 * @param {() => void} [input.onMcpList]
 */
export function createContext({
  options = {},
  servers = {},
  commands = [],
  status = "connected",
  onMcpList = () => {},
} = {}) {
  // The lower-precedence layer that OpenCode builds from configuration.
  const configuredServers = Object.entries(servers);
  const configuredCommands = commands.map((name) => ({ name }));

  /** @type {{callback: (draft: MCPDraft) => void}[]} */
  const mcpTransforms = [];
  /** @type {{callback: (draft: CommandDraft) => void}[]} */
  const commandTransforms = [];
  /** @type {Map<string, {callback: (input: any) => unknown}[]>} */
  const hooks = new Map();
  /** @type {unknown[]} */
  const prompts = [];
  /** @type {Set<(item: {event: ServerEvent, done: () => void}) => void>} */
  const listeners = new Set();

  /**
   * Removes one entry from a list, one time only.
   *
   * @template T
   * @param {T[]} list
   * @param {T} entry
   * @returns {Registration}
   */
  function registration(list, entry) {
    return {
      dispose: async () => {
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
      },
    };
  }

  /**
   * @template T
   * @param {{callback: (draft: T) => void}[]} list
   * @param {(draft: T) => void} callback
   */
  function transform(list, callback) {
    const entry = { callback };
    list.push(entry);
    return registration(list, entry);
  }

  /**
   * @param {string} domain
   * @param {string | number | symbol} name
   * @param {(input: any) => unknown} callback
   */
  function hook(domain, name, callback) {
    const key = `${domain}.${String(name)}`;
    const list = hooks.get(key) ?? [];
    hooks.set(key, list);
    const entry = { callback };
    list.push(entry);
    return registration(list, entry);
  }

  /** Replays every active transform, the way OpenCode does after a reload. */
  function materialize() {
    /** @type {Map<string, any>} */
    const draftServers = new Map(configuredServers);
    for (const { callback } of mcpTransforms) {
      callback({
        list: () => [...draftServers.entries()],
        get: (name) => draftServers.get(name),
        set: (name, config) => draftServers.set(name, config),
        update: (name, update) => update(draftServers.get(name)),
        remove: (name) => draftServers.delete(name),
      });
    }

    /** @type {(CommandDefinition | {name: string})[]} */
    const draftCommands = configuredCommands.map((command) => ({ ...command }));
    for (const { callback } of commandTransforms) {
      callback({
        add: (definition) => {
          const index = draftCommands.findIndex(
            (command) => command.name === definition.name,
          );
          if (index >= 0) draftCommands[index] = definition;
          else draftCommands.push(definition);
        },
      });
    }

    return { servers: draftServers, commands: draftCommands };
  }

  // Location identifiers are branded strings at the type level.
  const location = /** @type {Context["location"]} */ (
    /** @type {unknown} */ ({
      directory: "/work",
      project: { id: "test", directory: "/work", canonical: "/work" },
    })
  );

  /**
   * Status is per server, so a test can move one server between states while
   * the others stay the same.
   *
   * @type {Map<string, "connected" | "pending" | "disabled" | "failed" | "needs_auth">}
   */
  const serverStatus = new Map();

  /** @param {string} name */
  function statusOf(name) {
    const current = serverStatus.get(name) ?? status;
    // A failed server always reports why it failed.
    return current === "failed"
      ? /** @type {const} */ ({ status: current, error: "test failure" })
      : { status: current };
  }

  const ctx = {
    app: { name: "cli", version: "0.0.0-test", channel: "beta" },
    location,
    options,
    mcp: {
      list: async () => {
        onMcpList();
        return {
          location,
          data: [...materialize().servers.keys()].map((name) => ({
            name,
            status: statusOf(name),
          })),
        };
      },
      /** @param {(draft: MCPDraft) => void} callback */
      transform: async (callback) => transform(mcpTransforms, callback),
    },
    command: {
      list: async () => ({
        location,
        data: /** @type {any} */ (materialize().commands),
      }),
      /** @param {(draft: CommandDraft) => void} callback */
      transform: async (callback) => transform(commandTransforms, callback),
    },
    permission: {
      /** @type {Context["permission"]["hook"]} */
      hook: async (name, callback) => hook("permission", name, callback),
    },
    session: {
      /** @type {Context["session"]["hook"]} */
      hook: async (name, callback) => hook("session", name, callback),
      /** @type {Context["session"]["prompt"]} */
      prompt: async (input) => {
        prompts.push(input);
        return /** @type {any} */ (input);
      },
    },
    tool: {
      /** @type {Context["tool"]["hook"]} */
      hook: async (name, callback) => hook("tool", name, callback),
    },
    event: {
      /** @param {{signal?: AbortSignal}} [requestOptions] */
      subscribe: ({ signal } = {}) => ({
        async *[Symbol.asyncIterator]() {
          /** @type {{event: ServerEvent, done: () => void}[]} */
          const queue = [];
          /** @type {(() => void) | undefined} */
          let wake;
          /** @param {{event: ServerEvent, done: () => void}} item */
          const listener = (item) => {
            queue.push(item);
            wake?.();
          };
          listeners.add(listener);
          try {
            while (!signal?.aborted) {
              if (queue.length === 0) {
                await new Promise((resolve) => {
                  wake = () => resolve(undefined);
                  signal?.addEventListener("abort", wake, { once: true });
                });
                wake = undefined;
              }
              while (queue.length > 0) {
                const item =
                  /** @type {{event: ServerEvent, done: () => void}} */ (
                    queue.shift()
                  );
                try {
                  // The generator resumes only after the consumer's loop body
                  // finishes, so this reports real delivery.
                  yield item.event;
                } finally {
                  item.done();
                }
              }
            }
          } finally {
            listeners.delete(listener);
            for (const item of queue) item.done();
          }
        },
      }),
    },
  };

  return {
    ctx,
    prompts,
    servers: () => materialize().servers,
    commands: () => materialize().commands,
    /**
     * Changes one server's status, the way a connection change does.
     *
     * @param {string} name
     * @param {"connected" | "pending" | "disabled" | "failed" | "needs_auth"} next
     */
    setStatus(name, next) {
      serverStatus.set(name, next);
    },
    /** @param {string} name */
    command: (name) =>
      materialize().commands.find((entry) => entry.name === name),
    /**
     * Invokes every callback registered for a hook, in registration order.
     *
     * @param {string} key
     * @template T
     * @param {T} input
     */
    async fire(key, input) {
      for (const { callback } of hooks.get(key) ?? []) await callback(input);
      return input;
    },
    /** @param {string} key */
    has: (key) => (hooks.get(key)?.length ?? 0) > 0,
    /**
     * Publishes an event and waits until every subscriber has processed it.
     *
     * @param {any} event
     */
    async emit(event) {
      if (listeners.size === 0) return;
      await Promise.all(
        [...listeners].map(
          (listener) =>
            new Promise((resolve) =>
              listener({ event, done: () => resolve(undefined) }),
            ),
        ),
      );
    },
  };
}
