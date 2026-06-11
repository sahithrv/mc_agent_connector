import type { AgentMode, Position } from "@mc-ai-video/contracts";

import type { StudioDb } from "./client";
import { encodeJson, nullableJson } from "./json";
import type { AgentStateRecord } from "./types";

interface AgentStateRow {
  agent_id: string;
  mode: AgentMode;
  role: string;
  current_task: string | null;
  health: number;
  food: number;
  position: string | null;
  updated_at: string;
}

export interface UpsertAgentStateInput {
  agentId: string;
  mode: AgentMode;
  role: string;
  currentTask?: string;
  health: number;
  food: number;
  position?: Position;
  updatedAt?: string;
}

export class AgentStateRepository {
  public constructor(private readonly db: StudioDb) {}

  public upsert(input: UpsertAgentStateInput): AgentStateRecord {
    const state: AgentStateRecord = {
      ...input,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO agent_state (
        agent_id, mode, role, current_task, health, food, position, updated_at
      ) VALUES (
        @agentId, @mode, @role, @currentTask, @health, @food, @position, @updatedAt
      )
      ON CONFLICT(agent_id) DO UPDATE SET
        mode = excluded.mode,
        role = excluded.role,
        current_task = excluded.current_task,
        health = excluded.health,
        food = excluded.food,
        position = excluded.position,
        updated_at = excluded.updated_at
    `).run(toParams(state));
    return state;
  }

  public get(agentId: string): AgentStateRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM agent_state WHERE agent_id = @agentId")
      .get({ agentId }) as AgentStateRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  public list(): AgentStateRecord[] {
    return this.db
      .prepare("SELECT * FROM agent_state ORDER BY agent_id")
      .all()
      .map((row) => fromRow(row as AgentStateRow));
  }
}

function toParams(state: AgentStateRecord): Record<string, unknown> {
  return {
    agentId: state.agentId,
    mode: state.mode,
    role: state.role,
    currentTask: state.currentTask ?? null,
    health: state.health,
    food: state.food,
    position: state.position ? encodeJson(state.position) : null,
    updatedAt: state.updatedAt,
  };
}

function fromRow(row: AgentStateRow): AgentStateRecord {
  const state: AgentStateRecord = {
    agentId: row.agent_id,
    mode: row.mode,
    role: row.role,
    health: row.health,
    food: row.food,
    updatedAt: row.updated_at,
  };
  if (row.current_task !== null) {
    state.currentTask = row.current_task;
  }
  const position = nullableJson<Position>(row.position);
  if (position) {
    state.position = position;
  }
  return state;
}
