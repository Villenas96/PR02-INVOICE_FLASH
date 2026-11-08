import {
  type RunCycleDependencies,
  runRecurringCycle,
} from "@/services/recurring/run-cycle";
import type { RecurringRunMessage } from "@/workers/messages";

/** `recurring.run`: one document per cycle, redeliveries are no-ops. */
export function handleRecurringRun(
  message: RecurringRunMessage,
  dependencies: RunCycleDependencies,
): Promise<void> {
  return runRecurringCycle(message.cycleId, dependencies);
}
