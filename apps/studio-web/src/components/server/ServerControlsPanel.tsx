import { Badge, Box, Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { Power, RotateCcw, Server, Square } from "lucide-react";

import type { ServiceStatus } from "../../lib/types";
import { DebugPanelFrame, EmptyPanelState, cellStyle } from "../debug/panelPrimitives";
import { showStudioErrorToast, showStudioSuccessToast } from "../toasts/studioToasts";

export interface ServerControlCapabilities {
  start?: boolean;
  stop?: boolean;
  restart?: boolean;
}

export interface ServerControlsPanelProps {
  status?: ServiceStatus | "starting" | "stopping" | "restarting";
  capabilities?: ServerControlCapabilities;
  pendingControl?: keyof ServerControlCapabilities;
  error?: string;
  hideUnsupported?: boolean;
  onStart?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  onRestart?: () => void | Promise<void>;
}

export function ServerControlsPanel(props: ServerControlsPanelProps): JSX.Element {
  const capabilities = props.capabilities ?? {};
  const controls = [
    {
      id: "start" as const,
      label: "Start",
      icon: <Power size={14} aria-hidden="true" />,
      supported: capabilities.start === true && Boolean(props.onStart),
      onClick: props.onStart,
    },
    {
      id: "stop" as const,
      label: "Stop",
      icon: <Square size={14} aria-hidden="true" />,
      supported: capabilities.stop === true && Boolean(props.onStop),
      onClick: props.onStop,
    },
    {
      id: "restart" as const,
      label: "Restart",
      icon: <RotateCcw size={14} aria-hidden="true" />,
      supported: capabilities.restart === true && Boolean(props.onRestart),
      onClick: props.onRestart,
    },
  ].filter((control) => control.supported || !props.hideUnsupported);

  return (
    <DebugPanelFrame
      icon={<Server size={14} aria-hidden="true" />}
      meta="F31"
      rightSection={<StatusBadge status={props.status ?? "unknown"} />}
      subtitle="Minecraft server lifecycle controls"
      title="Server controls"
    >
      <Stack gap="xs">
        <Box style={cellStyle}>
          <Text c="dimmed" size="xs" tt="uppercase">
            Control support
          </Text>
          <Text mt={4} size="xs">
            {supportsAny(capabilities)
              ? "Backend lifecycle controls are partially available."
              : "Backend start/stop/restart endpoints are not exposed yet."}
          </Text>
        </Box>
        {controls.length === 0 ? (
          <EmptyPanelState
            detail="Unsupported server controls are hidden for this environment."
            icon={<Server size={16} aria-hidden="true" />}
            title="No server controls available"
          />
        ) : (
          <Group gap="xs" grow>
            {controls.map((control) => (
              <ControlButton
                key={control.id}
                disabled={!control.supported}
                icon={control.icon}
                label={control.label}
                loading={props.pendingControl === control.id}
                onClick={control.onClick}
                unsupportedReason="Backend endpoint not exposed"
              />
            ))}
          </Group>
        )}
        {props.error ? (
          <Text c="var(--mcas-red)" size="xs">
            {props.error}
          </Text>
        ) : null}
      </Stack>
    </DebugPanelFrame>
  );
}

function ControlButton(props: {
  label: string;
  icon: JSX.Element;
  disabled: boolean;
  loading: boolean;
  unsupportedReason: string;
  onClick?: () => void | Promise<void>;
}): JSX.Element {
  const button = (
    <Button
      disabled={props.disabled}
      leftSection={props.icon}
      loading={props.loading}
      onClick={() => void runControl(props.label, props.onClick)}
      variant={props.disabled ? "outline" : "light"}
    >
      {props.label}
    </Button>
  );

  return props.disabled ? (
    <Tooltip label={props.unsupportedReason}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );
}

async function runControl(label: string, action?: () => void | Promise<void>): Promise<void> {
  if (!action) return;
  try {
    await action();
    showStudioSuccessToast({ title: `${label} command sent` });
  } catch (error) {
    showStudioErrorToast({
      title: `${label} command failed`,
      message: error instanceof Error ? error.message : "Unknown server control error",
    });
  }
}

function StatusBadge({ status }: { status: ServerControlsPanelProps["status"] }): JSX.Element {
  const color = status === "online" ? "lime" : status === "offline" ? "red" : status === "unknown" ? "gray" : "yellow";
  return (
    <Badge color={color} radius="xs" size="xs" variant="light">
      {status}
    </Badge>
  );
}

function supportsAny(capabilities: ServerControlCapabilities): boolean {
  return capabilities.start === true || capabilities.stop === true || capabilities.restart === true;
}
