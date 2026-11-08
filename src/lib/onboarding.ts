import { z } from "zod";

/** Setup wizard steps, in the order they are offered (FR-048). */
export const ONBOARDING_STEPS = [
  "fiscal_data",
  "logo",
  "collection_method",
  "series",
  "sample_invoice",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  fiscal_data: "Datos fiscales",
  logo: "Logo",
  collection_method: "Forma de cobro",
  series: "Serie de facturas",
  sample_invoice: "Factura de ejemplo",
};

const stepSchema = z.enum(ONBOARDING_STEPS);

export interface OnboardingState {
  completed: OnboardingStep[];
  skipped: OnboardingStep[];
  dismissed_at?: string;
}

export const onboardingUpdateSchema = z
  .object({
    complete: stepSchema.optional(),
    skip: stepSchema.optional(),
    dismiss: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.complete, value.skip, value.dismiss].filter(
        (field) => field !== undefined,
      ).length === 1,
    { message: "Indica exactamente una acción: complete, skip o dismiss." },
  );

export type OnboardingUpdate = z.infer<typeof onboardingUpdateSchema>;

const storedStateSchema = z.object({
  completed: z.array(stepSchema).default([]),
  skipped: z.array(stepSchema).default([]),
  dismissed_at: z.string().datetime().optional(),
});

/** Tolerant read of `company.onboarding`: anything unreadable is «nothing done». */
export function parseOnboardingState(raw: unknown): OnboardingState {
  const parsed = storedStateSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { completed: [], skipped: [] };
}

function without(steps: OnboardingStep[], step: OnboardingStep) {
  return steps.filter((candidate) => candidate !== step);
}

/** Pure transition; completing and skipping a step are mutually exclusive. */
export function applyOnboardingUpdate(
  state: OnboardingState,
  update: OnboardingUpdate,
  now: Date,
): OnboardingState {
  if (update.dismiss) {
    return { ...state, dismissed_at: now.toISOString() };
  }
  if (update.complete) {
    const step = update.complete;
    return {
      ...state,
      completed: state.completed.includes(step)
        ? state.completed
        : [...state.completed, step],
      skipped: without(state.skipped, step),
    };
  }
  if (update.skip) {
    const step = update.skip;
    return {
      ...state,
      completed: without(state.completed, step),
      skipped: state.skipped.includes(step)
        ? state.skipped
        : [...state.skipped, step],
    };
  }
  return state;
}

/** What the company already has, independent of what the wizard recorded. */
export interface OnboardingFacts {
  fiscalDataComplete: boolean;
  hasLogo: boolean;
  hasCollectionMethod: boolean;
}

export type OnboardingStepStatus = "done" | "skipped" | "pending";

export interface OnboardingProgress {
  steps: Array<{
    step: OnboardingStep;
    label: string;
    status: OnboardingStepStatus;
  }>;
  /** First step still pending, or null when every step is done or skipped. */
  currentStep: OnboardingStep | null;
  total: number;
  /** Steps done or skipped. */
  resolved: number;
  /** «Paso X de N» for the current step; null when nothing is pending. */
  label: string | null;
  dismissed: boolean;
  finished: boolean;
  /** Steps without which the first invoice cannot be issued. */
  missingToIssue: OnboardingStep[];
  /** The resumable banner shows while there is something left to do. */
  showBanner: boolean;
}

function isDone(
  step: OnboardingStep,
  state: OnboardingState,
  facts: OnboardingFacts,
): boolean {
  switch (step) {
    // Never claimed by hand: the data is either there or it is not.
    case "fiscal_data":
      return facts.fiscalDataComplete;
    case "logo":
      return facts.hasLogo || state.completed.includes(step);
    case "collection_method":
      return facts.hasCollectionMethod || state.completed.includes(step);
    default:
      return state.completed.includes(step);
  }
}

export function deriveOnboarding(
  state: OnboardingState,
  facts: OnboardingFacts,
): OnboardingProgress {
  const steps = ONBOARDING_STEPS.map((step) => {
    const status: OnboardingStepStatus = isDone(step, state, facts)
      ? "done"
      : state.skipped.includes(step)
        ? "skipped"
        : "pending";
    return { step, label: ONBOARDING_STEP_LABELS[step], status };
  });
  const currentIndex = steps.findIndex((entry) => entry.status === "pending");
  const resolved = steps.filter((entry) => entry.status !== "pending").length;
  const missingToIssue: OnboardingStep[] = facts.fiscalDataComplete
    ? []
    : ["fiscal_data"];
  const finished = currentIndex === -1;
  const dismissed = state.dismissed_at !== undefined;
  return {
    steps,
    currentStep: finished ? null : (steps[currentIndex]?.step ?? null),
    total: steps.length,
    resolved,
    label: finished ? null : `Paso ${currentIndex + 1} de ${steps.length}`,
    dismissed,
    finished,
    missingToIssue,
    // Dismissing hides the banner, but never while issuing is blocked.
    showBanner: !finished && (!dismissed || missingToIssue.length > 0),
  };
}
