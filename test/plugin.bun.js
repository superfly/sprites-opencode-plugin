import { expect, test } from "bun:test";

import plugin from "../index.js";

test("loads and configures under Bun", async () => {
  const hooks = await plugin.server({
    client: {
      mcp: {
        status: async () => ({ data: { sprites: { status: "connected" } } }),
      },
    },
    directory: "/work",
  });
  const config = {};

  await hooks.config(config);

  expect(config.mcp.sprites.url).toBe("https://sprites.dev/mcp");
  expect(config.permission["sprites_*destroy_sprite"]).toBe("ask");
});
