# Data Model: Invoice Flash

**Date**: 2026-07-09 | **Plan**: [plan.md](./plan.md) | **Storage**: Neon Postgres (Drizzle ORM, migraciones drizzle-kit)

Convenciones globales:

- Claves primarias `id` UUID v7 (ordenables por tiempo, generadas en app).
- Importes monetarios: **enteros en céntimos** (`integer`; `bigint` en agregados). Cantidades: `numeric(12,3)`. Porcentajes: `numeric(5,2)`.
- Todas las tablas de negocio llevan `company_id` y **toda consulta se filtra por él** (autorización a nivel de recurso, Principio III). Deny by default vía helper único de scoping.
- `created_at` / `updated_at` `timestamptz` en todas las tablas (salvo tablas inmutables, que solo llevan `created_at`).
- Soft-state por columnas (`archived_at`, `disabled_at`), nunca borrado físico de datos con historia.

## Diagrama de relaciones

```text
user (Better Auth) 1─1 company
company 1─N client
company 1─N catalog_item
company 1─N document_series
company 1─N document ──N document_line
document (invoice) 1─N payment
document 1─N share_link (máx. 1 activo)
document 1─N document_event   [inmutable]
document (proforma) 0─1→ document (invoice)   [converted_to_id]
document (receipt)  1→ document (invoice) + 1→ payment
```

## Entidades

### user / session / account / verification (Better Auth)

Tablas generadas por el adaptador Drizzle de Better Auth. No se modifican a mano; se extiende `user` solo por relación 1–1 con `company`.

### company — Perfil del emisor (FR-002, FR-003)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| user_id | uuid FK→user, **unique** | 1 empresa por usuario (asunción v1) |
| legal_name | text | requerido para emitir |
| tax_id | text | NIF; requerido para emitir; formato validado (Zod, NIF/NIE/CIF español) |
| address | text | requerido para emitir |
| email | text | requerido; formato email |
| phone | text null | |
| logo_key | text null | clave R2; subida ≤ 2 MB, png/jpg/svg |
| default_due_days | int, default 30 | > 0 (edge case "vencimiento sin fecha") |
| default_tax_rate | numeric(5,2), default 21.00 | ∈ {0, 4, 10, 21} configurable |
| retention_rate | numeric(5,2), default 0 | IRPF; 0–99.99 |
| currency | char(3), default 'EUR' | ISO 4217 |
| plan | enum('free','pro'), default 'free' | FR-027 |
| plan_doc_limit | int null | límite mensual de documentos emitidos; null = ilimitado |

**Regla de negocio**: `isReadyToIssue(company)` = legal_name, tax_id y address no vacíos (FR-003; guía de onboarding US1-AC1).

### client — Cliente (FR-005…FR-008)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id | uuid FK→company | |
| name | text | requerido |
| tax_id | text null | validación de formato si presente |
| address | text null | |
| email | text null | formato email |
| phone | text null | |
| notes | text null | |
| archived_at | timestamptz null | archivado reversible (FR-008) |

**Índices**: `(company_id, archived_at)`; búsqueda inmediata (FR-006): `(company_id, name)` + `(company_id, tax_id)` con `ILIKE prefix` o trigram (`pg_trgm`) si el prefijo no basta.

**Reglas**: archivar no toca documentos (los emitidos usan snapshot); un cliente archivado no aparece en selectores pero sí en históricos.

### catalog_item — Concepto de catálogo (FR-009, FR-010)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id | uuid FK→company | |
| description | text | requerida |
| unit_price_cents | integer | ≥ 0 |
| tax_rate | numeric(5,2) | por defecto el de la empresa |
| archived_at | timestamptz null | "eliminar" = archivar; los documentos no referencian el ítem (copian valores), así editar/borrar nunca altera documentos (US4-AC3) |

**Índices**: `(company_id, archived_at)`, búsqueda por `description` (trigram/prefijo).

### document_series — Serie de numeración (FR-013, edge cases de concurrencia y cambio de año)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id | uuid FK→company | |
| doc_type | enum('invoice','proforma','receipt') | |
| prefix | text | ej. `2026-`, `F-`; definible por usuario |
| next_number | integer, default configurable | ≥ 1; el usuario fija el inicial |
| is_default | boolean | exactamente una serie default por (company, doc_type) — índice único parcial |

**Constraints**: unique `(company_id, doc_type, prefix)`; unique parcial `(company_id, doc_type) WHERE is_default`.

**Asignación (transacción crítica)**: al emitir → `SELECT ... FOR UPDATE` de la fila de serie → asignar `next_number`, incrementarlo, escribir documento emitido; commit atómico. Garantiza unicidad y correlatividad sin huecos (los borradores no consumen número). Cambio de año = crear nueva serie (p. ej. prefijo `2027-`) y marcarla default; la anterior conserva su correlatividad.

### document — Factura, proforma o recibo (FR-011…FR-018)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id | uuid FK→company | |
| doc_type | enum('invoice','proforma','receipt') | |
| status | enum('draft','issued','voided') | ver transiciones |
| series_id | uuid FK→document_series null | null en borrador |
| number | integer null | asignado al emitir |
| full_number | text null | `prefix + number` denormalizado; unique `(company_id, full_number)` parcial WHERE issued/voided |
| client_id | uuid FK→client null | requerido para emitir |
| issue_date | date | default hoy |
| due_date | date null | facturas: si null al emitir → `issue_date + company.default_due_days` |
| notes | text null | |
| subtotal_cents | integer | calculado (ver billing) |
| tax_breakdown | jsonb | `[{rate, base_cents, tax_cents}]` por tipo (edge case impuestos mixtos) |
| retention_rate | numeric(5,2) | copiada de company al emitir |
| retention_cents | integer | |
| total_cents | integer | |
| issuer_snapshot | jsonb null | copia inmutable de company al emitir (FR-015) |
| client_snapshot | jsonb null | copia inmutable de client al emitir (FR-015) |
| converted_from_id | uuid FK→document null | en factura creada desde proforma (FR-016) |
| converted_to_id | uuid FK→document null | en proforma convertida; marcada "convertida" |
| invoice_id | uuid FK→document null | solo recibos: factura justificada (US6-AC3) |
| payment_id | uuid FK→payment null | solo recibos: pago justificado |
| issued_at / voided_at | timestamptz null | |

**Transiciones de estado**:

```text
draft ──issue──▶ issued ──void──▶ voided
  │ (editable,      (contenido inmutable;      (excluida de cobros FR-024;
  │  sin número)     admite pagos, enlaces,     enlace público muestra "anulado")
  └─ deletable       envíos, recibo)
```

- `issue`: valida cliente + ≥1 línea (US1-AC4), empresa lista (FR-003), límite de plan no superado (FR-027); asigna número (serie FOR UPDATE); congela snapshots; recalcula y persiste totales; encola render de PDF.
- Emitido: solo cambian campos de relación (pagos, enlaces, conversión); contenido y totales inmutables. No se elimina jamás; solo `void` (FR-014).
- Borrador: editable y eliminable físicamente (no tiene número ni efectos).
- Duplicar (FR-017): cualquier documento → nuevo `draft` copiando cliente, líneas y notas (fechas nuevas, sin número).

**Estado de cobro (derivado, nunca almacenado — FR-024)**: sobre facturas emitidas, con `paid_cents = Σ payments`:
`voided → excluida` · `paid_cents ≥ total → pagada` · `0 < paid < total y due_date < hoy → vencida (parcial)` · `paid = 0 y due_date < hoy → vencida` · `0 < paid < total → parcialmente pagada` · `resto → pendiente`.

**Índices**: `(company_id, doc_type, status, issue_date desc)` (listados/panel); `(company_id, client_id)` (ficha cliente FR-007); `(company_id, due_date) WHERE status='issued' AND doc_type='invoice'` (vencidas); unique parcial de `full_number`. Agregados del panel (FR-025) por consulta agregada con estos índices; a 10x, vista materializada como plan documentado.

### document_line — Línea de documento (FR-011, FR-012)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| document_id | uuid FK→document (cascade en draft) | |
| position | integer | orden estable |
| description | text | requerida |
| quantity | numeric(12,3) | **> 0** (edge case) |
| unit_price_cents | integer | **≥ 0** (edge case) |
| tax_rate | numeric(5,2) | 0–99.99 |
| discount_pct | numeric(5,2), default 0 | 0–100 |
| line_subtotal_cents / line_tax_cents / line_total_cents | integer | calculados y persistidos al emitir |

Sin FK a `catalog_item`: la línea copia valores del catálogo (desacoplada, FR-010 / US4-AC2/AC3).

**Cálculo (en `src/lib/billing`, puro)**: `line_subtotal = round(quantity × unit_price × (1 − discount/100))`; `line_tax = round(line_subtotal × rate/100)`; desglose por tipo = suma de líneas redondeadas; `retention = round(subtotal × retention_rate/100)`; `total = subtotal + Σtax − retention`. Redondeo half-up al céntimo. Exacto al céntimo por construcción (SC-003).

### payment — Pago (FR-023, FR-026)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id | uuid FK→company | |
| document_id | uuid FK→document | solo facturas `issued` |
| amount_cents | integer | > 0; si excede pendiente → requiere confirmación explícita (flag `confirmed_overpayment`) |
| paid_on | date | |
| method | enum('transfer','cash','card','other') null | |

Editable y eliminable (FR-026); el estado de la factura se deriva, así que se recalcula solo. Cada alta/edición/borrado genera `document_event`.

**Índices**: `(document_id)`, `(company_id, paid_on)`.

### share_link — Enlace público (FR-020, US5)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id / document_id | uuid FK | solo documentos emitidos/anulados |
| token | text unique | 32 bytes aleatorios CSPRNG, base64url (≥128 bits: no adivinable) |
| disabled_at | timestamptz null | desactivable en cualquier momento (US5-AC2) |

Acceso público sin sesión: por token exacto, solo lectura + PDF; si el documento está anulado, la vista lo muestra claramente (edge case). Rate-limited.

### document_event — Auditoría inmutable (FR-018, constitución)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id / document_id | uuid FK | |
| actor | text | user_id o `system` |
| event | enum('created','updated','issued','voided','converted','duplicated','pdf_generated','link_created','link_disabled','email_sent','payment_added','payment_updated','payment_deleted') | |
| payload | jsonb null | detalle (sin datos sensibles en claro innecesarios) |
| created_at | timestamptz | |

**Solo INSERT** (sin UPDATE/DELETE a nivel de aplicación y sin permisos de update en el rol de BD). Índice `(document_id, created_at)`.

### Límite de plan (FR-027)

Sin tabla propia en v1: documentos emitidos del mes = `COUNT(*)` sobre `document` con índice `(company_id, issued_at)`. Aviso anticipado al 80% del límite; al 100% se bloquea solo *emitir* (nunca el acceso a lo ya creado — edge case). Capacidades por plan resueltas en un único módulo `src/lib/plan.ts` (`canSendEmail(plan)`, `docLimit(plan)`), para que FR-022 tenga un solo punto de verdad.
