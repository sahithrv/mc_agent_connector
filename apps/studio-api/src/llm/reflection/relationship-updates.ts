import { randomUUID } from "node:crypto";

import type { RelationshipRecord } from "../../db";

export interface RelationshipUpdate {
  targetId: string;
  trustDelta?: number;
  loyaltyDelta?: number;
  fearDelta?: number;
  emotionalState?: string;
  addTags?: string[];
  removeTags?: string[];
}

export interface RelationshipUpdateAuditRecord {
  id: string;
  agentId: string;
  targetId: string;
  before?: RelationshipRecord;
  after: RelationshipRecord;
  emotionalState?: string;
  reason: string;
  eventId?: string;
  createdAt: string;
}

export interface RelationshipStore {
  get(agentId: string, targetId: string): RelationshipRecord | undefined;
  upsert(input: RelationshipRecord): RelationshipRecord;
}

export interface RelationshipAuditRepository {
  append(record: RelationshipUpdateAuditRecord): void;
  listForAgent(agentId: string): RelationshipUpdateAuditRecord[];
}

export class InMemoryRelationshipAuditRepository implements RelationshipAuditRepository {
  private readonly records: RelationshipUpdateAuditRecord[] = [];

  public append(record: RelationshipUpdateAuditRecord): void {
    this.records.push(record);
  }

  public listForAgent(agentId: string): RelationshipUpdateAuditRecord[] {
    return this.records
      .filter((record) => record.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  }
}

export interface ApplyRelationshipUpdatesInput {
  agentId: string;
  updates: RelationshipUpdate[];
  store: RelationshipStore;
  audit: RelationshipAuditRepository;
  reason: string;
  eventId?: string;
  createdAt?: string;
}

export function applyRelationshipUpdates(input: ApplyRelationshipUpdatesInput): RelationshipRecord[] {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return [...input.updates]
    .sort((left, right) => left.targetId.localeCompare(right.targetId))
    .map((update) => {
      const before = input.store.get(input.agentId, update.targetId);
      const after: RelationshipRecord = {
        agentId: input.agentId,
        targetId: update.targetId,
        trust: clampRelationshipValue((before?.trust ?? 50) + (update.trustDelta ?? 0)),
        loyalty: clampRelationshipValue((before?.loyalty ?? 50) + (update.loyaltyDelta ?? 0)),
        fear: clampRelationshipValue((before?.fear ?? 0) + (update.fearDelta ?? 0)),
        tags: mergeTags(before?.tags ?? [], update.addTags ?? [], update.removeTags ?? []),
      };

      const saved = input.store.upsert(after);
      input.audit.append({
        id: randomUUID(),
        agentId: input.agentId,
        targetId: update.targetId,
        before,
        after: saved,
        emotionalState: update.emotionalState,
        reason: input.reason,
        eventId: input.eventId,
        createdAt,
      });
      return saved;
    });
}

export function clampRelationshipValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function mergeTags(existing: string[], add: string[], remove: string[]): string[] {
  const removed = new Set(remove.map(normalizeTag));
  const merged = new Set<string>();

  for (const tag of [...existing, ...add]) {
    const normalized = normalizeTag(tag);
    if (normalized && !removed.has(normalized)) merged.add(normalized);
  }

  return [...merged].sort();
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40);
}
