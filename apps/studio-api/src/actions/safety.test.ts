import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultActionRegistry } from "./index";
import { actionRequest, fakeAgent, fakeBot } from "./test-helpers";

test("move, follow, and flee fail clearly on timeout", async () => {
  for (const [action, params] of [
    ["move_to", { position: { x: 4, y: 64, z: 0 } }],
    ["follow_player", { username: "Steve" }],
    ["flee", { position: { x: -2, y: 64, z: 0 } }],
  ] as const) {
    let stopped = 0;
    const result = await createDefaultActionRegistry().run(
      actionRequest(action, params, 5),
      {
        agent: fakeAgent(),
        bot: fakeBot({
          pathfinder: {
            goto: () => new Promise<void>(() => {}),
            stop: () => {
              stopped += 1;
            },
          },
          entities: {
            steve: {
              id: 2,
              type: "player",
              username: "Steve",
              position: { x: 2, y: 64, z: 0 },
            },
          },
        }),
      },
    );

    assert.equal(result.ok, false, action);
    assert.match(result.error ?? "", /timed out/, action);
    assert.equal(stopped, 1, action);
  }
});

test("move_to waits for pathfinder goto when setGoal also exists", async () => {
  let gotoCalls = 0;
  let setGoalCalls = 0;
  let stopped = 0;
  const result = await createDefaultActionRegistry().run(
    actionRequest("move_to", { position: { x: 4, y: 64, z: 0 } }, 5),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        pathfinder: {
          goto: () => {
            gotoCalls += 1;
            return new Promise<void>(() => {});
          },
          setGoal: () => {
            setGoalCalls += 1;
          },
          stop: () => {
            stopped += 1;
          },
        },
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /timed out/);
  assert.equal(gotoCalls, 1);
  assert.equal(setGoalCalls, 0);
  assert.equal(stopped, 1);
});

test("collect_item validates inventory space", async () => {
  const result = await createDefaultActionRegistry().run(
    actionRequest("collect_item", { item: "diamond" }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        collectBlock: {
          async collect() {},
        },
        inventory: {
          items: () => [],
          emptySlotCount: () => 0,
        },
        entities: {
          drop: {
            id: 3,
            type: "object",
            name: "diamond",
            position: { x: 1, y: 64, z: 0 },
          },
        },
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no empty slots/);
});

test("collect_item stops pathfinder when collection times out", async () => {
  let collectCalls = 0;
  let stopped = 0;
  const result = await createDefaultActionRegistry().run(
    actionRequest("collect_item", { item: "diamond" }, 5),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        collectBlock: {
          collect() {
            collectCalls += 1;
            return new Promise<void>(() => {});
          },
        },
        pathfinder: {
          goto: async () => {},
          stop: () => {
            stopped += 1;
          },
        },
        entities: {
          drop: {
            id: 3,
            type: "object",
            name: "diamond",
            position: { x: 1, y: 64, z: 0 },
          },
        },
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /timed out/);
  assert.equal(collectCalls, 1);
  assert.equal(stopped, 1);
});

test("mine_block rejects unsafe requests", async () => {
  const result = await createDefaultActionRegistry().run(
    actionRequest("mine_block", {
      position: { x: 1, y: 64, z: 0 },
      block: "bedrock",
    }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        blockAt: () => ({ name: "bedrock", position: { x: 1, y: 64, z: 0 } }),
        async dig() {},
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /unsafe block/);
});

test("attack_entity has a friendly-fire guard", async () => {
  const result = await createDefaultActionRegistry().run(
    actionRequest("attack_entity", { username: "Steve" }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        attack() {},
        entities: {
          steve: {
            id: 2,
            type: "player",
            username: "Steve",
            position: { x: 2, y: 64, z: 0 },
          },
        },
      }),
      policy: {
        playerTeams: {
          steve: "blue",
        },
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /friendly-fire/);
});
