import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";

import { studioStore } from "../../lib/state/store";
import { studioTheme } from "../../styles/theme";
import { LlmQueuePanel } from "./LlmQueuePanel";

describe("LlmQueuePanel", () => {
  beforeEach(() => studioStore.reset());

  it("shows active, queued, provider error, and rate-limit state", () => {
    studioStore.setAgents([
      {
        id: "planner-1",
        name: "Planner 1",
        account: { username: "planner_1" },
        role: "guard",
        mode: "planning",
        allowedActions: [],
        providerRef: "openai",
      },
      {
        id: "queued-1",
        name: "Queued 1",
        account: { username: "queued_1" },
        role: "miner",
        mode: "routine",
        allowedActions: [],
        providerRef: "local",
      },
    ]);

    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <LlmQueuePanel
          snapshot={{
            activeAgentIds: ["planner-1"],
            queuedAgentIds: ["queued-1"],
            providerErrors: [{ providerRef: "openai", message: "429 retry later" }],
            rateLimits: [{ providerRef: "openai", limited: true, remaining: 0, limit: 2 }],
            maxConcurrency: 2,
          }}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Planner 1")).toBeInTheDocument();
    expect(screen.getByText("Queued 1")).toBeInTheDocument();
    expect(screen.getByText("429 retry later")).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });
});
