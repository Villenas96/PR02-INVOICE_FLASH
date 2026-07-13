# Tasks: Invoice Flash — Facturación sencilla para autónomos y pequeños negocios

**Input**: Design documents from `/specs/001-invoice-flash/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: INCLUIDOS — la constitución (Principio I, no negociable) exige pruebas unitarias para toda lógica de negocio y pruebas de integración para los flujos críticos (facturación, cálculo de importes, estados de cobro, numeración, aislamiento por empresa).

**Organization**: tareas agrupadas por historia de usuario (US1–US6) para que cada historia sea implementable y verificable de forma independiente. Convención del proyecto: código, identificadores y commits en inglés; UI y textos de producto en español.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (ficheros distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario a la que pertenece (US1…US6)
- Cada tarea incluye rutas de fichero exactas

## Path Conventions

Proyecto único Next.js full-stack en la raíz del repo (ver plan.md § Project Structure): `src/app/` (App Router + API), `src/db/` (Drizzle), `src/lib/` (lógica pura), `src/services/` (orquestación), `src/workers/` (consumidor de colas), `src/proxies/` (middleware), `tests/{unit,integration,e2e}/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: inicialización del proyecto, toolchain y puertas de calidad

- [X] T001 Create Next.js 15 (App Router) + React 19 + TypeScript 5 `strict` project with pnpm at repo root; scaffold directories `src/app`, `src/components`, `src/db/schema`, `src/db/migrations`, `src/lib`, `src/services`, `src/workers`, `src/proxies`, `tests/{unit,integration,e2e}`; add `tsconfig.json` (strict, path alias `@/`), `package.json` scripts (`dev`, `build`, `typecheck`) and `.gitignore` (incl. `.dev.vars`, `.env.local`)
- [X] T002 [P] Configure Biome as single linter+formatter in `biome.json` + `pnpm lint` script (per research.md R12)
- [X] T003 [P] Configure Tailwind CSS 4 + shadcn/ui base (design tokens, Spanish locale defaults) in `src/app/globals.css`, `components.json`, `src/components/ui/` (init base components: button, input, form, dialog, table, badge, toast)
- [X] T004 [P] Configure Vitest with separate `unit` and `integration` projects in `vitest.config.ts` + scripts `pnpm test` / `pnpm test:integration`
- [X] T005 [P] Configure Playwright with @axe-core/playwright (WCAG 2.1 AA) and mobile+desktop viewports in `playwright.config.ts` + script `pnpm test:e2e`
- [X] T006 [P] Configure Cloudflare deployment: `@opennextjs/cloudflare` adapter, `wrangler.jsonc` with R2 bucket binding, Queues producer/consumer bindings and secrets placeholders; create `.dev.vars.example` (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`) + scripts `pnpm deploy`
- [X] T007 [P] Create CI pipeline in `.github/workflows/ci.yml` (pnpm install → Biome lint → `tsc --noEmit` → unit → integration vs Postgres service/Neon branch → e2e → `pnpm audit` blocking high/critical) + `.github/dependabot.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: base de datos, autenticación, autorización por empresa, convenciones de API y librerías transversales. Ninguna historia puede empezar sin esto.

**⚠️ CRITICAL**: no empezar trabajo de historias hasta completar esta fase

- [ ] T008 Configure Drizzle: `drizzle.config.ts`, db client with `@neondatabase/serverless` in `src/db/index.ts`, scripts `pnpm db:generate` / `db:migrate` / `db:migrate:prod`
- [ ] T009 Setup Better Auth (email/password + verification + password reset) with Drizzle adapter: config in `src/lib/auth.ts`, generated tables in `src/db/schema/auth.ts`, route handler in `src/app/api/auth/[...all]/route.ts` (FR-001)
- [ ] T010 [P] Create `company` schema (legal_name, tax_id, address, email, phone, logo_key, default_due_days, default_tax_rate, retention_rate, currency, plan, plan_doc_limit; unique user_id) in `src/db/schema/company.ts` (data-model.md)
- [ ] T011 [P] Create `client` schema (name, tax_id, address, email, phone, notes, archived_at) in `src/db/schema/client.ts`
- [ ] T012 [P] Create `catalog_item` schema (description, unit_price_cents, tax_rate, archived_at) in `src/db/schema/catalog-item.ts`
- [ ] T013 [P] Create `document_series` schema (doc_type, prefix, next_number, is_default; unique `(company_id, doc_type, prefix)` + partial unique default) in `src/db/schema/document-series.ts`
- [ ] T014 [P] Create `document` and `document_line` schemas (status enum, series/number/full_number, dates, totals in cents, tax_breakdown jsonb, issuer/client snapshots, conversion/receipt links; lines with position, quantity, unit_price_cents, tax_rate, discount_pct) in `src/db/schema/document.ts` and `src/db/schema/document-line.ts`
- [ ] T015 [P] Create `payment` schema (amount_cents > 0, paid_on, method, confirmed_overpayment) in `src/db/schema/payment.ts`
- [ ] T016 [P] Create `share_link` schema (unique token, disabled_at) in `src/db/schema/share-link.ts`
- [ ] T017 [P] Create `document_event` schema (actor, event enum, payload; INSERT-only, no updated_at) in `src/db/schema/document-event.ts`
- [ ] T018 Generate initial drizzle-kit migration in `src/db/migrations/` including all indexes from data-model.md (client search + `pg_trgm`, document listing/dashboard/due-date partial indexes, partial unique `full_number`, `(company_id, issued_at)` for plan limit) and verify reversibility
- [ ] T019 Implement session→company scoping helper (deny by default: resolve `company_id` from Better Auth session, foreign resource → 404) in `src/services/context.ts`, plus company row bootstrap on first login/signup (1–1 user–company) (FR-004)
- [ ] T020 Implement API conventions: error envelope `{error: {code, message, field_errors?}}` with Spanish actionable messages + stable codes map in `src/lib/api/errors.ts`, cursor pagination helper (default 25, max 100) in `src/lib/api/pagination.ts`, Zod validation wrapper for route handlers in `src/lib/api/validate.ts` (contracts/api.md § Convenciones)
- [ ] T021 Implement request-id middleware + auth guard for `(app)` and `/api/v1` in `src/proxies/middleware.ts`, and structured JSON logger with `logSafe` (NIF/importes/tokens excluded) in `src/lib/log.ts`
- [ ] T022 Implement money library (nominal `Cents` type, half-up rounding to cent, `formatEUR`) in `src/lib/money/index.ts` (research.md R10)
- [ ] T023 [P] Unit tests for money library (rounding half-up, formatting, integer invariants) in `tests/unit/money.test.ts`
- [ ] T024 [P] Implement plan capabilities module (`canSendEmail(plan)`, `docLimit(plan)`, single source of truth for FR-022/FR-027) in `src/lib/plan.ts` + unit tests in `tests/unit/plan.test.ts`
- [ ] T025 Implement R2 storage service (private bucket, keys `logos/…`, `pdfs/{company_id}/{document_id}.pdf`) in `src/services/storage.ts` and queue consumer skeleton with message router + retries/DLQ config in `src/workers/queue-consumer.ts`
- [ ] T026 Build auth pages (login, registro, recuperación de contraseña; UI en español) in `src/app/(auth)/` and private app shell with responsive nav (Dashboard, Documentos, Clientes, Catálogo, Ajustes) in `src/app/(app)/layout.tsx`
- [ ] T027 Setup integration test harness (Postgres via Docker/Neon branch, migrations + truncation per suite) in `tests/integration/setup.ts` and write company-isolation test: user A accessing user B's resources by id gets 404 on all endpoints (FR-004, quickstart V8) in `tests/integration/authorization.test.ts`

**Checkpoint**: fundación lista — las historias de usuario pueden comenzar

---

## Phase 3: User Story 1 - Configurar mi empresa y crear mi primera factura (Priority: P1) 🎯 MVP

**Goal**: registro → completar datos fiscales de empresa → crear factura con cliente y líneas → emitir con número correlativo → descargar PDF profesional. Todo en minutos (SC-001, SC-002).

**Independent Test**: registrar cuenta nueva, rellenar perfil de empresa, crear factura con cliente y 2 líneas con IVA distinto, emitirla y verificar que el PDF contiene datos fiscales, número correlativo y cálculos exactos al céntimo (quickstart V1).

### Tests for User Story 1 (constitución: obligatorios; escribirlos primero y verlos fallar)

- [ ] T028 [P] [US1] Unit tests for billing calc (line subtotal with discount, per-line rounding, multi-rate tax breakdown, IRPF retention, totals to the cent; property: totals always integers) in `tests/unit/billing.test.ts` (FR-012, SC-003)
- [ ] T029 [P] [US1] Unit tests for numbering (full_number = prefix+number, series selection, no number on drafts) in `tests/unit/numbering.test.ts` (FR-013)
- [ ] T030 [P] [US1] Unit tests for document lifecycle (issue validation: client + ≥1 line + company ready; state transitions draft→issued→voided; snapshot building; invalid quantities/prices rejected) in `tests/unit/documents.test.ts` (FR-003, FR-014, FR-015, US1-AC4)
- [ ] T031 [P] [US1] Integration test: N concurrent issues on same series produce unique, gapless, correlative numbers (`SELECT ... FOR UPDATE`) in `tests/integration/numbering-concurrency.test.ts` (quickstart V7, SC-003)

### Implementation for User Story 1

- [ ] T032 [P] [US1] Implement pure billing logic (line totals, tax breakdown by rate from rounded lines, retention, document totals) in `src/lib/billing/index.ts`
- [ ] T033 [P] [US1] Implement pure numbering logic (compose full_number, next-number semantics, new-year series rules) in `src/lib/numbering/index.ts`
- [ ] T034 [P] [US1] Implement pure document logic (issue validation with concrete missing-field errors, `isReadyToIssue(company)`, state transitions, issuer/client snapshot builders) in `src/lib/documents/index.ts`
- [ ] T035 [US1] Implement company endpoints GET/PUT `/api/v1/company` (derived flags `is_ready_to_issue`, `docs_issued_this_month`, `doc_limit`; Zod NIF/NIE/CIF validation) in `src/app/api/v1/company/route.ts` (FR-002, FR-003)
- [ ] T036 [US1] Implement logo upload/delete PUT/DELETE `/api/v1/company/logo` (multipart ≤2 MB png/jpg/svg → R2) in `src/app/api/v1/company/logo/route.ts`
- [ ] T037 [US1] Implement series endpoints GET/POST `/api/v1/series` + PATCH `/api/v1/series/:id` (edit only if no issued docs; default-series switch) in `src/app/api/v1/series/route.ts` and `src/app/api/v1/series/[id]/route.ts`, plus default invoice series bootstrap on company creation (FR-013)
- [ ] T038 [US1] Implement minimal client creation POST + list GET `/api/v1/clients` (name, tax_id, address, email; enough to invoice — full management in US3) in `src/app/api/v1/clients/route.ts` (FR-005 parcial)
- [ ] T039 [US1] Implement documents service (create/update/delete drafts with lines, recompute totals via `src/lib/billing`, line validations quantity>0/price≥0/discount 0–100, record `document_event` created/updated) in `src/services/documents.ts` (FR-011, FR-018)
- [ ] T040 [US1] Implement documents endpoints GET(list, paginated, filters type/status)/POST `/api/v1/documents` and GET/PATCH/DELETE `/api/v1/documents/:id` (PATCH/DELETE solo borradores → 409 si emitido) in `src/app/api/v1/documents/route.ts` and `src/app/api/v1/documents/[id]/route.ts` (FR-014)
- [ ] T041 [US1] Implement issue endpoint POST `/api/v1/documents/:id/issue`: single transaction with `SELECT ... FOR UPDATE` on series row, assign number+full_number, freeze issuer/client snapshots, persist line/doc totals, due_date default `issue_date + default_due_days`, plan-limit check (402 `plan_limit_reached`), enqueue `pdf.render`, `document_event` issued — in `src/app/api/v1/documents/[id]/issue/route.ts` (FR-013, FR-015, FR-027)
- [ ] T042 [US1] Implement void endpoint POST `/api/v1/documents/:id/void` (only issued → voided, never delete; `document_event` voided) in `src/app/api/v1/documents/[id]/void/route.ts` (FR-014, edge case factura por error)
- [ ] T043 [US1] Implement PDF template + render service with pdf-lib (issuer/client blocks, logo, doc type+number, dates, lines table, tax breakdown by rate, retention, total, Spanish labels, professional layout) in `src/services/pdf/render.ts` and `src/services/pdf/template.ts` (FR-019)
- [ ] T044 [US1] Implement `pdf.render` queue consumer handler (render → store in R2 `pdfs/{company_id}/{document_id}.pdf` → `document_event` pdf_generated) in `src/workers/queue-consumer.ts`
- [ ] T045 [US1] Implement PDF download endpoint GET `/api/v1/documents/:id/pdf` (serve from R2 cache; on-demand render+cache fallback; `Content-Disposition: attachment`) in `src/app/api/v1/documents/[id]/pdf/route.ts`
- [ ] T046 [US1] Build settings UI (company fiscal form with NIF validation, invoicing preferences, logo upload, series management) in `src/app/(app)/settings/page.tsx` + `src/components/settings/`
- [ ] T047 [US1] Implement onboarding guard: si la empresa no está lista para emitir, guiar al usuario a completar nombre/NIF/dirección antes de crear factura (banner + redirect) in `src/components/onboarding-guard.tsx` wired into `src/app/(app)/documents/` (US1-AC1)
- [ ] T048 [US1] Build single-screen document editor (client picker/inline create, dynamic lines with quantity/price/tax/discount, live totals with tax breakdown, save draft, issue with clear missing-field errors, <100 ms feedback) in `src/app/(app)/documents/new/page.tsx` + `src/components/documents/editor/` (Principio V)
- [ ] T049 [US1] Build documents list UI (paginated, type/status badges, link to detail) in `src/app/(app)/documents/page.tsx`
- [ ] T050 [US1] Build document detail UI (totals + tax breakdown, status, event history, issue/void/download-PDF actions) in `src/app/(app)/documents/[id]/page.tsx`
- [ ] T051 [US1] E2E test: registro → guía de empresa → crear factura con 2 líneas (21% y 10%) → emitir (número `2026-0001`) → descargar PDF; incluye intento de emitir borrador incompleto y chequeo axe móvil+escritorio in `tests/e2e/first-invoice.spec.ts` (quickstart V1, SC-001)

**Checkpoint**: MVP funcional — registrar, configurar empresa, facturar y descargar PDF de forma independiente

---

## Phase 4: User Story 2 - Controlar qué facturas están cobradas, pendientes o vencidas (Priority: P2)

**Goal**: panel de cobros con estados derivados (pendiente/parcial/pagada/vencida), registro de pagos totales y parciales, totales del periodo (SC-004).

**Independent Test**: con facturas emitidas (US1), registrar pagos totales y parciales, dejar una vencida sin pagar, y verificar estados y totales cobrado/pendiente/vencido en el panel (quickstart V2).

### Tests for User Story 2

- [ ] T052 [P] [US2] Unit tests for payment-status derivation (pending/partial/paid/overdue incl. partial+overdue, voided excluded, boundary due_date = today, overpayment detection) in `tests/unit/payments.test.ts` (FR-024)

### Implementation for User Story 2

- [ ] T053 [US2] Implement pure payments logic (derive payment status from totals+payments+due_date+status, paid/pending amounts, overpayment check) in `src/lib/payments/index.ts`
- [ ] T054 [US2] Implement payment endpoints: POST `/api/v1/documents/:id/payments` (only issued invoices; overpayment → 409 `overpayment_confirmation_required`, retry with `confirmed_overpayment`), PATCH/DELETE `/api/v1/payments/:id` with re-derivation and `document_event` payment_added/updated/deleted in `src/app/api/v1/documents/[id]/payments/route.ts` and `src/app/api/v1/payments/[id]/route.ts` (FR-023, FR-026)
- [ ] T055 [US2] Implement dashboard endpoint GET `/api/v1/dashboard?from=&to=` (aggregate paid/pending/overdue cents + counts by derived status + latest invoices, using indexes from data-model.md) in `src/app/api/v1/dashboard/route.ts` (FR-025)
- [ ] T056 [US2] Extend documents list endpoint with derived `payment_status` filter and client/date-range filters in `src/app/api/v1/documents/route.ts` (FR-025)
- [ ] T057 [US2] Integration test: payment lifecycle vs real Postgres (partial → paid, overdue derivation, delete payment re-derives, voided excluded from aggregates) in `tests/integration/payments.test.ts` (quickstart V2)
- [ ] T058 [US2] Build dashboard UI (totales cobrado/pendiente/vencido del periodo, filtros por estado/cliente/fechas, vencidas destacadas, una sola pantalla) in `src/app/(app)/dashboard/page.tsx` + `src/components/dashboard/` (SC-004)
- [ ] T059 [US2] Build payments UI in document detail (register payment form with date/amount/method, overpayment confirmation dialog, edit/delete, paid vs pending display) in `src/components/documents/payments-panel.tsx` wired into `src/app/(app)/documents/[id]/page.tsx`
- [ ] T060 [US2] E2E test: 4 facturas (pendiente/pagada/parcial/vencida) → panel muestra estados y totales correctos; pago superior al pendiente pide confirmación; eliminar pago rederiva estado; axe in `tests/e2e/payments.spec.ts` (quickstart V2)

**Checkpoint**: US1 y US2 funcionan de forma independiente

---

## Phase 5: User Story 3 - Gestionar mi cartera de clientes (Priority: P3)

**Goal**: CRUD + búsqueda + archivado de clientes, ficha con historial y pendiente de cobro, selección rápida al facturar (SC-007).

**Independent Test**: crear varios clientes, buscar por nombre y NIF, editar y archivar, facturar seleccionando cliente existente y verificar volcado automático y snapshot inmutable (quickstart V3).

### Implementation for User Story 3

- [ ] T061 [US3] Extend clients collection endpoint GET `/api/v1/clients?q=&archived=&limit=&cursor=` with immediate name/NIF search (prefix + `pg_trgm`) in `src/app/api/v1/clients/route.ts` (FR-006)
- [ ] T062 [US3] Implement client detail endpoints: GET `/api/v1/clients/:id` (+`pending_cents`, `overdue_cents`), GET `/api/v1/clients/:id/documents` (paginated history), PATCH `/api/v1/clients/:id`, POST `archive`/`unarchive` in `src/app/api/v1/clients/[id]/route.ts`, `src/app/api/v1/clients/[id]/documents/route.ts`, `src/app/api/v1/clients/[id]/archive/route.ts`, `src/app/api/v1/clients/[id]/unarchive/route.ts` (FR-007, FR-008)
- [ ] T063 [US3] Build clients list UI (búsqueda inmediata por nombre/NIF, crear/editar formulario con validación NIF, archivar/desarchivar, archived filter) in `src/app/(app)/clients/page.tsx` + `src/components/clients/`
- [ ] T064 [US3] Build client detail UI (datos, historial de documentos paginado, pendiente de cobro del cliente) in `src/app/(app)/clients/[id]/page.tsx`
- [ ] T065 [US3] Upgrade document editor client picker: search existing clients (excluding archived), auto-fill fiscal data, keep inline creation in `src/components/documents/editor/client-picker.tsx` (US3-AC1)
- [ ] T066 [US3] Integration test: edit + archive client after issuing → issued document snapshot unchanged, client hidden from selectors but history intact in `tests/integration/client-snapshot.test.ts` (US3-AC4/AC5, SC-007)
- [ ] T067 [US3] E2E test: crear 3 clientes → buscar por nombre y NIF → facturar a uno → editarlo y archivarlo → factura conserva datos originales y ficha muestra historial+pendiente; axe in `tests/e2e/clients.spec.ts` (quickstart V3)

**Checkpoint**: US1–US3 funcionan de forma independiente

---

## Phase 6: User Story 4 - Reutilizar servicios y conceptos habituales (Priority: P4)

**Goal**: catálogo de conceptos con precio e impuesto por defecto; añadir líneas desde catálogo sin acoplar documentos al concepto.

**Independent Test**: crear conceptos, añadir líneas desde catálogo (auto-relleno editable), editar/eliminar el concepto y verificar que los documentos no cambian (quickstart V4).

### Implementation for User Story 4

- [ ] T068 [US4] Implement catalog endpoints GET(search)/POST `/api/v1/catalog-items` + PATCH/DELETE(soft archive) `/api/v1/catalog-items/:id` in `src/app/api/v1/catalog-items/route.ts` and `src/app/api/v1/catalog-items/[id]/route.ts` (FR-009)
- [ ] T069 [US4] Build catalog UI (lista con búsqueda, crear/editar/archivar concepto con precio en céntimos e IVA por defecto) in `src/app/(app)/catalog/page.tsx` + `src/components/catalog/`
- [ ] T070 [US4] Add catalog picker to document editor lines (search catalog, copy description/price/tax into line — values editable, no FK to catalog item) in `src/components/documents/editor/catalog-picker.tsx` (FR-010, US4-AC2)
- [ ] T071 [US4] E2E test: crear conceptos → añadir línea desde catálogo (auto-relleno editable) → modificar línea → editar/eliminar concepto → documento intacto; axe in `tests/e2e/catalog.spec.ts` (quickstart V4)

**Checkpoint**: US1–US4 funcionan de forma independiente

---

## Phase 7: User Story 5 - Compartir el documento por enlace o email (Priority: P5)

**Goal**: enlace público no adivinable (ver + PDF sin cuenta, desactivable), envío por email según plan con constancia en historial (SC-006).

**Independent Test**: emitir factura → abrir enlace en incógnito (documento visible, PDF descargable) → desactivar enlace (404); con plan pro enviar email y ver constancia; con plan free ver aviso claro con alternativas (quickstart V5).

### Implementation for User Story 5

- [ ] T072 [US5] Implement share-link service (CSPRNG 32-byte base64url token, max 1 active per doc, reactivation) + endpoints POST/DELETE `/api/v1/documents/:id/share-link` with `document_event` link_created/link_disabled in `src/services/share-links.ts` and `src/app/api/v1/documents/[id]/share-link/route.ts` (FR-020)
- [ ] T073 [US5] Build public document page GET `/d/:token` (SSR, responsive, sin sesión; documento anulado → aviso claro; token inválido/desactivado → 404 genérico; tokens nunca logueados) in `src/app/d/[token]/page.tsx` (SC-006)
- [ ] T074 [US5] Implement public PDF download GET `/d/:token/pdf` (only active link, serve from R2/on-demand) in `src/app/d/[token]/pdf/route.ts`
- [ ] T075 [US5] Implement email sending: Resend template (español) in `src/services/email/`, endpoint POST `/api/v1/documents/:id/email` with plan gating via `src/lib/plan.ts` (403 `feature_not_in_plan` + alternativas PDF/enlace) enqueuing `email.send` in `src/app/api/v1/documents/[id]/email/route.ts` (FR-021, FR-022)
- [ ] T076 [US5] Implement `email.send` queue consumer handler (Resend send, `document_event` email_sent, retries with backoff + dead-letter after 3 failures) in `src/workers/queue-consumer.ts` (contracts/api.md § asíncronos)
- [ ] T077 [US5] Build share UI in document detail (copiar enlace, desactivar, enviar por email con mensaje opcional; si plan free, mensaje claro de plan superior con alternativas) in `src/components/documents/share-panel.tsx` wired into `src/app/(app)/documents/[id]/page.tsx`
- [ ] T078 [US5] Integration test: share-link access (valid token reads, disabled/invented token 404, voided doc shows voided) and email plan gating (free → 403 with alternatives, pro → enqueued + event) in `tests/integration/share-email.test.ts`
- [ ] T079 [US5] E2E test: emitir → generar enlace → abrir en contexto sin sesión (móvil y escritorio) → descargar PDF → desactivar enlace (deja de funcionar) → anular documento (enlace muestra anulado); axe on public page in `tests/e2e/share-link.spec.ts` (quickstart V5)

**Checkpoint**: US1–US5 funcionan de forma independiente

---

## Phase 8: User Story 6 - Crear proformas y recibos, y convertir proformas en facturas (Priority: P6)

**Goal**: proformas con serie propia y marca "sin validez fiscal", conversión proforma→factura con vinculación, recibos ligados a factura y pago, duplicado de documentos.

**Independent Test**: crear proforma (serie propia, PDF marcado), convertirla en factura (hereda datos, número de serie de facturas, ambas vinculadas), generar recibo de factura pagada (quickstart V6).

### Implementation for User Story 6

- [ ] T080 [US6] Enable proforma/receipt doc types end-to-end: default proforma+receipt series bootstrap in `src/app/api/v1/series/route.ts` service layer, doc_type selector in editor `src/components/documents/editor/` and type filter/badges in `src/app/(app)/documents/page.tsx` (FR-011)
- [ ] T081 [US6] Implement conversion POST `/api/v1/documents/:id/convert` (issued proforma → linked invoice draft or direct issue with `{issue: true}`; inherit client+lines; set converted_from/to; mark proforma "convertida"; 409 if already converted or not proforma; `document_event` converted) in `src/app/api/v1/documents/[id]/convert/route.ts` + pure rules in `src/lib/documents/index.ts` (FR-016)
- [ ] T082 [US6] Implement receipt generation POST `/api/v1/documents/:id/receipt` (`{payment_id}` → receipt document linked to invoice+payment, receipt series numbering, amount/date from payment) in `src/app/api/v1/documents/[id]/receipt/route.ts` (US6-AC3)
- [ ] T083 [US6] Implement duplicate POST `/api/v1/documents/:id/duplicate` (any document → new draft copying client, lines, notes; new dates, no number; `document_event` duplicated) in `src/app/api/v1/documents/[id]/duplicate/route.ts` + action in document detail UI (FR-017)
- [ ] T084 [US6] Extend PDF template with variants: proforma header + "Proforma — sin validez fiscal" notice, receipt layout (importe cobrado, fecha de pago, factura de origen) in `src/services/pdf/template.ts` (FR-019, US6-AC1)
- [ ] T085 [US6] E2E test: crear proforma (serie propia, PDF marcado) → convertir en factura (herencia + número de facturas + vinculación) → recibo sobre factura pagada (importe, fecha, factura origen); axe in `tests/e2e/proforma-receipt.spec.ts` (quickstart V6)

**Checkpoint**: todas las historias funcionan de forma independiente

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: observabilidad, seguridad operativa, datos de demo y validación final

- [ ] T086 [P] Create seed script with demo data (empresa, clientes, catálogo, documentos en varios estados) in `src/db/seed.ts` + `pnpm db:seed` script (quickstart)
- [ ] T087 [P] Configure rate limiting for `/d/*` (Cloudflare rules in `wrangler.jsonc`) and verify tokens/NIF/importes excluded from all logs via `logSafe` sweep (contracts/api.md, Principio III)
- [ ] T088 [P] Integrate Sentry (Cloudflare SDK) with request-id correlation in `src/proxies/middleware.ts` + `src/lib/log.ts`, and document budget-alert setup for Cloudflare/Neon in `README.md` (research.md R13, Principio IV)
- [ ] T089 Add coverage gate for business modules (`src/lib/**`) to CI in `.github/workflows/ci.yml` (coverage no baja respecto a main — Principio I)
- [ ] T090 Accessibility + responsive sweep: run axe on all app pages (dashboard, documents, clients, catalog, settings, public page) mobile+desktop viewports, fix violations in `tests/e2e/accessibility.spec.ts` (WCAG 2.1 AA, Principio V)
- [ ] T091 Verify deployment pipeline: `pnpm build` (OpenNext) + `pnpm deploy` (Workers + Queues + R2 bindings) + `pnpm db:migrate:prod`, smoke test alta→factura→PDF→enlace público desde móvil real (quickstart § Despliegue)
- [ ] T092 Run full quickstart.md validation (V1–V8) and all quality gates (`pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `audit`) in green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — empezar de inmediato
- **Foundational (Phase 2)**: depende de Setup — **BLOQUEA todas las historias**
- **User Stories (Phases 3–8)**: todas dependen de Foundational
  - En equipo, pueden avanzar en paralelo tras la Phase 2; en solitario, en orden de prioridad P1→P6
- **Polish (Phase 9)**: depende de las historias que se quieran entregar

### User Story Dependencies

- **US1 (P1)**: solo Foundational. Sin dependencias de otras historias. **Es el MVP.**
- **US2 (P2)**: Foundational; usa facturas emitidas (US1) para probarse, pero su código (payments, dashboard) es independiente
- **US3 (P3)**: Foundational; extiende el endpoint mínimo de clientes creado en T038 (US1) y el editor (T048)
- **US4 (P4)**: Foundational; se integra en el editor de documentos (T048)
- **US5 (P5)**: Foundational; requiere documentos emitidos con PDF (US1: T041–T045)
- **US6 (P6)**: Foundational; extiende ciclo de vida y PDF de US1 (T039–T043) y usa pagos de US2 para recibos (T054)

### Within Each User Story

- Tests primero (deben fallar antes de implementar) → lib pura → services → endpoints → UI → E2E
- Modelos/lib marcados [P] pueden ir en paralelo; los endpoints que tocan el mismo route file van en serie

### Parallel Opportunities

- Phase 1: T002–T007 en paralelo tras T001
- Phase 2: los 8 schemas T010–T017 en paralelo tras T008/T009; T023–T024 en paralelo
- US1: los 4 tests T028–T031 en paralelo; las 3 libs T032–T034 en paralelo
- Tras Phase 2, historias completas en paralelo por desarrolladores distintos (US1 y US2 son las más independientes entre sí)
- Phase 9: T086–T088 en paralelo

---

## Parallel Example: User Story 1

```bash
# Tests de US1 juntos (deben fallar primero):
Task: "Unit tests for billing calc in tests/unit/billing.test.ts"
Task: "Unit tests for numbering in tests/unit/numbering.test.ts"
Task: "Unit tests for document lifecycle in tests/unit/documents.test.ts"
Task: "Integration test concurrent numbering in tests/integration/numbering-concurrency.test.ts"

# Libs puras de US1 juntas:
Task: "Implement pure billing logic in src/lib/billing/index.ts"
Task: "Implement pure numbering logic in src/lib/numbering/index.ts"
Task: "Implement pure document logic in src/lib/documents/index.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001–T007)
2. Phase 2: Foundational (T008–T027) — CRÍTICO, bloquea todo
3. Phase 3: US1 (T028–T051)
4. **STOP y VALIDAR**: quickstart V1 + V7 + V8 en verde; SC-001 medible
5. Desplegar/demo: el producto ya sustituye a Word/Excel

### Incremental Delivery

1. Setup + Foundational → base lista
2. +US1 → validar → **MVP desplegable** (facturar y PDF)
3. +US2 → validar → control de cobros
4. +US3 → validar → cartera de clientes
5. +US4 → validar → catálogo
6. +US5 → validar → enlace público + email por plan
7. +US6 → validar → proformas y recibos
8. Phase 9 → pulido, observabilidad y validación quickstart completa

Cada historia añade valor sin romper las anteriores (los E2E previos siguen en verde).

---

## Notes

- [P] = ficheros distintos y sin dependencias pendientes
- La numeración, los importes y los estados de cobro son los módulos más críticos: sus tests (T028–T031, T052) son la puerta de calidad del producto (SC-003)
- Commit tras cada tarea o grupo lógico; mensajes de commit en inglés
- CI en verde obligatorio para fusionar (constitución § Flujo de Desarrollo)
