import { Badge, Box, Group, Text, ThemeIcon } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";
import { useId } from "react";

export const panelShellStyle: CSSProperties = {
  minWidth: 0,
  border: "1px solid var(--mcas-line)",
  background: "rgba(16, 20, 15, 0.94)",
};

export const panelBodyStyle: CSSProperties = {
  padding: 10,
};

export const cellStyle: CSSProperties = {
  minWidth: 0,
  border: "1px solid var(--mcas-line)",
  background: "rgba(21, 26, 19, 0.88)",
  padding: 10,
};

export const monoStyle: CSSProperties = {
  fontFamily: "var(--mantine-font-family-monospace)",
  fontSize: 11,
};

export function DebugPanelFrame(props: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  meta?: string;
  rightSection?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const titleId = useId();

  return (
    <Box component="section" aria-labelledby={titleId} style={panelShellStyle}>
      <Group
        align="center"
        gap="xs"
        justify="space-between"
        wrap="nowrap"
        style={{
          minHeight: 42,
          borderBottom: "1px solid var(--mcas-line)",
          padding: "7px 10px",
        }}
      >
        <Group gap="xs" wrap="nowrap" miw={0}>
          <ThemeIcon color="lime" size="sm" variant="light">
            {props.icon}
          </ThemeIcon>
          <Box miw={0}>
            <Text id={titleId} fw={760} size="sm" truncate>
              {props.title}
            </Text>
            {props.subtitle ? (
              <Text c="dimmed" size="xs" truncate>
                {props.subtitle}
              </Text>
            ) : null}
          </Box>
        </Group>
        <Group gap={6} justify="flex-end" wrap="nowrap">
          {props.meta ? (
            <Badge color="gray" radius="xs" size="xs" variant="outline">
              {props.meta}
            </Badge>
          ) : null}
          {props.rightSection}
        </Group>
      </Group>
      <Box style={panelBodyStyle}>{props.children}</Box>
    </Box>
  );
}

export function EmptyPanelState(props: {
  title: string;
  detail: string;
  icon: ReactNode;
}): JSX.Element {
  return (
    <Box
      role="status"
      style={{
        border: "1px dashed var(--mcas-line-strong)",
        background: "rgba(12, 16, 11, 0.72)",
        color: "var(--mcas-muted)",
        padding: 18,
        textAlign: "center",
      }}
    >
      <Group gap="xs" justify="center">
        {props.icon}
        <Text c="var(--mcas-text)" fw={700} size="sm">
          {props.title}
        </Text>
      </Group>
      <Text c="dimmed" mt={4} size="xs">
        {props.detail}
      </Text>
    </Box>
  );
}

export function formatClock(value?: string): string {
  if (!value) return "not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function durationMs(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const started = new Date(start).getTime();
  const completed = new Date(end).getTime();
  if (Number.isNaN(started) || Number.isNaN(completed)) return undefined;
  return Math.max(0, completed - started);
}

export function formatDuration(ms?: number): string {
  if (ms === undefined) return "pending";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
