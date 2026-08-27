import { expect, test } from "bun:test";

import v1 from "../src/v1.js";
import v2 from "../src/v2.js";
import { createContext } from "./context.js";

test("the OpenCode 1 entry point configures under Bun", async () => {
  const hooks = await v1.server({
    client: {
      mcp: {
        status: async () => ({ data: { sprites: { status: "connected" } } }),
      },
    },
    directory: "/work",
  });
  const config = {};

  await hooks.config(config);

  expect(v1.id).toBe("sprites");
  expect(config.mcp.sprites.url).toBe("https://sprites.dev/mcp");
  expect(config.permission["sprites_*destroy_sprite"]).toBe("ask");
});

test("the OpenCode 2 entry point registers under Bun", async () => {
  const harness = createContext();

  const cleanup = await v2.setup(harness.ctx);

  expect(v2.id).toBe("sprites");
  expect(harness.servers().get("sprites").url).toBe("https://sprites.dev/mcp");
  expect(harness.commands().map((command) => command.name)).toEqual([
    "sprites-status",
    "sprites-smoke",
  ]);

  const evaluation = await harness.fire("permission.evaluate", {
    sessionID: "bun",
    action: "sprites_destroy_sprite",
    resources: ["*"],
    effect: "allow",
  });
  expect(evaluation.effect).toBe("ask");

  await cleanup();
});
