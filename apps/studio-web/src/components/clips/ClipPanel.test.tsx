import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameEvent } from "@mc-ai-video/contracts";
import type { Mock } from "vitest";

import { studioTheme } from "../../styles/theme";
import { ClipPanel, type ClipPanelProps } from "./ClipPanel";

describe("ClipPanel", () => {
  it("shows automatic severity markers and adds manual markers from the director API", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => ({
      ok: true,
      marker: {
        id: "clip-1",
        sessionId: "session-1",
        title: "Manual ambush",
        notes: "camera two",
        timestamp: "2026-06-10T00:12:00.000Z",
      },
      command: {
        id: "command-1",
        type: "mark-clip",
        payload: {},
        timestamp: "2026-06-10T00:12:00.000Z",
      },
    }));

    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <ClipPanel api={mockApi(request)} events={[severeEvent()]} />
      </MantineProvider>,
    );

    expect(screen.getByText("Auto: raid.start")).toBeInTheDocument();
    expect(screen.getByText("auto")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark clip" }));
    await user.type(await screen.findByLabelText(/title/i), "Manual ambush");
    await user.type(screen.getByLabelText(/notes/i), "camera two");
    await user.click(screen.getByRole("button", { name: "Save marker" }));

    expect(await screen.findByText("Manual ambush")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      "/director/clips",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

function severeEvent(): GameEvent {
  return {
    id: "event-1",
    type: "raid.start",
    actorId: "leader",
    severity: 5,
    visibility: "public",
    payload: {},
    timestamp: "2026-06-10T00:11:00.000Z",
  };
}

function mockApi(request: Mock): NonNullable<ClipPanelProps["api"]> {
  return { request } as unknown as NonNullable<ClipPanelProps["api"]>;
}
