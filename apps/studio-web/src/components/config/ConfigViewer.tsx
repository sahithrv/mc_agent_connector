import { Alert, Badge, Box, Group, Stack, Tabs, Text, Textarea } from "@mantine/core";
import { Braces, FileJson, LockKeyhole, TriangleAlert } from "lucide-react";
import type { AgentConfig } from "@mc-ai-video/contracts";

import { DebugPanelFrame, cellStyle, monoStyle } from "../debug/panelPrimitives";
import { useStudioStore } from "../../lib/state/store";
import type { ScenarioConfigView } from "../scenario/types";

export interface ConfigViewerProps {
  agentConfig?: AgentConfig | AgentConfig[] | null;
  scenarioConfig?: ScenarioConfigView | null;
  agentConfigSource?: string;
  scenarioConfigSource?: string;
  agentConfigError?: string;
  scenarioConfigError?: string;
  defaultTab?: "agents" | "scenario";
}

export function ConfigViewer(props: ConfigViewerProps): JSX.Element {
  const storeAgents = useStudioStore((state) => state.agents);
  const agentDocument = configDocument({
    error: props.agentConfigError,
    fallback: props.agentConfig ?? storeAgents,
    source: props.agentConfigSource,
  });
  const scenarioDocument = configDocument({
    error: props.scenarioConfigError,
    fallback: props.scenarioConfig,
    source: props.scenarioConfigSource,
  });

  return (
    <DebugPanelFrame
      icon={<FileJson size={14} aria-hidden="true" />}
      meta="F32"
      rightSection={
        <Badge color="gray" leftSection={<LockKeyhole size={11} aria-hidden="true" />} radius="xs" size="xs" variant="outline">
          readonly
        </Badge>
      }
      subtitle="Agent config and scenario JSON"
      title="Config viewer"
    >
      <Tabs defaultValue={props.defaultTab ?? "agents"} keepMounted={false} variant="pills">
        <Tabs.List grow mb="xs">
          <Tabs.Tab leftSection={<Braces size={12} aria-hidden="true" />} value="agents">
            Agents
          </Tabs.Tab>
          <Tabs.Tab leftSection={<FileJson size={12} aria-hidden="true" />} value="scenario">
            Scenario
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="agents">
          <JsonDocument label="Agent config JSON" document={agentDocument} />
        </Tabs.Panel>
        <Tabs.Panel value="scenario">
          <JsonDocument label="Scenario JSON" document={scenarioDocument} />
        </Tabs.Panel>
      </Tabs>
    </DebugPanelFrame>
  );
}

interface ConfigDocument {
  text: string;
  lineCount: number;
  parseError?: string;
  empty: boolean;
}

function JsonDocument(props: { label: string; document: ConfigDocument }): JSX.Element {
  return (
    <Stack gap="xs">
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Text c="dimmed" size="xs" tt="uppercase">
          {props.label}
        </Text>
        <Badge color={props.document.parseError ? "red" : "lime"} radius="xs" size="xs" variant="light">
          {props.document.empty ? "empty" : `${props.document.lineCount} lines`}
        </Badge>
      </Group>
      {props.document.parseError ? (
        <Alert color="red" icon={<TriangleAlert size={14} />} py={6} variant="light">
          <Text size="xs">{props.document.parseError}</Text>
        </Alert>
      ) : null}
      <Box style={cellStyle}>
        <Textarea
          aria-label={props.label}
          autosize
          maxRows={28}
          minRows={14}
          readOnly
          resize="vertical"
          spellCheck={false}
          value={props.document.text}
          styles={{
            input: {
              ...monoStyle,
              background: "rgba(7, 9, 7, 0.82)",
              borderColor: "var(--mcas-line)",
              color: "var(--mcas-text)",
              lineHeight: 1.45,
            },
          }}
        />
      </Box>
    </Stack>
  );
}

function configDocument(input: {
  source?: string;
  fallback?: unknown;
  error?: string;
}): ConfigDocument {
  const source = input.source?.trim();
  if (source) {
    try {
      return fromText(JSON.stringify(JSON.parse(source), null, 2), input.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON";
      return fromText(source, input.error ?? message);
    }
  }

  if (input.fallback === undefined || input.fallback === null) {
    return { text: "{}", lineCount: 1, empty: true, parseError: input.error };
  }

  return fromText(JSON.stringify(input.fallback, null, 2), input.error);
}

function fromText(text: string, parseError?: string): ConfigDocument {
  return {
    text,
    lineCount: text.split(/\r?\n/).length,
    parseError,
    empty: text === "{}" || text === "[]",
  };
}
