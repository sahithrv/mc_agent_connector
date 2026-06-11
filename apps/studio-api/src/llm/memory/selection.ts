import type { EventSeverity } from "@mc-ai-video/contracts";

import type { MemoryRecord, RelationshipRecord } from "../../db";

export type MemorySelectionSource = "important" | "relationship" | "scenario" | "recent";

export interface ScenarioMemory {
  id: string;
  summary: string;
  priority?: EventSeverity;
}

export interface MemorySelectionItem {
  id: string;
  source: MemorySelectionSource;
  summary: string;
  importance: number;
  createdAt?: string;
  targetId?: string;
}

export interface MemorySelectionBudget {
  maxItems?: number;
  maxChars: number;
}

export interface MemorySelectionRepositories {
  memories: {
    listRecent(query: { agentId: string; limit?: number }): MemoryRecord[];
    listImportant(query: { agentId: string; limit?: number; minImportance?: EventSeverity }): MemoryRecord[];
  };
  relationships: {
    listForAgent(agentId: string): RelationshipRecord[];
  };
}

export interface SelectMemoriesInput {
  agentId: string;
  repositories: MemorySelectionRepositories;
  scenarioMemories?: ScenarioMemory[];
  budget: MemorySelectionBudget;
  perSourceLimit?: number;
}

export function selectMemoriesForPrompt(input: SelectMemoriesInput): MemorySelectionItem[] {
  const perSourceLimit = input.perSourceLimit ?? 12;
  const candidates = [
    ...importantItems(input.repositories.memories.listImportant({
      agentId: input.agentId,
      limit: perSourceLimit,
      minImportance: 4,
    })),
    ...relationshipItems(input.repositories.relationships.listForAgent(input.agentId)),
    ...scenarioItems(input.scenarioMemories ?? []),
    ...recentItems(input.repositories.memories.listRecent({
      agentId: input.agentId,
      limit: perSourceLimit,
    })),
  ];

  const selected: MemorySelectionItem[] = [];
  const seen = new Set<string>();
  let usedChars = 0;
  const maxItems = input.budget.maxItems ?? Number.POSITIVE_INFINITY;

  for (const item of candidates.sort(compareMemorySelectionItems)) {
    const dedupeKey = item.id;
    if (seen.has(dedupeKey)) continue;

    const nextChars = usedChars + item.summary.length;
    if (selected.length >= maxItems || nextChars > input.budget.maxChars) continue;

    seen.add(dedupeKey);
    selected.push(item);
    usedChars = nextChars;
  }

  return selected;
}

function importantItems(memories: MemoryRecord[]): MemorySelectionItem[] {
  return memories.map((memory) => ({
    id: memory.id,
    source: "important",
    summary: memory.summary,
    importance: memory.importance,
    createdAt: memory.createdAt,
  }));
}

function recentItems(memories: MemoryRecord[]): MemorySelectionItem[] {
  return memories.map((memory) => ({
    id: memory.id,
    source: "recent",
    summary: memory.summary,
    importance: memory.importance,
    createdAt: memory.createdAt,
  }));
}

function relationshipItems(relationships: RelationshipRecord[]): MemorySelectionItem[] {
  return relationships
    .map((relationship) => ({
      id: `${relationship.agentId}->${relationship.targetId}`,
      source: "relationship" as const,
      summary: relationshipSummary(relationship),
      importance: Math.max(relationship.fear, 100 - relationship.trust, relationship.loyalty) / 20,
      targetId: relationship.targetId,
    }));
}

function scenarioItems(memories: ScenarioMemory[]): MemorySelectionItem[] {
  return memories.map((memory) => ({
    id: memory.id,
    source: "scenario",
    summary: memory.summary,
    importance: memory.priority ?? 3,
  }));
}

function relationshipSummary(relationship: RelationshipRecord): string {
  const tags = relationship.tags.length > 0 ? ` tags=${[...relationship.tags].sort().join(",")}` : "";
  return `${relationship.targetId}: trust ${relationship.trust}, loyalty ${relationship.loyalty}, fear ${relationship.fear}.${tags}`;
}

function compareMemorySelectionItems(left: MemorySelectionItem, right: MemorySelectionItem): number {
  return sourceRank(left.source) - sourceRank(right.source)
    || right.importance - left.importance
    || (right.createdAt ?? "").localeCompare(left.createdAt ?? "")
    || (left.targetId ?? "").localeCompare(right.targetId ?? "")
    || left.id.localeCompare(right.id);
}

function sourceRank(source: MemorySelectionSource): number {
  switch (source) {
    case "important": return 0;
    case "relationship": return 1;
    case "scenario": return 2;
    case "recent": return 3;
  }
}
