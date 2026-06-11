import { PlanningCooldown } from "./cooldown";
import { PriorityPlanningQueue } from "./priority-queue";
import { LlmRateLimiter } from "./rate-limiter";
import type { LlmPlanningTask } from "./types";

export interface PlanningDispatcherConfig {
  maxConcurrentPlanning: number;
  now?: () => number;
}

export class PlanningDispatcher {
  private readonly activeTaskIds = new Set<string>();
  private readonly now: () => number;

  public constructor(
    private readonly queue: PriorityPlanningQueue,
    private readonly limiter: LlmRateLimiter,
    private readonly cooldown: PlanningCooldown,
    private readonly config: PlanningDispatcherConfig,
  ) {
    this.now = config.now ?? Date.now;
  }

  public startReady(at = this.now()): LlmPlanningTask[] {
    const started: LlmPlanningTask[] = [];
    while (this.activeTaskIds.size < this.config.maxConcurrentPlanning) {
      const task = this.queue.dequeueReady(at, (candidate) =>
        this.cooldown.canPlanAll(candidate.agentIds, at),
      );
      if (!task) break;

      const limit = this.limiter.tryAcquire(task.provider, at);
      if (!limit.ok) {
        this.queue.enqueue({ ...task, notBefore: at + limit.retryAfterMs });
        if (limit.scope === "global") break;
        continue;
      }

      this.activeTaskIds.add(task.id);
      this.cooldown.markPlanned(task.agentIds, at);
      started.push(task);
    }
    return started;
  }

  public complete(taskId: string): void {
    this.activeTaskIds.delete(taskId);
  }

  public activeCount(): number {
    return this.activeTaskIds.size;
  }
}
