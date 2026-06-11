# LLM Design Plan

## V1 Target

Build a provider-agnostic AI layer that makes agents feel social and reactive while keeping cost, latency, and chaos controlled for 20+ simultaneous Minecraft players.

## Pushback

Do not ask an LLM to play Minecraft every tick. LLMs should choose goals, speech, relationships, betrayals, and high-level actions. Deterministic routines should perform repeated Minecraft mechanics.

## LLM Rules

- LLM code must not import Mineflayer.
- All model outputs must be schema-validated.
- Store prompt inputs and structured outputs for debugging.
- Add short comments for prompt contracts, schema fallback, and rate-limit behavior.
- Prefer small prompts with compact state over giant history dumps.

## Proposed Structure

```text
apps/studio-api/src/llm/
  providers/
  prompts/
  schemas/
  decisions/
  reflection/
  memory/
  scheduling/
  telemetry/
```

## Provider Contract

```ts
type LlmRequest = {
  provider: string;
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schemaName: string;
  temperature: number;
  timeoutMs: number;
};

type LlmResult<T> = {
  ok: true;
  value: T;
  usage?: { inputTokens?: number; outputTokens?: number };
} | {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
};
```

## PR Slices

### L01 LLM module shell
Create `src/llm` folders and barrel exports.
Acceptance: no runtime behavior yet.

### L02 Provider interface
Define `LlmProvider.generateStructured<T>()`.
Acceptance: providers can be mocked in tests.

### L03 Provider registry
Map provider name to implementation.
Acceptance: unknown provider returns typed error.

### L04 Environment secrets loader
Load provider API keys from env without logging values.
Acceptance: missing key fails only when provider is used.

### L05 OpenAI adapter
Implement OpenAI provider behind interface.
Acceptance: mock test covers request mapping.

### L06 Anthropic adapter
Implement Anthropic provider behind interface.
Acceptance: mock test covers request mapping.

### L07 DeepSeek adapter
Implement OpenAI-compatible DeepSeek adapter.
Acceptance: configurable base URL and model.

### L08 Local/OpenRouter adapter placeholder
Add config shape and explicit unsupported error for later.
Acceptance: clear error tells user what is missing.

### L09 Schema validation utility
Add Zod validation for all LLM outputs.
Acceptance: invalid output returns structured failure.

### L10 Agent decision schema
Create schema for intent, action, parameters, speech, confidence, reasoning summary.
Acceptance: rejects unknown actions.

### L11 Reflection schema
Create schema for trust, loyalty, fear, emotional state, new goals, memory summary.
Acceptance: clamps relationship values 0-100.

### L12 Chat message schema
Create schema for AI private/public speech proposals.
Acceptance: rejects empty content and invalid recipients.

### L13 Prompt context builder
Build compact context from perception, role, memories, relationships, recent chat, active scenario.
Acceptance: output has max character budget.

### L14 Persona prompt template
Create stable system prompt for identity, role, speaking style, allowed behavior.
Acceptance: static persona and dynamic state are separated.

### L15 Decision prompt template
Create user prompt asking for one high-level action plus optional speech.
Acceptance: includes available actions and constraints.

### L16 Reflection prompt template
Create prompt for major event reflection only.
Acceptance: asks for deltas, not full persona rewrite.

### L17 Leader summary prompt
Create prompt for group leader to summarize plans for many agents.
Acceptance: outputs short actionable broadcast.

### L18 Intent action map
Map high-level intents to allowed backend actions/routines.
Acceptance: no direct Mineflayer API names leak into prompts.

### L19 Decision service
Given agent id and context, call provider and return validated `AgentDecision`.
Acceptance: mock provider test passes.

### L20 Fallback decision service
On provider error, return safe fallback: idle, continue routine, flee, or ask for help.
Acceptance: fallback includes reason.

### L21 Rate limiter
Add per-provider and global LLM request limits.
Acceptance: 20 agents cannot exceed configured RPM.

### L22 Planning queue
Create priority queue for LLM decisions.
Acceptance: severe events outrank routine ticks.

### L23 Planning cooldown
Prevent same agent from planning too often.
Acceptance: cooldown test passes.

### L24 Group planning mode
Allow one leader/role agent to plan for a group and broadcast.
Acceptance: reduces LLM calls for 20-agent scenarios.

### L25 Wake rules
Define wake events: attacked, death, found diamonds, leader command, direct mention, betrayal.
Acceptance: irrelevant agents stay on routine.

### L26 Prompt logging table
Store prompt metadata, provider, model, schema, status, latency, error.
Acceptance: do not store secrets.

### L27 Decision logging table
Store validated decision, selected action, confidence, fallback flag.
Acceptance: dashboard can list decisions.

### L28 Token/cost telemetry
Track token usage when providers return it.
Acceptance: missing usage does not fail.

### L29 Memory selection
Select recent, important, relationship, and scenario memories under budget.
Acceptance: deterministic ordering.

### L30 Memory write policy
Only write memories for important events, promises, betrayals, discoveries, and role changes.
Acceptance: routine actions do not spam memory.

### L31 Relationship update service
Apply reflection deltas to trust, loyalty, fear, emotional state, and tags.
Acceptance: values are clamped and auditable.

### L32 Role mutation guard
Allow temporary goals freely, but require major event or director approval for role changes.
Acceptance: agents do not randomly change core roles.

### L33 Speech style guard
Normalize speech length and block private reasoning leakage.
Acceptance: no chain-of-thought is sent to chat.

### L34 Safety policy
Block disallowed actions, friendly fire, unsafe mining, and grief actions unless scenario allows.
Acceptance: policy has tests.

### L35 Scenario prompt injection
Add scenario context: premise, teams, secrets, current episode goal, director constraints.
Acceptance: secret roles only visible to intended agents/director.

### L36 Human alliance handling
Include human team assignments in prompt context.
Acceptance: unaffiliated humans are not treated as allies.

### L37 Recorder exclusion
Ensure recorders are observers, not normal social participants.
Acceptance: agents do not react socially to recorder-only messages.

### L38 Multi-agent chat summarizer
Summarize high-volume AI chat into compact context.
Acceptance: 100 messages become short summary plus last few messages.

### L39 Provider retry policy
Retry only retryable errors with backoff and jitter.
Acceptance: validation errors are not retried.

### L40 Timeout policy
Set per-request timeout and fallback on timeout.
Acceptance: stalled provider cannot block scheduler.

### L41 Model config matrix
Allow per-agent provider/model/temperature/max tokens.
Acceptance: config validation catches missing model.

### L42 Cheap model lane
Support cheap model for routine speech/reflection and premium model for leaders/major moments.
Acceptance: config can select lane by task type.

### L43 LLM smoke test
Run mocked leader attack scenario: farmer loyalty drops and warning chat is emitted.
Acceptance: deterministic mock assertions pass.

### L44 20-agent LLM load test
Simulate 20 agents and verify queue/rate limits/fallbacks.
Acceptance: max concurrency is respected.

### L45 Prompt review fixture
Add sample context and expected schema output fixtures.
Acceptance: future prompt edits can be reviewed quickly.

### L46 LLM V1 checklist
Add tonight checklist: one real provider, one fallback path, one reflection, one group broadcast.
Acceptance: checklist is in `plans/v1-test-checklist.md`.

### L47 LLM V1 freeze
Freeze schemas and provider contract for backend/frontend integration.
Acceptance: no schema TODOs remain.
