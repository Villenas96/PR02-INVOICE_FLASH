import {
  type ReminderRunDependencies,
  runReminder,
} from "@/services/reminder-run";
import type { ReminderSendMessage } from "@/workers/messages";

/** `reminder.send`: revalidates payment state and email, then queues. */
export function handleReminderSend(
  message: ReminderSendMessage,
  dependencies: ReminderRunDependencies,
): Promise<void> {
  return runReminder(message.reminderId, dependencies);
}
