import { MantineProvider } from "@mantine/core";

import { DashboardShell } from "../components/layout/DashboardShell";
import { useStudioRuntime } from "./useStudioRuntime";
import { studioTheme } from "../styles/theme";

export function App(): JSX.Element {
  useStudioRuntime();

  return (
    <MantineProvider defaultColorScheme="dark" theme={studioTheme}>
      <DashboardShell />
    </MantineProvider>
  );
}
