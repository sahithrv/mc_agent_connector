import { Button, Badge } from "@mantine/core";
import { Bell, Crosshair, LockKeyhole, ShieldAlert } from "lucide-react";
import { useState } from "react";

import type { injectDirectorEvent, sendDirectorAnnouncement } from "../../lib/api/director";
import type { RoleAssignmentInput } from "../../lib/api/director";
import type { UiAgentRuntime } from "../../lib/types";
import { AssignRoleForm } from "./AssignRoleForm";
import { GroupAnnouncementForm } from "./GroupAnnouncementForm";
import { InjectEventForm } from "./InjectEventForm";
import "./director.css";

type CommandMode = "inject" | "announce" | "role";

export interface DirectorCommandPanelProps {
  agents: readonly UiAgentRuntime[];
  api?: Parameters<typeof injectDirectorEvent>[1] & Parameters<typeof sendDirectorAnnouncement>[1];
  onEventInjected?: Parameters<typeof InjectEventForm>[0]["onSuccess"];
  onAnnouncementSent?: Parameters<typeof GroupAnnouncementForm>[0]["onSuccess"];
  onAssignRole?: (assignment: RoleAssignmentInput) => Promise<void> | void;
}

export function DirectorCommandPanel({
  agents,
  api,
  onEventInjected,
  onAnnouncementSent,
  onAssignRole,
}: DirectorCommandPanelProps): JSX.Element {
  const [mode, setMode] = useState<CommandMode>("inject");

  return (
    <section className="director-panel" aria-labelledby="director-panel-title">
      <div className="director-panel-head">
        <div className="director-panel-title" id="director-panel-title">
          <ShieldAlert size={15} aria-hidden="true" />
          Director Commands
        </div>
        <Badge variant="light" color={onAssignRole ? "lime" : "yellow"}>
          role API {onAssignRole ? "ready" : "missing"}
        </Badge>
      </div>
      <div className="director-toolbar" role="tablist" aria-label="Director command forms">
        <Button
          data-active={mode === "inject"}
          leftSection={<Crosshair size={14} />}
          onClick={() => setMode("inject")}
          role="tab"
          variant={mode === "inject" ? "light" : "subtle"}
        >
          Inject event
        </Button>
        <Button
          data-active={mode === "announce"}
          leftSection={<Bell size={14} />}
          onClick={() => setMode("announce")}
          role="tab"
          variant={mode === "announce" ? "light" : "subtle"}
        >
          Announcement
        </Button>
        <Button
          data-active={mode === "role"}
          leftSection={<LockKeyhole size={14} />}
          onClick={() => setMode("role")}
          role="tab"
          variant={mode === "role" ? "light" : "subtle"}
        >
          Role
        </Button>
      </div>
      {mode === "inject" ? <InjectEventForm api={api} onSuccess={onEventInjected} /> : null}
      {mode === "announce" ? (
        <GroupAnnouncementForm api={api} onSuccess={onAnnouncementSent} />
      ) : null}
      {mode === "role" ? <AssignRoleForm agents={agents} onAssignRole={onAssignRole} /> : null}
    </section>
  );
}
