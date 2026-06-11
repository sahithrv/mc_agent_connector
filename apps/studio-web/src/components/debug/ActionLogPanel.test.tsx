import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";

import { studioStore } from "../../lib/state/store";
import { studioTheme } from "../../styles/theme";
import { ActionLogPanel } from "./ActionLogPanel";

describe("ActionLogPanel", () => {
  beforeEach(() => studioStore.reset());

  it("makes failed action reasons easy to inspect", () => {
    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <ActionLogPanel
          requests={[
            {
              id: "req-1",
              agentId: "miner-1",
              action: "mine_block",
              params: { block: "diamond_ore" },
              createdAt: "2026-06-10T01:00:00.000Z",
            },
          ]}
          results={[
            {
              requestId: "req-1",
              agentId: "miner-1",
              action: "mine_block",
              ok: false,
              startedAt: "2026-06-10T01:00:01.000Z",
              completedAt: "2026-06-10T01:00:03.250Z",
              error: "tool path blocked by lava",
            },
          ]}
        />
      </MantineProvider>,
    );

    expect(screen.getAllByText("tool path blocked by lava").length).toBeGreaterThan(0);
    expect(screen.getByText("2.3s")).toBeInTheDocument();
    expect(screen.getByText("Latest failed action")).toBeInTheDocument();
  });
});
