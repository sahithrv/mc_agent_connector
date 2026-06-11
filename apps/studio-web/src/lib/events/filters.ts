import type { EventSeverity, GameEvent } from "@mc-ai-video/contracts";

export const EVENT_SEVERITY_VALUES = [1, 2, 3, 4, 5] as const satisfies EventSeverity[];

export interface EventFilterState {
  severity: "all" | `${EventSeverity}`;
  actor: string;
  eventType: string;
  text: string;
}

export const emptyEventFilters: EventFilterState = {
  severity: "all",
  actor: "",
  eventType: "",
  text: "",
};

export function sortEventsNewestFirst(events: readonly GameEvent[]): GameEvent[] {
  return [...events].sort((left, right) => {
    const timeDelta = Date.parse(right.timestamp) - Date.parse(left.timestamp);
    return timeDelta === 0 ? right.id.localeCompare(left.id) : timeDelta;
  });
}

export function filterEvents(
  events: readonly GameEvent[],
  filters: EventFilterState,
): GameEvent[] {
  const actor = filters.actor.trim().toLowerCase();
  const eventType = filters.eventType.trim().toLowerCase();
  const text = filters.text.trim().toLowerCase();

  return events.filter((event) => {
    if (filters.severity !== "all" && event.severity !== Number(filters.severity)) {
      return false;
    }

    if (actor && (event.actorId ?? "").toLowerCase() !== actor) {
      return false;
    }

    if (eventType && event.type.toLowerCase() !== eventType) {
      return false;
    }

    return text.length === 0 || eventText(event).includes(text);
  });
}

function eventText(event: GameEvent): string {
  return [
    event.id,
    event.type,
    event.actorId,
    event.targetId,
    event.visibility,
    `severity ${event.severity}`,
    event.location ? `${event.location.world ?? "world"} ${event.location.x} ${event.location.y} ${event.location.z}` : "",
    JSON.stringify(event.payload),
    event.timestamp,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
