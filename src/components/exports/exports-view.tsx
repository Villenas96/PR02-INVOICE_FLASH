"use client";

import { useState } from "react";

import { AdvancedExport } from "./advanced-export";
import { AdvisorEmailForm, AdvisorScheduleForm } from "./advisor-delivery";
import { ExportHistory } from "./export-history";
import { PeriodExport } from "./period-export";

/** Export page: period export for everyone with it, more for Pro. */
export function ExportsView({
  isOwner,
  advancedEnabled,
  scheduleEnabled,
  initialAdvisorEmail,
}: {
  isOwner: boolean;
  advancedEnabled: boolean;
  scheduleEnabled: boolean;
  initialAdvisorEmail: string | null;
}) {
  const [advisorEmail, setAdvisorEmail] = useState(initialAdvisorEmail);
  return (
    <div className="space-y-6">
      <PeriodExport advisorEmail={advisorEmail} canSend={isOwner} />
      {advancedEnabled ? <AdvancedExport /> : null}
      {isOwner ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <AdvisorEmailForm
            initialEmail={initialAdvisorEmail}
            onSaved={setAdvisorEmail}
          />
          {scheduleEnabled ? (
            <AdvisorScheduleForm hasAdvisorEmail={Boolean(advisorEmail)} />
          ) : null}
        </div>
      ) : null}
      <ExportHistory />
    </div>
  );
}
