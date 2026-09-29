# API Contract: Invoice Flash

**Date**: 2026-07-09 | **Updated**: 2026-07-30 | **Plan**: [../plan.md](../plan.md) | **Data model**: [../data-model.md](../data-model.md)

Interfaz REST expuesta por los route handlers de Next.js. Es el contrato entre UI y backend y la superficie pública (enlaces compartidos). Los cuerpos se validan con Zod en servidor; los esquemas Zod son la fuente de verdad tipada compartida con el frontend.

## Convenciones

- **Base**: `/api/v1` (privada, sesión requerida) · `/d/:token` (pública, sin sesión).
- **Auth**: sesión de Better Auth (cookie httpOnly, SameSite=Lax). Endpoints en `/api/auth/*` (sign-up, sign-in, sign-out, forget/reset-password, verify-email). Sign-up y recuperación persisten `email_delivery` y encolan solo `{delivery_id}`; nunca llaman a Resend en HTTP. `forget-password` devuelve la misma respuesta aceptada exista o no la cuenta (FR-001).
- **Autorización**: toda entidad se resuelve por `(company_id de la sesión, id)`; un recurso ajeno responde `404` (no `403`, para no revelar existencia) (FR-004).
- **Paginación**: todas las colecciones — `?limit` (default 25, máx 100) + `?cursor` (opaco). Respuesta: `{ items: [...], next_cursor: string | null }`.
- **Errores**: `{ error: { code: string, message: string, field_errors?: {campo: mensaje}[] } }`. `message` en español y accionable; `code` estable para la UI (`validation_error`, `not_found`, `conflict`, `plan_limit_reached`, `feature_not_in_plan`, `company_incomplete`…). HTTP: 400 validación, 401 sin sesión, 404 no existe/ajeno, 402/403 `feature_not_in_plan`, 409 conflicto de estado, 429 rate limit.
- **Importes**: siempre en céntimos enteros (`*_cents`). Fechas: `YYYY-MM-DD`; instantes: ISO 8601 UTC.
- **Trabajo pendiente**: operaciones asíncronas responden `202` con código estable, estado y `Retry-After`; ninguna ruta HTTP genera PDF ni envía email.
- **Idempotencia**: las mutaciones con efectos externos aceptan `Idempotency-Key` (máx. 256 caracteres). Repetir la misma clave devuelve el recurso original sin repetir el efecto.

## Empresa

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/company` | Perfil + flags derivados: `is_ready_to_issue`, `plan`, `docs_issued_this_month`, `doc_limit` (`5` free, `100` pro), `can_send_email` y `usage_warning`; mes `Europe/Madrid`, anulados incluidos |
| PUT | `/api/v1/company` | Actualiza perfil y preferencias (FR-002); valida NIF |
| PUT | `/api/v1/company/logo` | Sube logo (multipart, ≤2 MB png/jpg/svg) → R2 |
| DELETE | `/api/v1/company/logo` | Elimina logo |

## Series de numeración

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/series?doc_type=&limit=&cursor=` | Series paginadas por tipo; default 25, máximo 100 |
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
| DELETE | `/api/v1/catalog-items/:id` | Archiva de forma reversible y lo excluye de selectores |
| POST | `/api/v1/catalog-items/:id/restore` | Restaura un concepto archivado (FR-009) |

## Documentos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/documents?type=&status=&payment_status=&client_id=&from=&to=&limit=&cursor=` | Listado filtrable (FR-025); `payment_status` derivado: `pending`\|`partial`\|`paid`\|`overdue` |
| POST | `/api/v1/documents` | Crea borrador de factura o proforma `{doc_type, client_id?, issue_date?, due_date?, lines[], notes?}`; `receipt` se rechaza y se genera solo desde pago |
| GET | `/api/v1/documents/:id` | Detalle: líneas, totales, pagos, enlaces, historial (`events`), estado de cobro derivado |
| PATCH | `/api/v1/documents/:id` | Edita **solo borradores** (409 si emitido) |
| DELETE | `/api/v1/documents/:id` | Oculta lógicamente **solo borradores**, preservando su auditoría; los borradores eliminados dejan de aparecer en listado, detalle y emisión (409 si emitido — FR-014) |
| POST | `/api/v1/documents/:id/issue` | Emite mediante la guarda transaccional común: valida completitud, aplica límite `5/100` contando emitidos luego anulados del mes `Europe/Madrid` (402 `plan_limit_reached`), asigna número correlativo, congela snapshots y encola PDF |
| POST | `/api/v1/documents/:id/void` | Anula documento emitido (409 si borrador) |
| POST | `/api/v1/documents/:id/duplicate` | Nuevo borrador copiado (FR-017) |
| POST | `/api/v1/documents/:id/convert` | Proforma emitida → borrador de factura vinculado, o emisión directa `{issue: true}` mediante la guarda de cupo común (402 `plan_limit_reached`); 200 idempotente si ya existe la conversión solicitada, 409 si el estado/tipo no admite convertir |
| GET | `/api/v1/documents/:id/pdf` | Si `pdf_status=ready`, sirve R2 con `Content-Disposition: attachment`; si `pending`, `202 {status:"processing", code:"pdf_processing"}` + `Retry-After`; si `failed`, `409 pdf_generation_failed`. Nunca renderiza en HTTP |
| POST | `/api/v1/documents/:id/receipt` | Genera directamente como emitido el recibo de `{payment_id}` total o parcial mediante la guarda de cupo común; `201` al crear, 402 `plan_limit_reached` si crear uno nuevo excede el límite y `200` con el mismo recibo al repetir incluso si el cupo se agotó después. Rechaza pagos de otra factura/empresa; asigna número, snapshots y PDF pending atómicamente (US6-AC3, FR-011, FR-027) |

**Invariante común de emisión (FR-027)**: las tres rutas capaces de crear un nuevo documento emitido —`issue`, `convert` con `{issue:true}` y `receipt`— serializan por empresa la comprobación de cupo antes de reservar numeración. Solicitudes concurrentes solo ocupan las plazas disponibles; toda rechazada con `plan_limit_reached` revierte sin número, documento, evento ni PDF. Las repeticiones idempotentes que recuperan una conversión o recibo existente se resuelven antes del cupo y nunca consumen otra plaza.

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
| POST | `/api/v1/documents/:id/email` | Requiere `Idempotency-Key`; crea/reutiliza `email_delivery`, encola `{delivery_id}` y responde `202 {delivery_id,status}`; 403 `feature_not_in_plan` con alternativas (FR-021, FR-022) |
| GET | `/api/v1/documents/:id/email-deliveries?limit=&cursor=` | Historial paginado de entregas sin exponer destinatario en claro |

## Panel de cobros (US2)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/v1/dashboard?from=&to=` | `{paid_cents, pending_cents, overdue_cents, counts_by_status}` del periodo (FR-025, SC-004); las facturas se consultan en el listado paginado |

La pantalla de dashboard MUST solicitar en paralelo estos agregados y `GET /api/v1/documents?...&limit=&cursor=` con los mismos filtros, mostrando totales y colección paginada en una única vista. No se permite incrustar una colección sin paginar en la respuesta de agregados.

## Superficie pública (sin sesión)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/d/:token` | Página del documento (SSR, responsive, SC-006). Anulado → aviso claro. Token inválido/desactivado → 404 genérico |
| GET | `/d/:token/pdf` | PDF vía enlace activo; `200` desde R2 o `202 pdf_processing` + `Retry-After`; nunca renderiza |

Rate limit por IP en `/d/*` (Cloudflare). Los tokens no se registran en logs.

## Contratos asíncronos (Cloudflare Queues)

| Mensaje | Productor | Consumidor | Efecto |
|---------|-----------|------------|--------|
| `pdf.render {document_id}` | `issue` | queue-consumer | Si `pdf_status=ready`, ack; si no, render → R2 determinista → `ready` + evento único `pdf_generated`; reintentos/backoff/DLQ |
| `email.send {delivery_id}` | endpoint documental o callback Better Auth | queue-consumer | Reclamo atómico; si `sent`, ack; carga el origen y plantilla por `purpose`; Resend con `idempotencyKey=email/{delivery_id}` → `sent`; solo documento crea evento. Reintentos <24 h y dentro de la vigencia auth; después DLQ sin reenvío automático |

Queues ofrece entrega al menos una vez. Los dos consumidores deben soportar mensajes repetidos sin duplicar efectos. El productor no incluye NIF, importes, destinatarios, mensajes, tokens ni URLs de autenticación en el cuerpo de cola; solo identificadores opacos.
