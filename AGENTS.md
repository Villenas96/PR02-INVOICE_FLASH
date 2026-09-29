# Invoice Flash — Agent Context

Facturación web para autónomos y pequeños negocios (mercado español). Promesa: "Factura rápido, organiza tus clientes y controla tus cobros sin montar un ERP".

## Active feature

- `001-invoice-flash` — spec, plan y diseño en `specs/001-invoice-flash/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md).

## Stack (decidido en specs/001-invoice-flash/research.md — no cambiar sin actualizar el plan)

- **TypeScript 5 `strict`** · **Next.js 15 App Router** · React 19 · **pnpm** (único gestor de paquetes permitido).
- Hosting: **Cloudflare Workers** vía `@opennextjs/cloudflare` (+ R2, Queues). Fallback documentado: Vercel.
- BD: **Neon Postgres** + **Drizzle ORM** (migraciones drizzle-kit versionadas y reversibles).
- Auth: **Better Auth** (adaptador Drizzle). PDF: **pdf-lib** exclusivamente en cola + caché R2 (`202 pdf_processing` mientras no esté listo; nunca render HTTP). Email: **Resend** vía Cloudflare Queues con `email_delivery` y clave idempotente.
- UI: **Tailwind CSS 4 + shadcn/ui** (sistema de diseño único; WCAG 2.1 AA).
- Calidad: **Biome** (lint+formato), `tsc --noEmit`, **Vitest** (unit + integración con Postgres real), **Playwright** (+axe, responsive, feedback <100 ms), benchmarks p95 y GitHub Actions.

## Reglas clave (constitución `.specify/memory/constitution.md` v1.0.0 — prevalece siempre)

- Importes monetarios: **enteros en céntimos**; nunca coma flotante. Lógica de negocio pura en `src/lib/*` con pruebas unitarias obligatorias.
- Numeración de documentos: correlativa sin huecos; asignada **solo al emitir**, en transacción con `SELECT ... FOR UPDATE` sobre `document_series`.
- Documentos emitidos: **inmutables** (snapshot de emisor y cliente); nunca se borran, solo se anulan. Auditoría en `document_events` (solo INSERT).
- Estados de cobro (pendiente/parcial/pagada/vencida): **derivados en consulta**, nunca almacenados.
- Toda consulta filtrada por `company_id` de la sesión (recurso ajeno → 404). Validación Zod en servidor. Sin secretos en el repo.
- Colecciones siempre paginadas (default 25, máx 100). Trabajo pesado (PDF, email) exclusivamente vía Cloudflare Queues; consumidores idempotentes ante entrega al menos una vez.
- Neon y R2 cifrados en reposo y TLS en tránsito, con verificación pre-deploy. Alerta real de gasto Cloudflare desde el primer despliegue; Neon Free monitorizado y Spending Limit obligatorio antes de cualquier upgrade.
- UI y docs de producto en **español**; código, identificadores y commits en **inglés**.

## Workflow

Spec-Kit: specify → plan → tasks → implement. No implementar sin spec/plan aprobados. CI en verde obligatorio para fusionar.
