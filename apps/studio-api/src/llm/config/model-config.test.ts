import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelConfig, selectModelLane, validateModelConfigMatrix } from "./index";

test("model config validation catches missing model", () => {
  assert.throws(
    () => validateModelConfigMatrix({
      lanes: {
        cheap: { provider: "openai", model: "gpt-cheap" },
        premium: { provider: "openai" },
      },
    }),
    /missing model/,
  );
});

test("model config resolves per-agent provider model temperature and max tokens", () => {
  const resolved = resolveModelConfig({
    matrix: {
      default: { provider: "openai", temperature: 0.3, maxTokens: 500 },
      lanes: {
        cheap: { model: "gpt-cheap" },
        premium: { model: "gpt-premium", maxTokens: 1200 },
      },
      agents: {
        leader: {
          default: { provider: "anthropic" },
          lanes: { premium: { temperature: 0.7 } },
        },
      },
    },
    agentId: "leader",
    taskType: "major_moment",
  });

  assert.deepEqual(resolved, {
    provider: "anthropic",
    model: "gpt-premium",
    temperature: 0.7,
    maxTokens: 1200,
  });
});

test("model config selects cheap lane for routine speech/reflection and premium for leaders", () => {
  assert.equal(selectModelLane("routine_speech"), "cheap");
  assert.equal(selectModelLane("routine_reflection"), "cheap");
  assert.equal(selectModelLane("decision", true), "premium");

  const matrix = {
    default: { provider: "openai" },
    lanes: {
      cheap: { model: "gpt-cheap" },
      premium: { model: "gpt-premium" },
    },
  };

  assert.equal(resolveModelConfig({ matrix, agentId: "farmer", taskType: "routine_reflection" }).model, "gpt-cheap");
  assert.equal(resolveModelConfig({ matrix, agentId: "leader", taskType: "leader_planning" }).model, "gpt-premium");
});
