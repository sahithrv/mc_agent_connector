import { ActionIcon, Box, Group, SimpleGrid, Tooltip } from "@mantine/core";
import { BookmarkPlus, MessageSquare, PauseCircle } from "lucide-react";
import type { ActionRequest, ActionResult, AgentConfig, GameEvent } from "@mc-ai-video/contracts";

import { ConfigViewer } from "../config/ConfigViewer";
import { ActionLogPanel } from "../debug/ActionLogPanel";
import { LlmQueuePanel } from "../debug/LlmQueuePanel";
import type { LlmQueueSnapshot } from "../debug/types";
import { ServerControlsPanel, type ServerControlsPanelProps } from "../server/ServerControlsPanel";
import {
  StudioNotifications,
  showStudioErrorToast,
  showStudioSuccessToast,
} from "../toasts/studioToasts";
import {
  shortcutTooltip,
  useStudioShortcuts,
  type StudioShortcutHandlers,
} from "../../lib/shortcuts/studioShortcuts";
import { ScenarioPanel } from "./ScenarioPanel";
import type { ScenarioConfigView } from "./types";

export interface ScenarioDebugWorkspaceProps {
  scenario?: ScenarioConfigView | null;
  scenarioLoading?: boolean;
  scenarioError?: string;
  scenarioJsonSource?: string;
  agentConfig?: AgentConfig | AgentConfig[] | null;
  agentConfigSource?: string;
  agentConfigError?: string;
  llmQueue?: LlmQueueSnapshot;
  actionRequests?: ActionRequest[];
  actionResults?: ActionResult[];
  actionEvents?: GameEvent[];
  serverControls?: ServerControlsPanelProps;
  shortcuts?: StudioShortcutHandlers;
  renderNotifications?: boolean;
}

export function ScenarioDebugWorkspace(props: ScenarioDebugWorkspaceProps): JSX.Element {
  const shortcuts = createShortcutHandlers(props.shortcuts);
  useStudioShortcuts(shortcuts);

  return (
    <Box style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {props.renderNotifications === false ? null : <StudioNotifications />}
      <ShortcutToolbar shortcuts={shortcuts} />
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
        <ScenarioPanel
          error={props.scenarioError}
          loading={props.scenarioLoading}
          scenario={props.scenario}
        />
        <LlmQueuePanel snapshot={props.llmQueue} />
        <ActionLogPanel
          events={props.actionEvents}
          requests={props.actionRequests}
          results={props.actionResults}
        />
        <ServerControlsPanel {...props.serverControls} />
      </SimpleGrid>
      <ConfigViewer
        agentConfig={props.agentConfig}
        agentConfigError={props.agentConfigError}
        agentConfigSource={props.agentConfigSource}
        scenarioConfig={props.scenario}
        scenarioConfigError={props.scenarioError}
        scenarioConfigSource={props.scenarioJsonSource}
      />
    </Box>
  );
}

function ShortcutToolbar({ shortcuts }: { shortcuts: StudioShortcutHandlers }): JSX.Element {
  return (
    <Group gap={6} justify="flex-end" wrap="nowrap">
      <ToolbarButton
        disabled={!shortcuts.onPauseAll}
        icon={<PauseCircle size={15} aria-hidden="true" />}
        label="Pause all"
        tooltip={shortcutTooltip("pauseAll")}
        onClick={shortcuts.onPauseAll}
      />
      <ToolbarButton
        disabled={!shortcuts.onMarkClip}
        icon={<BookmarkPlus size={15} aria-hidden="true" />}
        label="Mark clip"
        tooltip={shortcutTooltip("markClip")}
        onClick={shortcuts.onMarkClip}
      />
      <ToolbarButton
        icon={<MessageSquare size={15} aria-hidden="true" />}
        label="Focus chat"
        tooltip={shortcutTooltip("focusChat")}
        onClick={shortcuts.onFocusChat}
      />
    </Group>
  );
}

function ToolbarButton(props: {
  label: string;
  tooltip: string;
  icon: JSX.Element;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
}): JSX.Element {
  const button = (
    <ActionIcon
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => void props.onClick?.()}
      variant="light"
    >
      {props.icon}
    </ActionIcon>
  );

  return (
    <Tooltip label={props.disabled ? `${props.tooltip}; action not wired` : props.tooltip}>
      <span>{button}</span>
    </Tooltip>
  );
}

function createShortcutHandlers(input: StudioShortcutHandlers | undefined): StudioShortcutHandlers {
  const onPauseAll = input?.onPauseAll;
  const onMarkClip = input?.onMarkClip;
  const onFocusChat = input?.onFocusChat;
  const focusChat = onFocusChat
    ? () => runShortcut("Focus chat", onFocusChat)
    : () => document.querySelector<HTMLElement>(input?.chatTargetSelector ?? "[data-studio-chat-input]")?.focus();

  return {
    enabled: input?.enabled,
    chatTargetSelector: input?.chatTargetSelector,
    onPauseAll: onPauseAll ? () => runShortcut("Pause all", onPauseAll) : undefined,
    onMarkClip: onMarkClip ? () => runShortcut("Mark clip", onMarkClip) : undefined,
    onFocusChat: focusChat,
  };
}

async function runShortcut(label: string, action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
    showStudioSuccessToast({ title: `${label} accepted` });
  } catch (error) {
    showStudioErrorToast({
      title: `${label} failed`,
      message: error instanceof Error ? error.message : "Unknown shortcut error",
    });
  }
}
