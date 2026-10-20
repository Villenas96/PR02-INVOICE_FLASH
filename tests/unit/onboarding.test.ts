import { describe, expect, it } from "vitest";

import {
  applyOnboardingUpdate,
  deriveOnboarding,
  type OnboardingFacts,
  type OnboardingState,
  onboardingUpdateSchema,
  parseOnboardingState,
} from "@/lib/onboarding";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const EMPTY: OnboardingState = { completed: [], skipped: [] };
const NOTHING: OnboardingFacts = {
  fiscalDataComplete: false,
  hasLogo: false,
  hasCollectionMethod: false,
};

describe("onboarding derivation", () => {
  it("starts at step 1 of 5 and lists fiscal data as missing to issue", () => {
    const progress = deriveOnboarding(EMPTY, NOTHING);
    expect(progress.currentStep).toBe("fiscal_data");
    expect(progress.label).toBe("Paso 1 de 5");
    expect(progress.resolved).toBe(0);
    expect(progress.missingToIssue).toEqual(["fiscal_data"]);
    expect(progress.showBanner).toBe(true);
  });

  it("derives done steps from what the company already has", () => {
    const progress = deriveOnboarding(EMPTY, {
      fiscalDataComplete: true,
      hasLogo: true,
      hasCollectionMethod: false,
    });
    expect(progress.currentStep).toBe("collection_method");
    expect(progress.label).toBe("Paso 3 de 5");
    expect(progress.resolved).toBe(2);
    expect(progress.missingToIssue).toEqual([]);
  });

  it("never lets fiscal data be marked complete by hand", () => {
    const state = applyOnboardingUpdate(
      EMPTY,
      { complete: "fiscal_data" },
      NOW,
    );
    expect(deriveOnboarding(state, NOTHING).currentStep).toBe("fiscal_data");
  });

  it("moves past a skipped step and keeps it resumable", () => {
    const state = applyOnboardingUpdate(EMPTY, { skip: "logo" }, NOW);
    const progress = deriveOnboarding(state, {
      ...NOTHING,
      fiscalDataComplete: true,
    });
    expect(progress.steps.find((s) => s.step === "logo")?.status).toBe(
      "skipped",
    );
    expect(progress.currentStep).toBe("collection_method");
    expect(progress.label).toBe("Paso 3 de 5");
    expect(progress.showBanner).toBe(true);
  });

  it("is finished when every step is done or skipped", () => {
    const state: OnboardingState = {
      completed: ["series", "sample_invoice"],
      skipped: ["logo", "collection_method"],
    };
    const progress = deriveOnboarding(state, {
      ...NOTHING,
      fiscalDataComplete: true,
    });
    expect(progress.finished).toBe(true);
    expect(progress.currentStep).toBeNull();
    expect(progress.label).toBeNull();
    expect(progress.resolved).toBe(5);
    expect(progress.showBanner).toBe(false);
  });

  it("dismissing hides the banner except while issuing is blocked", () => {
    const dismissed = applyOnboardingUpdate(EMPTY, { dismiss: true }, NOW);
    expect(dismissed.dismissed_at).toBe(NOW.toISOString());
    expect(deriveOnboarding(dismissed, NOTHING).showBanner).toBe(true);
    expect(
      deriveOnboarding(dismissed, { ...NOTHING, fiscalDataComplete: true })
        .showBanner,
    ).toBe(false);
  });
});

describe("onboarding transitions", () => {
  it("completing and skipping the same step are mutually exclusive", () => {
    const skipped = applyOnboardingUpdate(EMPTY, { skip: "series" }, NOW);
    const completed = applyOnboardingUpdate(
      skipped,
      { complete: "series" },
      NOW,
    );
    expect(completed.skipped).toEqual([]);
    expect(completed.completed).toEqual(["series"]);
    expect(
      applyOnboardingUpdate(completed, { skip: "series" }, NOW).completed,
    ).toEqual([]);
  });

  it("is idempotent", () => {
    const once = applyOnboardingUpdate(EMPTY, { complete: "logo" }, NOW);
    expect(applyOnboardingUpdate(once, { complete: "logo" }, NOW)).toEqual(
      once,
    );
  });

  it("requires exactly one action and rejects unknown steps", () => {
    expect(onboardingUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      onboardingUpdateSchema.safeParse({ complete: "logo", skip: "series" })
        .success,
    ).toBe(false);
    expect(onboardingUpdateSchema.safeParse({ complete: "nope" }).success).toBe(
      false,
    );
    expect(onboardingUpdateSchema.safeParse({ dismiss: true }).success).toBe(
      true,
    );
  });

  it("reads unreadable stored state as empty", () => {
    expect(parseOnboardingState({ completed: ["nope"] })).toEqual(EMPTY);
    expect(parseOnboardingState(null)).toEqual(EMPTY);
    expect(parseOnboardingState({})).toEqual(EMPTY);
  });
});
