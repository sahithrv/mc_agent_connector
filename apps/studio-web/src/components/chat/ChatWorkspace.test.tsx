import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import type { AgentConfig } from "@mc-ai-video/contracts";

import { validateChatDraft } from "../../lib/chat/validation";
import { studioTheme } from "../../styles/theme";
import { ChatWorkspace } from "./ChatWorkspace";
import type { StudioChatMessage } from "./types";

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const agents: AgentConfig[] = [
  {
    id: "guard-1",
    name: "Gate Guard",
    account: { username: "gate_guard", auth: "offline" },
    role: "guard",
    allowedActions: ["chat"],
    providerRef: "local",
  },
  {
    id: "miner-1",
    name: "Deep Miner",
    account: { username: "deep_miner", auth: "offline" },
    role: "miner",
    allowedActions: ["chat"],
    providerRef: "local",
  },
];

const messages: StudioChatMessage[] = [
  {
    id: "private-ai-urgent",
    senderId: "guard-1",
    recipientIds: ["miner-1"],
    topic: "base defense",
    urgency: 5,
    visibility: "ai",
    content: "Seal the west gate before the raid reaches storage.",
    location: { x: 12, y: 64, z: -9, world: "overworld" },
    timestamp: "2026-06-10T08:00:00.000Z",
  },
  {
    id: "private-human-team",
    senderId: "ai-team-human",
    recipientIds: ["guard-1"],
    topic: "human flank",
    urgency: 3,
    visibility: "human-team",
    content: "Human team is rotating through the river path.",
    timestamp: "2026-06-10T08:01:00.000Z",
  },
  {
    id: "public-chat",
    senderId: "miner-1",
    recipientIds: [],
    topic: "server",
    urgency: 1,
    visibility: "public",
    content: "Public chat says the village bell is ringing.",
    timestamp: "2026-06-10T08:02:00.000Z",
  },
];

describe("ChatWorkspace", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: TestResizeObserver,
    });
  });

  it("keeps urgent private messages visually distinct and metadata visible", () => {
    renderWorkspace();

    const urgentMessage = screen
      .getByText("Seal the west gate before the raid reaches storage.")
      .closest("article");

    expect(urgentMessage).toHaveAttribute("data-urgent", "true");
    expect(screen.getByText("base defense")).toBeInTheDocument();
    expect(screen.getByText("overworld 12, 64, -9")).toBeInTheDocument();
    expect(screen.getByText("Public chat mirror")).toBeInTheDocument();
  });

  it("hides private AI traffic from unaffiliated viewers while keeping public chat visible", () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Viewer role"), {
      target: { value: "unaffiliated" },
    });

    expect(screen.queryByText("Seal the west gate before the raid reaches storage.")).not.toBeInTheDocument();
    expect(screen.queryByText("Human team is rotating through the river path.")).not.toBeInTheDocument();
    expect(screen.getByText("Public chat says the village bell is ringing.")).toBeInTheDocument();
  });

  it("validates empty composer content and recipients before sending", () => {
    renderWorkspace([]);

    fireEvent.click(screen.getByRole("button", { name: /send private/i }));

    expect(screen.getByText("Select at least one recipient.")).toBeInTheDocument();
    expect(screen.getByText("Message content is required.")).toBeInTheDocument();
  });

  it("rejects recipients outside the local agent directory", () => {
    const result = validateChatDraft(
      {
        senderId: "director",
        recipientIds: ["missing-agent"],
        urgency: 4,
        visibility: "ai",
        content: "Check this route.",
      },
      new Set(["guard-1", "miner-1"]),
    );

    expect(result.valid).toBe(false);
    expect(result.fieldErrors.recipientIds).toBe(
      "Remove recipients that are not in the agent directory.",
    );
  });
});

function renderWorkspace(chatMessages: StudioChatMessage[] = messages): void {
  render(
    <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
      <ChatWorkspace agents={agents} autoLoad={false} messages={chatMessages} />
    </MantineProvider>,
  );
}
