export interface RoleMutationRequest {
  agentId: string;
  currentCoreRole: string;
  proposedCoreRole?: string;
  currentTemporaryGoals?: string[];
  proposedTemporaryGoals?: string[];
  majorEvent?: boolean;
  directorApproved?: boolean;
}

export interface RoleMutationDecision {
  agentId: string;
  coreRole: string;
  temporaryGoals: string[];
  coreRoleChanged: boolean;
  allowed: boolean;
  rejectionReason?: string;
}

export function guardRoleMutation(request: RoleMutationRequest): RoleMutationDecision {
  const proposedCoreRole = normalizeRole(request.proposedCoreRole) ?? request.currentCoreRole;
  const wantsCoreChange = proposedCoreRole !== request.currentCoreRole;
  const temporaryGoals = normalizeGoals(request.proposedTemporaryGoals ?? request.currentTemporaryGoals ?? []);

  if (!wantsCoreChange) {
    return {
      agentId: request.agentId,
      coreRole: request.currentCoreRole,
      temporaryGoals,
      coreRoleChanged: false,
      allowed: true,
    };
  }

  if (request.majorEvent || request.directorApproved) {
    return {
      agentId: request.agentId,
      coreRole: proposedCoreRole,
      temporaryGoals,
      coreRoleChanged: true,
      allowed: true,
    };
  }

  return {
    agentId: request.agentId,
    coreRole: request.currentCoreRole,
    temporaryGoals,
    coreRoleChanged: false,
    allowed: false,
    rejectionReason: "core role changes require a major event or director approval",
  };
}

function normalizeRole(role: string | undefined): string | undefined {
  const normalized = role?.trim();
  return normalized ? normalized : undefined;
}

function normalizeGoals(goals: string[]): string[] {
  return goals
    .map((goal) => goal.trim())
    .filter((goal) => goal.length > 0)
    .slice(0, 8);
}
