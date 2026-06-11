import { Badge, Group, Text } from "@mantine/core";
import { CircuitBoard, Radio } from "lucide-react";

import { useStudioStore } from "../../lib/state/store";

export function AppHeader(): JSX.Element {
  const session = useStudioStore((state) => state.session);
  const connection = useStudioStore((state) => state.connection);
  const backendStatus = useStudioStore((state) => state.health.backend.status);

  return (
    <header className="studio-header">
      <div className="studio-brand">
        <div className="studio-mark">
          <CircuitBoard size={19} aria-hidden="true" />
        </div>
        <div>
          <div className="studio-kicker">Minecraft AI Agent Studio</div>
          <h1 className="studio-title">{session?.name ?? "Dashboard route"}</h1>
        </div>
      </div>
      <Group gap="xs" justify="flex-end" wrap="nowrap">
        <Badge
          leftSection={<span className="status-dot" data-status={backendStatus} />}
          variant="outline"
        >
          API {backendStatus}
        </Badge>
        <Badge
          leftSection={<Radio size={12} aria-hidden="true" />}
          color={connection.phase === "connected" ? "lime" : "yellow"}
          variant="light"
        >
          WS {connection.phase}
        </Badge>
        {connection.attempts > 0 ? (
          <Text c="dimmed" size="xs">
            retry {connection.attempts}
          </Text>
        ) : null}
      </Group>
    </header>
  );
}
