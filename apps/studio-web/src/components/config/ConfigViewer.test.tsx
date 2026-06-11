import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";

import { studioStore } from "../../lib/state/store";
import { studioTheme } from "../../styles/theme";
import { ConfigViewer } from "./ConfigViewer";

describe("ConfigViewer", () => {
  beforeEach(() => studioStore.reset());

  it("keeps malformed scenario config readable and readonly", () => {
    render(
      <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
        <ConfigViewer defaultTab="scenario" scenarioConfigSource={'{"id": "broken",'} />
      </MantineProvider>,
    );

    const viewer = screen.getByLabelText("Scenario JSON");
    expect(viewer).toHaveValue('{"id": "broken",');
    expect(viewer).toHaveAttribute("readonly");
    expect(screen.getByText(/Expected double-quoted property name|Unexpected end/i)).toBeInTheDocument();
  });
});
