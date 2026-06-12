import type { ActionRequest } from "@mc-ai-video/contracts";

import type { RoutineActionIntent } from "../routines";
import type { AgentSchedulerState } from "./types";

export interface RunningAction {
  request: ActionRequest;
  controller: AbortController;
  promise: Promise<void>;
}

export interface RuntimeState {
  publicState: AgentSchedulerState;
  action?: RunningAction;
  pendingAction?: RoutineActionIntent;
  planningController?: AbortController;
  planningPromise?: Promise<void>;
}
