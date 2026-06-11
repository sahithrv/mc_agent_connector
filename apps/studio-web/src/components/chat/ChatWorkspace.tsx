import { Alert, Badge } from "@mantine/core";
import { MessagesSquare, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentConfig, AiChatMessage } from "@mc-ai-video/contracts";

import { getChatMessages, sendDirectorChat, type SendDirectorChatInput } from "../../lib/api/chat";
import type { ApiClient, ApiErrorShape } from "../../lib/api/client";
import { normalizeApiError } from "../../lib/api/client";
import { studioStore, useStudioStore } from "../../lib/state/store";
import {
  filterChatMessagesForViewer,
  isPrivateChatVisibility,
  type ChatViewerRole,
} from "../../lib/chat/visibility";
import { AiChatComposer } from "./AiChatComposer";
import { ChatMessageLane } from "./ChatMessageLane";
import {
  buildParticipantOptions,
  sortNewestMessages,
} from "./formatting";
import type { StudioChatMessage } from "./types";
import { ViewerRoleSelector } from "./ViewerRoleSelector";
import "./ChatWorkspace.css";

export interface ChatWorkspaceProps {
  agents?: AgentConfig[];
  messages?: StudioChatMessage[];
  initialViewerRole?: ChatViewerRole;
  autoLoad?: boolean;
  api?: ApiClient;
  onSend?: (input: SendDirectorChatInput) => Promise<AiChatMessage>;
}

export function ChatWorkspace(props: ChatWorkspaceProps): JSX.Element {
  const storeAgents = useStudioStore((state) => state.agents);
  const storeMessages = useStudioStore((state) => state.chat);
  const [viewerRole, setViewerRole] = useState<ChatViewerRole>(
    props.initialViewerRole ?? "recorder",
  );
  const [remoteMessages, setRemoteMessages] = useState<StudioChatMessage[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<ApiErrorShape | undefined>();

  const agents = props.agents ?? storeAgents;
  const shouldReadApi = props.messages === undefined && props.autoLoad !== false;

  useEffect(() => {
    if (!shouldReadApi) {
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError(undefined);

    void getChatMessages(viewerRole, props.api)
      .then((messages) => {
        if (active) {
          setRemoteMessages(messages);
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError(normalizeApiError(error));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [props.api, shouldReadApi, viewerRole]);

  const sourceMessages = props.messages ?? remoteMessages ?? storeMessages;
  const participants = useMemo(
    () => buildParticipantOptions(agents, sourceMessages),
    [agents, sourceMessages],
  );
  const visibleMessages = useMemo(
    () => sortNewestMessages(filterChatMessagesForViewer(sourceMessages, viewerRole)),
    [sourceMessages, viewerRole],
  );
  const privateMessages = visibleMessages.filter((message) =>
    isPrivateChatVisibility(message.visibility),
  );
  const publicMessages = visibleMessages.filter((message) => message.visibility === "public");

  async function handleSend(input: SendDirectorChatInput): Promise<AiChatMessage> {
    const message = props.onSend
      ? await props.onSend(input)
      : await sendDirectorChat(input, props.api);

    if (props.messages === undefined) {
      studioStore.appendChat(message);
      setRemoteMessages((current) => mergeNewestMessage(current, message));
    }

    return message;
  }

  return (
    <section className="chat-workspace" aria-label="Chat workspace">
      <div className="chat-workspace__header">
        <div>
          <div className="chat-eyebrow">F13-F16 / comms deck</div>
          <h2>AI private chat and public mirror</h2>
        </div>
        <Badge color="lime" leftSection={<ShieldCheck size={12} />} variant="light">
          channel separation active
        </Badge>
      </div>

      <div className="chat-workspace__body">
        <aside className="chat-workspace__rail">
          <ViewerRoleSelector
            onChange={setViewerRole}
            privateCount={privateMessages.length}
            publicCount={publicMessages.length}
            value={viewerRole}
          />
          <AiChatComposer disabled={participants.length <= 1} onSend={handleSend} participants={participants} />
        </aside>

        <div className="chat-workspace__lanes">
          {loadError ? (
            <Alert color="red" icon={<MessagesSquare size={16} />} variant="light">
              {loadError.message}. Showing any locally buffered chat that matches this viewer.
            </Alert>
          ) : null}
          <ChatMessageLane
            detail="Filtered private coordination. Role clearance decides which private channel is visible."
            emptyDetail="Switch to recorder or an authorized team role to inspect private coordination."
            emptyTitle="No private messages visible"
            error={undefined}
            loading={loading && remoteMessages === undefined && props.messages === undefined}
            messages={privateMessages}
            participants={participants}
            title="AI private channels"
            tone="private"
          />
          <ChatMessageLane
            detail="Public Minecraft chat mirror. This lane is intentionally separate from private traffic."
            emptyDetail="Public player chat will appear here as it arrives from the backend stream."
            emptyTitle="No public chat yet"
            loading={loading && remoteMessages === undefined && props.messages === undefined}
            messages={publicMessages}
            participants={participants}
            title="Public chat mirror"
            tone="public"
          />
        </div>
      </div>
    </section>
  );
}

function mergeNewestMessage(
  current: StudioChatMessage[] | undefined,
  message: AiChatMessage,
): StudioChatMessage[] | undefined {
  if (!current) {
    return current;
  }
  return sortNewestMessages([message, ...current.filter((item) => item.id !== message.id)]);
}
