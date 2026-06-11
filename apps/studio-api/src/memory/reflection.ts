import type { GameEvent } from "@mc-ai-video/contracts";

export interface ReflectionRequest {
  event: GameEvent;
  agentIds: string[];
  reason: "major-event";
}

export interface ReflectionService {
  requestReflection(request: ReflectionRequest): void | Promise<void>;
}
