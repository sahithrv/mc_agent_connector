import { Button, Badge } from "@mantine/core";
import { Bell, Bot, Crosshair, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";

import type { addDirectorAgent, injectDirectorCommand, injectDirectorEvent, sendDirectorAnnouncement } from "../../lib/api/director";
import type { UiAgentRuntime } from "../../lib/types";
import { AddAgentForm } from "./AddAgentForm";
import { ContextInjectionForm } from "./ContextInjectionForm";
import { GroupAnnouncementForm } from "./GroupAnnouncementForm";
import { InjectEventForm } from "./InjectEventForm";
import "./director.css";

type CommandMode = "event" | "announce" | "context" | "agent";

export interface DirectorCommandPanelProps {
  agents: readonly UiAgentRuntime[];
  api?: Parameters<typeof injectDirectorEvent>[1]
    & Parameters<typeof sendDirectorAnnouncement>[1]
    & Parameters<typeof injectDirectorCommand>[1]
    & Parameters<typeof addDirectorAgent>[1];
  onEventInjected?: Parameters<typeof InjectEventForm>[0]["onSuccess"];
  onAnnouncementSent?: Parameters<typeof GroupAnnouncementForm>[0]["onSuccess"];
}

export function DirectorCommandPanel({
  agents,
  api,
  onEventInjected,
  onAnnouncementSent,
}: DirectorCommandPanelProps): JSX.Element {
  const [mode, setMode] = useState<CommandMode>("context");

  return (
    <section className="director-panel" aria-labelledby="director-panel-title">
      <div className="director-panel-head">
        <div className="director-panel-title" id="director-panel-title">
          <ShieldAlert size={15} aria-hidden="true" />
          Director Commands
        </div>
        <Badge variant="light" color="lime">
          live context
        </Badge>
      </div>
      <div className="director-toolbar" role="tablist" aria-label="Director command forms">
        <Button
          data-active={mode === "context"}
          leftSection={<Sparkles size={14} />}
          onClick={() => setMode("context")}
          role="tab"
          variant={mode === "context" ? "light" : "subtle"}
        >
          Inject
        </Button>
        <Button
          data-active={mode === "event"}
          leftSection={<Crosshair size={14} />}
          onClick={() => setMode("event")}
          role="tab"
          variant={mode === "event" ? "light" : "subtle"}
        >
          Event
        </Button>
        <Button
          data-active={mode === "announce"}
          leftSection={<Bell size={14} />}
          onClick={() => setMode("announce")}
          role="tab"
          variant={mode === "announce" ? "light" : "subtle"}
        >
          Chat
        </Button>
        <Button
          data-active={mode === "agent"}
          leftSection={<Bot size={14} />}
          onClick={() => setMode("agent")}
          role="tab"
          variant={mode === "agent" ? "light" : "subtle"}
        >
          Agent
        </Button>
      </div>
      {mode === "context" ? <ContextInjectionForm agents={agents} api={api} /> : null}
      {mode === "event" ? <InjectEventForm api={api} onSuccess={onEventInjected} /> : null}
      {mode === "announce" ? (
        <GroupAnnouncementForm api={api} onSuccess={onAnnouncementSent} />
      ) : null}
      {mode === "agent" ? <AddAgentForm agents={agents} api={api} /> : null}
    </section>
  );
}
