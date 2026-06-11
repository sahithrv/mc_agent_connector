import { Alert, Badge, Button, Collapse, Textarea, TextInput, Tooltip } from "@mantine/core";
import type { GameEvent } from "@mc-ai-video/contracts";
import { Clapperboard, Plus, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { markDirectorClip, type DirectorClipMarker } from "../../lib/api/director";
import { normalizeApiError } from "../../lib/api/client";
import "./clips.css";

export interface ClipPanelProps {
  events?: readonly GameEvent[];
  initialMarkers?: readonly DirectorClipMarker[];
  api?: Parameters<typeof markDirectorClip>[1];
  requestedBy?: string;
  onMarkerCreated?: (marker: DirectorClipMarker) => void;
}

export function ClipPanel({
  events = [],
  initialMarkers = [],
  api,
  requestedBy = "director",
  onMarkerCreated,
}: ClipPanelProps): JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [manualMarkers, setManualMarkers] = useState<DirectorClipMarker[]>([]);
  const automaticMarkers = useMemo(() => automaticMarkersFromEvents(events), [events]);
  const markers = useMemo(
    () => sortMarkers([...initialMarkers, ...manualMarkers, ...automaticMarkers]),
    [automaticMarkers, initialMarkers, manualMarkers],
  );

  function handleCreated(marker: DirectorClipMarker): void {
    setManualMarkers((current) => sortMarkers([marker, ...current]));
    onMarkerCreated?.(marker);
  }

  return (
    <section className="clip-panel" aria-labelledby="clip-panel-title">
      <div className="clip-panel-head">
        <div className="clip-panel-title" id="clip-panel-title">
          <Clapperboard size={15} aria-hidden="true" />
          Clip Markers
        </div>
        <Tooltip label={formOpen ? "Close marker form" : "Mark clip"}>
          <Button
            leftSection={<Plus size={14} />}
            onClick={() => setFormOpen((current) => !current)}
            variant={formOpen ? "light" : "subtle"}
          >
            Mark clip
          </Button>
        </Tooltip>
      </div>
      <Collapse in={formOpen}>
        <ClipMarkerForm api={api} onCreated={handleCreated} requestedBy={requestedBy} />
      </Collapse>
      <div className="clip-list" aria-live="polite">
        {markers.length === 0 ? (
          <div className="clip-empty" role="status">
            No clip markers yet.
          </div>
        ) : (
          markers.map((marker) => <ClipMarkerRow key={`${marker.kind}-${marker.id}`} marker={marker} />)
        )}
      </div>
    </section>
  );
}

function ClipMarkerForm({
  api,
  requestedBy,
  onCreated,
}: {
  api?: Parameters<typeof markDirectorClip>[1];
  requestedBy: string;
  onCreated: (marker: DirectorClipMarker) => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      const marker = await markDirectorClip(
        { title: title.trim(), notes: optionalText(notes), requestedBy },
        api,
      );
      onCreated(marker);
      setTitle("");
      setNotes("");
    } catch (caught) {
      setError(normalizeApiError(caught).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="clip-marker-form" onSubmit={(event) => void submit(event)}>
      <TextInput
        label="Title"
        required
        placeholder="ambush starts"
        value={title}
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
      <Textarea
        autosize
        minRows={2}
        label="Notes"
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
      />
      {error ? (
        <Alert color="red" icon={<TriangleAlert size={15} />}>
          {error}
        </Alert>
      ) : null}
      <Button leftSection={<Clapperboard size={14} />} loading={loading} type="submit">
        Save marker
      </Button>
    </form>
  );
}

function ClipMarkerRow({ marker }: { marker: DirectorClipMarker }): JSX.Element {
  return (
    <article className="clip-marker" data-kind={marker.kind} aria-label={`${marker.kind} clip marker`}>
      <div className="clip-strip" aria-hidden="true" />
      <div className="clip-body">
        <div className="clip-topline">
          <span className="clip-title" title={marker.title}>
            {marker.title}
          </span>
          <Badge color={marker.kind === "manual" ? "lime" : "yellow"} variant="light">
            {marker.kind === "manual" ? "manual" : "auto"}
          </Badge>
        </div>
        <div className="clip-meta">
          {formatTime(marker.timestamp)}
          {marker.sourceEventId ? ` / ${marker.sourceEventId}` : ""}
        </div>
        {marker.notes ? (
          <div className="clip-notes" title={marker.notes}>
            {marker.notes}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function automaticMarkersFromEvents(events: readonly GameEvent[]): DirectorClipMarker[] {
  return events
    .filter((event) => event.severity >= 5)
    .map((event) => ({
      id: `auto-${event.id}`,
      title: `Auto: ${event.type}`,
      notes: "High severity event marker",
      sourceEventId: event.id,
      sourceEventType: event.type,
      timestamp: event.timestamp,
      kind: "automatic" as const,
    }));
}

function sortMarkers(markers: readonly DirectorClipMarker[]): DirectorClipMarker[] {
  return [...new Map(markers.map((marker) => [marker.id, marker])).values()].sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
