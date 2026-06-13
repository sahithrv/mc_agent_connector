import assert from "node:assert/strict";
import test from "node:test";

import type { Position } from "@mc-ai-video/contracts";

import type { BotBlock } from "../bots/types";
import { createDefaultActionRegistry } from "./index";
import { actionRequest, fakeAgent, fakeBot } from "./test-helpers";

test("default registry includes farming actions", () => {
  const actions = createDefaultActionRegistry().list().map((action) => action.name);

  assert.ok(actions.includes("harvest_crop"));
  assert.ok(actions.includes("plant_crop"));
});

test("harvest_crop digs a mature crop and replants when seeds are available", async () => {
  const crop = block("wheat", { x: 1, y: 64, z: 0 }, { metadata: 7 });
  const farmland = block("farmland", { x: 1, y: 63, z: 0 });
  const dug: BotBlock[] = [];
  const equipped: unknown[] = [];
  const placed: BotBlock[] = [];

  const result = await createDefaultActionRegistry().run(
    actionRequest("harvest_crop", {
      position: crop.position,
      crop: "wheat",
      replant: true,
    }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        inventory: {
          items: () => [{ name: "wheat_seeds", count: 3 }],
          emptySlotCount: () => 1,
        },
        blockAt(position) {
          return samePosition(position, crop.position)
            ? crop
            : samePosition(position, farmland.position)
              ? farmland
              : null;
        },
        async dig(target) {
          dug.push(target);
        },
        async equip(item) {
          equipped.push(item);
        },
        async placeBlock(target) {
          placed.push(target);
        },
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.crop, "wheat");
  assert.equal(result.data?.replanted, true);
  assert.equal(result.data?.seed, "wheat_seeds");
  assert.deepEqual(dug, [crop]);
  assert.deepEqual(equipped, [{ name: "wheat_seeds", count: 3 }]);
  assert.deepEqual(placed, [farmland]);
});

test("harvest_crop rejects immature crops before digging", async () => {
  let digCalls = 0;
  const result = await createDefaultActionRegistry().run(
    actionRequest("harvest_crop", {
      position: { x: 1, y: 64, z: 0 },
      crop: "wheat",
    }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        blockAt: () => block("wheat", { x: 1, y: 64, z: 0 }, { metadata: 4 }),
        async dig() {
          digCalls += 1;
        },
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not mature/);
  assert.equal(digCalls, 0);
});

test("plant_crop plants an available seed on nearby farmland", async () => {
  const farmland = block("farmland", { x: 2, y: 64, z: 0 });
  const air = block("air", { x: 2, y: 65, z: 0 });
  const equipped: unknown[] = [];
  const placed: BotBlock[] = [];

  const result = await createDefaultActionRegistry().run(
    actionRequest("plant_crop", {
      position: farmland.position,
    }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        inventory: {
          items: () => [{ name: "carrot", count: 2 }],
          emptySlotCount: () => 1,
        },
        blockAt(position) {
          return samePosition(position, farmland.position)
            ? farmland
            : samePosition(position, air.position)
              ? air
              : null;
        },
        async equip(item) {
          equipped.push(item);
        },
        async placeBlock(target) {
          placed.push(target);
        },
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.seed, "carrot");
  assert.equal(result.data?.crop, "carrot");
  assert.deepEqual(equipped, [{ name: "carrot", count: 2 }]);
  assert.deepEqual(placed, [farmland]);
});

test("plant_crop accepts the air block above farmland as the target", async () => {
  const farmland = block("farmland", { x: 1, y: 64, z: 1 });
  const air = block("air", { x: 1, y: 65, z: 1 });
  const placed: BotBlock[] = [];

  const result = await createDefaultActionRegistry().run(
    actionRequest("plant_crop", {
      position: air.position,
      crop: "beetroot",
    }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        inventory: {
          items: () => [{ name: "beetroot_seeds", count: 1 }],
          emptySlotCount: () => 1,
        },
        blockAt(position) {
          return samePosition(position, air.position)
            ? air
            : samePosition(position, farmland.position)
              ? farmland
              : null;
        },
        async equip() {},
        async placeBlock(target) {
          placed.push(target);
        },
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(placed, [farmland]);
});

test("plant_crop rejects targets farther than five blocks", async () => {
  const farmland = block("farmland", { x: 6, y: 64, z: 0 });
  const air = block("air", { x: 6, y: 65, z: 0 });
  let placeCalls = 0;

  const result = await createDefaultActionRegistry().run(
    actionRequest("plant_crop", {
      position: farmland.position,
      seed: "wheat_seeds",
    }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        inventory: {
          items: () => [{ name: "wheat_seeds", count: 1 }],
          emptySlotCount: () => 1,
        },
        blockAt(position) {
          return samePosition(position, farmland.position)
            ? farmland
            : samePosition(position, air.position)
              ? air
              : null;
        },
        async equip() {},
        async placeBlock() {
          placeCalls += 1;
        },
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /farther than 5 blocks/);
  assert.equal(placeCalls, 0);
});

function block(
  name: string,
  position: Position,
  extra: Record<string, unknown> = {},
): BotBlock {
  return {
    name,
    position,
    ...extra,
  };
}

function samePosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}
