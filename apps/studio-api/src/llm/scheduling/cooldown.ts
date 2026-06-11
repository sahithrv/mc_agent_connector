export class PlanningCooldown {
  private readonly nextPlanAt = new Map<string, number>();
  private readonly now: () => number;

  public constructor(
    private readonly cooldownMs: number,
    now: () => number = Date.now,
  ) {
    this.now = now;
  }

  public canPlan(agentId: string, at = this.now()): boolean {
    return at >= (this.nextPlanAt.get(agentId) ?? 0);
  }

  public canPlanAll(agentIds: string[], at = this.now()): boolean {
    return agentIds.every((agentId) => this.canPlan(agentId, at));
  }

  public nextAllowedAt(agentId: string): number {
    return this.nextPlanAt.get(agentId) ?? 0;
  }

  public markPlanned(agentIds: string[], at = this.now()): void {
    const next = at + this.cooldownMs;
    for (const agentId of agentIds) this.nextPlanAt.set(agentId, next);
  }
}
