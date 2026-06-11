import "@mantine/notifications/styles.css";

import { Notifications, notifications } from "@mantine/notifications";
import { CheckCircle2, TriangleAlert } from "lucide-react";

export interface StudioToastInput {
  title: string;
  message?: string;
}

export function StudioNotifications(): JSX.Element {
  return <Notifications limit={4} position="top-right" zIndex={4000} />;
}

export function showStudioSuccessToast(input: StudioToastInput): string {
  return notifications.show({
    autoClose: 2_800,
    color: "lime",
    icon: <CheckCircle2 size={16} aria-hidden="true" />,
    message: input.message,
    title: input.title,
    withBorder: true,
  });
}

export function showStudioErrorToast(input: StudioToastInput): string {
  return notifications.show({
    autoClose: 5_000,
    color: "red",
    icon: <TriangleAlert size={16} aria-hidden="true" />,
    message: input.message,
    title: input.title,
    withBorder: true,
  });
}
