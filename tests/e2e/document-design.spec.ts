import { expect, type Page, test } from "@playwright/test";

import {
  expectAccessible,
  registerVerifyAndSignIn,
  saveFiscalData,
  setCompanyPlan,
} from "./helpers";

/** US6 (specs/002): logos, units, payment block, observations and Excel. */

const SVG_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80"><rect width="200" height="80" fill="#1d4ed8"/><text x="20" y="50" font-size="32" fill="#fff">Flash</text></svg>',
);

async function uploadSvgLogo(page: Page, inputId: string): Promise<void> {
  await page.locator(`#${inputId}`).setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: SVG_LOGO,
  });
  await page
    .locator(`#${inputId}`)
    .locator("xpath=ancestor::div[contains(@class,'space-y-4')][1]")
    .getByRole("button", { name: "Subir logotipo" })
    .click();
  await expect(page.getByText("Logotipo actualizado.")).toBeVisible();
}

async function expectLoadedImages(page: Page, count: number): Promise<void> {
  await expect
    .poll(() =>
      page
        .locator("img")
        .evaluateAll(
          (images) =>
            images.filter(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ).length,
        ),
    )
    .toBe(count);
}

test("los logotipos SVG se convierten en el navegador y el documento público refleja el diseño", async ({
  page,
  browser,
}) => {
  const email = await registerVerifyAndSignIn(page);
  await page.goto("/settings");
  await saveFiscalData(page, email);

  await uploadSvgLogo(page, "company-logo");
  await expect(
    page.getByRole("img", { name: "Logotipo actual" }),
  ).toBeVisible();

  const clientResponse = await page.request.post("/api/v1/clients", {
    data: {
      name: "Cliente con Marca",
      tax_id: "A87654321",
      address: "Avenida del Cliente 2, 46001 Valencia",
    },
  });
  expect(clientResponse.status()).toBe(201);
  const client = (await clientResponse.json()) as { id: string };
  await page.goto(`/clients/${client.id}`);
  await uploadSvgLogo(page, "client-logo");

  const createResponse = await page.request.post("/api/v1/documents", {
    data: {
      doc_type: "invoice",
      client_id: client.id,
      notes: "Gracias por confiar en nosotros.",
      lines: [
        {
          description: "Sesión de diseño",
          quantity: "3",
          unit: "hora",
          unit_price_cents: 5_000,
          tax_rate: "21.00",
        },
      ],
    },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const created = (await createResponse.json()) as { id: string };
  const issueResponse = await page.request.post(
    `/api/v1/documents/${created.id}/issue`,
  );
  expect(issueResponse.status(), await issueResponse.text()).toBe(200);

  // Basic: no spreadsheet download offered.
  await page.goto(`/documents/${created.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Descargar Excel" })).toHaveCount(
    0,
  );

  const shareResponse = await page.request.post(
    `/api/v1/documents/${created.id}/share-link`,
  );
  expect(shareResponse.ok(), await shareResponse.text()).toBe(true);
  const share = (await shareResponse.json()) as { url: string };

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(share.url);
  await expect(anonymousPage.getByText("3 hora")).toBeVisible();
  await expect(
    anonymousPage.getByRole("heading", { name: "Pago" }),
  ).toBeVisible();
  await expect(
    anonymousPage.getByRole("heading", { name: "Observaciones" }),
  ).toBeVisible();
  await expectLoadedImages(anonymousPage, 2);
  await expectAccessible(anonymousPage);
  await anonymousContext.close();

  // Pro: the issued document downloads as a spreadsheet.
  await setCompanyPlan(email, "pro");
  await page.goto(`/documents/${created.id}`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar Excel" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
});
