# API Contract: Invoice Flash

**Date**: 2026-07-09 | **Plan**: [../plan.md](../plan.md) | **Data model**: [../data-model.md](../data-model.md)

Interfaz REST expuesta por los route handlers de Next.js. Es el contrato entre UI y backend y la superficie pública (enlaces compartidos). Los cuerpos se validan con Zod en servidor; los esquemas Zod son la fuente de verdad tipada compartida con el frontend.

## Convenciones

- **Base**: `/api/v1` (privada, sesión requerida) · `/d/:token` (pública, sin sesión).
- **Auth**: sesión de Better Auth (cookie httpOnly, SameSite=Lax). Endpoints de auth montados por Better Auth en `/api/auth/*` (sign-up, sign-in, sign-out, forget/reset-password, verify-email) — contrato delegado en la librería (FR-001).
- **Autorización**: toda entidad se resuelve por `(company_id de la sesión, id)`; un recurso ajeno responde `404` (no `403`, para no revelar existencia) (FR-004).
- **Paginación**: todas las colecciones — `?limit` (default 25, máx 100) + `?cursor` (opaco). Respuesta: `{ items: [...], next_cursor: string | null }`.
- **Errores**: `{ error: { code: string, message: string, field_errors?: {campo: mensaje}[] } }`. `message` en español y accionable; `code` estable para la UI (`validation_error`, `not_found`, `conflict`, `plan_limit_reached`, `feature_not_in_plan`, `company_incomplete`…). HTTP: 400 validación, 401 sin sesión, 404 no existe/ajeno, 402/403 `feature_not_in_plan`, 409 conflicto de estado, 429 rate limit.
- **Importes**: siempre en céntimos enteros (`*_cents`). Fechas: `YYYY-MM-DD`; instantes: ISO 8601 UTC.

## Empresa

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/company` | Perfil + flags derivados: `is_ready_to_issue`, `plan`, `docs_issued_this_month`, `doc_limit` |
| PUT | `/api/v1/company` | Actualiza perfil y preferencias (FR-002); valida NIF |
| PUT | `/api/v1/company/logo` | Sube logo (multipart, ≤2 MB png/jpg/svg) → R2 |
| DELETE | `/api/v1/company/logo` | Elimina logo |

## Series de numeración

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/series` | Series por tipo de documento |
| POST | `/api/v1/series` | Crea serie `{doc_type, prefix, next_number, is_default}` (FR-013) |
| PATCH | `/api/v1/series/:id` | Edita prefijo/inicial (solo si la serie no tiene documentos emitidos) o marca default |

## Clientes

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/clients?q=&archived=&limit=&cursor=` | Lista/búsqueda por nombre o NIF (FR-006) |
| POST | `/api/v1/clients` | Crea cliente (FR-005) |
| GET | `/api/v1/clients/:id` | Ficha + `{pending_cents, overdue_cents}` (FR-007) |
| GET | `/api/v1/clients/:id/documents?limit=&cursor=` | Historial de documentos del cliente (FR-007) |
| PATCH | `/api/v1/clients/:id` | Edita (no afecta a documentos emitidos: snapshot) |
| POST | `/api/v1/clients/:id/archive` · `/unarchive` | Archivado reversible (FR-008) |

## Catálogo

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/catalog-items?q=&limit=&cursor=` | Lista/búsqueda (FR-009) |
| POST | `/api/v1/catalog-items` | Crea concepto |
| PATCH | `/api/v1/catalog-items/:id` | Edita (no altera documentos: las líneas copian valores) |
| DELETE | `/api/v1/catalog-items/:id` | Archiva (soft) |

## Documentos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/documents?type=&status=&payment_status=&client_id=&from=&to=&limit=&cursor=` | Listado filtrable (FR-025); `payment_status` derivado: `pending`\|`partial`\|`paid`\|`overdue` |
| POST | `/api/v1/documents` | Crea borrador `{doc_type, client_id?, issue_date?, due_date?, lines[], notes?}`; devuelve totales calculados |
| GET | `/api/v1/documents/:id` | Detalle: líneas, totales, pagos, enlaces, historial (`events`), estado de cobro derivado |
| PATCH | `/api/v1/documents/:id` | Edita **solo borradores** (409 si emitido) |
| DELETE | `/api/v1/documents/:id` | Elimina **solo borradores** (409 si emitido — FR-014) |
| POST | `/api/v1/documents/:id/issue` | Emite: valida completitud (400 `company_incomplete` / `validation_error` con faltas concretas, US1-AC4), límite de plan (402 `plan_limit_reached`), asigna número correlativo, congela snapshots, encola PDF |
| POST | `/api/v1/documents/:id/void` | Anula documento emitido (409 si borrador) |
| POST | `/api/v1/documents/:id/duplicate` | Nuevo borrador copiado (FR-017) |
| POST | `/api/v1/documents/:id/convert` | Proforma emitida → borrador de factura vinculado, o emisión directa `{issue: true}` (FR-016); 409 si ya convertida o no es proforma |
| GET | `/api/v1/documents/:id/pdf` | PDF (FR-019): sirve de caché R2; si no está, render on-demand y cachea. `Content-Disposition: attachment` |
| POST | `/api/v1/documents/:id/receipt` | Genera recibo desde factura con pagos `{payment_id}` (US6-AC3) |

**Validaciones de línea** (400 con `field_errors`): `quantity > 0`, `unit_price_cents ≥ 0`, `discount_pct ∈ [0,100]`, `description` no vacía (edge case importes inválidos).

## Pagos

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/documents/:id/payments` | Registra pago `{amount_cents, paid_on, method?}`; si `amount > pendiente` → 409 `overpayment_confirmation_required`, reintento con `{confirmed_overpayment: true}` (edge case) |
| PATCH | `/api/v1/payments/:id` | Corrige pago; estado de factura se rederiva (FR-026) |
| DELETE | `/api/v1/payments/:id` | Elimina pago; queda `document_event` |

## Compartir y enviar (US5)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/documents/:id/share-link` | Crea/reactiva enlace `{url, token}` (FR-020) |
| DELETE | `/api/v1/documents/:id/share-link` | Desactiva el enlace (US5-AC2) |
| POST | `/api/v1/documents/:id/email` | Encola envío `{to, message?}`; 403 `feature_not_in_plan` con alternativas si el plan no lo incluye (FR-021, FR-022); constancia en historial |

## Panel de cobros (US2)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/dashboard?from=&to=` | `{paid_cents, pending_cents, overdue_cents, counts_by_status}` del periodo + últimas facturas (FR-025, SC-004) |

## Superficie pública (sin sesión)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/d/:token` | Página del documento (SSR, responsive, SC-006). Anulado → aviso claro. Token inválido/desactivado → 404 genérico |
| GET | `/d/:token/pdf` | Descarga del PDF vía enlace activo |

Rate limit por IP en `/d/*` (Cloudflare). Los tokens no se registran en logs.

## Contratos asíncronos (Cloudflare Queues)

| Mensaje | Productor | Consumidor | Efecto |
|---------|-----------|------------|--------|
| `pdf.render {document_id}` | `issue` | queue-consumer | Render pdf-lib → R2 `pdfs/{company_id}/{document_id}.pdf` + evento `pdf_generated` |
| `email.send {document_id, to, message?}` | endpoint email | queue-consumer | Resend + evento `email_sent`; reintentos con backoff, dead-letter tras 3 fallos |
