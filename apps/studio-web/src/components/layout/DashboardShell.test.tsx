import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import { DashboardShell } from "./DashboardShell";
import { createMockStudioState, mockStudioData } from "../../lib/mock/data";
import { studioStore } from "../../lib/state/store";
import { studioTheme } from "../../styles/theme";

describe("DashboardShell", () => {
  beforeEach(() => {
    studioStore.reset();
  });

  it("renders the dashboard shell with disconnected state obvious", () => {
    studioStore.setConnection({
      phase: "reconnecting",
      attempts: 2,
      error: "Dashboard event stream closed",
      nextRetryAt: "2026-06-10T00:05:00.000Z",
    });

    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <DashboardShell />
      </MantineProvider>,
    );

    expect(screen.getByRole("main", { name: "Dashboard route" })).toBeInTheDocument();
    expect(screen.getAllByText("reconnecting").length).toBeGreaterThan(0);
    expect(screen.getByText("Reconnect attempt 2")).toBeInTheDocument();
  });

  it("smoke renders the V1 mock dashboard with 20 agents and 100 events", () => {
    studioStore.reset(createMockStudioState(mockStudioData));

    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <DashboardShell />
      </MantineProvider>,
    );

    expect(screen.getAllByTestId(/agent-row-/)).toHaveLength(20);
    expect(screen.getByText("20 live player slots")).toBeInTheDocument();
    expect(screen.getByText("100 shown")).toBeInTheDocument();
    expect(screen.getByText("Traitor Village Rehearsal")).toBeInTheDocument();
  });
});
