import { Badge } from "@mantine/core";
import { AlertTriangle, BrainCircuit, Footprints, PauseCircle, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentMode } from "@mc-ai-video/contracts";

interface ModeMeta {
  label: string;
  icon: LucideIcon;
}

export const agentModeMeta: Record<AgentMode, ModeMeta> = {
  paused: { label: "Paused", icon: PauseCircle },
  routine: { label: "Routine", icon: RotateCw },
  planning: { label: "Planning", icon: BrainCircuit },
  acting: { label: "Acting", icon: Footprints },
  failed: { label: "Failed", icon: AlertTriangle },
};

export function AgentModeChip(props: { mode: AgentMode; compact?: boolean }): JSX.Element {
  const meta = agentModeMeta[props.mode];
  const Icon = meta.icon;

  return (
    <Badge
      className="agent-mode-chip"
      data-mode={props.mode}
      data-testid={`mode-chip-${props.mode}`}
      leftSection={<Icon size={props.compact ? 10 : 12} aria-hidden />}
      variant="outline"
    >
      {meta.label}
    </Badge>
  );
}
