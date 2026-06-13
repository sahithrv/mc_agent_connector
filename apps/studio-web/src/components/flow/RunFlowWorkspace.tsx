import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import type {
  AgentConfig,
  AiChatMessage,
  BotConnectionStatus,
  EventSeverity,
  GameEvent,
  RuntimeAgentControlResult,
  RuntimeStatusSnapshot,
} from "@mc-ai-video/contracts";
import {
  Activity,
  Bot,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Flag,
  MapPinned,
  PauseCircle,
  PlayCircle,
  RadioTower,
  RefreshCw,
  Send,
  ShieldCheck,
  Shuffle,
  Square,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { agentControls } from "../../lib/api/agentControls";
import { getAgentConfigs, updateAgentConfig, type UpdateAgentInput } from "../../lib/api/agents";
import { normalizeApiError } from "../../lib/api/client";
import { injectDirectorEvent } from "../../lib/api/director";
import { runtimeApi } from "../../lib/api/runtime";
import { shouldUseStudioMocks } from "../../lib/mock/runtime";
import { studioStore, useStudioStore } from "../../lib/state/store";
import type { UiAgentRuntime, UiHealthSnapshot } from "../../lib/types";
import { AddAgentForm } from "../director/AddAgentForm";
import { DIRECTOR_ROLE_OPTIONS } from "../director/roleOptions";
import "./run-flow.css";

type FlowStepId = "agents" | "teams" | "scenario" | "readiness" | "launch" | "live";
type TimelineKind =
  | "all"
  | "events"
  | "public-chat"
  | "private-chat"
  | "team-chat"
  | "actions"
  | "decisions"
  | "errors";

const stepOrder: FlowStepId[] = ["agents", "teams", "scenario", "readiness", "launch", "live"];

const DEFAULT_SUBTEAM_OPTIONS = ["oak", "iron", "river", "ember"];

const BASIC_ROUTINE_OPTIONS = [
  { value: "farmer", label: "Farmer" },
  { value: "miner", label: "Miner" },
  { value: "guard", label: "Guard" },
  { value: "survival", label: "Survival" },
];

const ROLE_SELECT_DATA = DIRECTOR_ROLE_OPTIONS.map((role) => ({
  value: role.toLowerCase(),
  label: role,
}));

const PERSONALITY_TRAITS = [
  "adaptable",
  "alert",
  "analytical",
  "bold",
  "calm",
  "careful",
  "collaborative",
  "curious",
  "decisive",
  "disciplined",
  "empathetic",
  "inventive",
  "loyal",
  "methodical",
  "observant",
  "optimistic",
  "patient",
  "pragmatic",
  "protective",
  "resourceful",
  "skeptical",
  "steady",
  "strategic",
  "witty",
];

const stepMeta: Record<FlowStepId, { label: string; detail: string; icon: typeof Circle }> = {
  agents: {
    label: "Agents",
    detail: "Select and shape the bot roster",
    icon: Bot,
  },
  teams: {
    label: "Subteams",
    detail: "Group selected agents",
    icon: Users,
  },
  scenario: {
    label: "Scenario",
    detail: "Set the live objective",
    icon: Flag,
  },
  readiness: {
    label: "Readiness",
    detail: "Check API, runtime, and server",
    icon: ShieldCheck,
  },
  launch: {
    label: "Launch",
    detail: "Connect selected bots",
    icon: RadioTower,
  },
  live: {
    label: "Live Ops",
    detail: "Monitor and direct runtime",
    icon: Activity,
  },
};

interface AgentDraft {
  name: string;
  username: string;
  role: string;
  subteam: string;
  personality: string;
  routine: string;
  enabled: boolean;
  riskTolerance: NonNullable<AgentConfig["behavior"]>["riskTolerance"];
  teamwork: NonNullable<AgentConfig["behavior"]>["teamwork"];
  initiative: NonNullable<AgentConfig["behavior"]>["initiative"];
}

interface RuntimeRefreshOptions {
  silent?: boolean;
  statusMessage?: string;
}

export function RunFlowWorkspace(): JSX.Element {
  const agents = useStudioStore((state) => state.agents);
  const events = useStudioStore((state) => state.events);
  const chat = useStudioStore((state) => state.chat);
  const health = useStudioStore((state) => state.health);
  const [activeStep, setActiveStep] = useState<FlowStepId>("agents");
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [focusedAgentId, setFocusedAgentId] = useState<string>();
  const [draft, setDraft] = useState<AgentDraft | undefined>();
  const [teamDraft, setTeamDraft] = useState("");
  const [scenarioGoal, setScenarioGoal] = useState(
    "Work as coordinated teams to survive, gather resources, and report decisions before risky actions.",
  );
  const [runtime, setRuntime] = useState<RuntimeStatusSnapshot>();
  const [flowError, setFlowError] = useState<string>();
  const [flowStatus, setFlowStatus] = useState<string>();
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingScenario, setSavingScenario] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchResults, setLaunchResults] = useState<RuntimeAgentControlResult[]>([]);
  const [timelineAgent, setTimelineAgent] = useState("all");
  const [timelineTeam, setTimelineTeam] = useState("all");
  const [timelineKind, setTimelineKind] = useState<TimelineKind>("all");
  const selectedAgents = useMemo(
    () => agents.filter((agent) => selectedAgentIds.has(agent.id)),
    [agents, selectedAgentIds],
  );
  const focusedAgent = agents.find((agent) => agent.id === focusedAgentId) ?? selectedAgents[0] ?? agents[0];
  const teams = useMemo(() => teamSummaries(agents), [agents]);
  const selectedTeams = useMemo(() => teamSummaries(selectedAgents), [selectedAgents]);
  const stepComplete = useMemo(
    () => ({
      agents: selectedAgents.some((agent) => agent.enabled !== false),
      teams: selectedAgents.length > 0 && selectedAgents.every((agent) => Boolean(teamId(agent))),
      scenario: scenarioGoal.trim().length >= 12,
      readiness:
        health.backend.status === "online" &&
        runtime?.capabilities.launch === true &&
        runtime.minecraft.status !== "offline",
      launch:
        launchResults.some((result) => result.ok) ||
        selectedAgents.some((agent) => agent.connectionStatus === "connected"),
      live:
        launchResults.some((result) => result.ok) ||
        selectedAgents.some((agent) => agent.connectionStatus === "connected"),
    }),
    [health.backend.status, launchResults, runtime, scenarioGoal, selectedAgents],
  );

  useEffect(() => {
    if (agents.length === 0 || selectedAgentIds.size > 0) return;
    const initialSelection = agents
      .filter((agent) => agent.enabled !== false)
      .slice(0, 6)
      .map((agent) => agent.id);
    setSelectedAgentIds(new Set(initialSelection));
    setFocusedAgentId(initialSelection[0] ?? agents[0]?.id);
  }, [agents, selectedAgentIds.size]);

  useEffect(() => {
    if (!focusedAgent) {
      setDraft(undefined);
      return;
    }
    setDraft(draftFromAgent(focusedAgent));
  }, [focusedAgent?.id]);

  useEffect(() => {
    if (import.meta.env.MODE === "test" || shouldUseStudioMocks()) return;
    void refreshRuntime();
  }, []);

  function canOpen(step: FlowStepId): boolean {
    const index = stepOrder.indexOf(step);
    return stepOrder.slice(0, index).every((id) => stepComplete[id]);
  }

  function openStep(step: FlowStepId): void {
    setActiveStep(step);
    if (step === "launch") {
      setFlowStatus(`Ready to launch ${selectedAgents.length} selected bots.`);
    } else if (step === "agents" || step === "teams" || step === "scenario") {
      setFlowStatus(undefined);
    }
  }

  function continueTo(next: FlowStepId): void {
    if (canOpen(next)) {
      openStep(next);
    }
  }

  function toggleAgent(agent: UiAgentRuntime, checked: boolean): void {
    setSelectedAgentIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(agent.id);
      } else {
        next.delete(agent.id);
      }
      return next;
    });
    setFocusedAgentId(agent.id);
  }

  async function refreshRuntime(options: RuntimeRefreshOptions = {}): Promise<void> {
    setCheckingReadiness(true);
    setFlowError(undefined);
    try {
      const [agentConfigs, status] = await Promise.all([
        getAgentConfigs(),
        runtimeApi.getStatus(),
      ]);
      studioStore.setAgents(agentConfigs);
      studioStore.setRuntimeStatus(status);
      setRuntime(status);
      if (!options.silent) {
        setFlowStatus(options.statusMessage ?? "Readiness refreshed. Open Launch when all checks are green.");
      }
    } catch (error) {
      setFlowError(normalizeApiError(error).message);
    } finally {
      setCheckingReadiness(false);
    }
  }

  async function saveAgentDraft(): Promise<void> {
    if (!focusedAgent || !draft) return;
    setSavingAgent(true);
    setFlowError(undefined);
    try {
      const update: UpdateAgentInput = {
        name: draft.name.trim(),
        role: draft.role.trim(),
        subteam: draft.subteam.trim() || undefined,
        personality: draft.personality.trim() || undefined,
        routine: draft.routine.trim() || undefined,
        enabled: draft.enabled,
        account: { username: draft.username.trim() },
        behavior: {
          riskTolerance: draft.riskTolerance,
          teamwork: draft.teamwork,
          initiative: draft.initiative,
        },
      };
      const agent = await updateAgentConfig(focusedAgent.id, update);
      const nextAgents = agents.map((item) => (item.id === agent.id ? { ...item, ...agent } : item));
      studioStore.setAgents(nextAgents);
      if (agent.enabled === false) {
        setSelectedAgentIds((current) => {
          const next = new Set(current);
          next.delete(agent.id);
          return next;
        });
      }
      setFlowStatus(`Saved ${agent.name}`);
    } catch (error) {
      setFlowError(normalizeApiError(error).message);
    } finally {
      setSavingAgent(false);
    }
  }

  async function assignSelectedTeam(): Promise<void> {
    const subteam = teamDraft.trim();
    if (!subteam || selectedAgents.length === 0) return;
    setSavingAgent(true);
    setFlowError(undefined);
    try {
      const updates = await Promise.all(
        selectedAgents.map((agent) => updateAgentConfig(agent.id, { subteam })),
      );
      const updateById = new Map(updates.map((agent) => [agent.id, agent]));
      studioStore.setAgents(
        agents.map((agent) => (updateById.get(agent.id) ? { ...agent, ...updateById.get(agent.id)! } : agent)),
      );
      setTeamDraft("");
      setFlowStatus(`Assigned ${selectedAgents.length} agents to subteam ${subteam}`);
    } catch (error) {
      setFlowError(normalizeApiError(error).message);
    } finally {
      setSavingAgent(false);
    }
  }

  async function saveScenarioGoal(): Promise<void> {
    const content = scenarioGoal.trim();
    if (content.length < 12) return;
    setSavingScenario(true);
    setFlowError(undefined);
    try {
      const event = await injectDirectorEvent({
        type: "chat.leader_command",
        actorId: "studio-web",
        severity: 4 as EventSeverity,
        visibility: "ai",
        payload: {
          content,
          agentIds: selectedAgents.map((agent) => agent.id),
          source: "guided-flow",
        },
      });
      studioStore.appendEvent(event);
      setFlowStatus("Scenario goal saved. Check readiness next.");
      continueTo("readiness");
    } catch (error) {
      setFlowError(normalizeApiError(error).message);
    } finally {
      setSavingScenario(false);
    }
  }

  async function launchSelectedAgents(): Promise<void> {
    setLaunching(true);
    setFlowError(undefined);
    setLaunchResults([]);
    try {
      const response = await runtimeApi.launch({
        agentIds: selectedAgents.map((agent) => agent.id),
        scenarioGoal,
        requestedBy: "studio-web",
      });
      setLaunchResults(response.results);
      await refreshRuntime({ silent: true });
      const acceptedCount = response.results.filter((result) => result.ok).length;
      setFlowStatus(
        acceptedCount > 0
          ? `Launch accepted for ${acceptedCount}/${response.results.length} selected bots. Live Ops is active.`
          : "Launch returned no accepted bots. Review the per-agent results.",
      );
      if (acceptedCount > 0) {
        setActiveStep("live");
      }
    } catch (error) {
      setFlowError(normalizeApiError(error).message);
    } finally {
      setLaunching(false);
    }
  }

  async function stopSelectedAgents(): Promise<void> {
    setFlowError(undefined);
    try {
      const response = await runtimeApi.stopAgents(
        selectedAgents.map((agent) => agent.id),
        "Stopped from guided runtime controls",
      );
      setLaunchResults(response.results);
      await refreshRuntime({ silent: true });
      setFlowStatus(`Stop commands sent for ${response.results.length} selected bots.`);
    } catch (error) {
      setFlowError(normalizeApiError(error).message);
    }
  }

  async function pauseSelectedAgents(paused: boolean): Promise<void> {
    setFlowError(undefined);
    try {
      await Promise.all(
        selectedAgents.map((agent) =>
          paused
            ? agentControls.pauseAgent(agent.id, { reason: "Guided flow runtime control" })
            : agentControls.resumeAgent(agent.id, { reason: "Guided flow runtime control" }),
        ),
      );
      setFlowStatus(
        paused
          ? `Pause commands sent for ${selectedAgents.length} selected bots.`
          : `Resume commands sent for ${selectedAgents.length} selected bots.`,
      );
    } catch (error) {
      setFlowError(normalizeApiError(error).message);
    }
  }

  return (
    <section className="run-flow" aria-label="Guided demo flow">
      <div className="run-flow__rail" aria-label="Flow steps">
        {stepOrder.map((stepId) => (
          <StepButton
            active={activeStep === stepId}
            complete={stepComplete[stepId]}
            disabled={!canOpen(stepId)}
            key={stepId}
            onClick={() => openStep(stepId)}
            stepId={stepId}
          />
        ))}
      </div>

      <div className="run-flow__panel">
        <div className="run-flow__head">
          <div>
            <div className="run-flow__eyebrow">guided local demo</div>
            <h3>{stepMeta[activeStep].label}</h3>
            <p>{stepMeta[activeStep].detail}</p>
          </div>
          <FlowStats
            connected={agents.filter((agent) => agent.connectionStatus === "connected").length}
            selected={selectedAgents.length}
            teams={selectedTeams.length}
          />
        </div>

        {flowError ? (
          <Alert color="red" icon={<ShieldCheck size={15} />} variant="outline">
            {flowError}
          </Alert>
        ) : null}
        {flowStatus ? (
          <div className="run-flow__status" role="status">
            {flowStatus}
          </div>
        ) : null}

        {activeStep === "agents" ? (
          <AgentsStep
            agents={agents}
            draft={draft}
            focusedAgent={focusedAgent}
            onAddAgent={(agent) => {
              studioStore.setAgents([...agents, agent]);
              setSelectedAgentIds((current) => new Set([...current, agent.id]));
              setFocusedAgentId(agent.id);
            }}
            onChangeDraft={setDraft}
            onContinue={() => continueTo("teams")}
            onFocusAgent={setFocusedAgentId}
            onSaveDraft={saveAgentDraft}
            onToggleAgent={toggleAgent}
            saving={savingAgent}
            selectedAgentIds={selectedAgentIds}
            stepComplete={stepComplete.agents}
          />
        ) : null}

        {activeStep === "teams" ? (
          <TeamsStep
            allTeams={teams}
            onAssignTeam={() => void assignSelectedTeam()}
            onContinue={() => continueTo("scenario")}
            saving={savingAgent}
            selectedAgents={selectedAgents}
            selectedTeams={selectedTeams}
            setTeamDraft={setTeamDraft}
            stepComplete={stepComplete.teams}
            teamDraft={teamDraft}
          />
        ) : null}

        {activeStep === "scenario" ? (
          <ScenarioStep
            goal={scenarioGoal}
            onContinue={() => continueTo("readiness")}
            onGoalChange={setScenarioGoal}
            onSave={() => void saveScenarioGoal()}
            saving={savingScenario}
            selectedAgents={selectedAgents}
            stepComplete={stepComplete.scenario}
          />
        ) : null}

        {activeStep === "readiness" ? (
          <ReadinessStep
            checking={checkingReadiness}
            health={health}
            onContinue={() => continueTo("launch")}
            onRefresh={() => void refreshRuntime()}
            runtime={runtime}
            stepComplete={stepComplete.readiness}
          />
        ) : null}

        {activeStep === "launch" ? (
          <LaunchStep
            disabled={!stepComplete.readiness}
            launching={launching}
            onLaunch={() => void launchSelectedAgents()}
            onRefresh={() => void refreshRuntime()}
            results={launchResults}
            selectedAgents={selectedAgents}
          />
        ) : null}

        {activeStep === "live" ? (
          <LiveStep
            agents={agents}
            events={events}
            chat={chat}
            onPause={() => void pauseSelectedAgents(true)}
            onRefresh={() => void refreshRuntime()}
            onResume={() => void pauseSelectedAgents(false)}
            onSaveGoal={() => void saveScenarioGoal()}
            onStop={() => void stopSelectedAgents()}
            onTimelineAgentChange={setTimelineAgent}
            onTimelineKindChange={setTimelineKind}
            onTimelineTeamChange={setTimelineTeam}
            runtime={runtime}
            scenarioGoal={scenarioGoal}
            selectedAgents={selectedAgents}
            timelineAgent={timelineAgent}
            timelineKind={timelineKind}
            timelineTeam={timelineTeam}
          />
        ) : null}
      </div>
    </section>
  );
}

function StepButton(props: {
  stepId: FlowStepId;
  active: boolean;
  complete: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  const Icon = stepMeta[props.stepId].icon;
  return (
    <Tooltip disabled={!props.disabled} label="Finish previous steps first" position="right">
      <button
        aria-current={props.active ? "step" : undefined}
        className="run-flow-step"
        data-active={props.active}
        data-complete={props.complete}
        disabled={props.disabled}
        onClick={props.onClick}
        type="button"
      >
        <Icon size={16} aria-hidden="true" />
        <span>
          <strong>{stepMeta[props.stepId].label}</strong>
          <em>{stepMeta[props.stepId].detail}</em>
        </span>
        {props.complete ? <CheckCircle2 size={15} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}

function FlowStats(props: { selected: number; connected: number; teams: number }): JSX.Element {
  return (
    <div className="run-flow-stats" aria-label="Flow totals">
      <FlowStat label="Selected" value={props.selected} />
      <FlowStat label="Connected" value={props.connected} />
      <FlowStat label="Subteams" value={props.teams} />
    </div>
  );
}

function FlowStat(props: { label: string; value: number | string }): JSX.Element {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function AgentsStep(props: {
  agents: UiAgentRuntime[];
  selectedAgentIds: Set<string>;
  focusedAgent?: UiAgentRuntime;
  draft?: AgentDraft;
  saving: boolean;
  stepComplete: boolean;
  onAddAgent: (agent: UiAgentRuntime) => void;
  onChangeDraft: (draft: AgentDraft) => void;
  onContinue: () => void;
  onFocusAgent: (agentId: string) => void;
  onSaveDraft: () => void;
  onToggleAgent: (agent: UiAgentRuntime, checked: boolean) => void;
}): JSX.Element {
  const roleOptions = selectDataWithCurrent(ROLE_SELECT_DATA, props.draft?.role);
  const subteamOptions = selectDataWithCurrent(
    uniqueStrings([
      ...DEFAULT_SUBTEAM_OPTIONS,
      ...props.agents.map((agent) => teamId(agent)),
      props.draft?.subteam,
    ]),
    props.draft?.subteam,
  );
  const routineOptions = selectDataWithCurrent(BASIC_ROUTINE_OPTIONS, props.draft?.routine);

  return (
    <div className="run-flow-grid run-flow-grid--agents">
      <div className="run-flow-block">
        <PanelTitle icon={<Bot size={15} />} title="Launch roster" meta={`${props.selectedAgentIds.size}/${props.agents.length}`} />
        <div className="run-flow-agent-list" role="list" aria-label="Selectable agents">
          {props.agents.map((agent) => (
            <button
              className="run-flow-agent-row"
              data-active={props.focusedAgent?.id === agent.id}
              key={agent.id}
              onClick={() => props.onFocusAgent(agent.id)}
              type="button"
            >
              <Checkbox
                aria-label={`Select ${agent.name}`}
                checked={props.selectedAgentIds.has(agent.id)}
                disabled={agent.enabled === false}
                onChange={(event) => props.onToggleAgent(agent, event.currentTarget.checked)}
                onClick={(event) => event.stopPropagation()}
              />
              <span>
                <strong>{agent.name}</strong>
                <em>{agent.role} / {teamId(agent) || "unassigned"}</em>
              </span>
              <StatusPill status={agent.connectionStatus ?? modeConnection(agent.mode)} />
            </button>
          ))}
        </div>
      </div>

      <div className="run-flow-block">
        <PanelTitle icon={<ClipboardCheck size={15} />} title="Agent configuration" meta="session" />
        {props.focusedAgent && props.draft ? (
          <Stack gap="xs">
            <div className="run-flow-form-grid">
              <TextInput
                label="Name"
                value={props.draft.name}
                onChange={(event) => props.onChangeDraft({ ...props.draft!, name: event.currentTarget.value })}
              />
              <TextInput
                label="Minecraft username"
                value={props.draft.username}
                onChange={(event) => props.onChangeDraft({ ...props.draft!, username: event.currentTarget.value })}
              />
            </div>
            <div className="run-flow-form-grid">
              <Select
                data={roleOptions}
                label="Role"
                searchable
                value={props.draft.role}
                onChange={(value) => {
                  if (value) {
                    props.onChangeDraft(roleDraft(props.draft!, value));
                  }
                }}
              />
              <Select
                clearable
                data={subteamOptions}
                label="Subteam"
                searchable
                value={props.draft.subteam || null}
                onChange={(value) => props.onChangeDraft({ ...props.draft!, subteam: value ?? "" })}
              />
            </div>
            <div className="run-flow-personality-field">
              <Textarea
                autosize
                minRows={2}
                label="Personality"
                value={props.draft.personality}
                onChange={(event) => props.onChangeDraft({ ...props.draft!, personality: event.currentTarget.value })}
              />
              <Button
                leftSection={<Shuffle size={14} />}
                onClick={() => props.onChangeDraft({ ...props.draft!, personality: randomPersonalityTraits() })}
                variant="light"
              >
                Randomize traits
              </Button>
            </div>
            <Select
              data={routineOptions}
              label="Basic routine"
              searchable
              value={props.draft.routine || null}
              onChange={(value) => props.onChangeDraft({ ...props.draft!, routine: value ?? "" })}
            />
            <div className="run-flow-form-grid">
              <Select
                label="Risk"
                data={["low", "medium", "high"]}
                value={props.draft.riskTolerance ?? "medium"}
                onChange={(value) => props.onChangeDraft({ ...props.draft!, riskTolerance: behaviorRisk(value) })}
              />
              <Select
                label="Teamwork"
                data={["solo", "balanced", "team-first"]}
                value={props.draft.teamwork ?? "balanced"}
                onChange={(value) => props.onChangeDraft({ ...props.draft!, teamwork: behaviorTeamwork(value) })}
              />
              <Select
                label="Initiative"
                data={["low", "medium", "high"]}
                value={props.draft.initiative ?? "medium"}
                onChange={(value) => props.onChangeDraft({ ...props.draft!, initiative: behaviorInitiative(value) })}
              />
            </div>
            <Group justify="space-between">
              <Switch
                checked={props.draft.enabled}
                label="Enabled for launch"
                onChange={(event) => props.onChangeDraft({ ...props.draft!, enabled: event.currentTarget.checked })}
              />
              <Button
                leftSection={<CheckCircle2 size={14} />}
                loading={props.saving}
                onClick={props.onSaveDraft}
              >
                Save agent
              </Button>
            </Group>
          </Stack>
        ) : (
          <div className="run-flow-empty">No agent selected.</div>
        )}
      </div>

      <div className="run-flow-block">
        <PanelTitle icon={<Bot size={15} />} title="Create agent" meta="validated" />
        <AddAgentForm agents={props.agents} onAdded={props.onAddAgent} />
      </div>

      <FlowFooter
        actionLabel="Continue to Subteams"
        complete={props.stepComplete}
        completeLabel="Agent roster ready"
        incompleteLabel="Select at least one enabled agent"
        onContinue={props.onContinue}
      />
    </div>
  );
}

function TeamsStep(props: {
  allTeams: TeamSummary[];
  selectedAgents: UiAgentRuntime[];
  selectedTeams: TeamSummary[];
  teamDraft: string;
  saving: boolean;
  stepComplete: boolean;
  setTeamDraft: (value: string) => void;
  onAssignTeam: () => void;
  onContinue: () => void;
}): JSX.Element {
  return (
    <div className="run-flow-grid">
      <div className="run-flow-block">
        <PanelTitle icon={<Users size={15} />} title="Selected subteam coverage" meta={`${props.selectedTeams.length} subteams`} />
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xs">
          {props.selectedTeams.length === 0 ? (
            <div className="run-flow-empty">No selected agents have teams yet.</div>
          ) : (
            props.selectedTeams.map((team) => <TeamBox key={team.id} team={team} />)
          )}
        </SimpleGrid>
      </div>
      <div className="run-flow-block">
        <PanelTitle icon={<Users size={15} />} title="Assign selected agents" meta={`${props.selectedAgents.length} selected`} />
        <Group align="end" gap="xs">
          <TextInput
            className="run-flow-grow"
            label="Subteam name"
            placeholder="oak"
            value={props.teamDraft}
            onChange={(event) => props.setTeamDraft(event.currentTarget.value)}
          />
          <Button
            disabled={!props.teamDraft.trim() || props.selectedAgents.length === 0}
            loading={props.saving}
            onClick={props.onAssignTeam}
          >
            Assign subteam
          </Button>
        </Group>
      </div>
      <div className="run-flow-block">
        <PanelTitle icon={<Users size={15} />} title="All session subteams" meta={`${props.allTeams.length}`} />
        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="xs">
          {props.allTeams.map((team) => <TeamBox key={team.id} team={team} />)}
        </SimpleGrid>
      </div>
      <FlowFooter
        actionLabel="Continue to Scenario"
        complete={props.stepComplete}
        completeLabel="Subteam setup ready"
        incompleteLabel="Every selected agent needs a subteam"
        onContinue={props.onContinue}
      />
    </div>
  );
}

function ScenarioStep(props: {
  selectedAgents: UiAgentRuntime[];
  goal: string;
  saving: boolean;
  stepComplete: boolean;
  onGoalChange: (value: string) => void;
  onSave: () => void;
  onContinue: () => void;
}): JSX.Element {
  return (
    <div className="run-flow-grid">
      <div className="run-flow-block">
        <PanelTitle icon={<Flag size={15} />} title="Active scenario goal" meta={`${props.selectedAgents.length} agents`} />
        <Textarea
          autosize
          minRows={5}
          value={props.goal}
          onChange={(event) => props.onGoalChange(event.currentTarget.value)}
        />
        <Group justify="flex-end" mt="xs">
          <Button
            disabled={!props.stepComplete}
            leftSection={<Send size={14} />}
            loading={props.saving}
            onClick={props.onSave}
          >
            Save and check readiness
          </Button>
        </Group>
      </div>
      <FlowFooter
        actionLabel="Continue to Readiness"
        complete={props.stepComplete}
        completeLabel="Scenario goal ready"
        incompleteLabel="Write a clear overall goal"
        onContinue={props.onContinue}
      />
    </div>
  );
}

function ReadinessStep(props: {
  health: UiHealthSnapshot;
  runtime?: RuntimeStatusSnapshot;
  checking: boolean;
  stepComplete: boolean;
  onRefresh: () => void;
  onContinue: () => void;
}): JSX.Element {
  const runtime = props.runtime;
  const minecraftStatus = runtime?.minecraft.status ?? props.health.minecraft.status;
  const checks = [
    {
      label: "Studio API",
      ok: props.health.backend.status === "online",
      detail: props.health.backend.status === "online" ? "API is reachable" : "Backend must be online",
    },
    {
      label: "Runtime launch",
      ok: runtime?.capabilities.launch === true,
      detail: runtime?.capabilities.launch
        ? "Lifecycle control is attached"
        : "Start live-agents for lifecycle control",
    },
    {
      label: "Minecraft",
      ok: minecraftStatus !== "offline",
      detail: minecraftStatus !== "offline" ? "Server stream is available" : "Minecraft is offline",
    },
  ];

  return (
    <div className="run-flow-grid">
      <div className="run-flow-block run-flow-readiness-summary">
        <PanelTitle
          icon={<ShieldCheck size={15} />}
          title="Launch gate"
          meta={props.stepComplete ? "ready to launch" : "needs attention"}
        />
        <p>
          Launch unlocks after the API, runtime lifecycle controller, and Minecraft status are green.
        </p>
        <div className="run-flow-checklist" aria-label="Launch readiness checklist">
          {checks.map((check) => (
            <div className="run-flow-check" data-ok={check.ok} key={check.label}>
              {check.ok ? <CheckCircle2 size={14} /> : <Circle size={13} />}
              <span>
                <strong>{check.label}</strong>
                <em>{check.detail}</em>
              </span>
            </div>
          ))}
        </div>
      </div>
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xs">
        <ReadinessBox label="Studio API" status={props.health.backend.status} message={props.health.backend.message} />
        <ReadinessBox label="Minecraft" status={runtime?.minecraft.status ?? props.health.minecraft.status} message={runtime?.minecraft.message ?? props.health.minecraft.message} />
        <ReadinessBox
          label="Runtime launch"
          status={runtime?.capabilities.launch ? "online" : "offline"}
          message={runtime?.capabilities.launch ? "Launch endpoint is available" : "Start live-agents for bot lifecycle control"}
        />
      </SimpleGrid>
      <Group className="run-flow-action-row" justify="space-between">
        <Button
          leftSection={<RefreshCw size={14} />}
          loading={props.checking}
          onClick={props.onRefresh}
          variant="light"
        >
          Refresh checks
        </Button>
        <FlowFooterInline
          actionLabel="Open Launch"
          complete={props.stepComplete}
          completeLabel="Backend and runtime ready"
          incompleteLabel="Runtime launch or Minecraft readiness is not green"
          onContinue={props.onContinue}
        />
      </Group>
    </div>
  );
}

function LaunchStep(props: {
  selectedAgents: UiAgentRuntime[];
  results: RuntimeAgentControlResult[];
  disabled: boolean;
  launching: boolean;
  onLaunch: () => void;
  onRefresh: () => void;
}): JSX.Element {
  const readyToLaunch = !props.disabled && props.selectedAgents.length > 0;
  const launchHint =
    props.selectedAgents.length === 0
      ? "Select at least one enabled bot before launching."
      : props.disabled
        ? "Readiness must be green before launch can send connect requests."
        : "Ready to send connect requests for the selected roster.";

  return (
    <div className="run-flow-grid">
      <div className="run-flow-block run-flow-launch-pad">
        <PanelTitle icon={<RadioTower size={15} />} title="Launch selected agents" meta={`${props.selectedAgents.length} bots`} />
        <div className="run-flow-next-card" data-ready={readyToLaunch}>
          <strong>{readyToLaunch ? "Next: launch the selected bots" : "Launch is gated"}</strong>
          <span>{launchHint}</span>
        </div>
        <p>Accepted launches open Live Ops automatically. Rejected agents appear in per-agent progress below.</p>
        <Group>
          <Button
            disabled={props.disabled || props.selectedAgents.length === 0}
            leftSection={<PlayCircle size={14} />}
            loading={props.launching}
            onClick={props.onLaunch}
          >
            Launch {props.selectedAgents.length} selected bots
          </Button>
          <Button leftSection={<RefreshCw size={14} />} onClick={props.onRefresh} variant="light">
            Refresh status
          </Button>
        </Group>
      </div>
      <LaunchResults results={props.results} />
    </div>
  );
}

function LiveStep(props: {
  agents: UiAgentRuntime[];
  selectedAgents: UiAgentRuntime[];
  events: GameEvent[];
  chat: AiChatMessage[];
  runtime?: RuntimeStatusSnapshot;
  scenarioGoal: string;
  timelineAgent: string;
  timelineTeam: string;
  timelineKind: TimelineKind;
  onRefresh: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSaveGoal: () => void;
  onTimelineAgentChange: (value: string) => void;
  onTimelineTeamChange: (value: string) => void;
  onTimelineKindChange: (value: TimelineKind) => void;
}): JSX.Element {
  const teamOptions = [
    { value: "all", label: "All subteams" },
    ...teamSummaries(props.agents).map((team) => ({ value: team.id, label: team.id })),
  ];
  const agentOptions = [
    { value: "all", label: "All agents" },
    ...props.agents.map((agent) => ({ value: agent.id, label: agent.name })),
  ];
  const timeline = buildTimeline({
    agents: props.agents,
    events: props.events,
    chat: props.chat,
    agentId: props.timelineAgent,
    teamId: props.timelineTeam,
    kind: props.timelineKind,
  });
  const selectedCount = props.selectedAgents.length;

  return (
    <div className="run-flow-grid">
      <div className="run-flow-controls">
        <div className="run-flow-controls__head">
          <span>Selected bot controls</span>
          <strong>{selectedCount} selected</strong>
        </div>
        <div className="run-flow-controls__actions">
          <Button disabled={selectedCount === 0} leftSection={<PauseCircle size={14} />} onClick={props.onPause} variant="light">
            Pause {selectedCount}
          </Button>
          <Button disabled={selectedCount === 0} leftSection={<PlayCircle size={14} />} onClick={props.onResume} variant="light">
            Resume {selectedCount}
          </Button>
          <Button color="red" disabled={selectedCount === 0} leftSection={<Square size={14} />} onClick={props.onStop} variant="outline">
            Stop {selectedCount}
          </Button>
          <Button leftSection={<Flag size={14} />} onClick={props.onSaveGoal} variant="light">
            Update goal
          </Button>
          <Button leftSection={<RefreshCw size={14} />} onClick={props.onRefresh} variant="subtle">
            Refresh
          </Button>
        </div>
      </div>

      <div className="run-flow-live-grid">
        <div className="run-flow-block">
          <PanelTitle icon={<Activity size={15} />} title="Live timeline filters" meta={`${timeline.length} shown`} />
          <div className="run-flow-form-grid">
            <Select data={agentOptions} label="Agent" value={props.timelineAgent} onChange={(value) => props.onTimelineAgentChange(value ?? "all")} />
            <Select data={teamOptions} label="Subteam" value={props.timelineTeam} onChange={(value) => props.onTimelineTeamChange(value ?? "all")} />
            <Select
              data={[
                { value: "all", label: "All messages" },
                { value: "events", label: "Events" },
                { value: "public-chat", label: "Public chat" },
                { value: "private-chat", label: "Private AI chat" },
                { value: "team-chat", label: "Team chat" },
                { value: "actions", label: "Actions" },
                { value: "decisions", label: "Decisions" },
                { value: "errors", label: "Errors/fallbacks" },
              ]}
              label="Message type"
              value={props.timelineKind}
              onChange={(value) => props.onTimelineKindChange((value ?? "all") as TimelineKind)}
            />
          </div>
          <div className="run-flow-timeline" aria-live="polite">
            {timeline.length === 0 ? (
              <div className="run-flow-empty">No live items match these filters.</div>
            ) : (
              timeline.slice(0, 10).map((item) => (
                <article className="run-flow-timeline-row" data-kind={item.kind} key={item.id}>
                  <span>{item.kind}</span>
                  <strong>{item.title}</strong>
                  <em>{item.detail}</em>
                </article>
              ))
            )}
          </div>
        </div>
        <PositionMap agents={props.selectedAgents} />
      </div>

      <div className="run-flow-block">
        <PanelTitle icon={<Flag size={15} />} title="Current runtime goal" meta={props.runtime?.capabilities.launch ? "runtime attached" : "runtime unavailable"} />
        <p className="run-flow-goal">{props.scenarioGoal}</p>
      </div>
    </div>
  );
}

function PositionMap({ agents }: { agents: UiAgentRuntime[] }): JSX.Element {
  const positioned = agents.filter((agent) => agent.position);
  if (positioned.length === 0) {
    return (
      <div className="run-flow-block run-flow-map">
        <PanelTitle icon={<MapPinned size={15} />} title="Position adapter" meta="waiting for coordinates" />
        <div className="run-flow-map-placeholder">
          <p>No runtime coordinates are available yet.</p>
          <span>
            Live controls and timeline updates still work. When the runtime sends positions, this panel will switch
            to the map view for selected bots.
          </span>
        </div>
      </div>
    );
  }

  const xs = positioned.map((agent) => agent.position!.x);
  const zs = positioned.map((agent) => agent.position!.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  return (
    <div className="run-flow-block run-flow-map">
      <PanelTitle icon={<MapPinned size={15} />} title="Position view" meta={`${positioned.length} agents`} />
      <div className="run-flow-map-plane" aria-label="2D agent position view">
        {positioned.map((agent) => {
          const left = scalePosition(agent.position!.x, minX, maxX);
          const top = scalePosition(agent.position!.z, minZ, maxZ);
          return (
            <span
              className="run-flow-map-dot"
              key={agent.id}
              style={{ left: `${left}%`, top: `${top}%` }}
              title={`${agent.name} ${agent.position!.x}, ${agent.position!.y}, ${agent.position!.z}`}
            >
              {agent.name.slice(0, 2).toUpperCase()}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LaunchResults({ results }: { results: RuntimeAgentControlResult[] }): JSX.Element {
  return (
    <div className="run-flow-block">
      <PanelTitle icon={<ClipboardCheck size={15} />} title="Launch progress" meta={`${results.length} results`} />
      {results.length === 0 ? (
        <div className="run-flow-empty">No launch requested yet. Per-agent accept/reject results will appear here.</div>
      ) : (
        <div className="run-flow-result-list">
          {results.map((result) => (
            <div className="run-flow-result" data-ok={result.ok} key={result.agentId}>
              <strong>{result.agentId}</strong>
              <span>{result.connectionStatus}</span>
              <em>{result.error ?? (result.ok ? "accepted" : "failed")}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelTitle(props: { icon: JSX.Element; title: string; meta: string }): JSX.Element {
  return (
    <div className="run-flow-block-title">
      <span>
        {props.icon}
        <strong>{props.title}</strong>
      </span>
      <Badge radius="xs" variant="outline">
        {props.meta}
      </Badge>
    </div>
  );
}

function ReadinessBox(props: { label: string; status: string; message?: string }): JSX.Element {
  return (
    <div className="run-flow-readiness" data-status={props.status}>
      <span>{props.label}</span>
      <strong>{props.status}</strong>
      <em>{props.message ?? "No detail reported"}</em>
    </div>
  );
}

function TeamBox({ team }: { team: TeamSummary }): JSX.Element {
  return (
    <div className="run-flow-team">
      <span>{team.id}</span>
      <strong>{team.count}</strong>
      <em>{team.roles.join(", ") || "no roles"}</em>
    </div>
  );
}

function FlowFooter(props: {
  actionLabel?: string;
  complete: boolean;
  completeLabel: string;
  incompleteLabel: string;
  onContinue: () => void;
}): JSX.Element {
  return (
    <div className="run-flow-footer">
      <FlowFooterInline {...props} />
    </div>
  );
}

function FlowFooterInline(props: {
  actionLabel?: string;
  complete: boolean;
  completeLabel: string;
  incompleteLabel: string;
  onContinue: () => void;
}): JSX.Element {
  return (
    <Group gap="xs" justify="flex-end">
      <Badge
        color={props.complete ? "lime" : "yellow"}
        leftSection={props.complete ? <CheckCircle2 size={12} /> : <Circle size={11} />}
        variant="light"
      >
        {props.complete ? props.completeLabel : props.incompleteLabel}
      </Badge>
      <Button disabled={!props.complete} onClick={props.onContinue}>
        {props.actionLabel ?? "Continue"}
      </Button>
    </Group>
  );
}

function StatusPill({ status }: { status: BotConnectionStatus }): JSX.Element {
  return (
    <Badge color={status === "connected" ? "lime" : status === "failed" ? "red" : status === "connecting" ? "yellow" : "gray"} radius="xs" variant="light">
      {status}
    </Badge>
  );
}

interface TeamSummary {
  id: string;
  count: number;
  roles: string[];
}

function teamSummaries(agents: readonly UiAgentRuntime[]): TeamSummary[] {
  const groups = new Map<string, UiAgentRuntime[]>();
  for (const agent of agents) {
    const id = teamId(agent);
    if (!id) continue;
    groups.set(id, [...(groups.get(id) ?? []), agent]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, teamAgents]) => ({
      id,
      count: teamAgents.length,
      roles: [...new Set(teamAgents.map((agent) => agent.role))].sort(),
    }));
}

function teamId(agent: Pick<UiAgentRuntime, "team" | "subteam">): string {
  return agent.subteam ?? agent.team ?? "";
}

function draftFromAgent(agent: UiAgentRuntime): AgentDraft {
  return {
    name: agent.name,
    username: agent.account.username,
    role: agent.role.trim().toLowerCase(),
    subteam: teamId(agent),
    personality: agent.personality ?? "",
    routine: agent.routine ?? routineForRole(agent.role),
    enabled: agent.enabled !== false,
    riskTolerance: agent.behavior?.riskTolerance ?? "medium",
    teamwork: agent.behavior?.teamwork ?? "balanced",
    initiative: agent.behavior?.initiative ?? "medium",
  };
}

type SelectOption = { value: string; label: string };

function selectDataWithCurrent(
  source: Array<SelectOption | string>,
  current: string | undefined,
): SelectOption[] {
  const options = source.map((item) =>
    typeof item === "string"
      ? { value: item, label: formatOptionLabel(item) }
      : item,
  );
  const currentValue = current?.trim();
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    options.push({ value: currentValue, label: formatOptionLabel(currentValue) });
  }
  return options;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function roleDraft(draft: AgentDraft, role: string): AgentDraft {
  const previousRoutine = routineForRole(draft.role);
  const nextRoutine = routineForRole(role);
  return {
    ...draft,
    role,
    routine: !draft.routine || draft.routine === previousRoutine ? nextRoutine : draft.routine,
  };
}

function routineForRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized.includes("farmer")) return "farmer";
  if (normalized.includes("miner")) return "miner";
  if (normalized.includes("guard")) return "guard";
  return "survival";
}

function randomPersonalityTraits(): string {
  const traits = [...PERSONALITY_TRAITS];
  for (let index = traits.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [traits[index], traits[swapIndex]] = [traits[swapIndex], traits[index]];
  }
  return traits.slice(0, 3).map(formatOptionLabel).join(", ");
}

function formatOptionLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function behaviorRisk(value: string | null): AgentDraft["riskTolerance"] {
  return value === "low" || value === "high" ? value : "medium";
}

function behaviorTeamwork(value: string | null): AgentDraft["teamwork"] {
  return value === "solo" || value === "team-first" ? value : "balanced";
}

function behaviorInitiative(value: string | null): AgentDraft["initiative"] {
  return value === "low" || value === "high" ? value : "medium";
}

function modeConnection(mode: UiAgentRuntime["mode"]): BotConnectionStatus {
  if (mode === "failed") return "failed";
  if (mode === "paused") return "disconnected";
  return "connected";
}

function scalePosition(value: number, min: number, max: number): number {
  if (min === max) return 50;
  return Math.max(6, Math.min(94, ((value - min) / (max - min)) * 88 + 6));
}

function buildTimeline(input: {
  agents: UiAgentRuntime[];
  events: GameEvent[];
  chat: AiChatMessage[];
  agentId: string;
  teamId: string;
  kind: TimelineKind;
}): Array<{ id: string; kind: string; title: string; detail: string; timestamp: string; agentId?: string }> {
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const eventItems = input.events.map((event) => ({
    id: event.id,
    kind: event.type,
    title: event.actorId ? agentById.get(event.actorId)?.name ?? event.actorId : event.type,
    detail: event.payload.error
      ? String(event.payload.error)
      : String(event.payload.summary ?? event.payload.content ?? event.payload.message ?? event.type),
    timestamp: event.timestamp,
    agentId: event.actorId,
  }));
  const chatItems = input.chat.map((message) => ({
    id: message.id,
    kind: message.visibility === "public" ? "public-chat" : message.visibility === "human-team" ? "team-chat" : "private-chat",
    title: agentById.get(message.senderId)?.name ?? message.senderId,
    detail: message.content,
    timestamp: message.timestamp,
    agentId: message.senderId,
  }));

  return [...eventItems, ...chatItems]
    .filter((item) => matchesTimelineAgent(item.agentId, input.agentId))
    .filter((item) => matchesTimelineTeam(item.agentId, input.teamId, agentById))
    .filter((item) => matchesTimelineKind(item, input.kind))
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function matchesTimelineAgent(agentId: string | undefined, filterAgentId: string): boolean {
  return filterAgentId === "all" || agentId === filterAgentId;
}

function matchesTimelineTeam(
  agentId: string | undefined,
  filterTeamId: string,
  agentById: Map<string, UiAgentRuntime>,
): boolean {
  if (filterTeamId === "all") return true;
  if (!agentId) return false;
  return teamId(agentById.get(agentId) ?? { team: "", subteam: "" }) === filterTeamId;
}

function matchesTimelineKind(
  item: { kind: string; detail: string },
  kind: TimelineKind,
): boolean {
  if (kind === "all") return true;
  if (kind === "events") return !item.kind.includes("chat");
  if (kind === "actions") return /action|routine|scheduler/.test(item.kind);
  if (kind === "decisions") return /decision|planning/.test(item.kind);
  if (kind === "errors") return /error|fallback|failed|rejected/.test(`${item.kind} ${item.detail}`.toLowerCase());
  return item.kind === kind;
}
