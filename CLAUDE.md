# Invoice Flash — Agent Context

Facturación web para autónomos y pequeños negocios (mercado español). Promesa: "Factura rápido, organiza tus clientes y controla tus cobros sin montar un ERP".

## Active feature

- `002-factum-improvements` — mejoras v2 (35 mejoras de `notas.md`, 15 historias P1–P5, entrega en 5 incrementos). Spec, plan y diseño en `specs/002-factum-improvements/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md). Amplía y en parte modifica la v1.
- `001-invoice-flash` — v1 en producción; `specs/001-invoice-flash/` sigue vigente en lo que la 002 no cambie.

## Stack (decidido en specs/001-invoice-flash/research.md — no cambiar sin actualizar el plan)

- **TypeScript 5 `strict`** · **Next.js 16 App Router** (`src/middleware.ts` en edge: no renombrar a `proxy.ts`, ver specs/002-factum-improvements/research.md R22) · React 19 · **pnpm** (único gestor de paquetes permitido).
- Hosting: **Cloudflare Workers** vía `@opennextjs/cloudflare` (+ R2, Queues). Fallback documentado: Vercel.
- BD: **Neon Postgres** + **Drizzle ORM** (migraciones drizzle-kit versionadas y reversibles).
- Auth: **Better Auth** (adaptador Drizzle). PDF: **pdf-lib** + caché en R2 (job de cola). Email: **Resend** vía Cloudflare Queues.
- UI: **Tailwind CSS 4 + shadcn/ui** (sistema de diseño único; WCAG 2.1 AA).
- Calidad: **Biome** (lint+formato), `tsc --noEmit`, **Vitest** (unit + integración con Postgres real), **Playwright** (+axe), GitHub Actions.
- Añadidos en 002 (specs/002-factum-improvements/research.md): **Stripe** Billing (Checkout + Customer Portal + webhooks reconciliados releyendo la suscripción), cola **`invoice-flash-jobs`** + cron diario `0 5 * * *` que solo planifica, **SheetJS CE** (Excel) + **fflate** (ZIP), **papaparse**, `unaccent` + `pg_trgm`, servidor **MCP** (`@modelcontextprotocol/sdk`, OAuth 2.1 de Better Auth).

## Reglas clave (constitución `.specify/memory/constitution.md` v1.0.0 — prevalece siempre)

- Importes monetarios: **enteros en céntimos**; nunca coma flotante. Lógica de negocio pura en `src/lib/*` con pruebas unitarias obligatorias.
- Numeración de documentos: correlativa sin huecos; asignada **solo al emitir**, en transacción con `SELECT ... FOR UPDATE` sobre `document_series`.
- Documentos emitidos: **inmutables** (snapshot de emisor y cliente); nunca se borran, solo se anulan. Auditoría en `document_events` (solo INSERT).
- Estados de cobro (pendiente/parcial/pagada/vencida): **derivados en consulta**, nunca almacenados.
- Toda consulta filtrada por `company_id` de la sesión (recurso ajeno → 404). Validación Zod en servidor. Sin secretos en el repo.
- Colecciones siempre paginadas (default 25, máx 100). Trabajo pesado (PDF, email, exportaciones, importaciones, recurrencias, recordatorios) vía Cloudflare Queues.
- Planes (002): `basic`/`essential`/`pro` con cupo **por tipo de documento**, definidos solo en `src/lib/plan.ts`; funciones comprobadas en servidor (`requireFeature`); bajar de plan nunca muta ni borra datos. Gestoría = rol `advisor` de solo lectura (`write` → 403).
- UI y docs de producto en **español**; código, identificadores y commits en **inglés**.

## Workflow

Spec-Kit: specify → plan → tasks → implement. No implementar sin spec/plan aprobados. CI en verde obligatorio para fusionar.
