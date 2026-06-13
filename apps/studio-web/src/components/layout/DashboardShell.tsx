import {
  Activity,
  Clapperboard,
  MessageSquare,
  TerminalSquare,
  Users,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { AgentWorkspace } from "../agents/AgentWorkspace";
import { ChatWorkspace } from "../chat/ChatWorkspace";
import { EventDirectorWorkspace } from "../director";
import { RunFlowWorkspace } from "../flow/RunFlowWorkspace";
import { HealthBanner } from "../session/HealthBanner";
import { ScenarioDebugWorkspace } from "../scenario";
import { AppHeader } from "./AppHeader";
import { LeftNav } from "./LeftNav";
import { RightInspector } from "./RightInspector";
import {
  mockAgentControls,
  mockDirectorApi,
  mockSendDirectorChat,
} from "../../lib/mock/api";
import { mockStudioData } from "../../lib/mock/data";
import { shouldUseStudioMocks } from "../../lib/mock/runtime";
import { studioStore, useStudioStore } from "../../lib/state/store";

export function DashboardShell(): JSX.Element {
  const [activeSection, setActiveSection] = useState<DashboardSectionId>("command");
  const mockMode = shouldUseStudioMocks();
  const events = useStudioStore((state) => state.events);
  const agents = useStudioStore((state) => state.agents);
  const mockProps = useMemo(
    () =>
      mockMode
        ? {
            controls: mockAgentControls,
            directorApi: mockDirectorApi,
            diagnosticsByAgentId: mockStudioData.diagnosticsByAgentId,
            teamRoster: mockStudioData.teamRoster,
            scenario: mockStudioData.scenario,
            llmQueue: mockStudioData.llmQueue,
            actionRequests: mockStudioData.actionRequests,
            actionResults: mockStudioData.actionResults,
            agentConfig: mockStudioData.agents,
          }
        : undefined,
    [mockMode],
  );

  function selectSection(sectionId: DashboardSectionId): void {
    setActiveSection(sectionId);
    window.requestAnimationFrame(() => {
      document.getElementById(`${sectionId}-section`)?.scrollIntoView({ block: "start" });
    });
  }

  return (
    <div className="studio-shell">
      <AppHeader />
      <div className="shell-grid">
        <LeftNav activeSection={activeSection} onSelectSection={selectSection} />
        <main className="main-deck" aria-label="Dashboard route">
          <HealthBanner />
          <section
            className="deck-section command-deck-section"
            id="command-section"
            aria-labelledby="command-surface-title"
          >
            <div className="section-head">
              <h2 className="section-title" id="command-surface-title">
                Guided Run Flow
              </h2>
              <span className="rail-meta">{mockMode ? "mock runtime" : "/runtime"}</span>
            </div>
            <RunFlowWorkspace />
          </section>
          <DashboardBand id="agents" meta="F08-F12 / F28-F30" title="Agent Operations">
            <AgentWorkspace
              controls={mockProps?.controls}
              diagnosticsByAgentId={mockProps?.diagnosticsByAgentId}
              teamRoster={mockProps?.teamRoster}
            />
          </DashboardBand>
          <DashboardBand id="events" meta="F17-F25" title="Events, Director, Clips">
            <EventDirectorWorkspace
              api={mockProps?.directorApi}
              onAnnouncementSent={(message) => studioStore.appendChat(message)}
            />
          </DashboardBand>
          <DashboardBand id="chat" meta="F13-F16" title="Chat Visibility">
            <ChatWorkspace
              autoLoad={!mockMode}
              onSend={mockMode ? mockSendDirectorChat : undefined}
            />
          </DashboardBand>
          <DashboardBand id="scenario" meta="F23 / F26-F34" title="Scenario and Debug">
            <ScenarioDebugWorkspace
              actionEvents={events}
              actionRequests={mockProps?.actionRequests}
              actionResults={mockProps?.actionResults}
              agentConfig={mockProps?.agentConfig ?? agents}
              llmQueue={mockProps?.llmQueue}
              renderNotifications={false}
              scenario={mockProps?.scenario}
              serverControls={{
                status: mockMode ? "online" : "unknown",
                capabilities: mockMode
                  ? { start: true, stop: true, restart: true }
                  : { start: false, stop: false, restart: false },
                hideUnsupported: !mockMode,
                onStart: mockMode ? async () => undefined : undefined,
                onStop: mockMode ? async () => undefined : undefined,
                onRestart: mockMode ? async () => undefined : undefined,
              }}
              shortcuts={{
                enabled: true,
                onFocusChat: () =>
                  document.querySelector<HTMLElement>("[data-studio-chat-input]")?.focus(),
                onMarkClip: mockMode
                  ? async () => {
                      await mockDirectorApi.request("/director/clips", {
                        method: "POST",
                        body: JSON.stringify({
                          title: "Shortcut marker",
                          notes: "Created from the command-deck shortcut",
                          requestedBy: "studio-web",
                        }),
                      });
                    }
                  : undefined,
                onPauseAll: mockMode
                  ? async () => {
                      await mockAgentControls.pauseAll({ reason: "Keyboard shortcut" });
                    }
                  : undefined,
              }}
            />
          </DashboardBand>
        </main>
        <RightInspector />
      </div>
    </div>
  );
}

function DashboardBand(props: {
  id: DashboardSectionId;
  meta: string;
  title: string;
  children: ReactNode;
}): JSX.Element {
  const titleId = `${props.id}-title`;

  return (
    <section
      className="deck-section dashboard-band"
      id={`${props.id}-section`}
      aria-labelledby={titleId}
    >
      <div className="section-head">
        <h2 className="section-title" id={titleId}>
          {props.title}
        </h2>
        <span className="rail-meta">{props.meta}</span>
      </div>
      <div className="dashboard-band__body">{props.children}</div>
    </section>
  );
}

export type DashboardSectionId = (typeof navItems)[number]["id"];

export const navItems = [
  { id: "command", label: "Run Flow", meta: "F03", icon: TerminalSquare },
  { id: "agents", label: "Agents", meta: "F08", icon: Users },
  { id: "events", label: "Events", meta: "F17-F25", icon: Activity },
  { id: "chat", label: "AI Chat", meta: "F13", icon: MessageSquare },
  { id: "scenario", label: "Scenario/Debug", meta: "F23+", icon: Clapperboard },
] as const;
