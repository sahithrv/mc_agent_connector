import type { LlmPlanningTask, LlmWakeReasonType } from "./types";

const WAKE_PRIORITY: Record<LlmWakeReasonType, number> = {
  death: 700,
  betrayal: 650,
  attacked: 600,
  leader_command: 500,
  found_diamonds: 450,
  direct_mention: 400,
  manual: 200,
  routine_tick: 100,
};

interface QueueItem {
  sequence: number;
  task: LlmPlanningTask;
}

export class PriorityPlanningQueue {
  private readonly items: QueueItem[] = [];
  private sequence = 0;

  public enqueue(task: LlmPlanningTask): void {
    const existingIndex = this.items.findIndex((item) => item.task.id === task.id);
    if (existingIndex >= 0) this.items.splice(existingIndex, 1);
    this.items.push({ sequence: this.sequence++, task: { ...task, agentIds: [...task.agentIds] } });
  }

  public dequeueReady(
    at: number,
    canStart: (task: LlmPlanningTask) => boolean = () => true,
  ): LlmPlanningTask | undefined {
    const index = this.bestReadyIndex(at, canStart);
    if (index < 0) return undefined;
    return this.items.splice(index, 1)[0]?.task;
  }

  public peekReady(at: number): LlmPlanningTask | undefined {
    const index = this.bestReadyIndex(at, () => true);
    return index < 0 ? undefined : this.items[index]?.task;
  }

  public size(): number {
    return this.items.length;
  }

  public all(): LlmPlanningTask[] {
    return this.items.map((item) => ({ ...item.task, agentIds: [...item.task.agentIds] }));
  }

  private bestReadyIndex(at: number, canStart: (task: LlmPlanningTask) => boolean): number {
    let bestIndex = -1;
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      if (!item || (item.task.notBefore ?? 0) > at || !canStart(item.task)) continue;
      if (bestIndex < 0 || compare(item, this.items[bestIndex] as QueueItem) < 0) {
        bestIndex = index;
      }
    }
    return bestIndex;
  }
}

function compare(left: QueueItem, right: QueueItem): number {
  const severity = right.task.severity - left.task.severity;
  if (severity !== 0) return severity;

  const wakePriority =
    WAKE_PRIORITY[right.task.reason.type] - WAKE_PRIORITY[left.task.reason.type];
  if (wakePriority !== 0) return wakePriority;

  const enqueued = left.task.enqueuedAt - right.task.enqueuedAt;
  if (enqueued !== 0) return enqueued;

  return left.sequence - right.sequence;
}
