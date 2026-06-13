import { MantineProvider } from "@mantine/core";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { UiAgentRuntime } from "../../lib/types";
import { studioTheme } from "../../styles/theme";
import { TeamRosterPanel } from "./TeamRosterPanel";

describe("TeamRosterPanel", () => {
  it("groups AI roster members by subteam when present", () => {
    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <TeamRosterPanel
          agents={[
            agent("farmer-1", "Ivy", "farmer", "ai", "oak"),
            agent("miner-1", "Dax", "miner", "ai", "iron"),
            agent("guard-1", "Noor", "guard", "ai"),
          ]}
        />
      </MantineProvider>,
    );

    const oak = screen.getByText("AI: oak").closest("section");
    const iron = screen.getByText("AI: iron").closest("section");
    const ai = screen.getByText("AI: ai").closest("section");

    expect(oak).not.toBeNull();
    expect(iron).not.toBeNull();
    expect(ai).not.toBeNull();
    expect(within(oak as HTMLElement).getByText("Ivy")).toBeInTheDocument();
    expect(within(iron as HTMLElement).getByText("Dax")).toBeInTheDocument();
    expect(within(ai as HTMLElement).getByText("Noor")).toBeInTheDocument();
  });
});

function agent(
  id: string,
  name: string,
  role: string,
  team: string,
  subteam?: string,
): UiAgentRuntime {
  return {
    id,
    name,
    account: { username: id, auth: "offline" },
    role,
    team,
    subteam,
    mode: "routine",
    routine: role,
    allowedActions: ["idle"],
    providerRef: "mock",
  };
}
