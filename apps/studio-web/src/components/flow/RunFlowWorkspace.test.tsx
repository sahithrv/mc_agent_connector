import { MantineProvider } from "@mantine/core";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentConfig } from "@mc-ai-video/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateAgentConfig } from "../../lib/api/agents";
import { studioStore } from "../../lib/state/store";
import { studioTheme } from "../../styles/theme";
import { RunFlowWorkspace } from "./RunFlowWorkspace";

vi.mock("../../lib/api/agents", () => ({
  getAgentConfigs: vi.fn(),
  updateAgentConfig: vi.fn(),
}));

describe("RunFlowWorkspace", () => {
  beforeEach(() => {
    studioStore.reset();
    vi.mocked(updateAgentConfig).mockReset();
  });

  it("assigns selected agents by subteam because subteam is the coordination group", async () => {
    const user = userEvent.setup();
    const agents = [
      agent("farmer-1", "Ivy", "farmer", "oak"),
      agent("miner-1", "Dax", "miner", "iron"),
    ];
    studioStore.setAgents(agents);
    vi.mocked(updateAgentConfig).mockImplementation(async (agentId, input) => {
      const current = agents.find((item) => item.id === agentId) as AgentConfig;
      return {
        ...current,
        ...input,
        account: {
          ...current.account,
          ...(input.account ?? {}),
        },
        providerRef: input.providerRef ?? current.providerRef,
        allowedActions: current.allowedActions,
      };
    });

    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <RunFlowWorkspace />
      </MantineProvider>,
    );

    const continueButton = screen.getByRole("button", { name: "Continue to Subteams" });
    await waitFor(() => expect(continueButton).not.toBeDisabled());
    await user.click(continueButton);

    await user.type(screen.getByLabelText("Subteam name"), "river");
    await user.click(screen.getByRole("button", { name: "Assign subteam" }));

    await waitFor(() => expect(updateAgentConfig).toHaveBeenCalledTimes(2));
    expect(updateAgentConfig).toHaveBeenNthCalledWith(1, "farmer-1", { subteam: "river" });
    expect(updateAgentConfig).toHaveBeenNthCalledWith(2, "miner-1", { subteam: "river" });
    expect(screen.getByText("Assigned 2 agents to subteam river")).toBeInTheDocument();
  });

  it("randomizes an agent personality into three traits", async () => {
    const user = userEvent.setup();
    studioStore.setAgents([
      agent("farmer-1", "Ivy", "farmer", "oak"),
    ]);

    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <RunFlowWorkspace />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Randomize traits" }));

    const personality = screen.getByLabelText("Personality") as HTMLTextAreaElement;
    expect(personality.value.split(", ")).toHaveLength(3);
  });
});

function agent(id: string, name: string, role: string, subteam: string): AgentConfig {
  return {
    id,
    name,
    account: { username: id, auth: "offline" },
    role,
    team: "ai",
    subteam,
    mode: "routine",
    routine: role,
    enabled: true,
    allowedActions: ["idle"],
    providerRef: "mock",
  };
}
