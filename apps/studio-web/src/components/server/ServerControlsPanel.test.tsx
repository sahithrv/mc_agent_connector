import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";

import { studioTheme } from "../../styles/theme";
import { ServerControlsPanel } from "./ServerControlsPanel";

describe("ServerControlsPanel", () => {
  it("disables unsupported lifecycle controls by default", () => {
    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <ServerControlsPanel />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restart" })).toBeDisabled();
    expect(screen.getByText(/endpoints are not exposed yet/i)).toBeInTheDocument();
  });
});
