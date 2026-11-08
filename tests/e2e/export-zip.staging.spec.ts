import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

import {
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
} from "./helpers";

/**
 * Quickstart V8 (specs/002, T189) against staging: a Pro advanced export of
 * 300 issued invoices builds the XLSX and the PDF ZIP in the background
 * (real queue, PDF renders and R2 multipart upload), then downloads both.
 */
test.skip(
  !(process.env.E2E_BASE_URL ?? "").includes("staging"),
  "Solo contra staging (colas y R2 reales).",
);

const INVOICES = 300;

test("V8: Pro exporta 300 facturas en XLSX y ZIP de PDF en segundo plano", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);
  await setCompanyPlan(email, "pro");

  const clientResponse = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente Exportación, S.L.",
      tax_id: "A87654321",
      address: "Avenida del Cliente 2, 46001 Valencia",
    },
  });
  expect(clientResponse.status()).toBe(201);
  const client = (await clientResponse.json()) as { id: string };

  async function issueOne(index: number): Promise<void> {
    const created = await page.request.post("/api/v1/documents", {
      data: {
        doc_type: "invoice",
        client_id: client.id,
        lines: [
          {
            description: `Servicio de exportación ${index + 1}`,
            quantity: "1",
            unit_price_cents: 1_000 + index,
            tax_rate: "21.00",
          },
        ],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const issued = await page.request.post(`/api/v1/documents/${id}/issue`);
    expect(issued.status(), await issued.text()).toBe(200);
  }
  for (let start = 0; start < INVOICES; start += 10) {
    await Promise.all(
      Array.from({ length: 10 }, (_, offset) => issueOne(start + offset)),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const requested = await page.request.post("/api/v1/exports", {
    data: {
      kind: "advanced",
      types: ["invoice"],
      from: `${today.slice(0, 4)}-01-01`,
      to: today,
      formats: ["xlsx", "pdf_zip"],
    },
  });
  expect(requested.status(), await requested.text()).toBe(202);
  const { export_id: exportId } = (await requested.json()) as {
    export_id: string;
  };

  const startedAt = Date.now();
  let result: {
    status: string;
    files?: Array<{ filename: string; url: string }>;
  } = { status: "" };
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/exports/${exportId}`);
        result = (await response.json()) as typeof result;
        return result.status;
      },
      { timeout: 1_000_000, intervals: [5_000, 10_000, 15_000] },
    )
    .toBe("ready");
  test.info().annotations.push({
    type: "export",
    description: `${INVOICES} facturas listas en ${Math.round((Date.now() - startedAt) / 1000)} s`,
  });

  const files = result.files ?? [];
  const zip = files.find((file) => file.filename.endsWith(".zip"));
  const xlsx = files.find((file) => file.filename.endsWith(".xlsx"));
  expect(zip, JSON.stringify(files.map((file) => file.filename))).toBeTruthy();
  expect(xlsx).toBeTruthy();
  expect((await page.request.get(xlsx?.url ?? "")).status()).toBe(200);
  const download = await page.request.get(zip?.url ?? "");
  expect(download.status()).toBe(200);
  const body = await download.body();
  const archive = unzipSync(new Uint8Array(body));
  const pdfs = Object.keys(archive).filter((name) =>
    name.toLowerCase().endsWith(".pdf"),
  );
  test.info().annotations.push({
    type: "archive",
    description: `${zip?.filename}: ${pdfs.length} PDF, ${Math.round(body.length / 1024)} KiB`,
  });
  expect(pdfs).toHaveLength(INVOICES);
});
