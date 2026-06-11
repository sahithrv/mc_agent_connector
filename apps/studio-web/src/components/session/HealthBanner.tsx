import { ActionIcon, Loader, Tooltip } from "@mantine/core";
import { Bot, BrainCircuit, RefreshCw, Server, Unplug, Wifi } from "lucide-react";

import { getHealthSnapshot } from "../../lib/api/health";
import { normalizeApiError } from "../../lib/api/client";
import { studioStore, useStudioStore } from "../../lib/state/store";
import type { ServiceStatus } from "../../lib/types";

export function HealthBanner(): JSX.Element {
  const health = useStudioStore((state) => state.health);
  const api = useStudioStore((state) => state.api);
  const connection = useStudioStore((state) => state.connection);

  async function retryHealth(): Promise<void> {
    studioStore.setApiStatus({ loading: true, error: undefined });
    try {
      const snapshot = await getHealthSnapshot();
      studioStore.setHealth(snapshot);
      studioStore.setApiStatus({
        loading: false,
        lastCheckedAt: snapshot.backend.lastCheckedAt,
      });
    } catch (error) {
      const apiError = normalizeApiError(error);
      studioStore.setHealth({
        ...health,
        backend: {
          status: "offline",
          message: apiError.message,
          lastCheckedAt: new Date().toISOString(),
        },
      });
      studioStore.setApiStatus({ loading: false, error: apiError });
    }
  }

  return (
    <section className="health-banner" aria-label="Session health">
      <HealthCell
        icon={api.loading ? <Loader size={14} /> : <Server size={15} />}
        label="Backend"
        status={health.backend.status}
        value={health.backend.status}
        detail={api.error?.message ?? health.backend.message ?? "Waiting for health probe"}
      />
      <HealthCell
        icon={<Wifi size={15} />}
        label="Event stream"
        status={connection.phase === "connected" ? "online" : "offline"}
        value={connection.phase}
        detail={
          connection.attempts > 0
            ? `Reconnect attempt ${connection.attempts}`
            : connection.error ?? "No reconnect attempts"
        }
      />
      <HealthCell
        icon={<Unplug size={15} />}
        label="Minecraft"
        status={health.minecraft.status}
        value={health.minecraft.status}
        detail={health.minecraft.message ?? "Server status unavailable"}
      />
      <HealthCell
        icon={<Bot size={15} />}
        label="Bots"
        status={health.bots.connected > 0 ? "online" : "unknown"}
        value={`${health.bots.connected}/${health.bots.total}`}
        detail={health.bots.message ?? "No bot snapshots received"}
      />
      <HealthCell
        icon={<BrainCircuit size={15} />}
        label="LLM queue"
        status={health.llmQueue.status}
        value={`${health.llmQueue.active}/${health.llmQueue.queued}`}
        detail={health.llmQueue.message ?? "Queue telemetry unavailable"}
      />
      <div className="health-actions">
        <Tooltip label={api.loading ? "Health check running" : "Retry backend health"}>
          <ActionIcon
            aria-label="Retry backend health"
            disabled={api.loading}
            loading={api.loading}
            onClick={() => void retryHealth()}
            variant="subtle"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </ActionIcon>
        </Tooltip>
      </div>
    </section>
  );
}

function HealthCell(props: {
  icon: JSX.Element;
  label: string;
  status: ServiceStatus;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="health-cell">
      <div className="health-label">{props.label}</div>
      <div className="health-value">
        <span className="status-dot" data-status={props.status} />
        {props.icon}
        <span>{props.value}</span>
      </div>
      <div className="health-detail" title={props.detail}>
        {props.detail}
      </div>
    </div>
  );
}
