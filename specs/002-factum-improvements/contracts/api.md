# API Contract: Factum — Mejoras v2 (delta)

**Date**: 2026-10-20 | **Plan**: [../plan.md](../plan.md) | **Data model**: [../data-model.md](../data-model.md) | **Base**: [../../001-invoice-flash/contracts/api.md](../../001-invoice-flash/contracts/api.md)

Solo se listan endpoints **nuevos o modificados**. Las convenciones v1 siguen vigentes sin excepción: `/api/v1`, sesión Better Auth, recurso ajeno → `404`, paginación por cursor (default 25, máx. 100), errores `{error:{code,message,field_errors?}}` en español, céntimos enteros, `Idempotency-Key` en mutaciones con efectos externos, ninguna ruta HTTP genera PDF ni envía email.

## Convenciones nuevas

- **Contexto de empresa**: cada petición resuelve `{company_id, role}` desde la sesión (`session.active_company_id` validado contra propiedad o `company_access` activo). Las rutas se declaran `read` o `write`.
  - Rol `advisor` en ruta `write` → `403 read_only_access`.
  - Rol `advisor` en empresa sin Pro → `403 advisor_access_suspended`.
- **Funciones por plan**: ruta de una función no incluida → `403 feature_not_in_plan` con `{feature, required_plan}` (FR-013). La UI lo transforma en explicación + invitación (FR-058).
- **Cupo**: `402 plan_limit_reached` ahora incluye `{document_type, limit, used, upgrade_url}`; el cupo es **por tipo** (FR-008).
- **Códigos nuevos**: `series_archived`, `iban_invalid`, `conversion_not_allowed`, `conversion_repeat_confirmation_required`, `delivery_note_already_invoiced` (incluye `invoice_id`, `invoice_number`), `import_too_large`, `export_empty`, `confirmation_required`, `confirmation_expired`.

## Empresa, plan y navegación

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/company` | read | **Modificado**: añade `plan` (`basic\|essential\|pro`), `usage: [{document_type, used, limit, warning}]` por tipo, `features: string[]`, `ui_mode`, `effective_ui` (`simple\|full`), `used_document_types`, `onboarding`, `missing_to_issue[]`. Elimina `docs_issued_this_month`/`doc_limit` globales. |
| PUT | `/company` | write | **Modificado**: admite `ui_mode` (`full` solo Pro → `403 feature_not_in_plan`), `advisor_email`, `reminder_policy` (Pro). |
| PUT | `/company/logo` | write | **Modificado**: solo `image/png`/`image/jpeg` ≤ 2 MB, ≤ 4.000 px; clave por contenido (los SVG se rasterizan en el navegador). |
| PATCH | `/company/onboarding` | write | `{complete?: Step, skip?: Step, dismiss?: true}` (FR-048). |
| POST | `/company/onboarding/sample` | write | `202 {sample_id}`; encola `pdf.sample`. Nunca crea documento ni consume cupo (FR-049). |
| GET | `/company/onboarding/sample/:id` | read | `200 application/pdf` si listo; `202 pdf_processing` + `Retry-After` si no. |
| GET | `/notifications?unread=&limit=&cursor=` | read | Avisos del usuario (R21). |
| POST | `/notifications/:id/read` | read | Marca leído (permitido a gestoría: solo afecta a sus propios avisos). |

## Suscripción (US2)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/billing/plans` | público con sesión | Comparativa: planes, `prices[{lookup_key, interval, unit_amount_cents, currency}]` desde `billing_price`, límites por tipo y funciones desde `lib/plan.ts`; señala el plan actual. |
| GET | `/billing/subscription` | owner | `{plan, effective_plan, interval, status, current_period_end, cancel_at_period_end, grace_until}`. |
| POST | `/billing/checkout` | owner | `{lookup_key, resume_document_id?}` → `{url}` de Stripe Checkout. Con suscripción existente, redirige a Portal con flujo de cambio de plan. Requiere `Idempotency-Key`. Precio Pro con `PRO_CHECKOUT_ENABLED` desactivado (hasta el Inc. 3) → `403 plan_not_available`. |
| POST | `/billing/portal` | owner | `{url}` de Stripe Customer Portal (FR-011). |
| GET | `/billing/return?session_id=&resume=` | owner (página) | Sincroniza la sesión de Checkout con la API de Stripe, actualiza plan efectivo y, si `resume` es un borrador propio, reintenta su emisión; redirige al documento (SC-002). |
| POST | `/api/webhooks/stripe` | **público**, firma Stripe | Verifica `Stripe-Signature` (`constructEventAsync`); inserta `billing_event` (duplicado → `200` sin efecto); relee la suscripción en Stripe y reconcilia (`subscription`, `company.plan`, `plan_change`). Eventos: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `price.*`, `product.*`. Nunca registra payload ni datos de tarjeta. |

## Configuración: métodos de cobro, impuestos, unidades, series

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET / POST | `/collection-methods` | read / write | Lista (filtro `archived`) / crea `{kind, label, holder_name?, iban?, bic?, phone?, email_or_url?, instructions?, is_default?}`; IBAN inválido → `400 iban_invalid` sin eco del valor (FR-021). |
| PATCH | `/collection-methods/:id` | write | Edita, `is_default`, archivar/restaurar (`archived: bool`). |
| GET / POST | `/tax-rates` | read / write | `{name, rate}` con `rate` string decimal ≤ 2 decimales (FR-023). |
| PATCH | `/tax-rates/:id` | write | Edita/defecto/archivar; documentos emitidos no cambian. |
| GET / POST | `/units` | read / write | Predefinidas + propias `{name}` (FR-030). |
| GET | `/series?doc_type=&archived=` | read | **Modificado**: incluye `quote`, `delivery_note`; filtro `archived`. |
| PATCH | `/series/:id` | write | **Modificado**: `archived: bool`. |

## Clientes y catálogo

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/clients?q=&archived=` | read | **Modificado**: `q` busca en nombre, NIF, email, teléfono, dirección, CP y ciudad, sin mayúsculas ni acentos (FR-028). |
| POST / PATCH | `/clients[/:id]` | write | **Modificado**: `postal_code`, `city`, `reminders_enabled`. |
| PUT / DELETE | `/clients/:id/logo` | write | Logotipo del cliente (mismas reglas que empresa, FR-025). |
| GET | `/catalog-items?q=` | read | **Modificado**: búsqueda sin acentos; incluye `unit`, `tax_rate_id`. |
| POST / PATCH | `/catalog-items[/:id]` | write | **Modificado**: `unit`, `tax_rate_id`. |
| POST | `/imports` | write · Pro `catalog_import` | `multipart {kind:'catalog'\|'bank_statement', file, collection_method_id?}` → `202 {import_id}`; > 5 MB → `400 import_too_large`. |
| GET | `/imports/:id` | read | Estado, `preview` (mapeo sugerido, filas válidas, errores por fila), `result`. |
| POST | `/imports/:id/confirm` | write | `{mapping, duplicate_policy}` → `202`; solo desde `preview_ready` (FR-031). |
| GET | `/imports/templates/catalog.csv` | read | Plantilla descargable. |

## Documentos

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/documents?type=&status=&...` | read | **Modificado**: `type` admite `quote`, `delivery_note`; nuevos filtros `quote_state`, `invoiced=false` (albaranes no facturados), `client_id`. Cada fila incluye `client_display {name, tax_id}` (FR-004). |
| POST | `/documents` | write | **Modificado**: `doc_type ∈ invoice\|proforma\|quote\|delivery_note`; `series_id?`, `collection_method_id?` (por defecto el método por defecto), `valid_until?` (quote); líneas con `unit?`, `tax_rate_id?`, `catalog_item_id?`. Si el tipo no tiene serie, la crea (`series_created: {prefix, renamed: bool}` en la respuesta, FR-019). |
| GET | `/documents/:id` | read | **Modificado**: `client_display`, `collection_method`, `links {from[], to[]}`, `derived_state` (presupuesto/albarán), `reminder_warning` (sin email del cliente), `series {id, prefix, archived}`. |
| PATCH | `/documents/:id` | write | **Modificado**: admite `series_id` (activa y del mismo tipo, FR-016), `collection_method_id`, `reminders_enabled` (también en emitidos: no es contenido fiscal). |
| DELETE | `/documents/:id` | write | Sin cambio (solo borradores); ahora expuesto en listado y detalle con confirmación (FR-017). |
| POST | `/documents/:id/issue` | write | **Modificado**: cupo por tipo; `409 series_archived`. |
| POST | `/documents/:id/duplicate` | write | **Modificado**: cualquier estado y tipo salvo recibo; fechas a hoy; respuesta con `warnings[]` (cliente/producto/impuesto archivados) (FR-018). |
| POST | `/documents/:id/convert` | write | **Modificado**: `{target_type, issue?: bool, confirm_repeat?: bool}`; transiciones de R4; anulado → `409 conversion_not_allowed`; repetida sin confirmar → `409 conversion_repeat_confirmation_required`; emisión directa por la guarda común (`402` por tipo destino). |
| POST | `/documents/invoice-delivery-notes` | write | `{delivery_note_ids[] (mismo cliente, emitidos, no facturados), issue?: bool}` → factura con líneas agrupadas por albarán; ya facturado → `409 delivery_note_already_invoiced` (FR-036, FR-037). Requiere `Idempotency-Key`. |
| POST | `/documents/:id/quote-decision` | write | `{decision: 'accepted'\|'rejected'}`; solo presupuestos emitidos no anulados. |
| GET | `/documents/:id/print` | read (página) | Vista imprimible HTML que invoca `window.print()` al cargar (FR-020). |
| GET | `/documents/:id/xlsx` | read · Pro `document_xlsx` | Hoja de cálculo del documento emitido; importes tomados de los totales almacenados (FR-027). |
| POST | `/documents/:id/void` | write | **Modificado**: si es factura destino de albaranes, libera sus vínculos `invoiced` en la misma transacción. |

## Exportación y gestoría

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/exports` | read · Esencial `period_export` / Pro `advanced_export` | `{kind:'period_excel', period:'current_month'\|'previous_month'\|'current_quarter'\|'previous_quarter'\|'year', send_to_advisor?}` (Esencial+) o `{kind:'advanced', types[], from, to, status?, client_id?, formats:['xlsx','pdf_zip']}` (Pro) → `202 {export_id}`. Permitido a gestoría (lectura). `send_to_advisor` exige `company.advisor_email` y rol owner. |
| GET | `/exports/:id` | read | `{status, download_url?, expires_at}`; `empty` → mensaje accionable (Edge Cases). |
| GET | `/exports?limit=&cursor=` | read | Historial de exportaciones y envíos a la asesoría (FR-032). |
| GET | `/x/:token` | **público**, rate limit | Descarga el fichero del export si el token es válido y no caducado; si no, `404` genérico. |
| GET / PUT | `/advisor-schedule` | owner · Pro `advisor_schedule` | `{frequency, formats, enabled}` (FR-034). |
| GET | `/advisor-access` | owner · Pro | Lista accesos (estado, aceptado, último acceso) y `access_events` paginados (FR-053). |
| POST | `/advisor-access` | owner · Pro | `{email}` → invitación caducable 7 días (FR-050). |
| DELETE | `/advisor-access/:id` | owner | Revoca con efecto inmediato. |
| POST | `/advisor-invitations/accept` | sesión | `{token}`; vincula la cuenta en sesión con la empresa. |
| GET | `/me/companies` | sesión | Empresas accesibles `{company_id, legal_name, role}`. |
| PUT | `/me/active-company` | sesión | `{company_id}`; valida acceso y actualiza `session.active_company_id` (FR-052). |

## Recurrencias, recordatorios (Pro)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET / POST | `/recurring-templates` | read / write · `recurring` | Lista / crea (FR-038). Valida acción `issue_and_send` contra email del cliente y plan. |
| GET / PATCH | `/recurring-templates/:id` | read / write | Edita (incrementa `version`; solo ciclos futuros), `status: 'active'\|'paused'\|'finished'` (FR-040). |
| GET | `/recurring-templates/:id/cycles?limit=&cursor=` | read | Ciclos con resultado y documento generado. |
| GET | `/documents/:id/reminders` | read | Recordatorios enviados/omitidos de una factura (FR-042). |

La política de recordatorios se edita en `PUT /company` (`reminder_policy`); la desactivación por cliente y por factura en sus `PATCH`.

## Conciliación bancaria (Pro `bank_reconciliation`)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| POST | `/imports` (`kind:'bank_statement'`) | write | Ver arriba; `collection_method_id` obligatorio y de tipo `bank_account`. |
| GET | `/bank-transactions?collection_method_id=&state=&limit=&cursor=` | read | Movimientos con estado derivado. |
| GET | `/reconciliation/suggestions?limit=&cursor=` | read | Ingresos pendientes con hasta 3 facturas sugeridas y puntuación (FR-044). |
| POST | `/reconciliations` | write | `{bank_transaction_id, allocations:[{document_id, amount_cents}]}`; suma ≤ importe del movimiento y ≤ pendiente salvo confirmación de sobrepago (regla v1); crea pagos (FR-045). Requiere `Idempotency-Key`. |
| DELETE | `/reconciliations/:id` | write | Deshace: borra pago generado. |
| POST | `/bank-transactions/:id/ignore` · `/unignore` | write | |

## Panel (US13)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/dashboard?from=&to=` | read | **Modificado**: todos los planes `{paid_cents, pending_cents, overdue_cents}`; con `dashboard_full`: `+invoiced_base_cents, invoiced_total_cents, tax_collected:[{name, rate, cents}]`. |
| GET | `/dashboard/monthly?months=12` | read · `dashboard_full` | `[{month, invoiced_cents, collected_cents}]`. |
| GET | `/dashboard/top-clients?from=&to=&limit=5` | read · `dashboard_full` | Máx. 5 (no es colección abierta). |
| GET | `/dashboard/treasury` | read · `dashboard_full` | `{accounts:[{collection_method_id, label, balance_cents, balance_on}], expected_30d_cents, expected_by_week[]}`. |

## Asistente de IA (Pro `ai_assistant`)

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET/POST | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/api/auth/oauth2/*` | público | Metadatos y flujo OAuth 2.1 + PKCE + registro dinámico (plugin de Better Auth). |
| GET | `/oauth/consent` | sesión (página) | Consentimiento explícito; crea `ai_connection` (FR-054). |
| POST | `/api/mcp` | Bearer OAuth | Servidor MCP Streamable HTTP sin estado. Rate limit 60/min por conexión. Conexión revocada o empresa sin Pro → `401`/`403` inmediato. |
| GET | `/ai-connections` | owner | Conexiones con `authorized_at`, `last_used_at`, estado. |
| DELETE | `/ai-connections/:id` | owner | Revoca (FR-054). |

**Herramientas MCP** (todas con el mismo Zod, scoping y límites del plan que la API; listas paginadas):

| Herramienta | Efecto |
|---|---|
| `search_clients`, `get_client`, `create_client` | Varias coincidencias → devuelve opciones, nunca elige. |
| `search_products`, `create_product` | |
| `list_documents`, `get_document`, `get_payment_summary` | Estados de cobro derivados. |
| `create_draft`, `update_draft` | Borradores. |
| `request_issue`, `request_void` | Devuelven resumen + `confirmation_token` (5 min, un uso); no ejecutan. |
| `confirm_action {confirmation_token}` | Ejecuta emisión/anulación; actor `ai:{connection}:user:{id}` (FR-056). |
| `send_document`, `record_payment` | Mismas reglas de plan (email solo Esencial+) e idempotencia. |

## Contratos asíncronos (Cloudflare Queues)

Colas v1 (`pdf-render`, `email-send`) sin cambios de contrato. Nueva cola **`invoice-flash-jobs`** (con DLQ, máx. 3 reintentos, backoff v1). Todos los mensajes llevan solo identificadores opacos.

| Mensaje | Productor | Efecto idempotente |
|---|---|---|
| `pdf.sample {sample_id}` (cola `pdf-render`) | onboarding | Render con marca «EJEMPLO – sin validez»; `sample_render.status=ready`. |
| `recurring.run {cycle_id}` | planificador cron | Reclamo por `recurring_cycle` único; borrador / guarda de emisión (`recurring_cycle`) / `email_delivery`; notificación. |
| `reminder.send {reminder_id}` | planificador cron | Revalida estado de cobro y email; crea `email_delivery` (`payment_reminder`) o marca `skipped_*`. |
| `export.build {export_id}` | `/exports`, cron asesoría | Construye XLSX y/o ZIP (multipart R2); token de descarga; email a asesoría si procede. |
| `import.analyze {import_id}` / `import.apply {import_id}` | `/imports` | Análisis sin efectos / aplicación por lotes de 500. |
| `billing.grace {company_id}` | planificador cron | Aviso día 5 y degradación al vencer `grace_until`. |

**Planificador** (`scheduled`, cron `0 5 * * *`): solo selecciona e inserta reclamos (`recurring_cycle`, `payment_reminder`, `export_job` de sistema) con `ON CONFLICT DO NOTHING` y encola; limpia muestras, exports caducados y logotipos huérfanos. El cron v1 `0 3 * * *` (purga de PII) no cambia.

## Matriz de permisos (SC-011) — debe cubrirse con tests de contrato

| Actor \ Operación | Lectura | Escritura | Emisión | Exportar | Suscripción | Funciones Pro |
|---|---|---|---|---|---|---|
| Propietario Básico | ✅ | ✅ | ✅ (5/tipo) | ❌ `feature_not_in_plan` | ✅ | ❌ |
| Propietario Esencial | ✅ | ✅ | ✅ (100/tipo) | periodo ✅ / avanzada ❌ | ✅ | ❌ |
| Propietario Pro | ✅ | ✅ | ✅ (1.000/tipo) | ✅ | ✅ | ✅ |
| Gestoría (empresa Pro) | ✅ | ❌ `read_only_access` | ❌ | ✅ (sin envío a asesoría) | ❌ | solo lectura |
| Gestoría (empresa no Pro) | ❌ `advisor_access_suspended` | ❌ | ❌ | ❌ | ❌ | ❌ |
| Asistente IA (Pro) | ✅ | clientes, productos, borradores, pagos | con confirmación | ❌ | ❌ | — |
| Cualquiera sobre empresa ajena | `404` | `404` | `404` | `404` | `404` | `404` |
