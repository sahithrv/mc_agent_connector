import assert from "node:assert/strict";
import test from "node:test";

import type { RelationshipRecord } from "../../db";
import {
  applyRelationshipUpdates,
  guardRoleMutation,
  InMemoryRelationshipAuditRepository,
  type RelationshipStore,
} from "./index";

test("relationship updates clamp values, merge tags, and write audit records", () => {
  const store = new MemoryRelationshipStore([
    { agentId: "farmer", targetId: "leader", trust: 20, loyalty: 50, fear: 70, tags: ["leader"] },
  ]);
  const audit = new InMemoryRelationshipAuditRepository();

  const updated = applyRelationshipUpdates({
    agentId: "farmer",
    store,
    audit,
    reason: "major-event-reflection",
    eventId: "attack-one",
    createdAt: "2026-06-10T21:00:00.000Z",
    updates: [{
      targetId: "leader",
      trustDelta: -50,
      loyaltyDelta: -80,
      fearDelta: 50,
      emotionalState: "alarmed",
      addTags: ["Attacked Me"],
    }],
  });

  assert.deepEqual(updated[0], {
    agentId: "farmer",
    targetId: "leader",
    trust: 0,
    loyalty: 0,
    fear: 100,
    tags: ["attacked_me", "leader"],
  });
  const auditRecord = audit.listForAgent("farmer")[0];
  assert.equal(auditRecord?.before?.trust, 20);
  assert.equal(auditRecord?.after.fear, 100);
  assert.equal(auditRecord?.emotionalState, "alarmed");
  assert.equal(auditRecord?.eventId, "attack-one");
});

test("role guard allows temporary goals but blocks unapproved core role mutation", () => {
  const blocked = guardRoleMutation({
    agentId: "farmer",
    currentCoreRole: "farmer",
    proposedCoreRole: "traitor",
    proposedTemporaryGoals: [" warn allies ", "hide"],
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.coreRole, "farmer");
  assert.deepEqual(blocked.temporaryGoals, ["warn allies", "hide"]);

  const allowed = guardRoleMutation({
    agentId: "farmer",
    currentCoreRole: "farmer",
    proposedCoreRole: "guard",
    directorApproved: true,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.coreRoleChanged, true);
  assert.equal(allowed.coreRole, "guard");
});

class MemoryRelationshipStore implements RelationshipStore {
  private readonly records = new Map<string, RelationshipRecord>();

  public constructor(records: RelationshipRecord[]) {
    for (const record of records) this.records.set(this.key(record.agentId, record.targetId), record);
  }

  public get(agentId: string, targetId: string): RelationshipRecord | undefined {
    return this.records.get(this.key(agentId, targetId));
  }

  public upsert(input: RelationshipRecord): RelationshipRecord {
    this.records.set(this.key(input.agentId, input.targetId), input);
    return input;
  }

  private key(agentId: string, targetId: string): string {
    return `${agentId}:${targetId}`;
  }
}
