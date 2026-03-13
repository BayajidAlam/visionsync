import { NotificationModel, NotificationKind } from "../model/notification.js";

export async function saveNotification(
  videoId: string,
  kind: NotificationKind,
  title: string,
  detail: string,
  status?: string,
  progress?: number,
): Promise<void> {
  try {
    await NotificationModel.create({
      videoId,
      kind,
      title,
      detail,
      status,
      progress,
    });
  } catch (err) {
    console.error("Failed to save notification:", err);
  }
}
