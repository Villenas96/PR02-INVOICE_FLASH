import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ProRoute } from "@/components/plan/pro-route";
import { RecurringDetail } from "@/components/recurring/recurring-detail";
import { createDatabase } from "@/db";
import { clients } from "@/db/schema/client";
import { recurringTemplates } from "@/db/schema/recurring-template";
import { auth } from "@/lib/auth";
import { getLayoutData } from "@/services/layout-data";

export default async function RecurringDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session] = await Promise.all([
    params,
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (!session) {
    redirect("/login");
  }
  const summary = await getLayoutData(session.user.id, session.session.id);
  if (!summary || !/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }
  const [row] = await createDatabase()
    .select({ name: clients.name })
    .from(recurringTemplates)
    .leftJoin(clients, eq(clients.id, recurringTemplates.clientId))
    .where(
      and(
        eq(recurringTemplates.id, id),
        eq(recurringTemplates.companyId, summary.company.id),
      ),
    );
  if (!row) {
    notFound();
  }
  return (
    <ProRoute feature="recurring">
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">Recurrencia</h1>
        <RecurringDetail templateId={id} clientName={row.name} />
      </div>
    </ProRoute>
  );
}
