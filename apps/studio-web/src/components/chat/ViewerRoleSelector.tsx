import { Badge, NativeSelect } from "@mantine/core";
import { Eye, LockKeyhole, Radio } from "lucide-react";

import {
  CHAT_VIEWER_ROLE_OPTIONS,
  type ChatViewerRole,
} from "../../lib/chat/visibility";

interface ViewerRoleSelectorProps {
  value: ChatViewerRole;
  onChange: (value: ChatViewerRole) => void;
  privateCount: number;
  publicCount: number;
}

export function ViewerRoleSelector(props: ViewerRoleSelectorProps): JSX.Element {
  const selected = CHAT_VIEWER_ROLE_OPTIONS.find((option) => option.value === props.value);

  return (
    <div className="chat-clearance" aria-label="Chat visibility selector">
      <div className="chat-clearance__header">
        <div>
          <div className="chat-eyebrow">Viewer clearance</div>
          <div className="chat-clearance__role">{selected?.label ?? props.value}</div>
        </div>
        <Eye size={18} aria-hidden="true" />
      </div>
      <NativeSelect
        aria-label="Viewer role"
        data={CHAT_VIEWER_ROLE_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        label="Viewer role"
        onChange={(event) => props.onChange(event.currentTarget.value as ChatViewerRole)}
        value={props.value}
      />
      <div className="chat-clearance__detail">{selected?.description}</div>
      <div className="chat-clearance__meters" aria-live="polite">
        <Badge leftSection={<LockKeyhole size={12} />} variant="light">
          {props.privateCount} private
        </Badge>
        <Badge color="cyan" leftSection={<Radio size={12} />} variant="light">
          {props.publicCount} public
        </Badge>
      </div>
    </div>
  );
}
