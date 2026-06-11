import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

import { studioTheme } from "../../styles/theme";
import { DirectorCommandPanel, type DirectorCommandPanelProps } from "./DirectorCommandPanel";

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe("DirectorCommandPanel", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("rejects invalid payload JSON before injecting an event", async () => {
    const user = userEvent.setup();
    const request = vi.fn();

    renderPanel({ api: mockApi(request) });

    await user.type(screen.getByLabelText(/event type/i), "leader.attack");
    fireEvent.change(screen.getByLabelText(/payload json/i), { target: { value: "{bad" } });
    await user.click(screen.getByRole("button", { name: "Inject event" }));

    expect(await screen.findByText("Payload JSON is invalid.")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("sends group announcements through the director chat endpoint", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (path: string, init?: RequestInit) => ({
      ok: true,
      message: {
        id: "chat-1",
        senderId: "director",
        recipientIds: JSON.parse(String(init?.body)).recipientIds,
        visibility: "ai",
        content: "Move now",
        timestamp: "2026-06-10T00:10:00.000Z",
      },
    }));

    renderPanel({ api: mockApi(request) });

    await user.click(screen.getByRole("tab", { name: "Announcement" }));
    await user.type(screen.getByLabelText(/recipients/i), "leader, scout-2");
    await user.type(screen.getByLabelText(/content/i), "Move now");
    await user.click(screen.getByRole("button", { name: "Send announcement" }));

    expect(await screen.findByText("Sent to 2 recipient(s).")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      "/director/chat",
      expect.objectContaining({ method: "POST" }),
    );
    const firstCall = request.mock.calls[0];
    if (!firstCall) {
      throw new Error("director chat request was not sent");
    }
    const init = firstCall[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      senderId: "director",
      recipientIds: ["leader", "scout-2"],
      visibility: "ai",
      content: "Move now",
    });
  });

  it("clearly reports missing backend support for role assignment", async () => {
    const user = userEvent.setup();

    renderPanel({});

    await user.click(screen.getByRole("tab", { name: "Role" }));

    expect(screen.getByText("The V1 director API does not expose role assignment yet.")).toBeInTheDocument();
    expect(screen.getByText("role API missing")).toBeInTheDocument();
  });
});

function renderPanel(props: Partial<DirectorCommandPanelProps>): void {
  render(
    <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
      <DirectorCommandPanel agents={[]} {...props} />
    </MantineProvider>,
  );
}

function mockApi(request: Mock): NonNullable<DirectorCommandPanelProps["api"]> {
  return { request } as unknown as NonNullable<DirectorCommandPanelProps["api"]>;
}
