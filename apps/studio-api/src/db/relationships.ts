import type { StudioDb } from "./client";
import { decodeJson, encodeJson } from "./json";
import type { RelationshipRecord } from "./types";

interface RelationshipRow {
  agent_id: string;
  target_id: string;
  trust: number;
  loyalty: number;
  fear: number;
  tags: string;
}

export interface UpsertRelationshipInput {
  agentId: string;
  targetId: string;
  trust: number;
  loyalty: number;
  fear: number;
  tags?: string[];
}

export class RelationshipsRepository {
  public constructor(private readonly db: StudioDb) {}

  public upsert(input: UpsertRelationshipInput): RelationshipRecord {
    const relationship: RelationshipRecord = {
      ...input,
      tags: input.tags ?? [],
    };

    this.db.prepare(`
      INSERT INTO relationships (
        agent_id, target_id, trust, loyalty, fear, tags
      ) VALUES (
        @agentId, @targetId, @trust, @loyalty, @fear, @tags
      )
      ON CONFLICT(agent_id, target_id) DO UPDATE SET
        trust = excluded.trust,
        loyalty = excluded.loyalty,
        fear = excluded.fear,
        tags = excluded.tags
    `).run(toParams(relationship));
    return relationship;
  }

  public get(agentId: string, targetId: string): RelationshipRecord | undefined {
    const row = this.db
      .prepare(`
        SELECT * FROM relationships
        WHERE agent_id = @agentId AND target_id = @targetId
      `)
      .get({ agentId, targetId }) as RelationshipRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  public listForAgent(agentId: string): RelationshipRecord[] {
    return this.db
      .prepare(`
        SELECT * FROM relationships
        WHERE agent_id = @agentId
        ORDER BY target_id
      `)
      .all({ agentId })
      .map((row) => fromRow(row as RelationshipRow));
  }
}

function toParams(relationship: RelationshipRecord): Record<string, unknown> {
  return {
    agentId: relationship.agentId,
    targetId: relationship.targetId,
    trust: relationship.trust,
    loyalty: relationship.loyalty,
    fear: relationship.fear,
    tags: encodeJson(relationship.tags),
  };
}

function fromRow(row: RelationshipRow): RelationshipRecord {
  return {
    agentId: row.agent_id,
    targetId: row.target_id,
    trust: row.trust,
    loyalty: row.loyalty,
    fear: row.fear,
    tags: decodeJson<string[]>(row.tags),
  };
}
