import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import type { GameEvent } from "@mc-ai-video/contracts";

import { studioTheme } from "../../styles/theme";
import { EventFeed } from "./EventFeed";
import type { EventFilterState } from "../../lib/events/filters";

describe("EventFeed", () => {
  it("renders 100+ events newest first", () => {
    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <EventFeed events={makeEvents(105)} />
      </MantineProvider>,
    );

    expect(screen.getByText("105 shown")).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("event.type.104");
  });

  it("applies severity, actor, event type, and text filters together", () => {
    const filters: EventFilterState = {
      severity: "5",
      actor: "leader",
      eventType: "raid.start",
      text: "north gate",
    };

    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <EventFeed events={filteredEvents()} filters={filters} />
      </MantineProvider>,
    );

    expect(screen.getByText("raid.start")).toBeInTheDocument();
    expect(screen.getByText("1 shown")).toBeInTheDocument();
    expect(screen.queryByText("raid.decoy")).not.toBeInTheDocument();
  });
});

function makeEvents(count: number): GameEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    type: `event.type.${index}`,
    actorId: `agent-${index % 7}`,
    targetId: `target-${index % 5}`,
    severity: ((index % 5) + 1) as GameEvent["severity"],
    visibility: "public",
    payload: { index },
    timestamp: new Date(Date.UTC(2026, 5, 10, 0, index, 0)).toISOString(),
  }));
}

function filteredEvents(): GameEvent[] {
  return [
    {
      id: "match",
      type: "raid.start",
      actorId: "leader",
      targetId: "guard-1",
      severity: 5,
      visibility: "public",
      payload: { note: "north gate breach" },
      timestamp: "2026-06-10T00:05:00.000Z",
    },
    {
      id: "wrong-text",
      type: "raid.start",
      actorId: "leader",
      severity: 5,
      visibility: "public",
      payload: { note: "south field" },
      timestamp: "2026-06-10T00:04:00.000Z",
    },
    {
      id: "wrong-type",
      type: "raid.decoy",
      actorId: "leader",
      severity: 5,
      visibility: "public",
      payload: { note: "north gate" },
      timestamp: "2026-06-10T00:03:00.000Z",
    },
  ];
}
