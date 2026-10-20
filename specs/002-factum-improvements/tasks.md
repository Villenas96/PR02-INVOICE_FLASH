# Tasks: Factum — Mejoras de producto v2

**Input**: Design documents from `/specs/002-factum-improvements/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: INCLUIDOS — la constitución exige pruebas unitarias para toda lógica de negocio nueva e integración para los flujos críticos (facturación, importes, estados, cupo, suscripción, permisos); la spec define criterios verificables (SC-001…SC-013) y la quickstart escenarios V1–V15.

**Organization**: tareas agrupadas por historia (US1–US15) en el orden de prioridad de la spec y en los **5 incrementos** de plan.md. Cada incremento empieza con un bloque fundacional propio (esquema y lógica compartida) para que pueda desplegarse sin los siguientes. Código, identificadores y commits en inglés; UI y textos de producto en español.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede ejecutarse en paralelo (ficheros distintos, sin dependencia de tareas incompletas del mismo grupo).
- **[Story]**: historia a la que pertenece (US1…US15); no se usa en Setup, bloques fundacionales ni Polish.
- Todas las tareas incluyen rutas exactas. «Modify» indica fichero existente de la v1; leerlo antes de cambiarlo.

## Path Conventions

Proyecto único Next.js en la raíz: `src/app/` (App Router, `api/v1`, webhooks, MCP), `src/db/schema/` (una tabla por fichero) y `src/db/migrations/` (drizzle-kit + `.down.sql` manual), `src/lib/` (lógica pura), `src/services/` (I/O), `src/workers/` (colas y cron), `tests/{unit,integration,e2e,performance,fixtures}/`.

## Reglas transversales (aplican a todas las tareas)

- Toda nueva vía que cree un documento emitido pasa por `src/services/document-issuance.ts` con orden de locks `company → document_series`; las repeticiones idempotentes se resuelven antes del cupo.
- Límites y funciones de plan se leen **solo** de `src/lib/plan.ts`; el servidor comprueba con `requireFeature` (nunca solo la UI).
- Toda ruta declara acceso `read` o `write` en `resolveCompanyContext`; recurso ajeno → `404`.
- Colecciones paginadas por cursor (25/100). Importes en céntimos. Estados de cobro, de presupuesto, de albarán y de movimiento bancario **derivados en consulta**.
- PDF, email, exportaciones, importaciones, recurrencias y recordatorios **solo en colas**; consumidores idempotentes.
- IBAN, conceptos bancarios, NIF, emails, tokens e importes nunca en logs, errores ni mensajes de cola.
- Cada migración lleva su `.down.sql`. Drizzle aplica todas las migraciones pendientes en una sola transacción: ninguna migración puede usar (literal, `UPDATE`, `DEFAULT`, `CHECK`, índice parcial) un valor añadido con `ADD VALUE`; si hace falta, se recrea el tipo como superconjunto (ver data-model, «Regla de enums»).
- Toda mutación de UI usa el hook de T014 (refresco sin recarga). Toda pantalla nueva pasa axe y es usable en móvil y escritorio.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencias, configuración de plataforma y fixtures que usan varios incrementos.

- [X] T001 Upgrade `better-auth` to `^1.7.11` (required peer of `@better-auth/oauth-provider` and `@better-auth/mcp`, so Increments 1–4 already run on it) with `pnpm add better-auth@^1.7.11` and run the existing auth tests; add runtime dependencies with `pnpm add stripe fflate papaparse @modelcontextprotocol/sdk` and `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, plus `pnpm add -D @types/papaparse`, keeping the existing `@modelcontextprotocol/sdk` override coherent in `package.json` and `pnpm-lock.yaml`
- [X] T002 [P] Add shadcn components with `pnpx shadcn add command popover chart tabs dropdown-menu checkbox select` into `src/components/ui/` and verify they use the existing tokens in `src/app/globals.css`
- [X] T003 Add the `invoice-flash-jobs` queue (producer binding `JOBS_QUEUE`, consumer with `max_retries: 3` and DLQ `invoice-flash-jobs-dlq`), the second cron `0 5 * * *`, and rate limiters `EXPORT_RATE_LIMITER` and `MCP_RATE_LIMITER` plus `limits.cpu_ms: 300000` (queue consumers build ZIP/XLSX exports and apply 5.000-row imports; the default CPU limit is too low), to the top level and to the `staging` and `production` environments in `wrangler.jsonc`, then regenerate `cloudflare-env.d.ts` with `pnpm cf-typegen`
- [X] T004 [P] Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `EMAIL_FROM` (replacing `RESEND_FROM_EMAIL`, format `Factum <no-reply@…>`), `EMAIL_REPLY_TO`, `APP_BASE_URL` and `PRO_CHECKOUT_ENABLED` (documented flag, `false` until Increment 3) placeholders to `.dev.vars.example`, and read them through a typed accessor in `src/lib/env.ts` that throws a clear Spanish error when a required value is missing
- [X] T005 [P] Extend `scripts/verify-predeploy.ts` with checks (no secret values printed) for the Stripe webhook secret, the jobs queue and DLQ, the `0 5 * * *` cron, the new rate limiters and a non-empty `billing_price` table, and document them in `docs/operations/predeploy.md`
- [X] T006 [P] Create test fixtures: `tests/fixtures/csv/catalog-500.csv` (UTF-8, `,`), `tests/fixtures/csv/catalog-latin1-semicolon.csv` (Latin-1, `;`, comma decimals, 8 invalid rows), `tests/fixtures/csv/catalog-5001.csv`, `tests/fixtures/bank/sample.n43` (20 movements, records 11/22/23/33/88), `tests/fixtures/bank/overlap.n43` and `tests/fixtures/bank/statement.csv`

---

## Phase 2: Foundational — Increment 1 (Blocking Prerequisites)

**Purpose**: planes con cupo por tipo, comprobación de funciones, contexto de acceso, refresco sin recarga y selector con búsqueda, que usan todas las historias.

**⚠️ CRITICAL**: ninguna historia empieza hasta completar esta fase.

### Tests (write first, must fail)

- [X] T007 [P] Rewrite plan unit tests for `basic`/`essential`/`pro`, per-type limits (5/100/1.000), the 80 % warning `ceil(limit*0.8)` per type, `hasFeature` against the FR-012 table and Madrid month bounds in `tests/unit/plan.test.ts`
- [X] T008 [P] Write unit tests for `effectivePlan` (active, past_due within/after grace, canceled, incomplete) and Stripe status mapping in `tests/unit/billing-plan.test.ts`
- [X] T009 [P] Write integration tests for per-type quota in the issuance guard: concurrent issues at the edge of the invoice quota while proformas still issue, rejected attempts consume no number/event/PDF, idempotent repeats skip quota, in `tests/integration/quota-per-type.test.ts`
- [X] T010 [P] Write unit tests for `useMutation` calling `router.refresh()` on success, not on error, and honouring `refresh: false` in `tests/unit/async-action.test.tsx`

### Implementation

- [X] T011 **Compat release (deployed alone, before the rest of Inc. 1)**: migration `0004_plan_tiers_expand` recreating the `plan` type as the superset `free, pro, basic, essential` (rename to `plan_old`, create, `ALTER COLUMN … USING plan::text::plan`, drop old, restore default; no `ADD VALUE`, because drizzle runs all pending migrations in one transaction and Postgres rejects using an added value in it; `.down.sql` recreates `free, pro`) in `src/db/schema/company.ts` and `src/db/migrations/0004_plan_tiers_expand.sql`, and make the v1 issuance guard (`src/services/document-issuance.ts`, `CASE locked_company.plan`) and `src/lib/plan.ts` treat `free|basic` with the v1 free limit and `pro|essential` with the v1 paid limit; integration test that both old and new values issue correctly and that a fresh database migrates `0000`→`0005` in a single run
- [X] T012 Create `subscription`, `plan_change`, `billing_event`, `billing_price` schemas, `company.ui_mode` and the `email_purpose` values used by T045, then migration `0005_billing` (first `UPDATE company SET plan='basic' WHERE plan='free'` and `plan='essential' WHERE plan='pro'`, then the tables and one `plan_change` row with reason `migration` per company; `.down.sql` reverses the data mapping) — applied only after T011 is live in production, in `src/db/schema/subscription.ts`, `src/db/schema/plan-change.ts`, `src/db/schema/billing-event.ts`, `src/db/schema/billing-price.ts`, `src/db/schema/company.ts`, `src/db/schema/index.ts` and `src/db/migrations/0005_billing.sql`
- [X] T013 Rewrite `src/lib/plan.ts` with plans `basic`/`essential`/`pro`, per-document-type limits, technical cap 1.000 for Pro, typed `Feature` keys from FR-012 (`email`, `period_export`, `advanced_export`, `document_xlsx`, `advisor_schedule`, `advisor_access`, `catalog_import`, `recurring`, `reminders`, `bank_reconciliation`, `dashboard_full`, `ai_assistant`, `full_ui`), `hasFeature`, `usageFor(type)` and `defaultUiMode(plan)`
- [X] T014 Add a `useMutation` hook to `src/components/ui/async-action.tsx` that wraps the existing async action state and calls `router.refresh()` after success unless `{ refresh: false }`, and migrate every existing client mutation in `src/components/**` to it (fixes mejoras 3 and 7 at the root)
- [X] T015 Create `src/lib/billing-plan.ts` with `effectivePlan(subscription, now)`, grace handling and Stripe status → local status mapping
- [X] T016 Modify the atomic issuance statement in `src/services/document-issuance.ts` to count `issued|voided` documents of the **same `document_type`** in the Madrid month and compare against the `(plan, type)` limit injected from `src/lib/plan.ts`; extend `plan_limit_reached` with `{document_type, limit, used, upgrade_url}`; keep the `company → document_series` lock order
- [X] T017 Create `src/services/entitlements.ts` with `requireFeature(context, feature)` throwing `ApiError('feature_not_in_plan', 403, …, {feature, required_plan})`, and register the new code in `src/lib/api/errors.ts`
- [X] T018 Modify `src/services/context.ts` so `resolveCompanyContext(request, { access: 'read' | 'write' })` returns `{companyId, userId, role: 'owner', plan}` and update every existing route in `src/app/api/v1/**/route.ts` to declare its access level (owner-only for now; advisor resolution arrives in T126)
- [X] T019 [P] Create the accessible `Combobox` (remote mode with 250 ms debounce and cursor pagination, local mode for short lists, value is the selected object, ARIA combobox keyboard pattern, "Crear «…»" option) in `src/components/ui/combobox.tsx` with tests in `tests/unit/combobox.test.tsx`
- [X] T020 [P] Create `src/components/plan/feature-upsell.tsx` (brief explanation of the feature, required plan, "Mejorar" CTA to `/billing`) and a client helper in `src/lib/api/client.ts` that maps `feature_not_in_plan` and `plan_limit_reached` to upsell UI instead of an error toast
- [X] T021 Modify `GET /api/v1/company` to return `plan`, `usage[]` per type, `features[]`, `ui_mode`, `effective_ui`, `used_document_types` and `missing_to_issue[]` in `src/app/api/v1/company/route.ts`, and update its contract test in `tests/integration/api-invariants.test.ts`
- [X] T022 Update every existing test that assumed `free`/`pro` or a single monthly quota (`tests/integration/document-issue.test.ts`, `tests/integration/receipt.test.ts`, `tests/integration/proforma-conversion.test.ts`, `tests/integration/share-email.test.ts`, `src/db/seed.ts`) to the new plans and per-type quotas

**Checkpoint**: `pnpm test`, `pnpm test:integration` y `pnpm typecheck` en verde con los planes nuevos; la v1 sigue funcionando con `basic`/`essential`.

---

## Phase 3: User Story 1 - Correcciones de fluidez detectadas en el uso real (Priority: P1) 🎯 MVP

**Goal**: banner y contador se actualizan sin recargar, el editor muestra el cliente por nombre, el PDF no muestra «Sin notas» ni el email del cliente y todos los correos salen como Factum.

**Independent Test**: cuenta nueva → guardar datos fiscales, crear borrador con cliente, emitir y enviar por email sin recargar nunca (quickstart V1).

### Tests for User Story 1

- [X] T023 [P] [US1] Write E2E tests without page reloads for: banner disappears after saving fiscal data, counter goes from "0 de 5" to "1 de 5" after issuing, the selected client shows name and NIF (also after reopening the draft), in `tests/e2e/fluency-fixes.spec.ts`
- [X] T024 [P] [US1] Update PDF template tests: no notes block when notes are empty, no client email anywhere, in `tests/unit/pdf-template.test.ts` and the approved layout in `tests/fixtures/pdf/invoice-layout.approved.json`
- [X] T025 [P] [US1] Write a unit test that renders every email template (document, verify, reset) and fails if the output contains "Invoice Flash" or the sender is not `EMAIL_FROM`, in `tests/unit/email-branding.test.ts`

### Implementation for User Story 1

- [X] T026 [US1] Remove the "Notas … Sin notas." fallback and render the notes block only when notes are non-empty, and stop printing the client email in `src/services/pdf/template.ts` and in the public view `src/app/d/[token]/page.tsx`
- [X] T027 [P] [US1] Create the shared Factum email layout in `src/services/email/templates/layout.ts` and refactor `src/services/email/templates/document.ts` and `src/services/email/templates/auth.ts` to use it, replacing every "Invoice Flash" text and subject
- [X] T028 [US1] Use `EMAIL_FROM` as sender and the company email as `Reply-To` for document emails in the Resend call of `src/workers/handlers/email-send.ts`, and set `appName: "Factum"` in `src/lib/auth.ts`
- [X] T029 [US1] Replace the `<select>` in `src/components/documents/editor/client-picker.tsx` with the `Combobox` (remote mode over `/api/v1/clients`), keep the selected client object in editor state, and show name + NIF; keep the inline client creation dialog
- [X] T030 [US1] Return `client_display {name, tax_id}` from `GET /api/v1/documents/:id` and from each row of `GET /api/v1/documents` in `src/services/documents.ts`, and initialize the editor selection from it in `src/components/documents/editor/invoice-editor.tsx` and `src/components/documents/document-list.tsx` (FR-004)
- [X] T031 [US1] Verify the layout banner and counter re-render after `router.refresh()` by moving their data loading into a cached server helper `src/services/layout-data.ts` used by `src/app/(app)/layout.tsx`, and confirm the company settings form and issue action use `useMutation` in `src/components/settings/company-settings.tsx` and `src/components/documents/editor/issue-action.tsx`

**Checkpoint**: V1 de la quickstart completa; SC-001 verificado por T023–T025.

---

## Phase 4: User Story 2 - Elegir plan, mejorar y gestionar la suscripción (Priority: P1)

**Goal**: página de planes, contadores por tipo con aviso del 80 %, contratación con Stripe, continuación de la emisión bloqueada, autogestión en el Customer Portal, gracia de 7 días y bajada a Básico sin perder datos.

**Independent Test**: Básico → agotar 5 facturas → contratar Esencial desde la invitación → emitir la factura bloqueada sin rehacerla → Portal: pasar a Pro y cancelar (quickstart V2).

### Tests for User Story 2

- [ ] T032 [P] [US2] Write integration tests for the Stripe webhook: invalid signature → 400, duplicated event → single effect, out-of-order `customer.subscription.updated` resolved by re-reading the subscription, `plan_change` written once per effective change, using a mocked Stripe client, in `tests/integration/billing-webhook.test.ts`
- [ ] T033 [P] [US2] Write integration tests for grace handling with injected clock: `invoice.payment_failed` sets `grace_until`, day-5 notice, downgrade to `basic` after expiry, paid invoice clears grace, no data deleted, in `tests/integration/billing-grace.test.ts`
- [ ] T034 [P] [US2] Write contract tests for `/api/v1/billing/plans`, `/billing/subscription`, `/billing/checkout` (Idempotency-Key, owner only) and `/billing/portal` in `tests/integration/billing-contract.test.ts`
- [ ] T035 [P] [US2] Write an E2E test (Stripe test mode, `4242…` card) for limit reached → upgrade → blocked invoice issued without redoing it, and abandoned checkout keeps the draft unnumbered, in `tests/e2e/upgrade-flow.spec.ts`

### Implementation for User Story 2

- [ ] T036 [P] [US2] Create the Stripe client factory with `Stripe.createFetchHttpClient()` and `constructEventAsync` helpers in `src/services/billing/stripe.ts`
- [ ] T037 [US2] Implement `reconcileSubscription(companyId | stripeCustomerId)` that re-reads the subscription from Stripe, updates `subscription`, writes `company.plan = effectivePlan(...)` and inserts `plan_change` with reason in one transaction, in `src/services/billing/reconcile.ts`
- [ ] T038 [US2] Implement the webhook route verifying `Stripe-Signature`, inserting `billing_event` (unique `stripe_event_id`, duplicate → 200), dispatching `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed` to `reconcileSubscription` and `price.*`/`product.*` to price sync, without logging payloads, in `src/app/api/webhooks/stripe/route.ts` and `src/services/billing/prices.ts`
- [ ] T039 [US2] Implement checkout (create/reuse Stripe customer, `lookup_key` price, `billing_address_collection: 'required'`, `tax_id_collection: { enabled: true }` with a Spanish NIF required before paying, prices tax-inclusive with the IVA 21 % Stripe tax rate so subscription invoices are valid Spanish invoices, `success_url=/billing/return?session_id={CHECKOUT_SESSION_ID}&resume=<id>`, existing subscription → Portal plan-change flow; Pro `lookup_key` rejected with `403 plan_not_available` while `PRO_CHECKOUT_ENABLED` is off, and the Portal configuration offers Pro only once enabled) and portal session endpoints in `src/services/billing/checkout.ts`, `src/app/api/v1/billing/checkout/route.ts` and `src/app/api/v1/billing/portal/route.ts`
- [ ] T040 [P] [US2] Implement `GET /api/v1/billing/plans` (prices from `billing_price`, limits and features from `src/lib/plan.ts`, current plan flag) and `GET /api/v1/billing/subscription` in `src/app/api/v1/billing/plans/route.ts` and `src/app/api/v1/billing/subscription/route.ts`
- [ ] T041 [US2] Implement the Checkout return page that calls `reconcileSubscription` from the Checkout session, and when `resume` is an own draft retries the issue and redirects to the document, showing progress feedback, in `src/app/(app)/billing/return/page.tsx`
- [ ] T042 [US2] Build the plans page with the three-plan comparison, monthly/annual toggle, per-type limits, features and current plan marker (Pro shown as «Próximamente» without purchase button while `PRO_CHECKOUT_ENABLED` is off), in `src/app/(app)/billing/page.tsx` and `src/components/plan/plan-comparison.tsx`
- [ ] T043 [US2] Rewrite `src/components/plan/plan-indicator.tsx` to show plan name and per-type usage (invoices first, other types collapsed), the non-blocking 80 % warning with "Mejorar", and the limit-reached state; wire the issue action's `plan_limit_reached` to an upgrade dialog that keeps the draft in `src/components/documents/editor/issue-action.tsx`
- [ ] T044 [US2] Add the grace step to the daily planner (day-5 notice, downgrade on expiry via `reconcileSubscription`, and cancel the Stripe subscription through the API on expiry so Stripe stops retrying the charge after the local downgrade) as `billing.grace` messages in `src/workers/scheduled.ts`, `src/workers/messages.ts` and `src/workers/handlers/billing-grace.ts`
- [ ] T045 [US2] Add `billing_notice` email purpose templates (payment failed, grace ending, downgraded, plan activated) in `src/services/email/templates/billing.ts` and extend the `email_purpose` enum in the same migration as T012
- [ ] T046 [US2] Add "Suscripción" section (current plan, period end, "Gestionar suscripción" → Portal, "Mejorar") to settings in `src/components/settings/subscription-settings.tsx` and `src/components/settings/settings-panel.tsx`

**Checkpoint**: V2 completa con Stripe CLI y test clocks; SC-002 < 3 min.

---

## Phase 5: User Story 3 - Interfaz sencilla para quien solo quiere facturar (Priority: P1)

**Goal**: Básico/Esencial con navegación reducida, pantalla principal de facturas con resumen y «Nueva factura», funciones Pro ocultas con explicación al acceder; Pro con interfaz completa y opción sencilla con menú «Más».

**Independent Test**: Básico → navegación reducida y emisión con cliente y producto nuevos sin salir del editor; Pro → interfaz completa y cambio a sencilla (quickstart V3).

### Tests for User Story 3

- [ ] T047 [P] [US3] Write unit tests for `buildNavigation(plan, uiMode, usedTypes)` covering every plan, `ui_mode` null/simple/full, "Más" menu in Pro simple and types appearing after first use, in `tests/unit/navigation.test.ts`
- [ ] T048 [P] [US3] Write E2E tests for simple UI in Basic and Essential, upsell page on direct access to a Pro route, Pro switching to simple with "Más", and downgrade showing simple UI, in `tests/e2e/simple-ui.spec.ts`

### Implementation for User Story 3

- [ ] T049 [P] [US3] Create `src/lib/navigation.ts` with `buildNavigation` returning primary items, "Nuevo ▾" types, "Más" items and the "Mejorar a Pro" entry
- [X] T050 [US3] Allow `ui_mode` in `PUT /api/v1/company` (`full` requires feature `full_ui`, else `403 feature_not_in_plan`) in `src/app/api/v1/company/route.ts` and its Zod schema
- [ ] T051 [US3] Render navigation from `buildNavigation` in `src/app/(app)/layout.tsx` via a new `src/components/navigation/app-nav.tsx` (primary items, "Nuevo ▾" dropdown, "Más" menu, "Mejorar a Pro")
- [ ] T052 [US3] Make the simple-UI home the invoice list with prominent "Nueva factura" and the paid/pending/overdue summary from `GET /api/v1/dashboard`, in `src/app/(app)/dashboard/page.tsx` and `src/components/dashboard/simple-home.tsx`
- [ ] T053 [US3] Create a `ProRoute` server wrapper that renders `FeatureUpsell` instead of the page when the feature is missing, in `src/components/plan/pro-route.tsx`, to be used by every Pro page added later
- [ ] T054 [US3] Group settings in a single page with sections for simple UI and tabs for full UI, and add the "Interfaz sencilla" toggle for Pro, in `src/components/settings/settings-panel.tsx` and `src/app/(app)/settings/page.tsx`
- [ ] T055 [US3] Replace `src/components/documents/editor/catalog-picker.tsx` with a remote `Combobox` whose "Crear «…»" option opens an inline product dialog (description, price, VAT rate) that creates the catalog item and fills the line by value without leaving the editor; add the E2E step creating client and product without leaving the editor to `tests/e2e/simple-ui.spec.ts`

**Checkpoint**: Incremento 1 completo (V1–V3). Desplegable. Usabilidad SC-004 programada en Polish.

---

## Phase 6: Foundational — Increment 2

**Purpose**: esquema de cobros, impuestos, unidades, series archivables y logotipos que comparten US4–US6.

- [ ] T056 Create `collection_method`, `tax_rate`, `measurement_unit` schemas and new columns (`document.collection_method_id`, `document.collection_method_snapshot`, `document_line.unit`, `document_line.tax_rate_id`, `document_line.tax_name`, `document_line.catalog_item_id`, `catalog_item.unit`, `catalog_item.tax_rate_id`, `document_series.archived_at`), extend `document_event_type`, seed IVA 21/10/4/0 per company marking `default_tax_rate` as default, then drop `company.default_tax_rate`, as migration `0006_payment_tax_units` with `.down.sql`, in `src/db/schema/collection-method.ts`, `src/db/schema/tax-rate.ts`, `src/db/schema/measurement-unit.ts`, `src/db/schema/document.ts`, `src/db/schema/catalog-item.ts`, `src/db/schema/document-series.ts`, `src/db/schema/document-event.ts` and `src/db/migrations/0006_payment_tax_units.sql`
- [ ] T057 Create migration `0007_logos` adding `client.logo_key` and copying existing company logos to content-addressed keys `logos/{company_id}/{sha256}.{ext}` (data step in `scripts/migrate-logos.ts`, idempotent), with `.down.sql`, in `src/db/schema/client.ts` and `src/db/migrations/0007_logos.sql`
- [ ] T058 [P] Write unit tests for tax breakdown grouped by `(name, rate)` with 2-decimal rates (4,5 %, 0,5 %), half-up per line and totals exact to the cent, in `tests/unit/billing.test.ts`
- [ ] T059 Modify `src/lib/billing/index.ts` to group the breakdown by `(name, rate)` and include `name` in `tax_breakdown`; update callers in `src/services/documents.ts`, `src/services/document-issuance.ts` and `src/services/pdf/template.ts`
- [ ] T060 [P] Create `src/lib/units.ts` with the predefined units (unidad, hora, día, mes, kg, g, l, m, m², m³, km, servicio) and tests in `tests/unit/units.test.ts`
- [ ] T191 Purge orphan logos in the existing `0 3 * * *` purge: list `logos/{company_id}/` in R2 and delete keys older than 24 h that are not referenced by `company.logo_key`, `client.logo_key`, `document.issuer_snapshot->>'logo_key'` or `document.client_snapshot->>'logo_key'` (add expression indexes for both snapshot keys to migration `0007_logos`), in `src/services/storage-purge.ts` and `src/workers/scheduled.ts`, with tests (referenced key never deleted, recent upload never deleted) in `tests/integration/storage-purge.test.ts`

**Checkpoint**: migraciones 0006–0007 aplicadas y reversibles; tests de billing en verde.

---

## Phase 7: User Story 4 - Editor de documentos más ágil (Priority: P2)

**Goal**: selectores con búsqueda en todo el editor, producto al catálogo desde la línea, cambio de serie, editar/eliminar/duplicar desde listado y detalle, series automáticas e imprimir.

**Independent Test**: borrador con cliente y producto buscados por texto, producto nuevo desde una línea, cambio de serie, editar, duplicar, eliminar el duplicado, emitir e imprimir; primera proforma sin configurar series (quickstart V4).

### Tests for User Story 4

- [ ] T061 [P] [US4] Write unit tests for automatic series prefixes (`PRO-`, `REC-`, `PRE-`, `ALB-` + invoice prefix, empty invoice prefix, collision → `PRE2-…`) in `tests/unit/numbering.test.ts`
- [ ] T062 [P] [US4] Write integration tests for `ensureDefaultSeries` idempotency under concurrency, draft series change (same type, active only), `409 series_archived` on issue, and duplicate of every state/type with archived-data warnings, in `tests/integration/editor-improvements.test.ts`
- [ ] T063 [P] [US4] Write E2E tests for the full editor flow of the independent test plus SC-003 timing (< 90 s) in `tests/e2e/editor-agile.spec.ts`

### Implementation for User Story 4

- [ ] T064 [P] [US4] Add `autoSeriesPrefix(type, invoicePrefix, existingPrefixes)` to `src/lib/numbering/index.ts`
- [ ] T065 [US4] Implement `ensureDefaultSeries(companyId, type)` with `INSERT … ON CONFLICT DO NOTHING` in `src/services/series.ts`, call it from draft creation in `src/services/documents.ts` and return `series_created {prefix, renamed}` from `POST /api/v1/documents` in `src/app/api/v1/documents/route.ts`
- [ ] T066 [US4] Extend the product `Combobox` from T055 to link `catalog_item_id` on selection and creation, and add "Guardar en catálogo" for manual lines (creates the product with description, price, tax, unit and links `catalog_item_id`) in `src/components/documents/editor/invoice-lines.tsx`
- [ ] T067 [US4] Add a series `Combobox` (active series of the document type) to the editor and accept `series_id` in `PATCH /api/v1/documents/:id` (draft only, same type, not archived) in `src/components/documents/editor/invoice-editor.tsx`, `src/app/api/v1/documents/[id]/route.ts` and `src/services/documents.ts`
- [ ] T068 [US4] Reject issuing with an archived series with `409 series_archived` and an actionable message in `src/services/document-issuance.ts`; add `archived` to `PATCH /api/v1/series/:id` and the `archived` filter to `GET /api/v1/series` in `src/app/api/v1/series/[id]/route.ts`, `src/app/api/v1/series/route.ts` and `src/components/settings/series-settings.tsx`
- [ ] T069 [US4] Extend duplicate to invoices, proformas, quotes and delivery notes in any state with dates recalculated to today and `warnings[]` for archived client/product/tax, in `src/app/api/v1/documents/[id]/duplicate/route.ts` and `src/services/documents.ts`
- [ ] T070 [US4] Add row actions "Editar", "Duplicar" and "Eliminar" (drafts only, confirmation dialog) to `src/components/documents/document-list.tsx`, and the same actions plus "Imprimir" to `src/components/documents/document-actions.tsx`
- [ ] T071 [US4] Create the printable document view that renders the same data as the public view with print CSS and calls `window.print()` on load, in `src/app/(app)/documents/[id]/print/page.tsx` and `src/components/documents/printable-document.tsx`
- [ ] T072 [P] [US4] Use local-mode `Combobox` for tax rates and units on each editor line in `src/components/documents/editor/invoice-lines.tsx` (data from US5 endpoints; until then, fixed IVA list from the seeded `tax_rate`)

**Checkpoint**: V4 completa; SC-003 medido.

---

## Phase 8: User Story 5 - Configuración de cobro e impuestos propia (Priority: P2)

**Goal**: varios métodos de cobro con uno por defecto y elección por factura; tipos de impuesto propios con nombre y porcentaje congelados al emitir.

**Independent Test**: dos cuentas y un Bizum, IGI 4,5 %, factura con IGI y otra cuenta; editar el IGI no cambia la emitida (quickstart V5).

### Tests for User Story 5

- [ ] T073 [P] [US5] Write unit tests for IBAN normalization, per-country length and mod-97, BIC pattern, and error messages that never echo the value, in `tests/unit/iban.test.ts`
- [ ] T074 [P] [US5] Write contract tests for `/api/v1/collection-methods`, `/tax-rates` and `/units` (CRUD, single default, archive, `iban_invalid`, isolation 404) in `tests/integration/payment-tax-config-contract.test.ts`
- [ ] T075 [P] [US5] Write integration tests: issued invoice freezes `collection_method_snapshot`, `tax_name` and `tax_rate`; editing or archiving the tax or method later leaves the document unchanged; IBAN never appears in logs (extend `tests/integration/log-redaction.test.ts`), in `tests/integration/payment-tax-snapshot.test.ts`

### Implementation for User Story 5

- [ ] T076 [P] [US5] Create `src/lib/iban.ts` (normalize, validate IBAN ISO 13616 mod-97, validate BIC ISO 9362, format with spaces for display)
- [ ] T077 [P] [US5] Add an IBAN pattern redaction rule to `src/lib/log.ts`
- [ ] T078 [US5] Implement collection methods service and routes (kind-specific Zod, single default via partial unique index, archive/restore) in `src/services/collection-methods.ts`, `src/app/api/v1/collection-methods/route.ts` and `src/app/api/v1/collection-methods/[id]/route.ts`
- [ ] T079 [P] [US5] Implement tax rates service and routes (name ≤ 30, rate ≤ 2 decimals in [0,100), default, archive) in `src/services/tax-rates.ts`, `src/app/api/v1/tax-rates/route.ts` and `src/app/api/v1/tax-rates/[id]/route.ts`
- [ ] T080 [P] [US5] Implement units service and routes (predefined + custom, unique per company case-insensitive) in `src/services/units.ts`, `src/app/api/v1/units/route.ts`
- [ ] T081 [US5] Preselect the default collection method on draft creation, accept `collection_method_id` (or null) in draft PATCH, and freeze `collection_method_snapshot` plus per-line `tax_name`/`tax_rate` at issue, in `src/services/documents.ts` and `src/services/document-issuance.ts`
- [ ] T082 [US5] Build settings sections "Métodos de cobro" and "Impuestos" (forms, default marker, archive) in `src/components/settings/collection-method-settings.tsx`, `src/components/settings/tax-rate-settings.tsx` and `src/components/settings/settings-panel.tsx`
- [ ] T083 [US5] Add the collection method selector (local `Combobox`, "Ninguno" option) to the editor in `src/components/documents/editor/invoice-editor.tsx`, and switch line tax selection to `tax_rate_id` from `/api/v1/tax-rates` in `src/components/documents/editor/invoice-lines.tsx`
- [ ] T084 [US5] Add `unit` and `tax_rate_id` to catalog items (form, Zod, API) in `src/components/catalog/catalog-list.tsx`, `src/app/api/v1/catalog-items/route.ts` and `src/app/api/v1/catalog-items/[id]/route.ts`, proposing them when the product is added to a line

**Checkpoint**: V5 completa; importes exactos al céntimo con IGI 4,5 %.

---

## Phase 9: User Story 6 - Documento más profesional (Priority: P2)

**Goal**: logotipos de emisor y cliente, bloque de pago con vencimiento y datos de cobro, cuadro de observaciones y Excel por documento en Pro.

**Independent Test**: con ambos logotipos, cuenta por defecto y observaciones, revisar PDF y vista pública; en Pro descargar Excel con importes idénticos (quickstart V6).

### Tests for User Story 6

- [ ] T085 [P] [US6] Write PDF template tests for header logo scaled with preserved aspect ratio (including extreme ratios), client logo, payment block (due date, amount, holder/IBAN/BIC; Bizum/PayPal/other variants), unit printed next to the quantity on each line (nothing when the line has no unit), "Observaciones" box only when present, and update the approved layout, in `tests/unit/pdf-template.test.ts` and `tests/fixtures/pdf/invoice-layout.approved.json`
- [ ] T086 [P] [US6] Write unit tests for the per-document spreadsheet rows (issuer, client, number, dates, lines with unit, tax breakdown by name, retention, total taken from stored totals) in `tests/unit/document-xlsx.test.ts`
- [ ] T087 [P] [US6] Write integration tests: changing a logo after issuing does not change the issued snapshot key; `/documents/:id/xlsx` → 403 for Basic/Essential, 200 for Pro, totals equal the PDF data, in `tests/integration/document-design.test.ts`

### Implementation for User Story 6

- [ ] T088 [US6] Store logos with content-addressed keys and accept only PNG/JPEG ≤ 2 MB and ≤ 4.000 px in `src/app/api/v1/company/logo/route.ts` and `src/services/storage.ts`; create `PUT`/`DELETE /api/v1/clients/:id/logo` in `src/app/api/v1/clients/[id]/logo/route.ts`
- [ ] T089 [P] [US6] Rasterize SVG uploads to PNG (2× render size) in the browser before upload, with clear errors for unsupported files, in `src/components/settings/logo-settings.tsx` and a reusable `src/components/ui/logo-upload.tsx` used also in `src/components/clients/client-detail.tsx`
- [ ] T090 [US6] Freeze `logo_key` in issuer and client snapshots at issue in `src/lib/documents/index.ts` and `src/services/document-issuance.ts`
- [ ] T091 [US6] Render issuer logo in the header and client logo next to client data with `scaleToFit`, the line unit next to the quantity (FR-030), the payment footer block and the "Observaciones" box in `src/services/pdf/template.ts` and `src/services/pdf/render.ts` (load logo bytes from R2 in the PDF consumer `src/workers/handlers/pdf-render.ts`)
- [ ] T092 [US6] Mirror logos, line units, payment block and observations in the public view `src/app/d/[token]/page.tsx` and in `src/components/documents/printable-document.tsx`
- [ ] T093 [P] [US6] Create `src/lib/exports/document-sheet.ts` building rows from stored totals (no recalculation; cents → euros only at presentation)
- [ ] T094 [US6] Implement `GET /api/v1/documents/:id/xlsx` with `requireFeature('document_xlsx')`, SheetJS write and `Content-Disposition: attachment`, in `src/app/api/v1/documents/[id]/xlsx/route.ts`, and add "Descargar Excel" (Pro) to `src/components/documents/document-actions.tsx`

**Checkpoint**: Incremento 2 completo (V4–V6). Desplegable.

---

## Phase 10: Foundational — Increment 3

**Purpose**: cola de trabajos y planificador, notificaciones, búsqueda sin acentos y esquema de presupuestos, gestoría, exportaciones, importaciones y recurrencias.

- [ ] T095 Create migration `0008_search` enabling `unaccent` and `pg_trgm`, creating `immutable_unaccent(text)`, adding `client.postal_code`, `client.city`, generated `search_text` columns with GIN `gin_trgm_ops` indexes on `client` and `catalog_item`, with `.down.sql`, in `src/db/schema/client.ts`, `src/db/schema/catalog-item.ts` and `src/db/migrations/0008_search.sql`
- [ ] T096 Create migration `0009_quotes_delivery_notes` (enum values `quote`, `delivery_note` added in a preceding statement file), `document_link` schema with partial unique index for `invoiced`, quote columns (`valid_until`, `quote_decision`, `quote_decided_at`), new indexes, data migration of `converted_from_id/converted_to_id` into `document_link`, then drop those columns, with `.down.sql` restoring them, in `src/db/schema/document-link.ts`, `src/db/schema/document.ts`, `src/db/schema/document-series.ts` and `src/db/migrations/0009_quotes_delivery_notes.sql`
- [ ] T097 Create migration `0010_advisor_exports_imports` with `company_access`, `access_event`, `session.active_company_id`, `company.advisor_email`, `export_job`, `advisor_schedule`, `import_job`, `catalog_item.source_import_id` and new `email_purpose` values (`advisor_export`, `advisor_invite`, `user_notice`), with `.down.sql`, in `src/db/schema/company-access.ts`, `src/db/schema/access-event.ts`, `src/db/schema/auth.ts`, `src/db/schema/export-job.ts`, `src/db/schema/advisor-schedule.ts`, `src/db/schema/import-job.ts` and `src/db/migrations/0010_advisor_exports_imports.sql`
- [ ] T098 Create migration `0011_recurring` with `recurring_template`, `recurring_cycle` (unique `(template_id, cycle_index)`), `document.recurring_cycle_id` (unique) and `user_notification`, with `.down.sql`, in `src/db/schema/recurring-template.ts`, `src/db/schema/recurring-cycle.ts`, `src/db/schema/user-notification.ts` and `src/db/migrations/0011_recurring.sql`
- [ ] T099 [P] Write unit tests for the new queue message schemas (`recurring.run`, `reminder.send`, `export.build`, `import.analyze`, `import.apply`, `billing.grace`, `pdf.sample`: opaque ids only, strict) in `tests/unit/queue-messages.test.ts`
- [ ] T100 Add the new message schemas and factories to `src/workers/messages.ts` and route the `invoice-flash-jobs` queue to per-type handlers with retry/backoff/DLQ semantics in `src/workers/queue-consumer.ts` and `src/worker-entry.ts`
- [ ] T101 Split `src/workers/scheduled.ts` by cron: keep `0 3 * * *` purge; add `0 5 * * *` planner `runDailyPlanner({database, now, queue})` that only inserts claims with `ON CONFLICT DO NOTHING` and enqueues, with an integration test using an injected clock in `tests/integration/daily-planner.test.ts`
- [ ] T102 [P] Implement `src/services/notifications.ts` (create with idempotency key, list paginated, mark read; optional email to the user via `user_notice`) and routes `src/app/api/v1/notifications/route.ts` and `src/app/api/v1/notifications/[id]/read/route.ts`, plus the header bell `src/components/notifications/notification-bell.tsx` in `src/app/(app)/layout.tsx`
- [ ] T103 [P] Implement the signed, hashed, 7-day download token and the public route `/x/[token]` with `EXPORT_RATE_LIMITER` and generic 404, in `src/lib/download-tokens.ts`, `src/app/x/[token]/route.ts` and `tests/unit/download-tokens.test.ts`
- [ ] T192 Add R2 lifecycle rules expiring `exports/` and `imports/` objects after 8 days (token expiry is 7) with `pnpm wrangler r2 bucket lifecycle add`, document them in `docs/operations/predeploy.md`, and extend `scripts/verify-predeploy.ts` to fail when the rules are missing; `/x/[token]` keeps rejecting expired tokens by `expires_at`

**Checkpoint**: migraciones 0008–0011 aplicadas y reversibles; consumidor y planificador en verde.

---

## Phase 11: User Story 7 - Clientes y catálogo más potentes (Priority: P3)

**Goal**: búsqueda de clientes por cualquier dato sin acentos, archivar/restaurar desde lista y ficha, logotipo y unidades; importación CSV del catálogo en Pro.

**Independent Test**: buscar por ciudad y email, archivar y restaurar, unidades en productos; en Pro importar 50/500 productos con errores y revisar el informe (quickstart V7).

### Tests for User Story 7

- [ ] T104 [P] [US7] Write unit tests for CSV encoding detection (UTF-8 vs windows-1252), delimiter detection, header mapping suggestion, per-row validation (comma decimals → cents, negative prices, missing required columns) and the 5.000-row limit in `tests/unit/csv-import.test.ts`
- [ ] T105 [P] [US7] Write integration tests for accent/case-insensitive client search over name, NIF, email, phone, address, postal code and city, and for catalog search, in `tests/integration/search-unaccent.test.ts`
- [ ] T106 [P] [US7] Write integration tests for catalog import: analyze creates nothing, confirm with `skip` vs `update` duplicates, summary counts, `import_too_large`, Pro-only (`403` otherwise), queue redelivery without duplicates, in `tests/integration/catalog-import.test.ts`
- [ ] T107 [P] [US7] Extend the client search performance scenario to 10.000 clients per company with p95 < 200 ms in `tests/performance/client-search.test.ts`

### Implementation for User Story 7

- [ ] T108 [US7] Use `search_text LIKE '%' || immutable_unaccent(lower(:q)) || '%'` for `q` in `GET /api/v1/clients` and `GET /api/v1/catalog-items`, and accept `postal_code`/`city` in client create/update, in `src/app/api/v1/clients/route.ts`, `src/app/api/v1/clients/[id]/route.ts` and `src/app/api/v1/catalog-items/route.ts`
- [ ] T109 [US7] Add "Archivar"/"Restaurar" row actions and an "Archivados" filter to `src/components/clients/client-list.tsx`, the same action and logo upload to `src/components/clients/client-detail.tsx`, and show postal code and city columns
- [ ] T110 [US7] Add the unit `Combobox` (predefined + custom, "Crear unidad") to the product form in `src/components/catalog/catalog-list.tsx`
- [ ] T111 [P] [US7] Create `src/lib/csv/` (`decode.ts`, `detect.ts`, `map-columns.ts`, `validate-catalog-row.ts`) reusing the catalog item Zod schema
- [ ] T112 [US7] Implement `POST /api/v1/imports` (multipart to R2, 5 MB limit, `requireFeature('catalog_import')` for `kind=catalog`), `GET /api/v1/imports/:id`, `POST /api/v1/imports/:id/confirm` and the static template `GET /api/v1/imports/templates/catalog.csv`, in `src/services/imports/index.ts`, `src/app/api/v1/imports/route.ts`, `src/app/api/v1/imports/[id]/route.ts`, `src/app/api/v1/imports/[id]/confirm/route.ts` and `src/app/api/v1/imports/templates/catalog.csv/route.ts`
- [ ] T113 [US7] Implement the `import.analyze` (preview only) and `import.apply` (batches of 500 per transaction, `source_import_id`, result summary) handlers for catalog imports in `src/workers/handlers/import-analyze.ts` and `src/workers/handlers/import-apply.ts`
- [ ] T114 [US7] Build the import wizard (upload, column mapping, preview with per-row errors, duplicate policy, summary) behind `ProRoute` in `src/app/(app)/catalog/import/page.tsx` and `src/components/catalog/import-wizard.tsx`

**Checkpoint**: V7 completa; SC-005 < 5 min.

---

## Phase 12: User Story 8 - Exportar y compartir con la gestoría (Priority: P3)

**Goal**: Esencial: Excel del periodo y envío manual a la asesoría; Pro: exportación filtrada XLSX + ZIP en segundo plano, envío programado y acceso de solo lectura de la gestoría con cambio de empresa.

**Independent Test**: Esencial exporta y envía el trimestre; Pro exporta con filtros, programa envío trimestral y la gestoría solo consulta y exporta (quickstart V8).

### Tests for User Story 8

- [ ] T115 [P] [US8] Write unit tests for period resolution (current/previous month and quarter, year, Madrid timezone) and period Excel rows (one per document, base and tax per tax type, retention, total, derived payment state, totals row equal to the sum) in `tests/unit/period-export.test.ts`
- [ ] T116 [P] [US8] Write integration tests for exports: `period_excel` Essential+, `advanced` Pro-only, filters applied, `empty` status, ZIP built via multipart with all PDFs, token expiry, advisor email delivery recorded once, in `tests/integration/exports.test.ts`
- [ ] T117 [P] [US8] Write the permission-matrix contract suite from contracts/api.md (owner Basic/Essential/Pro, advisor on Pro and non-Pro company, foreign company 404, every `write` route denied with `read_only_access`) iterating over all `src/app/api/v1/**/route.ts` handlers, in `tests/integration/permission-matrix.test.ts`
- [ ] T118 [P] [US8] Write integration tests for advisor access: invite expiry at 7 days, accept with another account, active company switch, revoke takes effect on the next request, `access_event` recorded (`session_started` once per day, `exported` for each advisor export and `downloaded_pdf` for each advisor PDF download, all visible to the owner), in `tests/integration/advisor-access.test.ts`
- [ ] T119 [P] [US8] Write a performance test exporting 500 documents (XLSX + ZIP) ready in < 60 s in `tests/performance/export-500.test.ts`

### Implementation for User Story 8

- [ ] T120 [P] [US8] Create `src/lib/exports/period.ts` (period bounds) and `src/lib/exports/period-sheet.ts` (rows and totals from stored document totals)
- [ ] T121 [US8] Implement `POST /api/v1/exports` (kind-specific Zod and features, `send_to_advisor` owner-only and requires `advisor_email`), `GET /api/v1/exports/:id`, `GET /api/v1/exports`, recording `exported` in `access_event` when the requester is an advisor (and `downloaded_pdf` in `src/app/api/v1/documents/[id]/pdf/route.ts`, FR-053), in `src/services/exports/index.ts`, `src/app/api/v1/exports/route.ts` and `src/app/api/v1/exports/[id]/route.ts`
- [ ] T122 [US8] Implement the `export.build` handler: XLSX with SheetJS, ZIP of cached PDFs with `fflate` stored without recompression (level 0: PDFs are already compressed, saves CPU) streamed to an R2 multipart upload (≥ 5 MB parts), retry when a PDF is not ready, download token, `empty` status, `advisor_export` email with only the link, notification when ready, in `src/workers/handlers/export-build.ts` and `src/services/exports/zip.ts`
- [ ] T123 [US8] Add `advisor_export` and `advisor_invite` email templates in `src/services/email/templates/advisor.ts`
- [ ] T124 [US8] Implement advisor schedule `GET/PUT /api/v1/advisor-schedule` (Pro) and its planner step creating system `export_job` rows unique per `(company_id, period_key)` on the first day after a month/quarter, in `src/app/api/v1/advisor-schedule/route.ts` and `src/workers/scheduled.ts`
- [ ] T125 [US8] Build the export page (Essential: period picker + "Descargar Excel" + "Enviar a mi asesoría"; Pro: filters, formats, history, schedule) and the advisor email setting, in `src/app/(app)/exports/page.tsx`, `src/components/exports/period-export.tsx`, `src/components/exports/advanced-export.tsx` and `src/components/exports/export-history.tsx`
- [ ] T126 [US8] Extend `resolveCompanyContext` in `src/services/context.ts` to resolve `session.active_company_id` against ownership or an active `company_access`, return `role: 'advisor'`, deny `write` with `403 read_only_access`, deny non-Pro companies with `403 advisor_access_suspended`, and record `session_started` once per user/company/day in `access_event`
- [ ] T127 [US8] Implement advisor access management `GET/POST /api/v1/advisor-access`, `DELETE /api/v1/advisor-access/:id`, `POST /api/v1/advisor-invitations/accept`, `GET /api/v1/me/companies` and `PUT /api/v1/me/active-company`, in `src/services/advisor-access.ts` and the corresponding `src/app/api/v1/**/route.ts` files
- [ ] T128 [US8] Build the owner's "Gestoría" settings (invite, list, revoke, access/export log) and the advisor's company switcher in the header (accounts without own company land on the switcher instead of onboarding), in `src/components/settings/advisor-settings.tsx`, `src/components/navigation/company-switcher.tsx` and `src/app/(app)/layout.tsx`
- [ ] T129 [US8] Hide all write actions in the UI for the advisor role (read-only badge, no edit/issue/delete buttons) using `role` from `GET /api/v1/company` across `src/components/documents/**`, `src/components/clients/**`, `src/components/catalog/**` and `src/components/settings/**`

**Checkpoint**: V8 completa; matriz de permisos (SC-011) en verde; SC-006 medido.

---

## Phase 13: User Story 9 - Presupuestos y albaranes con conversión entre documentos (Priority: P3)

**Goal**: presupuestos (validez, aceptado/rechazado) y albaranes con series propias y conversión vinculada, incluida la facturación de varios albaranes en una factura.

**Independent Test**: presupuesto aceptado → albarán; dos albaranes del mismo cliente → una factura; refacturar → bloqueado; cupos por tipo correctos (quickstart V9).

### Tests for User Story 9

- [ ] T130 [P] [US9] Rewrite conversion unit tests for the transition table (quote → proforma|delivery_note|invoice, delivery_note → invoice, proforma → invoice), forbidden cycles, voided sources, repeat-confirmation rule, delivery-note line grouping with `section_label`, and derived quote/delivery-note states, in `tests/unit/document-conversion.test.ts`
- [ ] T131 [P] [US9] Write integration tests: quote/delivery note numbering in own series, conversion with `issue: true` consuming the destination type quota (402 when exhausted), idempotent repeat, `confirm_repeat`, invoicing two delivery notes atomically, `delivery_note_already_invoiced` with invoice number under concurrency, voiding the invoice releases links, in `tests/integration/quotes-delivery-notes.test.ts`
- [ ] T132 [P] [US9] Update `tests/integration/proforma-conversion.test.ts` to the `document_link` model and the new repeat rule

### Implementation for User Story 9

- [ ] T133 [P] [US9] Rewrite `src/lib/documents/conversion.ts` with the transition table, `validateConversion`, `groupDeliveryNoteLines` and `deriveQuoteState`/`deriveDeliveryNoteState`
- [ ] T134 [US9] Create `src/services/document-links.ts` (create link, list `from`/`to`, release on void) and switch the `converted_from` idempotency strategy in `src/services/document-issuance.ts` to `document_link`
- [ ] T135 [US9] Rewrite `src/services/document-conversion.ts` and `POST /api/v1/documents/:id/convert` for `{target_type, issue?, confirm_repeat?}` in `src/app/api/v1/documents/[id]/convert/route.ts`
- [ ] T136 [US9] Implement `POST /api/v1/documents/invoice-delivery-notes` (same client, issued, not invoiced; lock source rows; Idempotency-Key; optional issue through the common guard) in `src/services/delivery-note-invoicing.ts` and `src/app/api/v1/documents/invoice-delivery-notes/route.ts`
- [ ] T137 [US9] Implement `POST /api/v1/documents/:id/quote-decision` with `quote_accepted`/`quote_rejected` events in `src/app/api/v1/documents/[id]/quote-decision/route.ts`, and release `invoiced` links when voiding in `src/services/document-void.ts`
- [ ] T138 [US9] Accept `quote` and `delivery_note` in draft creation (`valid_until` for quotes) and add filters `quote_state`, `invoiced=false` to the list, in `src/app/api/v1/documents/route.ts` and `src/services/documents.ts`
- [ ] T139 [US9] Render quotes and delivery notes in the PDF and public view with their title and the "Sin validez fiscal de factura" mention, and `section_label` groups, in `src/services/pdf/template.ts` and `src/app/d/[token]/page.tsx`
- [ ] T140 [US9] Add quote and delivery note types to "Nuevo ▾" and `buildNavigation`, the editor type selector (`src/components/documents/editor/document-type-selector.tsx`), the list filters, "Convertir en…" and accept/reject actions in `src/components/documents/document-actions.tsx`, multi-select "Facturar" for delivery notes in `src/components/documents/document-list.tsx`, and the linked documents panel in `src/components/documents/document-detail.tsx`

**Checkpoint**: V9 completa.

---

## Phase 14: User Story 10 - Facturas recurrentes programadas (Priority: P3)

**Goal**: plantillas recurrentes en Pro que generan exactamente un documento por ciclo con la acción configurada.

**Independent Test**: recurrencia mensual con emisión automática, avanzar 12 ciclos con reloj inyectado: 12 facturas, sin duplicados ni huecos (quickstart V10).

### Tests for User Story 10

- [ ] T141 [P] [US10] Write unit tests for `src/lib/recurrence.ts`: every frequency and custom N days/weeks/months, day 31 → last day of month, end by date or by cycles, pending cycles after downtime, in `tests/unit/recurrence.test.ts`
- [ ] T142 [P] [US10] Write integration tests over 12 cycles with injected clock: one document per cycle, correct numbering, redelivery and planner re-run without duplicates, 3-day outage recovery, archived client → draft + notification, downgrade → `skipped_plan`, edit/pause/finish affect only future cycles, in `tests/integration/recurring.test.ts`

### Implementation for User Story 10

- [ ] T143 [P] [US10] Create `src/lib/recurrence.ts` (`nextRunOn`, `cycleDate`, `pendingCycles`, `isFinished`)
- [ ] T144 [US10] Add the `recurring_cycle` idempotency strategy to `src/services/document-issuance.ts`
- [ ] T145 [US10] Implement templates service and routes (create, list, get, patch with `version` increment, status changes, cycles list) with `requireFeature('recurring')`, in `src/services/recurring/templates.ts`, `src/app/api/v1/recurring-templates/route.ts`, `src/app/api/v1/recurring-templates/[id]/route.ts` and `src/app/api/v1/recurring-templates/[id]/cycles/route.ts`
- [ ] T146 [US10] Add the recurrence step to the daily planner (active templates with `next_run_on <= today`, insert `recurring_cycle` claims, `skipped_plan` when the company lacks the feature, with a single `recurring_skipped` notification per template and downgrade, idempotency key `recurring_skipped:{template_id}:{plan_change_id}`) in `src/workers/scheduled.ts`
- [ ] T147 [US10] Implement the `recurring.run` handler (create draft from template version, issue through the guard, enqueue email for `issue_and_send`, fall back to draft or pause with notification on failure, advance `next_run_on`) in `src/workers/handlers/recurring-run.ts`
- [ ] T148 [US10] Build the recurring pages (list, editor reusing line components, cycles with generated documents, pause/resume/finish) behind `ProRoute` in `src/app/(app)/recurring/page.tsx`, `src/app/(app)/recurring/[id]/page.tsx` and `src/components/recurring/recurring-form.tsx`

**Checkpoint**: Incremento 3 completo (V7–V10); SC-008 verificado. Activar `PRO_CHECKOUT_ENABLED` en staging y producción (Pro contratable) y validar la contratación de Pro de V8. Desplegable.

---

## Phase 15: Foundational — Increment 4

- [ ] T149 Create migrations `0012_reminders` (`payment_reminder` with unique `(document_id, scheduled_on)` and `(document_id, sequence)`, `company.reminder_policy`, `client.reminders_enabled`, `document.reminders_enabled`, email purpose `payment_reminder`), `0013_bank` (`bank_statement`, `bank_transaction` with unique `(collection_method_id, fingerprint, occurrence)`, `reconciliation` with unique `payment_id`) and `0014_onboarding` (`company.onboarding`, `sample_render`), each with `.down.sql`, in `src/db/schema/payment-reminder.ts`, `src/db/schema/bank-statement.ts`, `src/db/schema/bank-transaction.ts`, `src/db/schema/reconciliation.ts`, `src/db/schema/sample-render.ts`, `src/db/schema/company.ts`, `src/db/schema/client.ts`, `src/db/schema/document.ts` and `src/db/migrations/`


---

## Phase 16: User Story 11 - Recordatorios automáticos de pago (Priority: P4)

**Goal**: recordatorios por email configurables para facturas pendientes, con parada al pagar o anular y máximo uno por factura y día.

**Independent Test**: política 3 días antes / al vencer / cada 7 días / máx. 3 con reloj inyectado; parada al registrar el pago (quickstart V11).

### Tests for User Story 11

- [ ] T150 [P] [US11] Write unit tests for `reminderDatesFor(policy, dueDate, sentCount)` and `isReminderDue(today, …)` in `tests/unit/reminders.test.ts`
- [ ] T151 [P] [US11] Write integration tests: exact send dates, at most one per invoice and day under planner re-runs and redelivery, stop when paid/voided between planning and sending, skip clients without email (warning in detail) or with reminders disabled, per-invoice opt-out, Pro-only, history events, in `tests/integration/reminders.test.ts`

### Implementation for User Story 11

- [ ] T152 [P] [US11] Create `src/lib/reminders.ts`
- [ ] T153 [US11] Accept `reminder_policy` (Pro) in `PUT /api/v1/company`, `reminders_enabled` in client and document PATCH, and expose `reminder_warning` and `GET /api/v1/documents/:id/reminders`, in `src/app/api/v1/company/route.ts`, `src/app/api/v1/clients/[id]/route.ts`, `src/app/api/v1/documents/[id]/route.ts` and `src/app/api/v1/documents/[id]/reminders/route.ts`
- [ ] T154 [US11] Add the reminders step to the daily planner (candidate invoices with derived pending/partial/overdue state via indexed query, insert `payment_reminder` claims) in `src/workers/scheduled.ts`
- [ ] T155 [US11] Implement the `reminder.send` handler (revalidate payment state and email, create `email_delivery` with purpose `payment_reminder`, record `reminder_sent`/`reminder_skipped` events) and the reminder template with pending amount, due date, collection method and public link, in `src/workers/handlers/reminder-send.ts` and `src/services/email/templates/reminder.ts`
- [ ] T156 [US11] Build the reminder policy settings (Pro), the client toggle, the per-invoice toggle and the reminder history/warning in the document detail, in `src/components/settings/reminder-settings.tsx`, `src/components/clients/client-detail.tsx` and `src/components/documents/document-detail.tsx`

**Checkpoint**: V11 completa.

---

## Phase 17: User Story 12 - Conciliación bancaria (Priority: P4)

**Goal**: importar extractos Norma 43/CSV sin duplicados, sugerencias por confianza, casar 1-N y N-1 registrando pagos, deshacer e ignorar.

**Independent Test**: importar 20 movimientos, confirmar sugerencias, casar uno parcial, reimportar sin duplicados (quickstart V12).

### Tests for User Story 12

- [ ] T157 [P] [US12] Write unit tests for the Norma 43 parser (records 11/22/23/33/88, Latin-1, debit/credit sign, record 33 totals cross-check, malformed lines) using `tests/fixtures/bank/sample.n43`, in `tests/unit/norma43.test.ts`
- [ ] T158 [P] [US12] Write unit tests for fingerprint + occurrence and for match scoring (invoice number in concept, exact pending amount, client NIF/name, unique amount, due proximity; credits only) in `tests/unit/bank-matching.test.ts`
- [ ] T159 [P] [US12] Write integration tests: import with preview then confirm, re-import and overlapping statements add 0 movements, suggestions ranking, confirm creates payment, 1-N and N-1 allocations, over-allocation rejected under concurrency, undo deletes the payment, ignore/unignore, Pro-only, ≥ 80 % correct suggestions on the fixture (SC-009), in `tests/integration/bank-reconciliation.test.ts`

### Implementation for User Story 12

- [ ] T160 [P] [US12] Create `src/lib/bank/norma43.ts`, `src/lib/bank/fingerprint.ts` and `src/lib/bank/matching.ts`
- [ ] T161 [US12] Extend imports for `kind=bank_statement` (requires a `bank_account` collection method, `requireFeature('bank_reconciliation')`; Norma 43 or CSV/XLSX with column mapping from `src/lib/csv/`) in the analyze/apply handlers `src/workers/handlers/import-analyze.ts` and `src/workers/handlers/import-apply.ts`, persisting `bank_statement` (with closing balance) and `bank_transaction` with `ON CONFLICT DO NOTHING`
- [ ] T162 [US12] Implement `GET /api/v1/bank-transactions`, `GET /api/v1/reconciliation/suggestions`, `POST /api/v1/reconciliations` (lock transaction row `FOR UPDATE`, sum ≤ amount, v1 overpayment rule, create payments, Idempotency-Key), `DELETE /api/v1/reconciliations/:id` and ignore/unignore, in `src/services/bank/reconciliation.ts` and the corresponding `src/app/api/v1/**/route.ts` files
- [ ] T163 [US12] Build the reconciliation page (pending invoices vs unmatched credits, suggestions with confidence, confirm, manual allocation dialog, undo, ignore, statement import entry) behind `ProRoute` in `src/app/(app)/reconciliation/page.tsx` and `src/components/reconciliation/*.tsx`

**Checkpoint**: V12 completa; SC-009 ≥ 80 %.

---

## Phase 18: User Story 13 - Panel de resumen y tesorería (Priority: P4)

**Goal**: resumen sencillo en todos los planes y panel Pro con métricas, gráficos de 12 meses, top 5 clientes y tesorería.

**Independent Test**: con 12 meses de datos, cada cifra coincide al céntimo con documentos y pagos en cada plan (quickstart V13).

### Tests for User Story 13

- [ ] T164 [P] [US13] Write integration tests comparing each dashboard figure (paid, pending, overdue, invoiced base/total, tax collected by name/rate, 12-month series, top 5, treasury balance and expected 30 days) against independent control queries over seeded data, excluding voided documents, and `403` for full endpoints outside Pro, in `tests/integration/dashboard-pro.test.ts`
- [ ] T165 [P] [US13] Write a performance test for the Pro dashboard (< 500 ms p95 with 12 months) in `tests/performance/dashboard.test.ts`

### Implementation for User Story 13

- [ ] T166 [US13] Extend `GET /api/v1/dashboard` with `dashboard_full` fields and implement `GET /api/v1/dashboard/monthly`, `/top-clients` and `/treasury` with SQL aggregates in `Europe/Madrid`, in `src/services/dashboard.ts`, `src/app/api/v1/dashboard/route.ts`, `src/app/api/v1/dashboard/monthly/route.ts`, `src/app/api/v1/dashboard/top-clients/route.ts` and `src/app/api/v1/dashboard/treasury/route.ts`
- [ ] T167 [US13] Build the Pro dashboard (period picker incl. custom, metric tiles, invoiced vs collected chart, top 5 clients, treasury block) with shadcn charts in `src/components/dashboard/dashboard-view.tsx` and `src/components/dashboard/pro-charts.tsx`, keeping `simple-home.tsx` for Basic/Essential
- [ ] T168 [US13] Extend `src/db/seed.ts` with 12 months of documents, payments and a bank statement for the Pro demo account

**Checkpoint**: V13 completa; SC-007 y SC-013 verificados.

---

## Phase 19: User Story 14 - Asistente de configuración inicial (Priority: P4)

**Goal**: asistente por pasos con progreso, pasos omitibles, retomable, y factura de prueba que no es un documento.

**Independent Test**: cuenta nueva completa el asistente y genera la factura de prueba sin consumir numeración ni cupo; repetir saltando y retomando (quickstart V14).

### Tests for User Story 14

- [ ] T169 [P] [US14] Write unit tests for onboarding step derivation (`currentStep`, progress "paso X de N", skipped/completed, what is missing to issue) in `tests/unit/onboarding.test.ts`
- [ ] T170 [P] [US14] Write integration tests: sample render via queue produces a watermarked PDF, no `document` row, quota and series counters unchanged, absent from lists, exports and dashboard; sample cleanup after 7 days, in `tests/integration/onboarding-sample.test.ts`
- [ ] T171 [P] [US14] Write an E2E test for the wizard (complete, skip, close mid-way, resume) in `tests/e2e/onboarding.spec.ts`

### Implementation for User Story 14

- [ ] T172 [P] [US14] Create `src/lib/onboarding.ts` (steps, derivation, progress)
- [ ] T173 [US14] Implement `PATCH /api/v1/company/onboarding`, `POST /api/v1/company/onboarding/sample` and `GET /api/v1/company/onboarding/sample/:id` in `src/services/onboarding.ts` and the corresponding `src/app/api/v1/company/onboarding/**/route.ts` files
- [ ] T174 [US14] Implement the `pdf.sample` handler on the PDF queue (same template with "EJEMPLO – sin validez" watermark, stored in `samples/{company_id}/{id}.pdf`) and the 7-day cleanup in the planner, in `src/workers/handlers/pdf-sample.ts`, `src/services/pdf/template.ts` and `src/workers/scheduled.ts`
- [ ] T175 [US14] Build the wizard (fiscal data, logo, collection method, series, sample invoice) reusing settings components, shown on first login and resumable from a banner that lists what is missing, in `src/app/(app)/onboarding/page.tsx`, `src/components/onboarding/onboarding-wizard.tsx` and `src/components/onboarding-guard.tsx`

**Checkpoint**: Incremento 4 completo (V11–V14). Desplegable.

---

## Phase 20: User Story 15 - Gestionar documentos desde mi asistente de IA (Priority: P5)

**Goal**: servidor MCP con OAuth 2.1 en Pro, mismas validaciones que la app, confirmación explícita para emitir/anular y revocación inmediata.

**Independent Test**: conectar un asistente, crear un borrador con una petición, emitir tras confirmar, revocar y comprobar el rechazo (quickstart V15).

### Tests for User Story 15

- [ ] T176 [P] [US15] Write integration tests for MCP tools: scoping and plan limits identical to the API, ambiguous client returns options, `request_issue` does not issue, `confirm_action` single-use and 5-minute expiry, actor `ai:{connection}:user:{id}` in `document_event`, revoked connection and non-Pro company rejected immediately, rate limit, in `tests/integration/mcp-tools.test.ts`
- [ ] T177 [P] [US15] Write integration tests for the OAuth flow (metadata endpoints, dynamic registration, PKCE, consent creates `ai_connection`, `last_used_at` updated) in `tests/integration/mcp-oauth.test.ts`

### Implementation for User Story 15

- [ ] T178 [US15] Install `@better-auth/oauth-provider` and `@better-auth/mcp` (`pnpm add @better-auth/oauth-provider @better-auth/mcp`), configure `oauthProvider` (PKCE S256, `allowDynamicClientRegistration` + `allowUnauthenticatedClientRegistration` for public MCP clients, `consentPage`/`loginPage`, decide `jwt` plugin vs `disableJwtPlugin` opaque tokens) and `mcp` in `src/lib/auth.ts`, smoke-test the flow under `pnpm preview` (workerd), and create migration `0015_ai_connections` with the plugin tables (`oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthResource`, `oauthClientResource`, `oauthClientAssertion`) plus `ai_connection` and `ai_confirmation`, with `.down.sql`, in `src/db/schema/ai-connection.ts`, `src/db/schema/ai-confirmation.ts` and `src/db/migrations/0015_ai_connections.sql`
- [ ] T179 [US15] Build the consent page and connections management (`GET/DELETE /api/v1/ai-connections`) in `src/app/(app)/oauth/consent/page.tsx`, `src/app/api/v1/ai-connections/route.ts`, `src/app/api/v1/ai-connections/[id]/route.ts` and `src/components/settings/integrations-settings.tsx`
- [ ] T180 [US15] Implement the stateless Streamable HTTP MCP endpoint with Bearer validation, active connection + Pro check per request, `MCP_RATE_LIMITER` per connection and `last_used_at`, in `src/app/api/mcp/route.ts` and `src/services/mcp/server.ts`
- [ ] T181 [US15] Implement MCP tools as thin adapters over existing services with the same Zod schemas (`search_clients`, `get_client`, `create_client`, `search_products`, `create_product`, `list_documents`, `get_document`, `get_payment_summary`, `create_draft`, `update_draft`, `send_document`, `record_payment`) in `src/services/mcp/tools.ts`
- [ ] T182 [US15] Implement `request_issue`, `request_void` and `confirm_action` with hashed single-use tokens (5 min) and the AI actor in events, in `src/services/mcp/confirmations.ts`

**Checkpoint**: Incremento 5 completo (V15); SC-012 ≥ 8/10.

---

## Phase 21: Polish & Cross-Cutting Concerns

- [ ] T183 [P] Run axe and mobile/desktop checks over every new page (billing, simple home, settings sections, print, exports, import wizard, recurring, reconciliation, onboarding, consent) and fix violations, extending `tests/e2e/accessibility-feedback.spec.ts`
- [ ] T184 [P] Verify < 100 ms visible feedback with delayed network for every new mutation (upgrade, convert, invoice delivery notes, export, import, reconcile) in `tests/e2e/accessibility-feedback.spec.ts`
- [ ] T185 [P] Update `README.md` and `docs/operations/` runbooks for Stripe (keys, webhook, test clocks, dashboard settings that cannot be set by API: failed-payment retries ending within 7 days with "cancel subscription", business details and IVA 21 % tax rate on invoices, Portal plans), Resend domain, jobs queue/DLQ replay, cron planner and MCP, with pnpm/pnpx commands only
- [ ] T186 [P] Recalibrate the cost table with staging metrics (Resend volume, queue operations, Neon storage) and record it in `specs/002-factum-improvements/research.md`
- [ ] T187 Run `pnpm audit`, confirm no high/critical vulnerabilities from new dependencies, and update `pnpm.overrides` in `package.json` only if needed
- [ ] T188 Run moderated usability sessions (≥ 10 participants, v1 protocol) for SC-004 (simple UI) and SC-010 (onboarding) and record results in `specs/002-factum-improvements/usability-report.md`
- [ ] T189 Execute all quickstart scenarios V1–V15 against staging and record evidence (no secrets) in `specs/002-factum-improvements/validation-report.md`
- [ ] T190 Remove dead code left by the migration (old plan names, `converted_*` helpers, `default_tax_rate` reads, `RESEND_FROM_EMAIL`) across `src/`, add migration `NNNN_plan_contract` recreating the `plan` type without `free` (new type, `ALTER COLUMN … USING plan::text::plan_new`, drop and rename) with `.down.sql`, and confirm `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` and `pnpm test:e2e` are green

---

## Dependencies & Execution Order

```text
Setup (T001–T006)
  └─▶ Foundational Inc.1 (T007–T022)
        ├─▶ US1 (T023–T031) ──┐
        ├─▶ US2 (T032–T046) ──┼─▶ US3 (T047–T055)            ═ Incremento 1
        └──────────────────────┘
              └─▶ Foundational Inc.2 (T056–T060)
                    ├─▶ US4 (T061–T072)
                    ├─▶ US5 (T073–T084) ─▶ US6 (T085–T094)    ═ Incremento 2
                    └─▶ Foundational Inc.3 (T095–T103)
                          ├─▶ US7 (T104–T114)
                          ├─▶ US8 (T115–T129)
                          ├─▶ US9 (T130–T140)
                          └─▶ US10 (T141–T148)                ═ Incremento 3
                                └─▶ Foundational Inc.4 (T149)
                                      ├─▶ US11 (T150–T156)
                                      ├─▶ US12 (T157–T163) ─▶ US13 treasury (T164–T168)
                                      └─▶ US14 (T169–T175)    ═ Incremento 4
                                            └─▶ US15 (T176–T182) ═ Incremento 5
                                                  └─▶ Polish (T183–T190)
```

### Phase Dependencies

- **Setup** bloquea todo; T001 antes de T002 (ambos tocan `package.json`/lock indirectamente vía shadcn).
- **Foundational Inc. 1** bloquea US1–US3. T011 → T012 → T013/T016 (enum y límites); T014 antes de cualquier tarea de UI.
- **US1** solo depende de Foundational (T014, T019). Es el MVP.
- **US2** depende de Foundational (T012, T013, T015–T017); su validación del flujo de emisión bloqueada usa US1 (contador).
- **US3** depende de US2 (plan efectivo, `/billing`) y de T020; T066 (US4) extiende T055.
- **Despliegue del Inc. 1 en dos pasos**: T011 (release de compatibilidad con `0004`) se despliega sola en producción antes de aplicar `0005` (T012) y el resto del código v2.
- **T191** depende de T088 (claves por contenido); **T192** de T103.
- **Foundational Inc. 2** depende del Incremento 1 desplegado.
- **US4** y **US5** pueden ir en paralelo; T072 y T083 tocan `invoice-lines.tsx`: serializar.
- **US6** depende de US5 (bloque de pago necesita métodos de cobro) y de T013 (Excel Pro).
- **Foundational Inc. 3** depende del Incremento 2 (Excel usa `tax_name`).
- **US7**, **US8**, **US9**, **US10** pueden ir en paralelo tras T095–T103, salvo: T126 (contexto de gestoría) toca `src/services/context.ts` y debe ir antes de T117; T134/T144 tocan `document-issuance.ts`: serializar; el planificador (`scheduled.ts`) lo tocan T124 y T146: serializar.
- **US11** depende de Foundational Inc. 4; **US12** depende de US5 (cuentas bancarias) y US7 (importación); **US13** tesorería depende de US12; **US14** solo de Foundational Inc. 4 y US5/US6 para sus pasos.
- **US15** depende de los servicios de US1–US14 que expone.
- **Polish** depende de los incrementos incluidos en la entrega.

### Within Each User Story

- Tests primero y fallando por la razón esperada.
- `src/lib` puro → servicios → rutas → handlers de cola → UI → E2E.
- Ningún par de tareas `[P]` toca el mismo fichero.

## Parallel Examples by User Story

```text
Foundational Inc.1: T007, T008, T009, T010 (tests) · después T019, T020 en paralelo con T015–T018
US1:  T023, T024, T025 · después T027 en paralelo con T026
US2:  T032, T033, T034, T035 · después T036 y T040 en paralelo
US3:  T047, T048 · después T049
Inc.2: T058, T060 en paralelo con T056–T057
US4:  T061, T062, T063 · T064 · T072 (tras T083 o antes, nunca a la vez)
US5:  T073, T074, T075 · T076, T077, T079, T080
US6:  T085, T086, T087 · T089, T093
Inc.3: T099, T102, T103 en paralelo con migraciones
US7:  T104–T107 · T111
US8:  T115–T119 · T120
US9:  T130–T132 · T133
US10: T141, T142 · T143
US11: T150, T151 · T152
US12: T157–T159 · T160
US13: T164, T165
US14: T169–T171 · T172
US15: T176, T177
Polish: T183–T186
```

## Implementation Strategy

### MVP First

1. Setup T001–T006 y Foundational Inc. 1 T007–T022.
2. US1 T023–T031 → validar V1 → **desplegable por sí solo** (corrige los defectos de la v1 en producción con los planes renombrados).

### Incremental Delivery

1. **Incremento 1** (US1 + US2 + US3): producto de pago con interfaz sencilla → V1–V3 → desplegar.
2. **Incremento 2** (US4–US6): editor ágil, cobros, impuestos y documento profesional → V4–V6 → desplegar.
3. **Incremento 3** (US7–US10): catálogo, gestoría, presupuestos/albaranes, recurrencias → V7–V10 → desplegar.
4. **Incremento 4** (US11–US14): recordatorios, conciliación, panel, asistente inicial → V11–V14 → desplegar.
5. **Incremento 5** (US15): asistente de IA → V15 → desplegar.
6. **Polish** antes del cierre de la feature: accesibilidad, usabilidad SC-004/SC-010, validación completa.

### Parallel Team Strategy

Tras cada bloque fundacional, las historias del incremento pueden repartirse en ramas separadas. Ficheros calientes que obligan a serializar: `src/services/document-issuance.ts`, `src/services/context.ts`, `src/workers/scheduled.ts`, `src/workers/queue-consumer.ts`, `src/services/pdf/template.ts`, `src/components/documents/editor/invoice-lines.tsx`, `src/app/(app)/layout.tsx`, `wrangler.jsonc`.

## Notes

- Marcar `[X]` solo tras revalidar el fichero y sus puertas.
- Cada migración se genera con `pnpm db:generate`, se revisa a mano y lleva `.down.sql`; probar `up → down → up` en integración.
- Commit por tarea o grupo lógico, mensajes en inglés; PR aprobado y CI verde antes de fusionar en `main`.
- Los cambios que modifican reglas v1 (cupo por tipo, planes, conversión repetible con confirmación, `document_link`, desglose por nombre de impuesto, PDF sin email del cliente) actualizan sus tests existentes, no solo añaden nuevos.
