# Data Model: Invoice Flash

**Date**: 2026-07-09 | **Updated**: 2026-07-30 | **Plan**: [plan.md](./plan.md) | **Storage**: Neon Postgres (Drizzle ORM, migraciones drizzle-kit)

Convenciones globales:

- Claves primarias `id` UUID v7 (ordenables por tiempo, generadas en app).
- Importes monetarios: **enteros en céntimos** (`integer`; `bigint` en agregados). Cantidades: `numeric(12,3)`. Porcentajes: `numeric(5,2)`.
- Todas las tablas de negocio llevan `company_id` y **toda consulta se filtra por él** (autorización a nivel de recurso, Principio III). Deny by default vía helper único de scoping.
- `created_at` / `updated_at` `timestamptz` en todas las tablas (salvo tablas inmutables, que solo llevan `created_at`).
- Soft-state por columnas (`archived_at`, `disabled_at`), nunca borrado físico de datos con historia.
- Neon cifra los datos en reposo y exige TLS en tránsito; R2 cifra objetos y metadatos en reposo. La configuración se verifica antes del despliegue y no sustituye el filtrado por `company_id` ni la minimización de datos.

## Diagrama de relaciones

```text
user (Better Auth) 1─1 company
company 1─N client
company 1─N catalog_item
company 1─N document_series
company 1─N document ──N document_line
document (invoice) 1─N payment
document 1─N share_link (máx. 1 activo)
user 1─N email_delivery
document 0─N email_delivery
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
| payment_id | uuid FK→payment null | solo recibos: pago justificado; unique parcial para `doc_type='receipt'` |
| pdf_status | enum('pending','ready','failed') null | null en borrador; `pending` al emitir; metadato operativo mutable |
| pdf_ready_at | timestamptz null | se completa al almacenar en R2 |
| issued_at / voided_at | timestamptz null | |
| deleted_at | timestamptz null | borrado lógico exclusivo de borradores; excluido de listados, detalle y emisión |

**Transiciones de estado**:

```text
draft ──issue──▶ issued ──void──▶ voided
  │ (editable,      (contenido inmutable;      (excluida de cobros FR-024;
  │  sin número)     admite pagos, enlaces,     enlace público muestra "anulado")
  └─ deletable       envíos, recibo)

payment ──create receipt──▶ issued ──void──▶ voided
```

- `issue` de factura/proforma: valida cliente + ≥1 línea (US1-AC4), empresa lista (FR-003) y delega en la guarda transaccional común de emisión; esta comprueba el límite de plan (FR-027), asigna número, congela snapshots, recalcula y persiste totales, fija `pdf_status=pending` y encola un único render de PDF.
- Emitido: solo cambian campos de relación (pagos, enlaces, conversión); contenido y totales inmutables. No se elimina jamás; solo `void` (FR-014).
- Borrador: editable y eliminable lógicamente mediante `deleted_at`; el documento y
  sus eventos permanecen para conservar la auditoría INSERT-only. Un borrador
  eliminado queda excluido de listados, detalle, edición y emisión.
- Duplicar (FR-017): factura o proforma → nuevo `draft` copiando cliente, líneas y notas (fechas nuevas, sin número). Los recibos se rechazan.
- Recibo: no pasa por `draft`; primero se resuelve idempotentemente `payment_id` y, si ya existe, se devuelve el recibo aunque el cupo se haya agotado después. Para uno nuevo, la guarda común bloquea empresa, valida cupo, bloquea serie y crea el documento directamente en `issued`; congela emisor/cliente, fija `total_cents = payment.amount_cents`, deja desglose fiscal/retención a cero, marca `pdf_status=pending`, encola un render y registra auditoría. Un rechazo de plan no consume número ni crea PDF/evento.
- PDF: el consumidor detecta estados terminales; `ready` es idempotente. La descarga nunca renderiza: `pending` responde 202 y `failed` permite reencolar de forma controlada.

**Estado de cobro (derivado, nunca almacenado — FR-024)**: sobre facturas emitidas, con `paid_cents = Σ payments`:
`voided → excluida` · `paid_cents ≥ total → pagada` · `0 < paid < total y due_date < hoy → vencida (parcial)` · `paid = 0 y due_date < hoy → vencida` · `0 < paid < total → parcialmente pagada` · `resto → pendiente`.

**Índices**: `(company_id, deleted_at)` para ocultar borradores eliminados; `(company_id, doc_type, status, issue_date desc)` (listados/panel); `(company_id, client_id)` (ficha cliente FR-007); `(company_id, due_date) WHERE status='issued' AND doc_type='invoice'` (vencidas); unique parcial de `full_number`. Agregados del panel (FR-025) por consulta agregada con estos índices; a 10x, vista materializada como plan documentado.

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

Sin FK a `catalog_item`: la línea copia valores del catálogo (desacoplada, FR-010 / US4-AC2/AC3). Solo facturas y proformas tienen líneas; los recibos reflejan el pago vinculado.

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

### email_delivery — Entrega idempotente de email documental y de autenticación (FR-001, FR-021, Principios II y IV)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | también identifica el mensaje de cola |
| purpose | enum('document','verify_email','reset_password') | selecciona origen y plantilla |
| company_id / document_id | uuid FK null | requeridos solo para `document` |
| user_id | uuid FK→user null | requerido para auth; destinatario de la acción |
| auth_verification_id | text FK→verification null | registro temporal de Better Auth; requerido para auth |
| requested_by | uuid FK→user null | actor; null para solicitudes anónimas de recuperación |
| idempotency_key | varchar(256) unique | estable y global; nunca contiene email ni token |
| recipient_email | text null | necesario durante entrega; nunca en logs |
| recipient_hash | text | hash para diagnóstico/auditoría sin revelar destinatario |
| custom_message | text null | solo documento; opcional y nunca en logs |
| status | enum('queued','sending','sent','failed') | máquina de estados persistida |
| provider_message_id | text null | id de Resend |
| attempt_count | integer default 0 | incrementa por intento |
| last_error_code | text null | código estable, sin cuerpo sensible |
| created_at / updated_at / sent_at | timestamptz | |

**Idempotencia**: el endpoint documental o callback de Better Auth inserta la fila y encola `{delivery_id}`. Un duplicado devuelve la fila existente. El consumidor reclama `queued|failed → sending` de forma atómica, no reenvía estados `sent`, carga por id el documento o registro de verificación, selecciona la plantilla por `purpose` y usa `email/{delivery_id}` como clave de Resend. Solo `purpose=document` crea exactamente un `document_event email_sent`. Los reintentos terminan antes de 24 horas y, para auth, antes de expirar la verificación; después se requiere una solicitud nueva. La respuesta de recuperación es idéntica si el usuario no existe. `recipient_email` y `custom_message` se purgan como máximo 30 días después del estado terminal; la referencia de auth se elimina al expirar o consumirse.

**Índices**: unique `(idempotency_key)`; `(document_id, created_at)`; `(user_id, purpose, created_at)`; `(status, created_at)` para recuperación operativa.

### document_event — Auditoría inmutable (FR-018, constitución)

| Campo | Tipo | Reglas |
|-------|------|--------|
| id | uuid PK | |
| company_id / document_id | uuid FK | |
| actor | text | user_id o `system` |
| event | enum('created','updated','issued','voided','converted','duplicated','pdf_generated','pdf_failed','link_created','link_disabled','email_queued','email_sent','email_failed','payment_added','payment_updated','payment_deleted') | |
| payload | jsonb null | detalle (sin datos sensibles en claro innecesarios) |
| created_at | timestamptz | |

**Solo INSERT** (sin UPDATE/DELETE a nivel de aplicación y sin permisos de update en el rol de BD). El borrado lógico de un borrador se registra como evento `updated` con payload estable `{operation: "draft_deleted"}` para conservar la trazabilidad sin ampliar el enum. Índice `(document_id, created_at)`.

### Capacidades y límite de plan (FR-027)

Sin tabla ni límite persistido por empresa en v1. `src/lib/plan.ts` es la única fuente: `free = {docLimit: 5, canSendEmail: false}` y `pro = {docLimit: 100, canSendEmail: true}`. Documentos emitidos del mes = `COUNT(*)` sobre `document` con `issued_at` dentro del mes natural `Europe/Madrid` e índice `(company_id, issued_at)`; los anulados cuentan y los borradores no. Aviso no bloqueante al alcanzar `ceil(0,8 × límite)` —4 para free, 80 para pro—; al llegar a 5/100 se bloquea solo crear un nuevo documento emitido, nunca crear borradores, devolver el resultado de una operación idempotente ni acceder a documentos existentes.

**Guarda transaccional de emisión**: `src/services/document-issuance.ts` es la única entrada para crear cualquier `document.status='issued'`. Puede resolver una repetición idempotente como vía rápida y, en la misma transacción: (1) bloquea `company` con `SELECT ... FOR UPDATE`; (2) vuelve a resolver el resultado idempotente para cerrar la carrera con solicitudes concurrentes y lo devuelve si existe; (3) cuenta documentos emitidos del periodo y rechaza `plan_limit_reached` si no queda cupo; (4) bloquea `document_series`; (5) asigna número y persiste documento, evento y estado PDF. Emisión convencional, conversión con emisión directa y recibos respetan siempre el orden `company → document_series`; un rollback no deja número, documento, evento ni mensaje de cola.
