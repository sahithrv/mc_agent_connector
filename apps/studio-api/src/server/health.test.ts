import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "./app";

test("GET /healthz returns ok", async () => {
  const app = createApp({
    studioConfig: {
      server: {
        host: "127.0.0.1",
        port: 0,
        logger: false,
      },
      tickRates: {
        schedulerMs: 1000,
        routineMs: 2000,
        perceptionMs: 500,
      },
      database: {
        path: ":memory:",
      },
      llm: {
        maxConcurrency: 1,
      },
    },
    agents: [],
  });

  const response = await app.inject({
    method: "GET",
    url: "/healthz",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
  await app.close();
});
