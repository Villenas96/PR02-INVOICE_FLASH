/**
 * Deterministic demo dataset for manual QA and screenshots.
 *
 * Creates two companies that sit at their plan's monthly document-issuance
 * boundary — a free-plan company at 5/5 and a pro-plan company at 100/100 —
 * each with clients, catalog items, invoices/proformas/receipts across every
 * lifecycle and payment state, and a couple of documents with simulated
 * PDF/email queue outcomes (since no real Cloudflare Queue consumer runs
 * against this script).
 *
 * Idempotent: re-running it is a no-op once the demo users already exist, so
 * it is always safe to invoke again (e.g. after a fresh migration).
 *
 * Usage: `pnpm db:seed` (with DATABASE_URL — and NEON_HTTP_ENDPOINT if
 * targeting a local Postgres via the neon-http proxy shim — already
 * exported into the environment).
 */
import { eq } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { users } from "@/db/schema/auth";
import { catalogItems } from "@/db/schema/catalog-item";
import { clients } from "@/db/schema/client";
import { companies } from "@/db/schema/company";
import { documents } from "@/db/schema/document";
import { documentEvents } from "@/db/schema/document-event";
import { documentSeries } from "@/db/schema/document-series";
import { payments } from "@/db/schema/payment";
import { auth, setAuthEmailDeliveryHandler } from "@/lib/auth";
import { createUuidV7 } from "@/lib/ids";
import { convertProformaAndIssue } from "@/services/document-conversion";
import type { IssueDocumentDependencies } from "@/services/document-issuance";
import { issueDocument } from "@/services/document-issuance";
import { createReceiptFromPayment } from "@/services/document-receipts";
import { createDraftDocument } from "@/services/documents";
import {
  claimDocumentDelivery,
  createOrReuseDocumentEmailDelivery,
  markDocumentDeliverySent,
} from "@/services/email/deliveries";
import { createPayment } from "@/services/payments";
import { ensureDefaultSeries } from "@/services/series";

const DEMO_PASSWORD = "invoice-flash-demo-2026";
const FREE_PLAN_LIMIT = 5;
const PRO_PLAN_LIMIT = 100;

const noopQueue: IssueDocumentDependencies["queue"] = {
  send: () => Promise.resolve(),
};

interface DemoCompany {
  userId: string;
  companyId: string;
  clientIds: string[];
  catalogItemIds: string[];
}

async function findExistingUserId(
  database: Database,
  email: string,
): Promise<string | null> {
  const [existing] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return existing?.id ?? null;
}

async function signUpDemoUser(
  database: Database,
  input: { name: string; email: string },
): Promise<string> {
  await auth.api.signUpEmail({
    body: { name: input.name, email: input.email, password: DEMO_PASSWORD },
  });
  const userId = await findExistingUserId(database, input.email);
  if (!userId) {
    throw new Error(`No se ha podido crear el usuario demo ${input.email}.`);
  }
  await database
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, userId));
  return userId;
}

interface ClientSeed {
  name: string;
  taxId: string;
  address: string;
  email: string;
  archived?: boolean;
}

const CLIENT_SEEDS: ClientSeed[] = [
  {
    name: "Panadería La Espiga, S.L.",
    taxId: "B10000001",
    address: "Calle del Horno 4, 28012 Madrid",
    email: "administracion@laespiga.example",
  },
  {
    name: "Taller Mecánico Ruedas, S.L.",
    taxId: "B10000002",
    address: "Polígono Industrial Sur 12, 41007 Sevilla",
    email: "facturas@ruedas.example",
  },
  {
    name: "Clínica Dental Sonrisa, S.L.P.",
    taxId: "B10000003",
    address: "Avenida de la Salud 8, 46021 Valencia",
    email: "gestion@sonrisa.example",
  },
  {
    name: "Estudio de Arquitectura Norte, S.L.",
    taxId: "B10000004",
    address: "Gran Vía 100, 48001 Bilbao",
    email: "proyectos@estudionorte.example",
  },
  {
    name: "Librería El Capítulo, S.L.",
    taxId: "B10000005",
    address: "Calle Mayor 22, 37001 Salamanca",
    email: "pedidos@elcapitulo.example",
    archived: true,
  },
];

const CATALOG_SEEDS: Array<{
  description: string;
  unitPriceCents: number;
  taxRate: string;
}> = [
  {
    description: "Hora de consultoría",
    unitPriceCents: 6_000,
    taxRate: "21.00",
  },
  {
    description: "Diseño de identidad visual",
    unitPriceCents: 45_000,
    taxRate: "21.00",
  },
  {
    description: "Mantenimiento mensual",
    unitPriceCents: 12_000,
    taxRate: "21.00",
  },
  {
    description: "Formación presencial (jornada)",
    unitPriceCents: 30_000,
    taxRate: "10.00",
  },
  {
    description: "Publicación digital",
    unitPriceCents: 1_500,
    taxRate: "4.00",
  },
  { description: "Material fungible", unitPriceCents: 800, taxRate: "21.00" },
];

async function seedCompanyBase(
  database: Database,
  now: Date,
  input: {
    userName: string;
    email: string;
    legalName: string;
    taxId: string;
    address: string;
    plan: "free" | "pro";
  },
): Promise<DemoCompany> {
  const userId = await signUpDemoUser(database, {
    name: input.userName,
    email: input.email,
  });

  const companyId = crypto.randomUUID();
  await database.insert(companies).values({
    id: companyId,
    userId,
    legalName: input.legalName,
    taxId: input.taxId,
    address: input.address,
    email: input.email,
    phone: "+34 910 000 000",
    plan: input.plan,
    retentionRate: "0.00",
    createdAt: now,
    updatedAt: now,
  });

  await ensureDefaultSeries(database, companyId, "invoice", now);
  await ensureDefaultSeries(database, companyId, "proforma", now);

  const clientIds = await Promise.all(
    CLIENT_SEEDS.map(async (seed) => {
      const clientId = crypto.randomUUID();
      await database.insert(clients).values({
        id: clientId,
        companyId,
        name: seed.name,
        taxId: seed.taxId,
        address: seed.address,
        email: seed.email,
        archivedAt: seed.archived ? now : null,
        createdAt: now,
        updatedAt: now,
      });
      return clientId;
    }),
  );

  const catalogItemIds = await Promise.all(
    CATALOG_SEEDS.map(async (seed) => {
      const catalogItemId = crypto.randomUUID();
      await database.insert(catalogItems).values({
        id: catalogItemId,
        companyId,
        description: seed.description,
        unitPriceCents: seed.unitPriceCents,
        taxRate: seed.taxRate,
      });
      return catalogItemId;
    }),
  );

  return { userId, companyId, clientIds, catalogItemIds };
}

interface ShowcaseResult {
  slotsUsed: number;
  paidInvoiceId: string;
}

/**
 * Issues a small, realistic spread of documents covering every lifecycle and
 * payment state: a paid invoice, an overdue invoice, a proforma converted
 * and issued as its own invoice, and a receipt for the paid invoice's
 * payment. Consumes 5 monthly slots (2 direct invoices + 2 for the
 * conversion + 1 for the receipt).
 */
async function issueShowcaseDocuments(
  database: Database,
  now: Date,
  company: DemoCompany,
): Promise<ShowcaseResult> {
  const dependencies: IssueDocumentDependencies = {
    database,
    queue: noopQueue,
    now,
  };
  const [clientA, clientB, clientC] = company.clientIds;
  if (!clientA || !clientB || !clientC) {
    throw new Error("Faltan clientes demo para el escaparate de documentos.");
  }

  const paidDraft = await createDraftDocument(
    {
      companyId: company.companyId,
      actor: company.userId,
      documentType: "invoice",
      clientId: clientA,
      issueDate: now.toISOString().slice(0, 10),
      dueDate: null,
      notes: "Gracias por confiar en nosotros.",
      lines: [
        {
          description: "Diseño de identidad visual",
          quantity: "1",
          unitPriceCents: 45_000,
          taxRate: "21.00",
        },
      ],
    },
    { database, now },
  );
  const paidInvoice = await issueDocument(
    {
      companyId: company.companyId,
      documentId: paidDraft.id,
      actor: company.userId,
    },
    dependencies,
  );
  await createPayment(
    {
      companyId: company.companyId,
      documentId: paidInvoice.id,
      actor: company.userId,
      amountCents: paidInvoice.totalCents,
      paidOn: now.toISOString().slice(0, 10),
      method: "transfer",
      confirmedOverpayment: false,
    },
    { database, now },
  );

  const overdueDueDate = new Date(now);
  overdueDueDate.setUTCDate(overdueDueDate.getUTCDate() - 20);
  const overdueDraft = await createDraftDocument(
    {
      companyId: company.companyId,
      actor: company.userId,
      documentType: "invoice",
      clientId: clientB,
      issueDate: overdueDueDate.toISOString().slice(0, 10),
      dueDate: overdueDueDate.toISOString().slice(0, 10),
      notes: null,
      lines: [
        {
          description: "Mantenimiento mensual",
          quantity: "3",
          unitPriceCents: 12_000,
          taxRate: "21.00",
        },
      ],
    },
    { database, now },
  );
  await issueDocument(
    {
      companyId: company.companyId,
      documentId: overdueDraft.id,
      actor: company.userId,
    },
    dependencies,
  );

  const proformaDraft = await createDraftDocument(
    {
      companyId: company.companyId,
      actor: company.userId,
      documentType: "proforma",
      clientId: clientC,
      issueDate: now.toISOString().slice(0, 10),
      dueDate: null,
      notes: "Presupuesto pendiente de aceptación.",
      lines: [
        {
          description: "Formación presencial (jornada)",
          quantity: "2",
          unitPriceCents: 30_000,
          taxRate: "10.00",
        },
      ],
    },
    { database, now },
  );
  const issuedProforma = await issueDocument(
    {
      companyId: company.companyId,
      documentId: proformaDraft.id,
      actor: company.userId,
    },
    dependencies,
  );
  await convertProformaAndIssue(
    {
      companyId: company.companyId,
      documentId: issuedProforma.id,
      actor: company.userId,
      now,
    },
    dependencies,
  );

  const [paymentRow] = await database
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.documentId, paidInvoice.id))
    .limit(1);
  if (!paymentRow) {
    throw new Error("No se ha encontrado el pago para generar el recibo demo.");
  }
  await createReceiptFromPayment(
    {
      companyId: company.companyId,
      invoiceId: paidInvoice.id,
      paymentId: paymentRow.id,
      actor: company.userId,
      now,
    },
    dependencies,
  );

  // Simulate the PDF and (for plans that allow it) email queues without a
  // running Cloudflare Queue consumer: mark the paid invoice's PDF ready and
  // deliver it by email, and mark the overdue invoice's PDF as failed, each
  // with the matching audit event a real worker would record.
  await markPdfReady(database, now, company.companyId, paidInvoice.id);
  await markPdfFailed(database, now, company.companyId, overdueDraft.id);

  return { slotsUsed: 5, paidInvoiceId: paidInvoice.id };
}

async function markPdfReady(
  database: Database,
  now: Date,
  companyId: string,
  documentId: string,
): Promise<void> {
  await database
    .update(documents)
    .set({ pdfStatus: "ready", pdfReadyAt: now, updatedAt: now })
    .where(eq(documents.id, documentId));
  await database.insert(documentEvents).values({
    id: createUuidV7(now.getTime()),
    companyId,
    documentId,
    actor: "system",
    event: "pdf_generated",
    createdAt: now,
  });
}

async function markPdfFailed(
  database: Database,
  now: Date,
  companyId: string,
  documentId: string,
): Promise<void> {
  await database
    .update(documents)
    .set({ pdfStatus: "failed", updatedAt: now })
    .where(eq(documents.id, documentId));
  await database.insert(documentEvents).values({
    id: createUuidV7(now.getTime()),
    companyId,
    documentId,
    actor: "system",
    event: "pdf_failed",
    createdAt: now,
  });
}

async function sendShowcaseEmail(
  database: Database,
  now: Date,
  company: DemoCompany,
  documentId: string,
  recipientEmail: string,
): Promise<void> {
  const delivery = await createOrReuseDocumentEmailDelivery({
    database,
    companyId: company.companyId,
    documentId,
    requestedBy: company.userId,
    recipientEmail,
    customMessage: null,
    idempotencyKey: createUuidV7(now.getTime()),
    now,
  });
  const claimed = await claimDocumentDelivery(database, delivery.id, now);
  if (claimed) {
    await markDocumentDeliverySent(database, delivery.id, "demo-seed", now);
  }
}

/**
 * Bulk-inserts uniform filler invoices directly (bypassing the atomic
 * issuance guard, like other integration fixtures in this repo do) purely
 * to reach the plan's monthly slot count; every interesting behaviour is
 * exercised through the real services in `issueShowcaseDocuments` instead.
 */
async function fillRemainingSlots(
  database: Database,
  now: Date,
  company: DemoCompany,
  count: number,
): Promise<void> {
  if (count <= 0) {
    return;
  }

  const [series] = await database
    .select({ id: documentSeries.id, nextNumber: documentSeries.nextNumber })
    .from(documentSeries)
    .where(eq(documentSeries.companyId, company.companyId));
  if (!series) {
    throw new Error("Falta la serie de facturas para el relleno demo.");
  }

  const startNumber = series.nextNumber;
  const year = now.getUTCFullYear();
  const clientId = company.clientIds[0];
  if (!clientId) {
    throw new Error("Falta un cliente demo para el relleno.");
  }

  const fillerDocuments = Array.from({ length: count }, (_, index) => {
    const number = startNumber + index;
    const documentId = crypto.randomUUID();
    return {
      id: documentId,
      companyId: company.companyId,
      documentType: "invoice" as const,
      status: "issued" as const,
      seriesId: series.id,
      number,
      fullNumber: `${year}-${number.toString().padStart(4, "0")}`,
      clientId,
      issueDate: now.toISOString().slice(0, 10),
      subtotalCents: 10_000,
      taxBreakdown: [{ rate: "21.00", baseCents: 10_000, taxCents: 2_100 }],
      retentionRate: "0.00",
      retentionCents: 0,
      totalCents: 12_100,
      issuerSnapshot: { legalName: "Demo" },
      clientSnapshot: { name: "Demo" },
      pdfStatus: "ready" as const,
      pdfReadyAt: now,
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  });
  await database.insert(documents).values(fillerDocuments);

  const lastFiller = fillerDocuments.at(-1);
  if (!lastFiller) {
    return;
  }
  await database
    .update(documentSeries)
    .set({ nextNumber: lastFiller.number + 1 })
    .where(eq(documentSeries.id, series.id));

  await database.insert(documentEvents).values(
    fillerDocuments.map((document) => ({
      id: createUuidV7(now.getTime()),
      companyId: company.companyId,
      documentId: document.id,
      actor: "system",
      event: "issued" as const,
      createdAt: now,
    })),
  );

  // One filler invoice is voided to demonstrate that terminal state too.
  const voided = fillerDocuments[fillerDocuments.length - 1];
  if (voided) {
    await database
      .update(documents)
      .set({ status: "voided", voidedAt: now, updatedAt: now })
      .where(eq(documents.id, voided.id));
    await database.insert(documentEvents).values({
      id: createUuidV7(now.getTime()),
      companyId: company.companyId,
      documentId: voided.id,
      actor: company.userId,
      event: "voided",
      createdAt: now,
    });
  }
}

export interface SeedOptions {
  database?: Database;
  now?: Date;
}

export async function seedDemoData(options: SeedOptions = {}): Promise<void> {
  const database = options.database ?? createDatabase();
  const now = options.now ?? new Date();
  setAuthEmailDeliveryHandler(() => Promise.resolve());

  const alreadySeeded = await findExistingUserId(
    database,
    "demo-free@invoiceflash.test",
  );
  if (alreadySeeded) {
    console.info("Los datos de demostración ya existen; no se hace nada.");
    return;
  }

  const freeCompany = await seedCompanyBase(database, now, {
    userName: "Demo Plan Gratuito",
    email: "demo-free@invoiceflash.test",
    legalName: "Estudio Demo Free, S.L.",
    taxId: "B90000001",
    address: "Calle de la Demostración 1, 28001 Madrid",
    plan: "free",
  });
  const freeShowcase = await issueShowcaseDocuments(database, now, freeCompany);
  console.info(
    `Empresa free lista con ${freeShowcase.slotsUsed}/${FREE_PLAN_LIMIT} documentos emitidos este mes.`,
  );

  const proCompany = await seedCompanyBase(database, now, {
    userName: "Demo Plan Pro",
    email: "demo-pro@invoiceflash.test",
    legalName: "Estudio Demo Pro, S.L.",
    taxId: "B90000002",
    address: "Paseo de la Demostración 2, 08001 Barcelona",
    plan: "pro",
  });
  const proShowcase = await issueShowcaseDocuments(database, now, proCompany);
  await sendShowcaseEmail(
    database,
    now,
    proCompany,
    proShowcase.paidInvoiceId,
    "cliente-demo@example.test",
  );
  await fillRemainingSlots(
    database,
    now,
    proCompany,
    PRO_PLAN_LIMIT - proShowcase.slotsUsed,
  );
  console.info(
    `Empresa pro lista con ${PRO_PLAN_LIMIT}/${PRO_PLAN_LIMIT} documentos emitidos este mes.`,
  );

  console.info("Datos de demostración creados correctamente.");
  console.info(`  Free: demo-free@invoiceflash.test / ${DEMO_PASSWORD}`);
  console.info(`  Pro:  demo-pro@invoiceflash.test / ${DEMO_PASSWORD}`);
}

const isMainModule =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  seedDemoData()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
