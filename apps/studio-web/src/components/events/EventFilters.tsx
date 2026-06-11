import { ActionIcon, Select, TextInput, Tooltip } from "@mantine/core";
import type { GameEvent } from "@mc-ai-video/contracts";
import { Search, X } from "lucide-react";

import {
  emptyEventFilters,
  EVENT_SEVERITY_VALUES,
  type EventFilterState,
} from "../../lib/events/filters";
import "./events.css";

export interface EventFiltersProps {
  events: readonly GameEvent[];
  filters: EventFilterState;
  onChange: (filters: EventFilterState) => void;
}

export function EventFilters({ events, filters, onChange }: EventFiltersProps): JSX.Element {
  const actorOptions = uniqueOptions(events.flatMap((event) => [event.actorId]).filter(Boolean));
  const typeOptions = uniqueOptions(events.map((event) => event.type));

  function patch(patchFilters: Partial<EventFilterState>): void {
    onChange({ ...filters, ...patchFilters });
  }

  return (
    <div className="event-filter-deck" aria-label="Event filters">
      <Select
        label="Severity"
        data={[
          { value: "all", label: "All severities" },
          ...EVENT_SEVERITY_VALUES.map((value) => ({ value: String(value), label: `S${value}` })),
        ]}
        value={filters.severity}
        onChange={(value) => patch({ severity: (value ?? "all") as EventFilterState["severity"] })}
      />
      <Select
        clearable
        searchable
        label="Actor"
        data={actorOptions}
        placeholder="Any actor"
        value={filters.actor || null}
        onChange={(value) => patch({ actor: value ?? "" })}
      />
      <Select
        clearable
        searchable
        label="Event type"
        data={typeOptions}
        placeholder="Any type"
        value={filters.eventType || null}
        onChange={(value) => patch({ eventType: value ?? "" })}
      />
      <TextInput
        label="Text"
        leftSection={<Search size={14} aria-hidden="true" />}
        placeholder="Search payload, target, location"
        value={filters.text}
        onChange={(event) => patch({ text: event.currentTarget.value })}
      />
      <Tooltip label="Clear event filters">
        <ActionIcon
          aria-label="Clear event filters"
          disabled={isEmpty(filters)}
          onClick={() => onChange(emptyEventFilters)}
          variant="subtle"
        >
          <X size={16} aria-hidden="true" />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}

function uniqueOptions(values: readonly (string | undefined)[]): { value: string; label: string }[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

function isEmpty(filters: EventFilterState): boolean {
  return (
    filters.severity === emptyEventFilters.severity &&
    filters.actor === emptyEventFilters.actor &&
    filters.eventType === emptyEventFilters.eventType &&
    filters.text === emptyEventFilters.text
  );
}
