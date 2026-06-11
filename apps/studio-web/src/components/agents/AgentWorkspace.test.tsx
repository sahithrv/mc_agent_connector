import { MantineProvider } from "@mantine/core";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentConfig, AgentMode } from "@mc-ai-video/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { studioStore } from "../../lib/state/store";
import type { AgentControlApi, AgentControlResponse } from "../../lib/api/agentControls";
import type { UiAgentDiagnostics, UiTeamRoster } from "../../lib/agents/types";
import { studioTheme } from "../../styles/theme";
import { AgentWorkspace } from "./AgentWorkspace";

const modes: AgentMode[] = ["paused", "routine", "planning", "acting", "failed"];

describe("AgentWorkspace", () => {
  beforeEach(() => {
    studioStore.reset();
  });

  it("renders 20 agents with distinct mode labels and a team roster", () => {
    seedAgents(20);

    renderWorkspace({
      teamRoster: {
        humanTeams: [
          {
            id: "blue",
            name: "Blue Humans",
            members: [{ id: "human-1", name: "Mira", kind: "human", teamId: "blue" }],
          },
        ],
        recorders: [{ id: "rec-1", name: "Camera One", kind: "recorder", status: "online" }],
        unaffiliated: [{ id: "guest-1", name: "Guest", kind: "unaffiliated" }],
      },
    });

    expect(screen.getAllByTestId(/agent-row-/)).toHaveLength(20);
    expect(screen.getByText("Blue Humans")).toBeInTheDocument();
    expect(screen.getByText("Camera One")).toBeInTheDocument();

    for (const mode of modes) {
      const chip = document.querySelector(`.agent-mode-chip[data-mode="${mode}"]`);
      expect(chip).toBeInTheDocument();
    }
  });

  it("opens a missing-data drawer and disables selected pause while pending", async () => {
    const user = userEvent.setup();
    seedAgents(20, { skipFirstRuntime: true });
    let resolvePause!: (value: AgentControlResponse) => void;
    const controls = createControls({
      pauseAgent: vi.fn(
        () =>
          new Promise<AgentControlResponse>((resolve) => {
            resolvePause = resolve;
          }),
      ),
    });

    renderWorkspace({ controls });

    await user.click(screen.getByTestId("agent-row-agent-0"));

    expect(await screen.findByText("No current task published")).toBeInTheDocument();
    expect(screen.getByText(/No relationship telemetry yet/i)).toBeInTheDocument();
    expect(screen.getByText("No memories recorded for this agent.")).toBeInTheDocument();

    const pauseButton = screen.getByRole("button", { name: /Pause agent/i });
    await user.click(pauseButton);

    expect(controls.pauseAgent).toHaveBeenCalledWith(
      "agent-0",
      expect.objectContaining({ reason: "Director control for Agent 0" }),
    );
    expect(pauseButton).toBeDisabled();

    resolvePause(controlResponse("pause-agent", "agent-0"));
    await waitFor(() => expect(pauseButton).not.toBeDisabled());
  });

  it("requires confirmation before pausing all agents", async () => {
    const user = userEvent.setup();
    seedAgents(20);
    const controls = createControls();

    renderWorkspace({ controls });

    await user.click(screen.getByRole("button", { name: "Pause all" }));

    expect(controls.pauseAll).not.toHaveBeenCalled();
    expect(await screen.findByText(/request a pause command for every loaded AI player/i))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm pause all" }));

    expect(controls.pauseAll).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Confirmed director pause all" }),
    );
  });

  it("handles a 20-row relationship matrix and expandable long memories", async () => {
    const user = userEvent.setup();
    seedAgents(20);
    const diagnosticsByAgentId: Record<string, UiAgentDiagnostics> = {
      "agent-0": {
        relationships: Array.from({ length: 20 }, (_, index) => ({
          agentId: "agent-0",
          targetAgentId: `target-${index}`,
          trust: 40 + index,
          loyalty: 70 - index,
          fear: index,
        })),
        memories: [
          {
            id: "long-memory",
            agentId: "agent-0",
            kind: "combat",
            importance: 5,
            createdAt: "2026-06-10T08:00:00.000Z",
            summary:
              "Agent 0 saw the west wall breach, warned the farmer group, retreated to copper gate, and marked Guard 4 as unreliable after a delayed response during the raid sequence.",
          },
        ],
      },
    };

    renderWorkspace({ diagnosticsByAgentId });

    await user.click(screen.getByTestId("agent-row-agent-0"));

    const matrix = await screen.findByRole("table", { name: "Relationship matrix" });
    expect(within(matrix).getAllByRole("row").length).toBeGreaterThanOrEqual(21);

    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });
});

function renderWorkspace(props: {
  controls?: AgentControlApi;
  diagnosticsByAgentId?: Record<string, UiAgentDiagnostics>;
  teamRoster?: UiTeamRoster;
} = {}) {
  return render(
    <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
      <AgentWorkspace {...props} />
    </MantineProvider>,
  );
}

function seedAgents(count: number, options: { skipFirstRuntime?: boolean } = {}): void {
  const agents: AgentConfig[] = Array.from({ length: count }, (_, index) => ({
    id: `agent-${index}`,
    name: `Agent ${index}`,
    account: { username: `agent_${index}`, auth: "offline" },
    role: index % 3 === 0 ? "guard" : index % 3 === 1 ? "farmer" : "miner",
    team: index % 2 === 0 ? "redstone" : "emerald",
    mode: modes[(index + 1) % modes.length],
    routine: "patrol",
    allowedActions: ["idle", "move_to", "chat_ai_private"],
    providerRef: index % 2 === 0 ? "local-llama" : "openai-fast",
  }));

  studioStore.setAgents(agents);

  agents.forEach((agent, index) => {
    if (options.skipFirstRuntime && index === 0) return;
    studioStore.upsertAgentState({
      agentId: agent.id,
      mode: agent.mode ?? "routine",
      currentTask: `Task ${index}`,
      health: { health: 20 - (index % 10) },
      updatedAt: "2026-06-10T08:00:00.000Z",
    });
  });
}

function createControls(overrides: Partial<AgentControlApi> = {}): AgentControlApi {
  return {
    pauseAgent: vi.fn((agentId: string) => Promise.resolve(controlResponse("pause-agent", agentId))),
    resumeAgent: vi.fn((agentId: string) =>
      Promise.resolve(controlResponse("resume-agent", agentId)),
    ),
    pauseAll: vi.fn(() => Promise.resolve(controlResponse("pause-all"))),
    resumeAll: vi.fn(() => Promise.resolve(controlResponse("resume-all"))),
    ...overrides,
  };
}

function controlResponse(type: AgentControlResponse["command"]["type"], agentId?: string) {
  return {
    ok: true,
    command: {
      id: `${type}-command`,
      type,
      targetAgentId: agentId,
      payload: {},
      timestamp: "2026-06-10T08:00:00.000Z",
    },
  };
}
