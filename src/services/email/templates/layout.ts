/**
 * Shared Factum layout for every email the platform sends (FR-001, research
 * R16): documents, account emails, reminders, advisor deliveries and billing
 * or user notices all render through here so the brand is defined once.
 */
export const EMAIL_BRAND = "Factum";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export interface EmailLayoutInput {
  /** Plain-text heading (escaped here). */
  title: string;
  /** Already-escaped HTML paragraphs/blocks for the body. */
  bodyHtml: string;
  action?: { label: string; url: string };
  /** Small print under the action (plain text, escaped here). */
  footnote?: string;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 24px;line-height:1.6;white-space:pre-wrap">${escapeHtml(text)}</p>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const action = input.action
    ? `<p style="margin:0 0 24px">
          <a href="${escapeHtml(input.action.url)}" style="display:inline-block;border-radius:8px;background:#18181b;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">${escapeHtml(input.action.label)}</a>
        </p>`
    : "";
  const footnote = input.footnote
    ? `<p style="margin:0;color:#71717a;font-size:13px;line-height:1.5">${escapeHtml(input.footnote)}</p>`
    : "";

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <main style="max-width:560px;margin:0 auto;padding:32px 16px">
      <section style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:32px">
        <p style="margin:0 0 20px;font-size:14px;font-weight:700">${EMAIL_BRAND}</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${escapeHtml(input.title)}</h1>
        ${input.bodyHtml}
        ${action}
        ${footnote}
      </section>
      <p style="margin:16px 0 0;color:#a1a1aa;font-size:12px;text-align:center">${EMAIL_BRAND} · Facturación para autónomos</p>
    </main>
  </body>
</html>`;
}
