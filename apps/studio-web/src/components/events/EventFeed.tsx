import { Badge } from "@mantine/core";
import type { GameEvent, Position } from "@mc-ai-video/contracts";
import { Activity } from "lucide-react";
import { useMemo } from "react";

import {
  emptyEventFilters,
  filterEvents,
  sortEventsNewestFirst,
  type EventFilterState,
} from "../../lib/events/filters";
import "./events.css";

export interface EventFeedProps {
  events: readonly GameEvent[];
  filters?: EventFilterState;
  emptyMessage?: string;
}

export function EventFeed({
  events,
  filters = emptyEventFilters,
  emptyMessage = "No events match the current telemetry filters.",
}: EventFeedProps): JSX.Element {
  const visibleEvents = useMemo(
    () => sortEventsNewestFirst(filterEvents(events, filters)),
    [events, filters],
  );

  return (
    <section className="event-feed" aria-labelledby="event-feed-title">
      <div className="event-feed-head">
        <div className="event-feed-title" id="event-feed-title">
          <Activity size={15} aria-hidden="true" />
          Event Feed
        </div>
        <div className="event-feed-count">{visibleEvents.length} shown</div>
      </div>
      <div className="event-feed-list" aria-live="polite">
        {visibleEvents.length === 0 ? (
          <div className="event-empty" role="status">
            {emptyMessage}
          </div>
        ) : (
          visibleEvents.map((event) => <EventRow event={event} key={event.id} />)
        )}
      </div>
    </section>
  );
}

function EventRow({ event }: { event: GameEvent }): JSX.Element {
  return (
    <article
      className="event-row"
      data-severity={event.severity}
      aria-label={`${event.type} severity ${event.severity}`}
    >
      <div className="event-strip" aria-hidden="true" />
      <div className="event-row-body">
        <div className="event-row-main">
          <div className="event-type-lockup">
            <Badge color={severityColor(event.severity)} variant="light">
              S{event.severity}
            </Badge>
            <span className="event-type" title={event.type}>
              {event.type}
            </span>
          </div>
          <time className="event-time" dateTime={event.timestamp}>
            {formatTime(event.timestamp)}
          </time>
        </div>
        <div className="event-row-meta">
          <span className="event-field" title={event.actorId ?? "none"}>
            actor <strong>{event.actorId ?? "none"}</strong>
          </span>
          <span className="event-field" title={event.targetId ?? "none"}>
            target <strong>{event.targetId ?? "none"}</strong>
          </span>
          <span className="event-field" title={formatLocation(event.location)}>
            loc <strong>{formatLocation(event.location)}</strong>
          </span>
          <span className="event-field">
            vis <strong>{event.visibility}</strong>
          </span>
        </div>
        <div className="event-payload" title={payloadSummary(event)}>
          {payloadSummary(event)}
        </div>
      </div>
    </article>
  );
}

function severityColor(severity: GameEvent["severity"]): string {
  if (severity >= 5) {
    return "red";
  }
  if (severity >= 4) {
    return "yellow";
  }
  if (severity >= 3) {
    return "cyan";
  }
  return "lime";
}

function formatLocation(location: Position | undefined): string {
  if (!location) {
    return "unknown";
  }
  const world = location.world ? `${location.world}:` : "";
  return `${world}${location.x},${location.y},${location.z}`;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function payloadSummary(event: GameEvent): string {
  const text = JSON.stringify(event.payload);
  return text === "{}" ? event.id : text;
}
