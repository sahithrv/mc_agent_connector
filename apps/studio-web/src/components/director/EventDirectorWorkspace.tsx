import type { AiChatMessage, GameEvent } from "@mc-ai-video/contracts";
import { useMemo, useState } from "react";

import { ClipPanel } from "../clips/ClipPanel";
import { EventFeed, EventFilters } from "../events";
import type { injectDirectorEvent, sendDirectorAnnouncement } from "../../lib/api/director";
import type { RoleAssignmentInput } from "../../lib/api/director";
import { useStudioStore } from "../../lib/state/store";
import type { UiAgentRuntime } from "../../lib/types";
import { emptyEventFilters, type EventFilterState } from "../../lib/events/filters";
import { DirectorCommandPanel } from "./DirectorCommandPanel";
import "./director.css";

export interface EventDirectorWorkspaceProps {
  events?: readonly GameEvent[];
  agents?: readonly UiAgentRuntime[];
  api?: Parameters<typeof injectDirectorEvent>[1] & Parameters<typeof sendDirectorAnnouncement>[1];
  onAnnouncementSent?: (message: AiChatMessage) => void;
  onAssignRole?: (assignment: RoleAssignmentInput) => Promise<void> | void;
}

export function EventDirectorWorkspace({
  events,
  agents,
  api,
  onAnnouncementSent,
  onAssignRole,
}: EventDirectorWorkspaceProps): JSX.Element {
  const storeEvents = useStudioStore((state) => state.events);
  const storeAgents = useStudioStore((state) => state.agents);
  const [filters, setFilters] = useState<EventFilterState>(emptyEventFilters);
  const [localEvents, setLocalEvents] = useState<GameEvent[]>([]);

  const allEvents = useMemo(
    () => mergeEvents([...(events ?? storeEvents), ...localEvents]),
    [events, localEvents, storeEvents],
  );
  const allAgents = agents ?? storeAgents;

  function handleEventInjected(event: GameEvent): void {
    setLocalEvents((current) => mergeEvents([event, ...current]));
  }

  return (
    <div className="event-director-workspace">
      <div className="event-director-main">
        <EventFilters events={allEvents} filters={filters} onChange={setFilters} />
        <EventFeed events={allEvents} filters={filters} />
      </div>
      <aside className="event-director-side" aria-label="Director controls and clips">
        <DirectorCommandPanel
          agents={allAgents}
          api={api}
          onAnnouncementSent={onAnnouncementSent}
          onAssignRole={onAssignRole}
          onEventInjected={handleEventInjected}
        />
        <ClipPanel api={api} events={allEvents} />
      </aside>
    </div>
  );
}

function mergeEvents(events: readonly GameEvent[]): GameEvent[] {
  const byId = new Map<string, GameEvent>();
  for (const event of events) {
    byId.set(event.id, event);
  }
  return [...byId.values()];
}
