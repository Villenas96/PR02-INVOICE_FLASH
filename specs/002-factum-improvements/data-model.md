# Data Model: Factum — Mejoras de producto v2

**Date**: 2026-10-20 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md) | **Base**: [../001-invoice-flash/data-model.md](../001-invoice-flash/data-model.md)

Este documento describe solo los **cambios** sobre el modelo v1. Todo lo no mencionado sigue igual. Convenciones globales v1 vigentes: PK UUID v7, importes en céntimos enteros, porcentajes `numeric(5,2)`, `company_id` en toda tabla de negocio y en toda consulta, `created_at`/`updated_at`, soft-state por columnas, tablas de auditoría solo-INSERT.

## Diagrama de relaciones (nuevo o modificado en negrita)

```text
user 1─1 company (propietario)
**user 1─N company_access N─1 company**            [gestoría, solo lectura]
**company 1─1 subscription**   **company 1─N plan_change** [solo INSERT]
**billing_event**  (eventos Stripe, únicos)        **billing_price** (precios sincronizados)
company 1─N client                                  client: **+logo, +reminders, +city/postal_code**
company 1─N catalog_item                            catalog_item: **+unit, +tax_rate_id**
**company 1─N tax_rate**   **company 1─N measurement_unit**   **company 1─N collection_method**
company 1─N document_series                         document_series: **+archived_at**
company 1─N document ──N document_line              document: **+quote/delivery_note, +collection_method, ...**
**document N─N document (document_link: converted | invoiced)**
**company 1─N recurring_template 1─N recurring_cycle 0─1→ document**
**document 1─N payment_reminder**
**collection_method(bank_account) 1─N bank_statement 1─N bank_transaction N─N document (reconciliation → payment)**
**company 1─N export_job**   **company 0─1 advisor_schedule**
**company 1─N import_job**   **company 1─N sample_render**
**user 1─N ai_connection**   **ai_confirmation**
**company 1─N user_notification**   **company 1─N access_event** [solo INSERT]
```

## Entidades modificadas

### company

| Campo | Cambio | Reglas |
|---|---|---|
| plan | enum `plan`: `free,pro` → **`basic,essential,pro`** | Plan **efectivo**, materializado solo por la reconciliación de suscripción (R1) en la misma transacción que `plan_change`. Leído por la guarda de emisión bajo `FOR UPDATE`. |
| ui_mode | **nuevo** `enum('simple','full') null` | `null` = defecto del plan. `full` solo con plan Pro (validación en servidor); al bajar de plan se ignora sin borrarse. |
| onboarding | **nuevo** `jsonb not null default '{}'` | `{completed: Step[], skipped: Step[], dismissed_at?: ISO}`; `Step ∈ fiscal_data, logo, collection_method, series, sample_invoice`. |
| advisor_email | **nuevo** `text null` | Email validado; destino de envíos manuales y programados. |
| reminder_policy | **nuevo** `jsonb not null default '{"enabled":false}'` | `{enabled, days_before?: 0–30, on_due: bool, every_days_after?: 1–60, max_count: 1–10}`; validado con Zod; aplica solo si `hasFeature(plan,'reminders')`. |
| default_tax_rate | **deprecado → eliminado** tras sembrar `tax_rate` | El defecto pasa a `tax_rate.is_default`. |
| logo_key | semántica cambia | Clave direccionada por contenido `logos/{company_id}/{sha256}.{png\|jpg}`; nunca se sobrescribe (R10). |

**Migración del plan (expand/contract, sin parada)**: (1) `0004_plan_tiers_expand` recrea el tipo `plan` como superconjunto `free, pro, basic, essential` (`ALTER TYPE plan RENAME TO plan_old` → `CREATE TYPE plan AS ENUM(...)` → `ALTER COLUMN plan TYPE plan USING plan::text::plan` → `DROP TYPE plan_old`, quitando y reponiendo el default) en lugar de `ADD VALUE`, porque drizzle aplica todas las migraciones pendientes en una única transacción y Postgres rechaza usar en ella un valor añadido con `ADD VALUE` (comprobado en Postgres 18, incluso con la tabla vacía); un tipo creado en la misma transacción sí se puede usar. Se despliega junto a una versión de compatibilidad de la v1 que acepta ambos juegos de valores; (2) `0005_billing` migra los datos `free→basic`, `pro→essential`; desde ese momento `pro` no tiene filas y pasa a significar el Pro de la v2; (3) se despliega el código v2; (4) en Polish se recrea el tipo sin `free`. Nunca se renombran valores: el código v1 en ejecución usa literales `'free'::plan`/`'pro'::plan`.

### client

| Campo | Cambio | Reglas |
|---|---|---|
| postal_code, city | **nuevos** `text null` | Mostrados en la tabla y buscables (FR-028). |
| logo_key | **nuevo** `text null` | Igual que empresa; congelado en `client_snapshot.logo_key` al emitir (FR-025). |
| reminders_enabled | **nuevo** `boolean not null default true` | FR-041. |
| search_text | **nuevo** columna generada | `immutable_unaccent(lower(concat_ws(' ', name, tax_id, email, phone, address, postal_code, city)))`; índice GIN `gin_trgm_ops`. |

Archivado (`archived_at`) ya existe; se excluye de selectores (sin cambio de modelo).

### catalog_item

| Campo | Cambio | Reglas |
|---|---|---|
| unit | **nuevo** `text null` | ≤ 20; texto de unidad predefinida o propia (R9). |
| tax_rate_id | **nuevo** FK→`tax_rate` null | Referencia viva; `tax_rate` numérico se mantiene como valor propuesto. |
| search_text | **nuevo** columna generada | `immutable_unaccent(lower(description))` + GIN trigram. |
| source_import_id | **nuevo** FK→`import_job` null | Trazabilidad de importación CSV. |

### document_series

| Campo | Cambio | Reglas |
|---|---|---|
| document_type | enum `document_type` **+`quote`, +`delivery_note`** | |
| archived_at | **nuevo** `timestamptz null` | Serie archivada: no seleccionable; emitir con ella → `409 series_archived`. No puede archivarse la serie por defecto sin elegir otra. |

### document

| Campo | Cambio | Reglas |
|---|---|---|
| document_type | **+`quote`, +`delivery_note`** | Mismas reglas de numeración, snapshot e inmutabilidad (FR-035). |
| valid_until | **nuevo** `date null` | Solo `quote`; ≥ `issue_date`. |
| quote_decision | **nuevo** `enum('accepted','rejected') null` | Solo `quote` emitido; estado operativo (no fiscal); cambio → `document_event` `quote_accepted`/`quote_rejected`. |
| quote_decided_at | **nuevo** `timestamptz null` | |
| collection_method_id | **nuevo** FK→`collection_method` null | Editable en borrador; por defecto el método `is_default` al crear. |
| collection_method_snapshot | **nuevo** `jsonb null` | Congelado al emitir (FR-022): `{kind, label, holder?, iban?, bic?, phone?, email?, text?}`. |
| reminders_enabled | **nuevo** `boolean not null default true` | Desactivación por factura (FR-041); no es contenido fiscal. |
| recurring_cycle_id | **nuevo** FK→`recurring_cycle` null, **único** | Documento generado por un ciclo. |
| converted_from_id, converted_to_id | **eliminados** | Migrados a `document_link` (`kind='converted'`). |
| notes | sin cambio de columna | Se presenta como «Observaciones»; vacío → sin bloque (FR-005, FR-026). |
| issuer_snapshot / client_snapshot | contenido ampliado | `+logo_key` (clave inmutable), cliente `+postal_code, +city`; **sin email del cliente en lo impreso** (FR-006: el snapshot puede conservarlo para el envío, la plantilla no lo imprime). |
| tax_breakdown | contenido ampliado | `[{name, rate, base_cents, tax_cents}]` agrupado por `(name, rate)`. |

**Índices nuevos**: `(company_id, document_type, quote_decision)` parcial `WHERE document_type='quote'`; `(company_id, client_id, document_type, status)` para «albaranes no facturados del cliente».

**Estado derivado del presupuesto/albarán** (en consulta, nunca almacenado): `quote`: `pending | accepted | rejected | converted | expired (valid_until < hoy)`; `delivery_note`: `pending | invoiced` (existe `document_link` `invoiced` sin `released_at`).

### document_line

| Campo | Cambio | Reglas |
|---|---|---|
| unit | **nuevo** `text null` | Propuesto desde el producto; editable; impreso (FR-030). |
| tax_rate_id | **nuevo** FK→`tax_rate` null | Solo referencia de borrador. |
| tax_name | **nuevo** `text not null default 'IVA'` | Valor congelado junto a `tax_rate` (FR-023). |
| catalog_item_id | **nuevo** FK→`catalog_item` null | Vínculo opcional al producto (US4-AC2 «la línea queda vinculada»). |
| section_label | **nuevo** `text null` | Agrupación por albarán al facturar varios (US9-AC4). |

### document_event (enum ampliado)

Nuevos valores: `quote_accepted`, `quote_rejected`, `linked` (destino de una conversión/facturación), `link_released`, `reminder_sent`, `reminder_skipped`, `recurring_generated`, `exported`. Columna `actor` admite `user:{id}`, `advisor:{id}`, `ai:{connection_id}:user:{id}`, `system:recurring`, `system:reminders`.

### email_delivery (enum `email_purpose` ampliado)

Nuevos propósitos: `payment_reminder`, `advisor_export`, `advisor_invite`, `billing_notice`, `user_notice`. `document_id` opcional como hasta ahora; nuevo `export_job_id` FK null. Reglas de idempotencia, retención de PII de 30 días y cola sin datos sensibles: sin cambios.

## Entidades nuevas

### subscription — Suscripción (FR-010, FR-011)

| Campo | Tipo | Reglas |
|---|---|---|
| company_id | uuid FK, **unique** | Una por empresa. |
| stripe_customer_id | text unique | |
| stripe_subscription_id | text unique null | `null` en Básico. |
| plan | enum `plan` | Plan contratado (puede diferir del efectivo durante gracia/cancelación). |
| interval | `enum('month','year') null` | |
| status | `enum('active','past_due','canceled','incomplete')` | Copia reconciliada desde Stripe. |
| current_period_end | timestamptz null | |
| cancel_at_period_end | boolean | |
| grace_until | timestamptz null | `past_due` → `now()+7d`. |
| last_synced_at | timestamptz | |

**Plan efectivo** (función pura `effectivePlan(subscription, now)` en `src/lib/billing-plan.ts`): `active` → `plan`; `past_due` con `now < grace_until` → `plan`; resto → `basic`. La reconciliación escribe `company.plan = effectivePlan(...)` y, si cambia, `plan_change`.

### plan_change — Historial de plan (solo INSERT, FR-013)

`id, company_id, from_plan, to_plan, reason enum('checkout','portal','renewal_failed','grace_expired','canceled','migration','admin'), billing_event_id null, created_at`.

### billing_event — Eventos Stripe (idempotencia)

`id, stripe_event_id unique, type, received_at, processed_at null, error_code null`. Sin payload completo (minimización); se conserva 90 días.

### billing_price — Precios sincronizados

`lookup_key PK (essential_monthly…), stripe_price_id, plan, interval, unit_amount_cents, currency, active, updated_at`. Fuente de la página de planes; se actualiza por webhook (precios cambiables sin desarrollo).

### company_access — Acceso de gestoría (FR-050–053)

| Campo | Tipo | Reglas |
|---|---|---|
| company_id | uuid FK | |
| user_id | uuid FK null | `null` hasta aceptar. |
| role | `enum('advisor')` | Único rol (spec: solo gestoría). |
| status | `enum('pending','active','revoked')` | `suspended` no se almacena: se deriva si la empresa no tiene Pro. |
| invited_email_hash | text | SHA-256 del email normalizado; el email en claro solo en `email_delivery` (retención 30 días). |
| invite_token_hash | text unique | Token ≥ 128 bits. |
| invite_expires_at | timestamptz | `created_at + 7d`. |
| accepted_at, revoked_at | timestamptz null | |

Índices: único `(company_id, user_id) WHERE status='active'`; `(user_id, status)` para el selector de empresa. **Sesión**: `session.active_company_id uuid null` (campo adicional de Better Auth), validado en cada petición.

### access_event — Auditoría de gestoría (solo INSERT, FR-053)

`id, company_id, actor_user_id, action enum('session_started','exported','downloaded_pdf','access_revoked'), target_id null, created_at`. `session_started` como máximo una vez por usuario, empresa y día (índice único parcial por fecha).

### collection_method — Método de cobro (FR-021, FR-022)

| Campo | Tipo | Reglas |
|---|---|---|
| kind | `enum('bank_account','bizum','paypal','cash','other')` | |
| label | text | Alias ≤ 60. |
| holder_name, iban, bic | text null | Requeridos `holder_name`+`iban` si `bank_account`; IBAN normalizado sin espacios, mod-97 (R5); BIC opcional ISO 9362. |
| phone | text null | `bizum`. |
| email_or_url | text null | `paypal`. |
| instructions | text null | `other` (≤ 300). |
| is_default | boolean | Único parcial por empresa entre no archivados. |
| archived_at | timestamptz null | Archivado no seleccionable; los documentos emitidos conservan su snapshot. |

### tax_rate — Tipo de impuesto (FR-023)

`id, company_id, name (≤30), rate numeric(5,2) [0,100), is_default (único parcial), archived_at, created_at, updated_at`. Único `(company_id, name, rate) WHERE archived_at IS NULL`. Sembrado por migración: IVA 21 (defecto según v1), 10, 4, 0.

### measurement_unit — Unidades propias (FR-030)

`id, company_id, name (≤20), archived_at`. Único `(company_id, lower(name))`. Las predefinidas viven en código.

### document_link — Vínculos entre documentos (FR-036, FR-037)

| Campo | Tipo | Reglas |
|---|---|---|
| company_id | uuid FK | |
| source_document_id | uuid FK→document | Emitido, no anulado al crear el vínculo. |
| target_document_id | uuid FK→document | |
| kind | `enum('converted','invoiced')` | `invoiced` solo `delivery_note → invoice`. |
| released_at | timestamptz null | Se rellena al anular el destino. |

Índices: único parcial `(source_document_id) WHERE kind='invoiced' AND released_at IS NULL` (un albarán solo en una factura viva); `(target_document_id)`; `(source_document_id, kind)`. Transiciones válidas en `src/lib/documents/conversion.ts` (R4).

### recurring_template — Plantilla recurrente (FR-038–040)

| Campo | Tipo | Reglas |
|---|---|---|
| client_id, series_id, collection_method_id | FK | Cliente activo de la empresa; serie del tipo `invoice`. |
| lines | jsonb | Mismo esquema Zod que las líneas de borrador; importes en céntimos. |
| notes, due_days | text null, int | |
| frequency | `enum('weekly','monthly','quarterly','semiannual','annual','custom')` | |
| interval_count, interval_unit | int ≥1, `enum('day','week','month') null` | Solo `custom`. |
| start_on | date | |
| end_on / max_cycles | date null / int null | A lo sumo uno. |
| action | `enum('draft','issue','issue_and_send')` | `issue_and_send` requiere email del cliente y plan con email. |
| status | `enum('active','paused','finished')` | |
| next_run_on | date null | Recalculada solo por `lib/recurrence` tras cada ciclo o edición; `null` si `finished`. |
| version | int | Incrementa en cada edición; los ciclos registran la versión aplicada (las ediciones solo afectan a ciclos futuros). |

Índice parcial `(next_run_on) WHERE status='active'` para el planificador.

### recurring_cycle — Ciclo generado (idempotencia, SC-008)

`id, company_id, template_id, cycle_index, scheduled_on, template_version, outcome enum('pending','draft_created','issued','sent','skipped_plan','failed'), reason_code null, created_at, updated_at`. **Único `(template_id, cycle_index)`**: reclamo idempotente del ciclo. El documento generado referencia el ciclo (`document.recurring_cycle_id` único).

### payment_reminder — Recordatorio (FR-041, FR-042)

`id, company_id, document_id, scheduled_on, sequence (1..max_count), outcome enum('queued','sent','skipped_paid','skipped_no_email','failed'), email_delivery_id null, created_at`. **Único `(document_id, scheduled_on)`** → como máximo uno por factura y día; único `(document_id, sequence)`.

### bank_statement / bank_transaction / reconciliation (FR-043–045)

**bank_statement**: `id, company_id, collection_method_id (kind=bank_account), format enum('norma43','csv','xlsx'), file_key, period_start, period_end, closing_balance_cents bigint null, closing_balance_on date null, imported_at, import_job_id`.

**bank_transaction**:

| Campo | Tipo | Reglas |
|---|---|---|
| collection_method_id | FK | Cuenta bancaria. |
| statement_id | FK | Primer extracto que lo trajo. |
| operation_on, value_on | date | |
| amount_cents | bigint | Positivo = ingreso; negativo = cargo (los cargos no se proponen para casar). |
| concept | text | Concepto + complementarios (registros 23); excluido de logs. |
| reference | text null | Nº documento/referencias Norma 43. |
| fingerprint, occurrence | text, int | **Único `(collection_method_id, fingerprint, occurrence)`** (R14). |
| ignored_at | timestamptz null | «Ignorar» (US12-AC6). |

Estado (derivado): `ignored` si `ignored_at`; `reconciled` si `Σ reconciliation.amount_cents = amount_cents`; `partial` si > 0; si no, `pending`.

**reconciliation**: `id, company_id, bank_transaction_id, document_id (invoice emitida), payment_id unique, amount_cents > 0, created_by, created_at`. Invariante transaccional (con `FOR UPDATE` sobre el movimiento): `Σ amount_cents ≤ bank_transaction.amount_cents`. Deshacer = borrar fila + borrar `payment` generado (evento `payment_deleted`). Índice `(document_id)`, `(bank_transaction_id)`.

### export_job / advisor_schedule (FR-032–034)

**export_job**: `id, company_id, requested_by (user o system), kind enum('period_excel','advanced'), filters jsonb (tipos, from, to, status, client_id), formats text[] ('xlsx','pdf_zip'), period_key text null, status enum('queued','running','ready','empty','failed'), file_keys jsonb, download_token_hash unique null, expires_at, send_to_advisor bool, created_at, updated_at`. Único `(company_id, period_key) WHERE requested_by='system'` para envíos programados idempotentes. El cron borra objetos y anula tokens tras `expires_at` (7 días).

**advisor_schedule**: `company_id PK, frequency enum('monthly','quarterly'), formats text[], enabled, last_period_key`. Activo solo con Pro (comprobación en uso).

### import_job — Importación CSV/extractos (FR-031, FR-043)

`id, company_id, kind enum('catalog','bank_statement'), file_key, status enum('uploaded','analyzing','preview_ready','applying','done','failed','rejected'), mapping jsonb, duplicate_policy enum('skip','update') null, preview jsonb (resumen, ≤50 filas de muestra, errores por fila ≤ 500), result jsonb ({created, updated, skipped, errored}), row_count, created_at, updated_at`. Límites: 5 MB, 5.000 filas.

### sample_render — Factura de prueba (FR-049)

`id, company_id, status enum('pending','ready','failed'), file_key null, created_at`. Nunca es un `document`; el cron la borra a los 7 días.

### ai_connection / ai_confirmation (FR-054–056)

**ai_connection**: `id, user_id, company_id, oauth_client_id (Better Auth), client_name, status enum('active','revoked'), authorized_at, last_used_at, revoked_at`. Bloqueada (derivado) si la empresa no tiene Pro.

**ai_confirmation**: `id, ai_connection_id, action enum('issue','void'), document_id, token_hash unique, expires_at (5 min), used_at null`. Un solo uso.

### user_notification (R21)

`id, company_id, user_id, kind, payload jsonb (sin NIF, IBAN, importes ni emails), idempotency_key unique, read_at null, created_at`. Paginada; índice `(user_id, read_at, created_at)`.

## Reglas de negocio puras nuevas (`src/lib/*`, con pruebas unitarias obligatorias)

| Módulo | Contenido |
|---|---|
| `lib/plan.ts` | Planes `basic/essential/pro`, límites por tipo, funciones, aviso 80 %, `hasFeature`. |
| `lib/billing-plan.ts` | `effectivePlan`, transición de gracia, mapeo de estados Stripe. |
| `lib/navigation.ts` | Navegación por plan, `ui_mode` y tipos usados. |
| `lib/billing` | Desglose agrupado por `(name, rate)`. |
| `lib/iban.ts` | Normalización y validación IBAN/BIC. |
| `lib/units.ts` | Unidades predefinidas. |
| `lib/numbering` | Prefijo de serie automática y resolución de colisiones. |
| `lib/documents/conversion.ts` | Tabla de transiciones, ciclos prohibidos, agrupación de albaranes. |
| `lib/recurrence.ts` | Fechas de ciclo, fin de mes, fin por fecha/ciclos, ciclos pendientes. |
| `lib/reminders.ts` | Fechas de recordatorio según política y estado de cobro. |
| `lib/bank/norma43.ts`, `lib/bank/matching.ts`, `lib/bank/fingerprint.ts` | Parser, puntuación de sugerencias, huella de duplicados. |
| `lib/exports/*` | Filas del Excel de periodo y de documento desde totales almacenados. |
| `lib/csv/*` | Detección de codificación/separador, mapeo y validación por fila. |

## Transiciones de estado

```text
subscription:  (none) ─checkout─▶ active ─payment_failed─▶ past_due ─pagado─▶ active
                                  active ─cancel_at_period_end+fin─▶ canceled ⇒ plan efectivo basic
                                  past_due ─grace_until vencido─▶ (efectivo basic; status Stripe)
company_access: pending ─aceptar─▶ active ─retirar─▶ revoked ; pending ─caducar─▶ (inválido)
recurring_template: active ⇄ paused ; active|paused ─finalizar / fin alcanzado─▶ finished
recurring_cycle: pending ─▶ draft_created | issued ─▶ sent ; pending ─▶ skipped_plan | failed
quote (derivado): pending ─▶ accepted | rejected ; (cualquiera) ─convertido─▶ converted ; pending ─valid_until─▶ expired
delivery_note (derivado): pending ─facturado─▶ invoiced ─factura anulada─▶ pending
export_job / import_job: queued ─▶ running ─▶ ready|empty|failed  /  uploaded ─▶ analyzing ─▶ preview_ready ─▶ applying ─▶ done
```

## Migraciones (orden, todas versionadas y reversibles con `.down.sql`)

| Inc. | Migración | Contenido |
|---|---|---|
| 1 | `0004_plan_tiers_expand` | Recreación del tipo `plan` como superconjunto `free, pro, basic, essential` (release de compatibilidad, desplegada sola). |
| 1 | `0005_billing` | Migración de datos `free→basic`, `pro→essential`; `subscription`, `plan_change` (fila `migration` por empresa), `billing_event`, `billing_price`; `company.ui_mode`. |
| 2 | `0006_payment_tax_units` | `collection_method`, `tax_rate` (siembra), `measurement_unit`; columnas de cobro, impuesto y unidad en `document`, `document_line`, `catalog_item`; `document_series.archived_at`; eliminación de `company.default_tax_rate` tras la siembra; `document_event_type` ampliado. |
| 2 | `0007_logos` | `client.logo_key`; las claves existentes de empresa se copian a su forma direccionada por contenido; índices de expresión sobre `issuer_snapshot->>'logo_key'` y `client_snapshot->>'logo_key'` (purga de huérfanos). |
| 3 | `0008_search` | Extensiones `unaccent`, `pg_trgm`; `immutable_unaccent`; `search_text` + GIN en `client` y `catalog_item`; `client.postal_code`, `client.city`. |
| 3 | `0009_quotes_delivery_notes` | `document_type` + `quote`, `delivery_note` (separado de su uso); `document_link` con traslado de `converted_*` y eliminación de esas columnas; campos de presupuesto. |
| 3 | `0010_advisor_exports_imports` | `company_access`, `access_event`, `session.active_company_id`, `company.advisor_email`, `export_job`, `advisor_schedule`, `import_job`, `catalog_item.source_import_id`, `email_purpose` ampliado. |
| 3 | `0011_recurring` | `recurring_template`, `recurring_cycle`, `document.recurring_cycle_id`, `user_notification`. |
| 4 | `0012_reminders` | `payment_reminder`, `company.reminder_policy`, `client.reminders_enabled`, `document.reminders_enabled`. |
| 4 | `0013_bank` | `bank_statement`, `bank_transaction`, `reconciliation`. |
| 4 | `0014_onboarding` | `company.onboarding`, `sample_render`. |
| 5 | `0015_ai_connections` | Tablas del plugin OAuth de Better Auth, `ai_connection`, `ai_confirmation`. |

Todas versionadas con `.down.sql`. Ninguna exige parada siempre que se respete el orden migración ↔ despliegue: `0004` va con su release de compatibilidad y `0005` solo se aplica con esa release en producción. Columnas nuevas nulas o con default. **Regla de enums**: drizzle aplica todas las migraciones pendientes en una única transacción (CI y E2E migran siempre desde cero), así que ningún SQL de migración puede usar un valor añadido con `ADD VALUE` (literales, `UPDATE`, `DEFAULT`, `CHECK` o índices parciales); si hace falta usarlo, se recrea el tipo como superconjunto. `ADD VALUE` sin uso posterior en migraciones (`document_type`, `email_purpose`, `document_event_type`) sigue siendo válido, y evita reescribir tablas grandes como `document`. Si el orden real de entrega cambia, la numeración se regenera con drizzle-kit; esta tabla describe el contenido.
