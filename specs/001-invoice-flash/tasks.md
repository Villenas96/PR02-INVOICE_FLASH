# Tasks: Invoice Flash — Facturación sencilla para autónomos y pequeños negocios

**Input**: Design documents from `/specs/001-invoice-flash/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: INCLUIDOS — la especificación define escenarios verificables y la constitución exige pruebas unitarias para toda lógica de negocio, integración para los flujos críticos, E2E accesibles y puertas de rendimiento.

**Organization**: tareas agrupadas por historia de usuario (US1–US6), en orden de prioridad y con dependencias explícitas. Convención: código, identificadores y commits en inglés; UI y textos de producto en español.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo porque usa ficheros distintos y no depende de otra tarea incompleta del mismo grupo.
- **[Story]**: historia de usuario a la que pertenece (US1…US6); no se usa en Setup, Foundational ni Polish.
- Todas las tareas incluyen rutas exactas.

## Path Conventions

Proyecto único Next.js full-stack en la raíz: `src/app/` (App Router + API), `src/db/` (Drizzle), `src/lib/` (lógica pura), `src/services/` (orquestación), `src/workers/` (colas y scheduled handlers), `src/proxies/` (middleware), `tests/{unit,integration,e2e,performance}/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: inicialización del proyecto, toolchain y puertas básicas de calidad.

- [X] T001 Complete and verify the remaining Next.js 15 App Router + React 19 + TypeScript 5 strict scaffold with pnpm, ensuring `src/{app,components,db/schema,db/migrations,lib,services,workers,proxies}` and `tests/{unit,integration,e2e,performance}` exist and `dev`, `build` and `typecheck` are defined in `package.json` and `tsconfig.json`
- [X] T002 Configure Biome as the only linter and formatter with `pnpm lint` in `biome.json` and `package.json`
- [X] T003 [P] Configure Tailwind CSS 4 and shadcn/ui tokens plus base accessible components in `src/app/globals.css`, `components.json` and `src/components/ui/`
- [X] T004 Configure Vitest unit, integration and performance projects plus `test`, `test:integration` and `test:performance` scripts in `vitest.config.ts` and `package.json`
- [X] T005 [P] Configure Playwright with axe, mobile/desktop projects and `pnpm test:e2e` in `playwright.config.ts` and `package.json`
- [X] T006 [P] Configure OpenNext Cloudflare deployment, private R2 binding, PDF/email queues, DLQ and scheduled handler binding with secret placeholders in `wrangler.jsonc`, `open-next.config.ts` and `.dev.vars.example`
- [X] T007 Configure GitHub Actions plus protected-`main` governance requiring an approved PR, stale-review dismissal, required green checks and blocked direct/force pushes in `.github/workflows/ci.yml`, `.github/dependabot.yml` and `docs/operations/repository-governance.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: base de datos, autenticación, aislamiento por empresa, convenciones de API, dinero, planes, colas y UI asíncrona compartida.

**⚠️ CRITICAL**: ninguna historia puede empezar hasta completar esta fase.

- [X] T008 Configure Drizzle, the Neon serverless client and `db:generate`, `db:migrate`, `db:migrate:prod` scripts in `drizzle.config.ts`, `src/db/index.ts` and `package.json`
- [X] T009 Configure Better Auth email/password sessions and the Drizzle adapter, exposing verification/recovery callback boundaries without provider calls in `src/lib/auth.ts`, `src/db/schema/auth.ts` and `src/app/api/auth/[...all]/route.ts`
- [X] T010 [P] Create the `company` schema with fiscal preferences and `free|pro` plan enum without a duplicated per-company limit in `src/db/schema/company.ts`
- [X] T011 [P] Create the tenant-scoped, reversibly archived `client` schema in `src/db/schema/client.ts`
- [X] T012 [P] Create the tenant-scoped, reversibly archived `catalog_item` schema with cent amounts in `src/db/schema/catalog-item.ts`
- [X] T013 [P] Create the `document_series` schema with per-company/type defaults and next-number constraints in `src/db/schema/document-series.ts`
- [X] T014 [P] Create `document` and `document_line` schemas with immutable snapshots, cent totals, conversion/receipt links and `pdf_status`/`pdf_ready_at` in `src/db/schema/document.ts` and `src/db/schema/document-line.ts`
- [X] T015 [P] Create the positive-cent `payment` schema with overpayment confirmation metadata in `src/db/schema/payment.ts`
- [X] T016 [P] Create the CSPRNG-token `share_link` schema with reversible disable state in `src/db/schema/share-link.ts`
- [X] T017 [P] Create the generalized `email_delivery` schema for document/verify/reset purposes with nullable document/company scope, auth verification reference, global idempotency key, delivery state and PII-retention fields in `src/db/schema/email-delivery.ts`
- [X] T018 [P] Create the INSERT-only `document_event` schema with PDF/email/payment lifecycle event types in `src/db/schema/document-event.ts`
- [X] T019 Generate and review the reversible initial migration with `pg_trgm`, all query indexes, partial uniqueness and INSERT-only audit permissions in `src/db/migrations/`
- [X] T020 Implement session-to-company bootstrap and deny-by-default resource resolution returning 404 for foreign ids in `src/services/context.ts`
- [X] T021 Implement Spanish actionable API errors, Zod server validation, cursor pagination default 25/max 100 and `Idempotency-Key` parsing in `src/lib/api/errors.ts`, `src/lib/api/validate.ts`, `src/lib/api/pagination.ts` and `src/lib/api/idempotency.ts`
- [X] T022 Implement request-id propagation, private route guards, baseline Sentry error reporting and structured `logSafe` redaction for NIF, amounts, tokens, email addresses and messages in `src/proxies/middleware.ts`, `src/lib/sentry.ts` and `src/lib/log.ts`
- [X] T023 [P] Write failing unit tests for nominal `Cents`, integer invariants, half-up rounding and EUR formatting in `tests/unit/money.test.ts`
- [X] T024 Implement the pure money module after T023 passes red in `src/lib/money/index.ts`
- [X] T025 [P] Write failing unit tests for `free=5`/`pro=100`, email/PDF/link capabilities, warning thresholds 4/80, `Europe/Madrid` month boundaries, all issued document types, issued-then-voided counting and idempotent-existing-result exclusion in `tests/unit/plan.test.ts`
- [X] T026 Implement the versioned single source of truth for `canSendEmail`, `docLimit`, `usageWarning`, Madrid calendar-month bounds, all-type emitted-document counting and new-emission versus existing-idempotent-result rules in `src/lib/plan.ts`
- [X] T027 Define typed `pdf.render` and purpose-aware `email.send` messages, at-least-once idempotency rules, exponential backoff, auth-expiry/24-hour retry bounds and DLQ routing in `src/workers/messages.ts` and `src/workers/queue-consumer.ts`
- [X] T028 Implement private R2 keys and storage operations for logos and deterministic PDFs in `src/services/storage.ts`
- [X] T029 [P] Build and unit-test a shared async-action pattern that exposes loading/optimistic/success/error state synchronously in `src/components/ui/async-action.tsx` and `tests/unit/async-action.test.tsx`
- [X] T030 Build Spanish login, registration and password-recovery pages plus the responsive private shell with a persistent plan/usage indicator in `src/app/(auth)/`, `src/app/(app)/layout.tsx` and `src/components/plan/plan-indicator.tsx`
- [X] T031 Configure the real-Postgres integration harness with migrations, truncation and guaranteed Docker/Neon ephemeral-branch cleanup in `tests/integration/setup.ts` and `tests/integration/global-teardown.ts`
- [X] T032 Write the foundational authorization integration suite proving the shared resolver denies by default and returns 404 for foreign company, client, document, series and payment records in `tests/integration/authorization.test.ts`
- [X] T033 Implement queued Better Auth verification/recovery deliveries with generic anti-enumeration responses, opaque queue ids, purpose-specific templates and the base purpose-aware consumer in `src/services/email/auth-deliveries.ts`, `src/services/email/templates/auth.ts`, `src/workers/handlers/email-send.ts` and `src/lib/auth.ts`
- [X] T034 Write real-Postgres integration tests proving auth verification/recovery enqueue without provider calls, duplicate queue delivery sends once, nonexistent-account recovery is indistinguishable and logs/queue bodies contain no recipient, token or URL in `tests/integration/auth-email.test.ts`
- [X] T035 Implement blocking pre/post-deploy verification for Sentry, Neon TLS, R2 privacy/encryption and Cloudflare/Neon cost controls, with evidence runbooks in `scripts/verify-predeploy.ts`, `scripts/verify-postdeploy.ts`, `docs/security/storage-encryption.md` and `docs/operations/cloud-cost-controls.md`

**Checkpoint**: fundación completa; se puede iniciar US1.

---

## Phase 3: User Story 1 - Configurar mi empresa y crear mi primera factura (Priority: P1) 🎯 MVP

**Goal**: registro → empresa fiscal → factura con cliente y líneas → emisión correlativa → PDF asíncrono profesional descargable en menos de 10 minutos.

**Independent Test**: quickstart V1, V7 y V8: cuenta nueva, empresa, factura con IVA 21%/10%, emisión `2026-0001`, `202 pdf_processing` mientras trabaja la cola y descarga posterior desde R2 con cálculos/snapshots exactos.

### Tests for User Story 1

- [X] T036 [P] [US1] Write failing unit/property tests for discounts, per-line half-up rounding, mixed tax rates, retention and integer totals in `tests/unit/billing.test.ts`
- [X] T037 [P] [US1] Write failing unit tests for full numbers, default-series selection, no number on drafts and annual-series rollover preserving the prior series in `tests/unit/numbering.test.ts`
- [X] T038 [P] [US1] Write failing unit tests for readiness, concrete issue errors, lifecycle transitions, snapshots and invalid line inputs in `tests/unit/documents.test.ts`
- [X] T039 [P] [US1] Write PDF layout tests for fiscal blocks, multipage line tables, totals, Spanish labels and approved visual snapshots in `tests/unit/pdf-template.test.ts` and `tests/fixtures/pdf/`
- [X] T040 [P] [US1] Write the concurrent conventional-issue integration test proving unique gapless numbers and exact remaining-slot enforcement with `company → document_series` row-lock order in `tests/integration/numbering-concurrency.test.ts`
- [X] T041 [P] [US1] Write atomic issue and issuer-snapshot integration tests proving totals, number, snapshots, audit/PDF state commit together and later company name/NIF/address edits cannot change issued API/PDF data in `tests/integration/document-issue.test.ts` and `tests/integration/company-snapshot.test.ts`
- [X] T042 [P] [US1] Write the PDF re-delivery integration test proving duplicate queue messages create one deterministic object and one `pdf_generated` event in `tests/integration/pdf-queue.test.ts`
- [X] T043 [P] [US1] Write contract tests for company capability fields, paginated series/clients/documents, issue/void, PDF 200/202/409, exact 5/100 conventional-issue enforcement with side-effect-free 402 and foreign-resource 404 responses in `tests/integration/documents-contract.test.ts`

### Implementation for User Story 1

- [X] T044 [P] [US1] Implement pure billing calculations and tax breakdowns after T036 fails in `src/lib/billing/index.ts`
- [X] T045 [P] [US1] Implement pure numbering and annual-series rules after T037 fails in `src/lib/numbering/index.ts`
- [X] T046 [P] [US1] Implement readiness, issue validation, lifecycle and snapshot builders after T038 fails in `src/lib/documents/index.ts`
- [X] T047 [US1] Implement tenant-scoped GET/PUT company endpoints with readiness plus derived `free=5|pro=100`, email capability, Madrid-month consumption and warning flags in `src/app/api/v1/company/route.ts`
- [X] T048 [US1] Implement validated logo upload/delete to private R2 in `src/app/api/v1/company/logo/route.ts`
- [X] T049 [US1] Implement cursor-paginated series GET/POST/PATCH, default switching and company bootstrap series in `src/app/api/v1/series/route.ts` and `src/app/api/v1/series/[id]/route.ts`
- [X] T050 [US1] Implement minimal cursor-paginated client create/list needed for invoicing in `src/app/api/v1/clients/route.ts`
- [X] T051 [US1] Implement draft create/update/soft-delete, line validation, cent recomputation and append-only created/updated audit events (including `{operation:"draft_deleted"}`) in `src/services/documents.ts`
- [X] T052 [US1] Implement cursor-paginated document collection and draft-only detail mutation endpoints that exclude soft-deleted drafts in `src/app/api/v1/documents/route.ts` and `src/app/api/v1/documents/[id]/route.ts`
- [X] T053 [US1] Implement the shared atomic issuance guard with idempotent-result recheck after the `company` row lock, fixed `company → document_series` lock order, Madrid-month `free=5|pro=100` all-document counting, side-effect-free limit rejection, snapshots, persisted totals, due-date default, `pdf_status=pending`, one queue message and audit event, then route conventional issue through it in `src/services/document-issuance.ts` and `src/app/api/v1/documents/[id]/issue/route.ts`
- [X] T054 [US1] Implement issued-only voiding without deletion and append-only audit in `src/app/api/v1/documents/[id]/void/route.ts`
- [X] T055 [US1] Implement the professional multipage pdf-lib renderer matching T039 snapshots in `src/services/pdf/render.ts` and `src/services/pdf/template.ts`
- [X] T056 [US1] Implement the idempotent `pdf.render` consumer with terminal-state detection, deterministic R2 write, `ready|failed` transition and unique event in `src/workers/handlers/pdf-render.ts`
- [X] T057 [US1] Implement private PDF download as R2-only 200, pending 202 + `Retry-After`, or failed 409 with no HTTP rendering in `src/app/api/v1/documents/[id]/pdf/route.ts`
- [X] T058 [P] [US1] Build company, logo, invoicing preferences and paginated series settings UI in `src/app/(app)/settings/page.tsx` and `src/components/settings/`
- [X] T059 [P] [US1] Build onboarding guidance for incomplete fiscal data in `src/components/onboarding-guard.tsx`
- [X] T060 [US1] Build the single-screen invoice editor with inline client creation, dynamic lines, live totals and shared <100 ms async feedback in `src/app/(app)/documents/new/page.tsx` and `src/components/documents/editor/`
- [X] T061 [P] [US1] Build the cursor-paginated document list with type/status badges in `src/app/(app)/documents/page.tsx`
- [X] T062 [P] [US1] Build document detail with immutable snapshots, audit history, issue/void and PDF processing/poll/download states in `src/app/(app)/documents/[id]/page.tsx`
- [X] T063 [US1] Wire persistent `free=5|pro=100` plan usage, warning at 4/80, new-emission block at 5/100, server-authoritative `plan_limit_reached` feedback and email/PDF/link capabilities into settings and editor in `src/components/plan/plan-indicator.tsx` and `src/components/documents/editor/issue-action.tsx`
- [ ] T064 [US1] Add the automated timed registration-to-first-PDF and configured-user-under-two-minutes regression with incomplete-draft errors, axe and mobile/desktop feedback checks, explicitly separate from moderated V13, in `tests/e2e/first-invoice.spec.ts`
- [ ] T065 [US1] Add PDF render p95 <500 ms and availability p95 <3 s performance scenarios in `tests/performance/pdf-render.test.ts`

**Checkpoint**: US1 sustituye el flujo Word/Excel y constituye el MVP desplegable.

---

## Phase 4: User Story 2 - Controlar qué facturas están cobradas, pendientes o vencidas (Priority: P2)

**Goal**: pagos totales/parciales, estados derivados y panel de cobros identificable en una pantalla y menos de 10 segundos.

**Independent Test**: quickstart V2 con cuatro facturas: pendiente, pagada, parcial y vencida; totales exactos, confirmación de sobrepago y rederivación tras borrar pago.

### Tests for User Story 2

- [ ] T066 [P] [US2] Write failing unit tests for pending/partial/paid/overdue derivation, due-date boundary, void exclusion and overpayment detection in `tests/unit/payments.test.ts`
- [ ] T067 [P] [US2] Write payment and dashboard contract tests including validation, filters, aggregate shape and foreign payment/document 404 responses in `tests/integration/payments-contract.test.ts`
- [ ] T068 [P] [US2] Write the real-Postgres payment lifecycle integration test for partial→paid, overdue, delete/rederive and aggregate exclusion in `tests/integration/payments.test.ts`

### Implementation for User Story 2

- [ ] T069 [US2] Implement pure payment status, paid/pending amounts and overpayment rules after T066 fails in `src/lib/payments/index.ts`
- [ ] T070 [US2] Implement tenant-scoped payment POST/PATCH/DELETE with confirmation and append-only events in `src/app/api/v1/documents/[id]/payments/route.ts` and `src/app/api/v1/payments/[id]/route.ts`
- [ ] T071 [US2] Implement aggregate-only dashboard GET without embedded unpaginated invoice collections in `src/app/api/v1/dashboard/route.ts`
- [ ] T072 [US2] Extend the paginated document list with derived payment status, client and date-range filters in `src/app/api/v1/documents/route.ts`
- [ ] T073 [P] [US2] Build the one-screen dashboard that composes aggregate totals and the cursor-paginated invoice collection with shared period/status/client filters and overdue emphasis in `src/app/(app)/dashboard/page.tsx` and `src/components/dashboard/`
- [ ] T074 [P] [US2] Build payment create/edit/delete and overpayment confirmation UI in `src/components/documents/payments-panel.tsx`
- [ ] T075 [US2] Add the timed under-10-seconds dashboard E2E flow proving four statuses, matching filtered totals plus paginated invoice rows, payment correction and axe in `tests/e2e/payments.spec.ts`

**Checkpoint**: US1 y US2 funcionan conjuntamente; el estado de cobro nunca se almacena.

---

## Phase 5: User Story 3 - Gestionar mi cartera de clientes (Priority: P3)

**Goal**: CRUD, búsqueda, archivado reversible, ficha con historial/pendiente y selección rápida sin alterar snapshots emitidos.

**Independent Test**: quickstart V3: crear, buscar por nombre/NIF, editar, archivar, facturar y comprobar historial, pendiente y snapshot original.

### Tests for User Story 3

- [ ] T076 [P] [US3] Write client collection/detail contract tests for cursor pagination, search, archive/unarchive, paginated history and foreign-client 404 responses in `tests/integration/clients-contract.test.ts`
- [ ] T077 [P] [US3] Write the issued-snapshot integration test across client edit/archive operations in `tests/integration/client-snapshot.test.ts`
- [ ] T078 [P] [US3] Add the indexed client-search p95 <200 ms scenario with a documented dataset in `tests/performance/client-search.test.ts` and `tests/performance/fixtures/clients.ts`

### Implementation for User Story 3

- [ ] T079 [US3] Extend the client collection with immediate indexed name/NIF search and archived filters while preserving cursor pagination in `src/app/api/v1/clients/route.ts`
- [ ] T080 [US3] Implement client detail, pending/overdue aggregates, paginated document history and archive/unarchive endpoints in `src/app/api/v1/clients/[id]/route.ts`, `src/app/api/v1/clients/[id]/documents/route.ts`, `src/app/api/v1/clients/[id]/archive/route.ts` and `src/app/api/v1/clients/[id]/unarchive/route.ts`
- [ ] T081 [P] [US3] Build the paginated searchable client list and validated create/edit/archive UI in `src/app/(app)/clients/page.tsx` and `src/components/clients/`
- [ ] T082 [P] [US3] Build client detail with paginated history and receivable totals in `src/app/(app)/clients/[id]/page.tsx`
- [ ] T083 [US3] Upgrade the editor client picker for paginated search, archived exclusion and snapshot-safe autofill in `src/components/documents/editor/client-picker.tsx`
- [ ] T084 [US3] Add the create/search/invoice/edit/archive snapshot E2E flow with axe and responsive checks in `tests/e2e/clients.spec.ts`

**Checkpoint**: US3 es verificable sobre US1 sin modificar documentos emitidos.

---

## Phase 6: User Story 4 - Reutilizar servicios y conceptos habituales (Priority: P4)

**Goal**: catálogo paginado con archivado reversible y copia desacoplada de descripción/precio/impuesto en líneas.

**Independent Test**: quickstart V4: crear conceptos, añadir uno al documento, editar la línea y archivar el concepto sin cambiar documentos.

### Tests for User Story 4

- [ ] T085 [P] [US4] Write catalog contract tests for cursor pagination, search, create/edit, archive/restore, selector exclusion and foreign-item 404 responses in `tests/integration/catalog-contract.test.ts`
- [ ] T086 [P] [US4] Write the catalog-to-line decoupling integration test across edit/archive in `tests/integration/catalog-snapshot.test.ts`

### Implementation for User Story 4

- [ ] T087 [US4] Implement cursor-paginated catalog GET/search, POST, PATCH, reversible archive via DELETE and restore action in `src/app/api/v1/catalog-items/route.ts`, `src/app/api/v1/catalog-items/[id]/route.ts` and `src/app/api/v1/catalog-items/[id]/restore/route.ts`
- [ ] T088 [P] [US4] Build paginated catalog search and create/edit/archive/restore UI in `src/app/(app)/catalog/page.tsx` and `src/components/catalog/`
- [ ] T089 [US4] Add a paginated catalog picker that copies editable values without a document-line foreign key in `src/components/documents/editor/catalog-picker.tsx`
- [ ] T090 [US4] Add the catalog copy/edit/archive/selector-exclusion/restore invariance E2E flow with axe in `tests/e2e/catalog.spec.ts`

**Checkpoint**: US4 acelera la facturación sin acoplar documentos al catálogo.

---

## Phase 7: User Story 5 - Compartir el documento por enlace o email (Priority: P5)

**Goal**: enlace público revocable y no adivinable, PDF público asíncrono y email de plan pro idempotente con historial.

**Independent Test**: quickstart V5 y V10: enlace en primer intento móvil/escritorio, 404 al desactivar, documento anulado visible, plan free con alternativas y varias reentregas que producen un correo/evento.

### Tests for User Story 5

- [ ] T091 [P] [US5] Write failing unit tests for 32-byte base64url share tokens, one-active-link rules and disable/reactivate transitions in `tests/unit/share-links.test.ts`
- [ ] T092 [P] [US5] Write share/public/email contract tests for tokens, PDF 200/202, required idempotency key, paginated delivery history and foreign-document/delivery 404 responses in `tests/integration/share-email-contract.test.ts`
- [ ] T093 [P] [US5] Write integration tests for valid/disabled/invented/voided public access and free/pro email gating in `tests/integration/share-email.test.ts`
- [ ] T094 [P] [US5] Write the at-least-once email integration test proving duplicate API/queue delivery within 24 hours yields one provider call and one event in `tests/integration/email-idempotency.test.ts`
- [ ] T095 [P] [US5] Write security tests proving public/email logs and queue bodies exclude tokens, NIF, amounts, recipients and messages in `tests/integration/log-redaction.test.ts`

### Implementation for User Story 5

- [ ] T096 [US5] Implement CSPRNG share-link creation/reactivation/disable and append-only events after T091 fails in `src/services/share-links.ts` and `src/app/api/v1/documents/[id]/share-link/route.ts`
- [ ] T097 [P] [US5] Build the responsive SSR public document page with generic 404 and clear void status in `src/app/d/[token]/page.tsx`
- [ ] T098 [P] [US5] Implement public PDF download as R2-only 200 or pending 202 + `Retry-After` with no HTTP render in `src/app/d/[token]/pdf/route.ts`
- [ ] T099 [US5] Implement atomic create/reuse/claim/terminal transitions for `email_delivery` in `src/services/email/deliveries.ts`
- [ ] T100 [US5] Implement the plan-gated email endpoint requiring `Idempotency-Key`, persisting delivery before enqueue and returning 202 in `src/app/api/v1/documents/[id]/email/route.ts`
- [ ] T101 [US5] Implement the email delivery-history endpoint with cursor pagination and redacted recipients in `src/app/api/v1/documents/[id]/email-deliveries/route.ts`
- [ ] T102 [US5] Extend the purpose-aware Resend consumer with document templates, atomic claims, `email/{delivery_id}`, retry age <24 hours, document-only unique events and DLQ in `src/services/email/templates/document.ts` and `src/workers/handlers/email-send.ts`
- [ ] T103 [US5] Implement the scheduled purge of terminal document/auth delivery recipient/message PII and expired auth references within their retention limits in `src/workers/scheduled.ts`
- [ ] T104 [P] [US5] Build document sharing UI for copy/disable link, PDF processing, email, delivery history and free-plan alternatives in `src/components/documents/share-panel.tsx`
- [ ] T105 [US5] Add first-attempt anonymous mobile/desktop link, PDF processing/download, disable and void-state E2E coverage with axe in `tests/e2e/share-link.spec.ts`
- [ ] T106 [US5] Add free/pro email UI and repeated-submit idempotency E2E coverage in `tests/e2e/email-sharing.spec.ts`
- [ ] T107 [US5] Configure and validate `/d/*` rate limiting without token logging in `wrangler.jsonc` and `tests/integration/public-rate-limit.test.ts`

**Checkpoint**: US5 entrega documentos sin sesión y resiste reintentos sin duplicar correos.

---

## Phase 8: User Story 6 - Crear proformas y recibos, y convertir proformas en facturas (Priority: P6)

**Goal**: proformas con serie/PDF propio, conversión única a factura, recibos emitidos únicos por pago y duplicado de facturas/proformas a borrador.

**Independent Test**: quickstart V6: proforma emitida y marcada, conversión vinculada y numerada, editor sin recibo manual, recibo emitido desde un pago parcial y repetición idempotente sin nuevo número.

### Tests for User Story 6

- [ ] T108 [P] [US6] Write failing unit tests for one-time issued-proforma conversion, inherited copies, numberless invoice drafts, direct-issue delegation and existing-conversion idempotency in `tests/unit/document-conversion.test.ts`
- [ ] T109 [P] [US6] Write failing unit tests for direct issued-receipt generation from total/partial payment, exact copied total, zero fiscal base/tax/retention, one-receipt-per-payment and existing-receipt resolution before new-emission quota evaluation in `tests/unit/receipts.test.ts`
- [ ] T110 [P] [US6] Write conversion/receipt/duplicate contract tests including manual receipt rejection, 402 without side effects for new direct emissions at 5/100, existing conversion/receipt 200 after quota exhaustion, invoice/proforma-only duplication and foreign-resource 404 responses in `tests/integration/document-variants-contract.test.ts`
- [ ] T111 [P] [US6] Write the concurrent conversion integration test proving at most one linked invoice and no quota overflow or numbering side effects at the final monthly slot in `tests/integration/proforma-conversion.test.ts`
- [ ] T112 [P] [US6] Write the concurrent mixed-route integration test proving conventional issue, direct conversion and new receipt share the final monthly slot, while receipt replays return the existing document without another number/PDF/event or quota consumption, in `tests/integration/receipt.test.ts`

### Implementation for User Story 6

- [ ] T113 [US6] Add default proforma/receipt series while exposing only invoice/proforma in the generic editor selector in `src/services/series.ts` and `src/components/documents/editor/document-type-selector.tsx`
- [ ] T114 [US6] Implement pure conversion rules and the idempotent proforma-to-invoice endpoint after T108 fails, routing `{issue:true}` through the T053 shared issuance guard and resolving an existing conversion before quota evaluation, in `src/lib/documents/conversion.ts` and `src/app/api/v1/documents/[id]/convert/route.ts`
- [ ] T115 [US6] Implement direct-issued receipt generation after T109 fails by resolving the unique payment claim before quota evaluation and routing every new receipt through the T053 shared issuance guard for company/series locks, snapshots, exact payment total, zero fiscal base/tax/retention, pending PDF and audit in `src/lib/documents/receipts.ts` and `src/app/api/v1/documents/[id]/receipt/route.ts`
- [ ] T116 [US6] Implement invoice/proforma duplication to a numberless draft with new dates and audit event while rejecting receipts in `src/app/api/v1/documents/[id]/duplicate/route.ts`
- [ ] T117 [US6] Extend PDF rendering and snapshots for proforma notices and receipt-specific payment/date/invoice layout without fiscal lines in `src/services/pdf/template.ts` and `tests/fixtures/pdf/`
- [ ] T118 [P] [US6] Add conversion, duplication and receipt actions with shared async and actionable plan-limit feedback to document detail in `src/components/documents/document-actions.tsx`
- [ ] T119 [US6] Add the proforma→invoice→partial-payment→unique-receipt E2E flow with direct-emission plan gating, existing-result idempotency after exhaustion, duplication rejection, numbering, linkage, PDF snapshots and axe in `tests/e2e/proforma-receipt.spec.ts`

**Checkpoint**: las seis historias entregan el ciclo factura/proforma/cobro/recibo definido para v1.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: observabilidad, rendimiento global, seguridad operativa, coste y validación final.

- [ ] T120 [P] Create deterministic demo data for `free=5|pro=100` plan usage boundaries across invoices, proformas and receipts, clients, catalog, document/payment states and queues in `src/db/seed.ts`
- [ ] T121 [P] Run the final Sentry/request-id and `logSafe` sweep across every implemented handler in `src/proxies/middleware.ts`, `src/lib/sentry.ts` and `src/lib/log.ts`
- [ ] T122 [P] Reverify Neon TLS/encryption, R2 private encryption/HTTPS and CI branch expiry before production release in `docs/security/storage-encryption.md`
- [ ] T123 [P] Reverify the real Cloudflare budget alert plus Neon Free monitoring/paid Spending Limit gate and recipients before production release in `docs/operations/cloud-cost-controls.md`
- [ ] T124 Add a non-decreasing business-module coverage gate to `.github/workflows/ci.yml` and `vitest.config.ts`
- [ ] T125 Add a final API-invariants matrix proving every collection uses opaque cursor pagination default 25/max 100 and every private endpoint returns 404 for foreign resources in `tests/integration/api-invariants.test.ts`
- [ ] T126 Run the all-page axe, responsive and delayed-network <100 ms feedback sweep and fix violations in `tests/e2e/accessibility-feedback.spec.ts` and `src/components/`
- [ ] T127 Implement reproducible staging CRUD p95 <300 ms and documented dataset/load profiles in `tests/performance/api-crud.test.ts` and `tests/performance/fixtures/`
- [ ] T128 Add the controlled staging performance job and threshold reports to `.github/workflows/performance.yml`
- [ ] T129 Reverify OpenNext deploy, migrations, queues, R2, pre-deploy evidence and post-deploy mobile/Sentry smoke flow for production in `scripts/verify-postdeploy.ts` and `docs/operations/deployment-checklist.md`
- [ ] T130 Run the moderated V13 protocol with at least 10 first-time target users, anonymizing completion time, autonomous success and abandonment data in `specs/001-invoice-flash/usability-report.md`
- [ ] T131 Run quickstart V1–V13 and all `lint`, `typecheck`, unit, integration, E2E, performance and audit gates, recording usability results, approved PR reference, required check names and non-sensitive result in `specs/001-invoice-flash/validation-report.md`

---

## Dependencies & Execution Order

### Dependency Graph

```text
Setup (T001–T007)
  └─▶ Foundational (T008–T035)
        └─▶ US1 / MVP (T036–T065)
              ├─▶ US2 (T066–T075) ─┐
              ├─▶ US3 (T076–T084)  │
              ├─▶ US4 (T085–T090)  ├─▶ Polish (T120–T131)
              └─▶ US5 (T091–T107)  │
                    US2 + US1 ──────┴─▶ US6 (T108–T119)
```

### Phase Dependencies

- **Setup**: T002, T003 y T005 ya se revalidaron sobre el scaffold existente y no dependen de los elementos restantes de T001; T004 se serializa con T002 porque comparten `package.json`; T006–T007 esperan los entregables pendientes de T001.
- **Foundational**: depende de Setup y bloquea todas las historias.
- **US1**: depende solo de Foundational; es el MVP.
- **US2**: su código puede prepararse tras Foundational, pero su validación independiente requiere facturas emitidas de US1.
- **US3**: depende de US1 porque amplía la ruta mínima de clientes y el editor.
- **US4**: depende de US1 porque se integra en el editor de documentos.
- **US5**: depende de US1 porque comparte documentos emitidos, PDF y detalle.
- **US6**: depende de US1 —incluida la guarda de emisión T053— y de pagos US2 para generar recibos.
- **Polish**: depende de todas las historias incluidas en la entrega.

### Within Each User Story

- Escribir primero las pruebas marcadas en la historia y comprobar que fallan.
- Lógica pura antes de servicios; servicios antes de endpoints; endpoints antes de UI/E2E.
- Migraciones y modelos preceden a cualquier consulta.
- No ejecutar tareas con el mismo fichero en paralelo; toda vía que cree un documento emitido reutiliza T053 y respeta el orden de locks `company → document_series`.
- Cada checkpoint exige sus pruebas unitarias, integración y E2E en verde.

### Parallel Opportunities

- Setup: T002/T003/T005 ya están revalidadas; completar T001 antes de T006–T007; ejecutar T004 después de T002 por `package.json`.
- Foundational: T010–T018; T023/T025/T029; infraestructura T027–T028 cuando sus contratos estén definidos; T033–T034 después de T009/T017/T027; T035 después de T006/T022/T028.
- US1: T036–T043; T044–T046; T058–T059; T061–T062.
- US2: T066–T068; T073–T074.
- US3: T076–T078; T081–T082.
- US4: T085–T086; T088 con trabajo API ya disponible.
- US5: T091–T095; T097–T098; T104 mientras se estabilizan consumidores.
- US6: T108–T112; T118 después de los endpoints.
- Polish: T120–T123; T130 después de disponer de un entorno release candidate estable.

## Parallel Examples by User Story

### User Story 1

```text
Task: T036 billing unit tests
Task: T037 numbering/year unit tests
Task: T038 lifecycle/snapshot unit tests
Task: T039 PDF layout/snapshot tests
Task: T040–T043 independent integration/contract suites
```

### User Story 2

```text
Task: T066 payment derivation unit tests
Task: T067 payment/dashboard contract tests
Task: T068 payment lifecycle integration tests
```

### User Story 3

```text
Task: T076 client contract tests
Task: T077 snapshot integration tests
Task: T078 client-search performance scenario
```

### User Story 4

```text
Task: T085 catalog contract tests
Task: T086 catalog decoupling integration test
```

### User Story 5

```text
Task: T091 share-link unit tests
Task: T092–T095 contract, integration, idempotency and redaction suites
```

### User Story 6

```text
Task: T108 conversion unit tests
Task: T109 receipt unit tests
Task: T110–T112 contract and integration suites
```

---

## Implementation Strategy

### MVP First

1. Completar Setup T001–T007.
2. Completar Foundational T008–T035, incluido `verify:predeploy`.
3. Completar US1 T036–T065.
4. Validar quickstart V1, V7, V8, V9 (PDF) y V12.
5. Desplegar solo si T035 está en verde y ejecutar inmediatamente `verify:postdeploy`: empresa → factura correlativa → PDF asíncrono profesional → error de prueba visible en Sentry.

### Incremental Delivery

1. Setup + Foundational → base segura y testeable.
2. US1 → MVP de facturación/PDF.
3. US2 → control de cobros.
4. US3 y US4, en paralelo si hay capacidad → clientes y catálogo.
5. US5 → enlace y email idempotente.
6. US6, después de US2 → proformas y recibos derivados.
7. Polish → rendimiento, seguridad/costes, V13 moderado y validación completa.

### Parallel Team Strategy

Tras US1, un equipo puede ejecutar US2, US3, US4 y US5 en paralelo en ramas separadas; US6 espera a los contratos de pagos de US2. Las tareas que comparten `src/app/api/v1/documents/route.ts`, `src/services/pdf/template.ts`, `wrangler.jsonc` o el detalle de documento deben serializarse.

---

## Notes

- Todas las tareas se regeneran sin estado previo; marcar `[X]` solo después de revalidar el fichero y sus puertas.
- `[P]` significa ficheros distintos y dependencias satisfechas, no ausencia total de coordinación.
- Las pruebas se escriben antes de la implementación correspondiente y deben fallar por la razón esperada.
- PDF y cualquier email —documental o de autenticación— nunca se ejecutan dentro de una petición HTTP.
- Colecciones siempre paginadas; estados de cobro siempre derivados; datos siempre filtrados por `company_id`.
- Los límites de plan se leen solo de `src/lib/plan.ts`: free=5, pro=100, mes `Europe/Madrid`, anulados emitidos incluidos; toda nueva emisión pasa por `src/services/document-issuance.ts` y las repeticiones idempotentes se resuelven antes del cupo.
- Commit tras cada tarea o grupo lógico con mensaje en inglés; PR aprobado, protección de `main` y CI verde obligatorios antes de fusionar.
