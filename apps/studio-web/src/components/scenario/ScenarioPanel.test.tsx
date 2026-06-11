import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";

import { studioTheme } from "../../styles/theme";
import { ScenarioPanel } from "./ScenarioPanel";

describe("ScenarioPanel", () => {
  it("renders a readable empty scenario state", () => {
    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <ScenarioPanel />
      </MantineProvider>,
    );

    expect(screen.getAllByText("No scenario loaded").length).toBeGreaterThan(0);
    expect(screen.getByText(/Load a scenario to inspect teams/i)).toBeInTheDocument();
  });

  it("shows teams, goals, and triggers for a loaded scenario", () => {
    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <ScenarioPanel
          scenario={{
            id: "rehearsal",
            name: "Village rehearsal",
            teams: [{ id: "miners", name: "Miners", agentIds: ["miner-1", "miner-2"] }],
            roles: [],
            startingGoals: [{ agentId: "miner-1", goal: "Secure diamonds", priority: 1 }],
            secretRoles: [{ agentId: "miner-2", role: "traitor", visibleTo: ["director"] }],
            directorTriggers: [{ id: "raid", event: "raid_started", action: "wake guards", severity: 4 }],
          }}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Village rehearsal")).toBeInTheDocument();
    expect(screen.getByText("Secure diamonds")).toBeInTheDocument();
    expect(screen.getByText("raid_started")).toBeInTheDocument();
    expect(screen.getByText("1 secret roles")).toBeInTheDocument();
  });
});
