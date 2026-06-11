import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { AgentRegistry } from "../agents/registry";
import { createMineflayerBotFactory } from "./factory";
import { BotLifecycleManager } from "./lifecycle";
import type { BotEntity, BotEventHandler, BotHandle, BotLifecycleEvent } from "./types";

test("Mineflayer bot factory can be mocked", async () => {
  const bot = new FakeBot("AdaBot");
  const seenOptions: unknown[] = [];
  const factory = createMineflayerBotFactory({
    server: { host: "127.0.0.1", port: 25565, version: "1.20.4" },
    createBot(options) {
      seenOptions.push(options);
      return bot;
    },
  });

  assert.equal(await factory.connect(agent()), bot);
  assert.deepEqual(seenOptions, [{
    host: "127.0.0.1",
    port: 25565,
    username: "AdaBot",
    auth: "offline",
    version: "1.20.4",
  }]);
});

test("BotLifecycleManager handles spawn, kicked, error, and end events", async () => {
  const spawned = await setupLifecycle();
  spawned.bot.emit("spawn");
  assert.equal(spawned.manager.getStatus("agent-a").status, "connected");
  assert.equal(spawned.registry.get("agent-a")?.mode, "routine");

  const kicked = await setupLifecycle();
  kicked.bot.emit("kicked", "no whitelist");
  assert.equal(kicked.manager.getStatus("agent-a").status, "failed");
  assert.match(kicked.registry.get("agent-a")?.lastError ?? "", /kicked/);

  const errored = await setupLifecycle();
  errored.bot.emit("error", new Error("socket closed"));
  assert.equal(errored.manager.getStatus("agent-a").status, "failed");
  assert.match(errored.registry.get("agent-a")?.lastError ?? "", /socket closed/);

  const ended = await setupLifecycle();
  ended.bot.emit("end");
  assert.equal(ended.manager.getStatus("agent-a").status, "failed");
  assert.match(ended.registry.get("agent-a")?.lastError ?? "", /ended/);
});

test("BotLifecycleManager disconnects intentionally without failing the agent", async () => {
  const { manager, registry, bot } = await setupLifecycle();

  await manager.disconnect("agent-a");

  assert.equal(bot.quitReason, "studio disconnect");
  assert.equal(manager.getStatus("agent-a").status, "disconnected");
  assert.equal(registry.get("agent-a")?.mode, "paused");
  assert.equal(registry.get("agent-a")?.hasBot, false);
});

async function setupLifecycle() {
  const registry = new AgentRegistry([agent()]);
  const bot = new FakeBot("AdaBot");
  const manager = new BotLifecycleManager(registry, {
    async connect() {
      return bot;
    },
  });

  await manager.connect("agent-a");
  return { manager, registry, bot };
}

class FakeBot extends EventEmitter implements BotHandle {
  health = 20;
  food = 20;
  quitReason?: string;
  entity: BotEntity;

  constructor(readonly username: string) {
    super();
    this.entity = {
      id: "self",
      type: "player",
      username,
      position: { x: 0, y: 64, z: 0 },
    };
  }

  override on(event: BotLifecycleEvent, handler: BotEventHandler): this {
    super.on(event, handler);
    return this;
  }

  override off(event: BotLifecycleEvent, handler: BotEventHandler): this {
    super.off(event, handler);
    return this;
  }

  chat(): void {}

  quit(reason?: string): void {
    this.quitReason = reason;
  }
}

function agent(): AgentConfig {
  return {
    id: "agent-a",
    name: "Ada",
    account: {
      username: "AdaBot",
      auth: "offline",
    },
    role: "guard",
    team: "blue",
    mode: "routine",
    allowedActions: ["idle"],
    providerRef: "local",
  };
}
