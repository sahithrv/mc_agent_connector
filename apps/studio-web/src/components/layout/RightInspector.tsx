import { Badge, Stack } from "@mantine/core";

import { useStudioStore } from "../../lib/state/store";

export function RightInspector(): JSX.Element {
  const connection = useStudioStore((state) => state.connection);
  const api = useStudioStore((state) => state.api);
  const health = useStudioStore((state) => state.health);

  return (
    <aside className="right-inspector" aria-label="Connection inspector">
      <Stack gap="xs">
        <div className="section-head">
          <h2 className="section-title">Inspector</h2>
          <Badge
            variant="outline"
            leftSection={<span className="status-dot" data-status={connection.phase} />}
          >
            {connection.phase}
          </Badge>
        </div>
        <div className="inspector-stack">
          <InspectorBox label="WebSocket attempts" value={String(connection.attempts)} />
          <InspectorBox label="Next retry" value={connection.nextRetryAt ?? "none scheduled"} />
          <InspectorBox label="Last connected" value={connection.lastConnectedAt ?? "not yet"} />
          <InspectorBox
            label="Stream error"
            value={connection.error ?? "none"}
            tone={connection.error ? "error" : undefined}
          />
          <InspectorBox
            label="API health"
            value={api.loading ? "checking" : api.error?.message ?? health.backend.message ?? "idle"}
            tone={api.error ? "error" : undefined}
          />
          <InspectorBox label="Last health check" value={api.lastCheckedAt ?? "not yet"} />
        </div>
      </Stack>
    </aside>
  );
}

function InspectorBox(props: {
  label: string;
  value: string;
  tone?: "error";
}): JSX.Element {
  return (
    <div className="inspector-box">
      <div className="inspector-label">{props.label}</div>
      <div className={props.tone === "error" ? "inspector-value error-copy" : "inspector-value"}>
        {props.value}
      </div>
    </div>
  );
}
