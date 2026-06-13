# Decision-Making Phase 3 Report

## Scope

Implemented Task 3.1 and Task 3.2 for the live Minecraft LLM agent decision loop:

- Add one structured repair attempt before falling back.
- Make fallback choose useful physical work before passive routine continuation or idle.

## Task 3.1: Structured Repair Before Fallback

Changed `apps/studio-api/src/llm/decisions/service.ts`.

What changed:

- Added `AgentDecisionService.repairDecision(...)`.
- If the provider returns schema validation failure, invalid `AgentDecision` shape, or a contract-rejected decision, the service sends one repair request before fallback.
- The repair prompt includes the rejection reason, previous rejected decision when available, available actions, parameter rules, and an instruction to prefer non-idle physical progress when possible.
- Repaired decisions return with `fallback: false` and `repaired: true`.
- If the repair response is invalid or still violates the decision contract, the service falls back using the original rejection reason.

## Task 3.2: Less Passive Fallback

Changed `apps/studio-api/src/llm/decisions/fallback.ts`.

Fallback order is now:

1. Flee from a visible threat when possible.
2. Ask for help immediately when threatened but no valid flee target exists.
3. Collect a visible useful item drop.
4. Mine a visible safe resource block.
5. Craft an obvious missing item/tool when inventory and goal context support it.
6. Move to a patrol point or deterministic scout point.
7. Ask for private/public help when blocked.
8. Continue routine.
9. Idle.

Additional details:

- Useful item selection avoids generic unnamed item entities.
- Mining rejects unsafe blocks and blocks below the agent.
- Crafting uses active task/blocker text before role defaults, so an explicit mining goal can override a farmer role.
- Recent failed action results can trigger blocker-help fallback.
- Every fallback branch still parses through `AgentDecisionSchema`.

## Tests Added

Changed `apps/studio-api/src/llm/decisions/decisions.test.ts`.

Added coverage for:

- Invalid provider decision repaired before fallback.
- Unavailable action gets exactly one repair attempt before fallback.
- Missing `move_to` parameters repaired into a valid action.
- Fallback collects visible useful item before routine continuation.
- Fallback mines visible safe block before routine continuation.
- Fallback crafts an obvious missing tool before routine continuation.
- Fallback moves to a patrol point before routine continuation.

## Verification

Commands run:

- `npm run lint` - passed.
- `npm run test` - passed after rerunning outside the sandbox because the sandboxed run failed with Vite/esbuild `spawn EPERM`.

Final passing result:

- API tests: 161 passed.
- Web tests: 31 passed.
