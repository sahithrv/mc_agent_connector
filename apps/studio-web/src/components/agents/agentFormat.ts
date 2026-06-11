import type { JsonValue } from "@mc-ai-video/contracts";

import type { UiAgentRuntime } from "../../lib/types";

interface HealthReadout {
  label: string;
  percent: number;
  tone: "ok" | "warn" | "danger" | "unknown";
}

export function taskForAgent(agent: UiAgentRuntime): string {
  return agent.currentTask ?? agent.routine ?? `${agent.role} routine`;
}

export function formatLastUpdate(updatedAt?: string): string {
  if (!updatedAt) return "no ping";

  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) return "bad time";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function healthReadout(agent: UiAgentRuntime): HealthReadout {
  const value = firstNumber(agent.health, ["health", "hp", "hearts"]);

  if (value === undefined) {
    return { label: "n/a", percent: 0, tone: "unknown" };
  }

  const percent = value <= 20 ? (value / 20) * 100 : value;
  const clamped = Math.max(0, Math.min(100, percent));

  return {
    label: value <= 20 ? `${Math.round(value)}/20` : `${Math.round(clamped)}%`,
    percent: clamped,
    tone: clamped <= 25 ? "danger" : clamped <= 55 ? "warn" : "ok",
  };
}

function firstNumber(
  source: Record<string, JsonValue> | undefined,
  keys: string[],
): number | undefined {
  if (!source) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}
