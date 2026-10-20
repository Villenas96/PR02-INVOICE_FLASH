# Research: Factum — Mejoras de producto v2

**Date**: 2026-10-20 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

**Contexto de entrada**: el stack de la v1 ([../001-invoice-flash/research.md](../001-invoice-flash/research.md)) se mantiene íntegro: TypeScript strict, Next.js 15 App Router, Cloudflare Workers vía OpenNext, Neon Postgres + Drizzle, Better Auth, pdf-lib + R2, Resend vía Queues, Tailwind 4 + shadcn/ui, pnpm. Esta investigación solo resuelve lo que la spec 002 añade. Cada decisión se evalúa contra la constitución v1.0.0 (en especial: trabajo pesado en colas, céntimos enteros, numeración solo al emitir, inmutabilidad, scoping por `company_id`, coste estimado).

Antes de decidir se auditó el código existente (requisito de la spec, apartado «Funciones parcialmente existentes»). Los hallazgos están en R0 y condicionan varias decisiones.

---

## R0. Auditoría de lo existente (causa raíz de los defectos de US1)

| Mejora | Hallazgo en el código | Consecuencia para el plan |
|---|---|---|
| 3, 7 (banner y contador obsoletos) | `src/app/(app)/layout.tsx` calcula banner y consumo en el **Server Component** del layout; las mutaciones de cliente (`apiRequest`) nunca llaman a `router.refresh()` (solo `auth-form.tsx` lo hace). | Fix transversal: un único hook de mutación que refresca el árbol RSC tras éxito (R17). No hace falta estado global de cliente. |
| 4 (identificador visible) | `ClientPicker` es un `<select>` cuyo `value` es el id; si el cliente seleccionado no está en la página de resultados de búsqueda, se pierde su etiqueta. | El combobox guarda el **objeto** seleccionado (`id`, nombre, NIF), no solo el id; el editor lo recibe del detalle del borrador (R8). |
| 9 (duplicar) | Existe `POST /documents/:id/duplicate`; la UI solo lo expone en `document-actions.tsx` (detalle) y solo para algunos estados. | Reutilizar endpoint; ampliar a todos los estados/tipos y exponer en listado. |
| 11 (editar/eliminar borradores) | Existen `PATCH` y `DELETE` (borrado lógico `deleted_at`) de borradores; no hay acciones en el listado. | Solo UI + confirmación; sin cambios de API. |
| 12 (archivar clientes) | Existen `archive`/`unarchive`; no hay filtro «Archivados» ni acción en la lista. | Solo UI + parámetro `archived` ya soportado. |
| 14, 16 (logotipos) | `issuer_snapshot.logoKey` apunta a una clave R2 **mutable**; el PDF no dibuja logotipos; se aceptan SVG, que `pdf-lib` no puede incrustar. | Claves R2 direccionadas por contenido + PNG/JPEG para PDF (R10). |
| 17, 27 (notas, email del cliente) | `pdf/template.ts:458` imprime `Sin notas.`; `template.ts:146` añade `party.email` del cliente. | Cambios de plantilla; cubiertos por tests de snapshot del PDF. |
| 1 (marca de los correos) | `email/templates/*.ts` y `lib/auth.ts` (`appName`) contienen «Invoice Flash»; el remitente sale de configuración. | Plantillas + `EMAIL_FROM` con dominio de Factum verificado en Resend (R16). |
| 15 (series automáticas) | Series = `prefix` + número con relleno a 4 dígitos (`lib/numbering`); existe la rotación anual. | El «formato de la serie de facturas» es su prefijo; las series nuevas derivan de él (R7). |
| 2 (cupo) | La guarda de `services/document-issuance.ts` ya bloquea `company → document_series` y cuenta emitidos del mes en SQL con `CASE plan`. | El cupo por tipo es un cambio local de esa misma sentencia (R2). |

## R1. Procesador de pagos de la suscripción: Stripe Billing + Checkout + Customer Portal

- **Decision**: Stripe Billing con **Checkout** (alta y mejora), **Customer Portal** (cambiar plan/periodicidad, medio de pago, facturas de suscripción, cancelar) y **webhooks** firmados como única fuente de cambios de plan. SDK `stripe` con `Stripe.createFetchHttpClient()` y verificación `constructEventAsync` (SubtleCrypto), ambos compatibles con workerd. Precios referenciados por `lookup_key` (`essential_monthly`, `essential_yearly`, `pro_monthly`, `pro_yearly`) y sincronizados a una tabla local por webhook `price.*`/`product.*`, de modo que cambiar precios no requiere desarrollo (spec, Assumptions).
- **Rationale**: Customer Portal cubre FR-011 completo sin UI propia (menos código, menos superficie PCI: nunca tocamos datos de tarjeta). Checkout gestiona SCA/3DS exigido en la UE. Los webhooks permiten FR-010 («solo tras confirmación del cobro»). Comisiones orientativas para tarjetas EEE: ~1,5 % + 0,25 € por cobro + ~0,7 % de Stripe Billing; sin cuota fija (Principio IV: escala a cero). Se verifican en la página de precios de Stripe al contratar.
- **Idempotencia y orden (FR-013)**: cada evento se inserta en `billing_event` con `stripe_event_id` único (repetido → 200 sin efecto). Para tolerar desorden, el handler **no aplica el payload del evento**: relee la suscripción actual desde la API de Stripe y reconcilia el estado local completo en una transacción (patrón «fetch-on-webhook»). Toda reconciliación que cambie el plan efectivo inserta `plan_change` (solo INSERT, con origen y evento).
- **Periodo de gracia (FR-011)**: Stripe reintenta el cobro (Smart Retries); localmente `invoice.payment_failed` fija `grace_until = now + 7 d`. El cron diario avisa al día 5 y degrada a Básico al expirar si la suscripción sigue impagada. Al pagarse, `grace_until` se limpia. Nunca queda un plan de pago sin cobro confirmado más allá de la gracia. Para que Stripe y la app no diverjan, los reintentos de cobro de Stripe se configuran en el dashboard para terminar dentro de los 7 días con «cancelar suscripción» (no se puede fijar por API; va en el runbook), y además la app cancela la suscripción por API al expirar la gracia, por si los reintentos siguieran activos.
- **Facturas de la suscripción**: precios con IVA 21 % incluido mediante un tax rate de Stripe; Checkout exige dirección de facturación y NIF (`tax_id_collection`) para que la factura de Stripe sea válida y deducible para el autónomo. Se descarta Stripe Tax (~0,5 % por transacción) porque el mercado es solo España peninsular y Baleares con un único tipo; Canarias, Ceuta y Melilla quedan fuera del primer alcance.
- **Emisión bloqueada (FR-009, SC-002)**: Checkout recibe `success_url=/billing/return?session_id=…&resume=<document_id>`. La ruta de retorno sincroniza la sesión con la API de Stripe (no espera al webhook, que puede llegar después) y, si el plan ya es efectivo, reintenta la emisión del borrador conservado. Si el pago se abandona, el borrador sigue intacto y sin número (la guarda de cupo rechazó antes de reservar numeración).
- **Alternatives considered**:
  - *Paddle / Lemon Squeezy (merchant of record)*: resuelven el IVA de la venta, pero cobran ~5 % + 0,50 € por transacción, casi el triple que Stripe sobre cuotas de 5–15 €. Rechazado por coste; el IVA del SaaS a autónomos españoles es un único tipo (21 %), resuelto con precios con IVA incluido (ver «Facturas de la suscripción»).
  - *UI propia de gestión con Stripe Elements*: más control, pero reimplementa lo que Customer Portal da gratis y aumenta superficie de seguridad. Rechazado.
  - *Aplicar el payload del webhook directamente*: falla ante eventos desordenados (un `updated` antiguo pisaría uno nuevo). Rechazado.

## R2. Planes, capacidades y cupo por tipo

- **Decision**: `src/lib/plan.ts` sigue siendo la **única fuente de verdad versionada** (decisión R15 de la v1), ampliada a tres planes y a límites por tipo de documento:
  - `basic`: 5 por tipo, sin email, interfaz sencilla obligatoria.
  - `essential`: 100 por tipo, email, Excel de periodo y envío manual a la asesoría.
  - `pro`: tope técnico 1.000 por tipo (no comercial) y todas las funciones.
  - Funciones como claves tipadas (`feature: "recurring" | "reminders" | "bank_reconciliation" | ...`) con un único `hasFeature(plan, feature)` usado por API, UI, MCP y jobs.
- La sentencia atómica de emisión cuenta `issued|voided` del **mismo `document_type`** en el mes `Europe/Madrid` y compara con el límite de `(plan, tipo)` inyectado desde `plan.ts`; el orden de locks `company → document_series` no cambia. Aviso del 80 %: `ceil(limit * 0.8)` por tipo.
- **Comprobación de funciones en servidor (FR-013)**: un helper `requireFeature(context, feature)` responde `403 feature_not_in_plan` con `{feature, required_plan}`; la UI muestra la explicación con invitación a mejorar (FR-058) en lugar del error.
- **Bajada de plan sin borrar datos**: las funciones Pro **no mutan su estado al degradar**; se desactivan por comprobación de plan en el momento de uso (scheduler, endpoint MCP, contexto de gestoría). Al mejorar de nuevo, todo vuelve «tal como estaba» porque nada se cambió. Los ciclos de recurrencia cuya fecha cae durante la suspensión se registran como `skipped_plan` y no se recuperan al volver (evita una avalancha de facturas atrasadas); los fallos del sistema sí se recuperan (R11).
- **Migración v1**: `free → basic`, `pro → essential` (Assumptions). Los límites efectivos se conservan o mejoran (5 → 5 por tipo; 100 → 100 por tipo).
- **Alternatives considered**: *límites por empresa en BD* (divergencia entre clientes del mismo plan — rechazado, igual que en v1); *desactivar recurrencias/recordatorios mutando su estado al bajar de plan* (hay que recordar qué estaba activo para restaurarlo — rechazado); *servicio de entitlements externo* (coste y latencia sin necesidad — rechazado).

## R3. Interfaz sencilla y navegación por plan

- **Decision**: una función pura `src/lib/navigation.ts` deriva la navegación de `(plan, ui_mode, tipos_usados)`. `company.ui_mode` es `null` (por defecto del plan: sencilla en Básico/Esencial, completa en Pro) o `simple`/`full` (solo Pro puede elegir `full`). `tipos_usados` se calcula con un `EXISTS` por tipo (índice existente `company, type, status, issue_date`). Las rutas Pro accesibles directamente renderizan un componente `FeatureUpsell` en lugar de la página (FR-058). Los ajustes en interfaz sencilla se agrupan en una sola página con secciones; en interfaz completa, en pestañas.
- **Rationale**: lógica pura testeable (Principio I), sin estado duplicado; el servidor sigue siendo quien autoriza (R2). No es el rediseño visual aplazado: reutiliza componentes shadcn existentes.
- **Alternatives considered**: *dos apps/árboles de rutas* (duplicación — rechazado); *feature flags remotos* (servicio extra — rechazado).

## R4. Presupuestos, albaranes y vínculos entre documentos

- **Decision**: añadir `quote` y `delivery_note` al enum `document_type`; mismas reglas de series, numeración al emitir, snapshot e inmutabilidad. Los vínculos pasan de las columnas `converted_from_id/converted_to_id` (1 a 1) a una tabla `document_link (source_id, target_id, kind)` con `kind ∈ {converted, invoiced}`, que admite N albaranes → 1 factura. La migración traslada los vínculos proforma→factura existentes y elimina las columnas antiguas (reversible).
  - **Unicidad de facturación del albarán (FR-037)**: índice único parcial `(source_id) WHERE kind='invoiced' AND released_at IS NULL`. Al anular la factura destino se rellena `released_at` en la misma transacción y el albarán puede volver a facturarse (decisión de diseño: una factura anulada no factura nada).
  - **Estado comercial del presupuesto**: `quote_decision ∈ {accepted, rejected}` + `quote_decided_at` en `document`. Es estado operativo como `voided_at`, no contenido fiscal: no altera el snapshot ni el PDF emitido; cada cambio registra `document_event`.
  - **Conversión directa con emisión** sigue pasando por la guarda común de emisión con estrategia de idempotencia `converted_from`, ahora contra `document_link`. Convertir dos veces el mismo origen al mismo tipo requiere `confirm_repeat: true` (spec, Edge Cases) — cambia la regla v1 «una proforma se convierte como máximo una vez», que pasa a ser «una vez sin confirmación». La reentrega idempotente (mismo `Idempotency-Key`) devuelve el mismo destino.
  - **Factura desde varios albaranes**: líneas copiadas por valor con `section_label` = «Albarán ALB-2026-0003 (fecha)» para agrupar por albarán en pantalla y PDF.
  - Ciclos prohibidos por una tabla de transiciones pura en `src/lib/documents/conversion.ts` (`quote → proforma|delivery_note|invoice`, `delivery_note → invoice`, `proforma → invoice`).
- **Alternatives considered**: *array de ids en la factura* (sin integridad referencial ni índice de unicidad — rechazado); *columna `invoiced_by_id` en el albarán* (no sirve para presupuesto→varios destinos — rechazado).

## R5. Métodos de cobro e IBAN

- **Decision**: tabla `collection_method` (nombre de dominio «método de cobro»; se evita colisionar con el enum v1 `payment_method` de `payment.method`, que describe cómo se recibió un pago concreto). Tipos: `bank_account` (titular, IBAN, BIC opcional), `bizum` (teléfono), `paypal` (email o enlace), `cash`, `other` (texto libre). Alias, `is_default` (índice único parcial por empresa), `archived_at`. La factura guarda `collection_method_id` en borrador y `collection_method_snapshot` (jsonb) al emitir (FR-022).
- **Validación IBAN**: función pura `src/lib/iban.ts` (normalización, longitud por país ISO 13616, mod-97); BIC por patrón ISO 9362. Errores sin eco del valor (Edge Cases: IBAN nunca en mensajes ni logs). `logSafe` añade una regla de redacción por patrón IBAN como defensa en profundidad.
- **Cifrado**: Neon cifra en reposo (AES-256) y TLS en tránsito (verificado pre-deploy en la v1). No se añade cifrado de aplicación: el IBAN del **emisor** se imprime en cada factura, es dato que el autónomo publica a sus clientes; cifrarlo a nivel de app impediría la búsqueda de cuenta en conciliación sin aportar protección real frente al modelo de amenaza (acceso a la BD ya implica acceso a los documentos que lo contienen).
- **Alternatives considered**: *columnas bancarias en `company`* (solo una cuenta — rechazado, la spec pide varias); *cifrado AES de app para IBAN* (ver arriba — rechazado, revisable si se almacenan IBAN de terceros).

## R6. Tipos de impuesto configurables

- **Decision**: tabla `tax_rate` por empresa (nombre ≤ 30, `rate numeric(5,2)` ∈ [0, 100), `is_default`, `archived_at`). La migración siembra IVA 21/10/4/0 por empresa y marca por defecto el `company.default_tax_rate` vigente. Productos y líneas guardan `tax_rate_id` (referencia en borrador) y, como hoy, `tax_rate` numérico + **nuevo `tax_name`** (valor congelado). El desglose de `src/lib/billing` agrupa por `(tax_name, tax_rate)` en lugar de solo por porcentaje, con el mismo redondeo half-up por línea (R10 v1). `taxBreakdown` jsonb gana `name`.
- **Rationale**: un IGI 4,5 % y un IVA 4,5 % hipotético no deben sumarse; los documentos emitidos conservan nombre y porcentaje aunque el tipo se edite o archive (FR-023). Exactitud al céntimo con 2 decimales ya garantizada por enteros y `numeric(5,2)`.
- **Alternatives considered**: *enum fijo de impuestos (IVA/IGIC/IPSI/IGI)* (no cubre tipos propios — rechazado); *referenciar el tipo sin copiar nombre* (rompería inmutabilidad — rechazado).

## R7. Series automáticas y cambio de serie en borrador

- **Decision**: `ensureDefaultSeries(companyId, type)` idempotente (`INSERT … ON CONFLICT DO NOTHING` sobre el índice único parcial de serie por defecto) se invoca al **crear el borrador** de un tipo sin serie, para que el editor muestre ya la serie. Prefijo = código del tipo + prefijo de la serie de facturas por defecto: `PRO-`, `REC-`, `PRE-`, `ALB-` + `2026-` → `PRE-2026-`; si colisiona con una serie existente, se añade sufijo (`PRE2-2026-`) y el resultado informa del cambio (Edge Cases). La rotación anual de la v1 se aplica igual.
- **Cambio de serie**: `PATCH /documents/:id {series_id}` solo en borrador y solo series activas del mismo tipo. Se añade `document_series.archived_at`; la emisión rechaza una serie archivada con `409 series_archived` accionable.
- **Alternatives considered**: *crear todas las series al registrarse* (series vacías que confunden en la interfaz sencilla — rechazado); *crearla en la emisión* (el editor no podría mostrar la serie — rechazado).

## R8. Selectores con búsqueda y búsqueda de clientes sin acentos

- **Decision**: componente único `Combobox` sobre shadcn `Command` (`cmdk`) + `Popover`, accesible por teclado (patrón ARIA combobox). Dos modos: **remoto** (clientes, productos: búsqueda en servidor con debounce 250 ms, paginada a 25) y **local** (series, impuestos, unidades, métodos de cobro: listas cortas acotadas). El valor es el objeto seleccionado (fix de la mejora 4).
- **Búsqueda (FR-028)**: extensiones Postgres `unaccent` y `pg_trgm` (disponibles en Neon). Función `immutable_unaccent(text)` (envoltorio `IMMUTABLE` con diccionario explícito, patrón estándar) y columna generada `client.search_text = immutable_unaccent(lower(name ‖ tax_id ‖ email ‖ phone ‖ address ‖ postal_code ‖ city))` con índice GIN `gin_trgm_ops` filtrado por empresa vía índice compuesto `(company_id)` + GIN. Mismo patrón para `catalog_item.search_text` (descripción). Consulta: `search_text LIKE '%' || immutable_unaccent(lower(:q)) || '%'` (usa el índice trigram).
- **Rendimiento**: objetivo heredado de búsqueda p95 < 200 ms; el índice trigram mantiene la búsqueda sublineal a 10x (Principio II).
- **Alternatives considered**: *`ILIKE` sobre varias columnas* (sin índice y sin acentos — rechazado); *búsqueda en cliente* (exige cargar la cartera completa, prohibido por Principio II — rechazado); *motor externo (Typesense/Algolia)* (coste y sincronización — rechazado).
- **Datos de cliente**: se añaden `postal_code` y `city` opcionales (la spec busca por ciudad y la v1 solo tenía `address`); `address` queda como línea de calle.

## R9. Unidades de medida

- **Decision**: lista predefinida en código (`src/lib/units.ts`: unidad, hora, día, mes, kg, g, l, m, m², m³, km, servicio) + tabla `measurement_unit` para las propias de cada empresa. `catalog_item.unit` y `document_line.unit` guardan el **texto** de la unidad (valor congelado, como la descripción), sin FK. Sin unidad → no se imprime.
- **Alternatives considered**: *FK a tabla de unidades* (las líneas emitidas dependerían de una fila editable — rechazado).

## R10. Logotipos inmutables y su render en PDF

- **Decision**: almacenamiento direccionado por contenido: `logos/{company_id}/{sha256}.{png|jpg}`. `company.logo_key` y `client.logo_key` apuntan a la versión vigente; el snapshot del emisor/cliente congela la clave al emitir, y como las claves nunca se sobrescriben, cambiar el logotipo no altera documentos emitidos (Edge Cases). La purga de logotipos huérfanos (sin referencia en empresa, clientes ni snapshots) se hace en el cron.
- **Formatos**: `pdf-lib` solo incrusta PNG y JPEG. La UI acepta SVG/PNG/JPEG y **rasteriza los SVG en el navegador** (canvas → PNG a 2× del tamaño de render) antes de subir; el servidor solo acepta PNG/JPEG (≤ 2 MB, validación estructural existente, dimensiones ≤ 4.000 px). Los SVG ya subidos en v1 se siguen mostrando en web y la configuración pide resubirlos para el PDF. El render escala con `scaleToFit` dentro de una caja fija (sin deformar proporciones extremas).
- **Alternatives considered**: *rasterizar SVG en el Worker con resvg-wasm* (~2–3 MB de WASM en el bundle y CPU por render — rechazado); *aceptar SVG en el PDF dibujándolo como path* (solo SVG triviales — rechazado).

## R11. Recurrencias, recordatorios y envíos programados: Cron Triggers + cola de trabajos

- **Decision**: un segundo Cron Trigger diario `0 5 * * *` (06:00/07:00 `Europe/Madrid`) ejecuta un **planificador** que solo selecciona trabajo pendiente y encola mensajes por unidad de trabajo en una nueva cola `invoice-flash-jobs` (con DLQ). Nunca genera documentos dentro del cron.
  - **Recurrencias (FR-038–040, SC-008)**: `recurring_template.next_run_on`; el planificador selecciona plantillas activas con `next_run_on <= hoy` (índice parcial) y para cada ciclo vencido inserta `recurring_cycle (template_id, cycle_index)` **único** → la fila es el reclamo idempotente; reentregas y recuperaciones tras caída no duplican. El consumidor crea el borrador y, según la acción, llama a la guarda común de emisión con nueva estrategia de idempotencia `recurring_cycle` y encola el email. Imposibilidad de emitir (cliente archivado, datos fiscales, cupo, plan) → el ciclo queda como borrador o la plantilla se pausa, con notificación del motivo (US10-AC4). Cálculo de fechas puro en `src/lib/recurrence.ts` (día 31 → último día del mes, cada N días/semanas/meses, fin por fecha o por número de ciclos).
  - **Recordatorios (FR-041–042)**: el planificador calcula candidatos (facturas emitidas con estado de cobro derivado pendiente/parcial/vencida, cliente con email y recordatorios activos, política aplicable hoy) e inserta `payment_reminder (document_id, scheduled_on)` **único** → como máximo uno por factura y día. El consumidor revalida el estado de cobro justo antes de crear el `email_delivery` (si se pagó entre medias, no se envía).
  - **Envío automático a la asesoría (FR-034)**: `advisor_schedule` mensual/trimestral → crea un `export_job` con clave única `(company_id, period)`.
  - **Gracia de suscripción, limpieza de muestras y logotipos huérfanos** en la misma pasada.
- **Rationale**: Workers Paid incluye Cron Triggers y Queues (coste marginal casi nulo); la idempotencia por fila única absorbe la entrega al menos una vez (patrón ya probado en la v1). Granularidad diaria suficiente: todas las reglas de la spec están en días.
- **Alternatives considered**: *Durable Objects alarms por plantilla* (más piezas y coste por objeto — rechazado); *cron cada hora* (24× invocaciones sin beneficio con reglas diarias — rechazado); *generar en la petición del usuario al entrar* (no cumple «sin intervención» — rechazado).

## R12. Exportaciones (Excel, ZIP de PDF) y enlace caducable

- **Decision**:
  - **Hoja de cálculo**: SheetJS Community Edition (`xlsx`) instalado desde su tarball oficial versionado (`pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; el paquete publicado en el registro público está desactualizado). JS puro, funciona en workerd. Los importes se escriben como número con formato `#,##0.00 €` calculado desde céntimos (`cents / 100` solo en la capa de presentación; los totales se toman de los documentos, nunca se recalculan en la hoja → coinciden al céntimo con el PDF, SC-007).
  - **ZIP de PDF**: `fflate` (JS puro, streaming). El consumidor lee los PDF ya cacheados en R2 y escribe el ZIP mediante **R2 multipart upload** en partes de ≥ 5 MB, sin cargar el archivo completo en memoria (límite de 128 MB del isolate). Documentos sin PDF listo se encolan y el job reintenta.
  - **Todas las exportaciones de periodo o con filtros** pasan por `export_job` + cola (FR-033, Principio II); la UI hace polling del job (la mayoría termina en < 2 s) y notifica si tarda. El **Excel de un único documento** (FR-027) se genera síncronamente: tamaño acotado (líneas ≤ límite del editor), < 50 ms de CPU, no es una operación de larga duración.
  - **Enlace caducable**: token aleatorio ≥ 128 bits, almacenado como hash SHA-256, caducidad 7 días, ruta pública `/x/:token` con el rate limit existente; sirve el objeto R2 con `Content-Disposition: attachment`. El email a la asesoría lleva solo el enlace (FR-032).
  - **Periodo sin documentos**: el job termina en `empty` y la UI/notificación lo dice (Edge Cases).
- **Alternatives considered**: *ExcelJS* (depende de streams de Node; problemas en workerd — rechazado); *CSV en lugar de XLSX* (la spec pide hoja compatible con Excel con totales y formatos; CSV con `;` y coma decimal da problemas recurrentes en Excel ES — rechazado como formato principal); *JSZip* (sin streaming real — rechazado).

## R13. Importación de catálogo por CSV

- **Decision**: flujo en dos fases con `import_job`: (1) subida a R2 (≤ 5 MB) → job de **análisis** en cola: detección de codificación (`TextDecoder('utf-8', {fatal:true})`, si falla `windows-1252`), separador (`;`/`,` por frecuencia en cabecera), `papaparse` (JS puro), correspondencia de columnas sugerida por nombre normalizado, validación por fila con el mismo esquema Zod que la API de productos (precios con coma decimal → céntimos con `lib/money`), detección de duplicados por descripción normalizada; resultado persistido en `import_job.preview` (resumen + primeras 50 filas + errores por fila) — nada se crea. (2) el usuario confirma mapeo y política de duplicados (`skip`/`update`) → job de **aplicación** en lotes de 500 en transacción por lote, con resumen final. Límite 5.000 filas y 5 MB → rechazo accionable. Plantilla CSV descargable estática.
- **Rationale**: la constitución exige importaciones asíncronas; 5.000 filas caben holgadamente en un job. Reutilizar el esquema Zod garantiza las mismas validaciones que la UI.
- **Alternatives considered**: *parsear en el navegador y enviar JSON* (la validación de seguridad debe ser en servidor igualmente; duplicaría lógica — rechazado como fuente de verdad, aunque la UI puede previsualizar la cabecera); *importación síncrona* (viola Principio II — rechazado).

## R14. Conciliación bancaria: Norma 43 y CSV

- **Decision**:
  - **Parser Norma 43 propio y puro** en `src/lib/bank/norma43.ts` (registros de 80 posiciones: `11` cabecera de cuenta, `22` movimiento, `23` conceptos complementarios, `33` final de cuenta con saldo, `88` fin de fichero; codificación ISO-8859-1; importes en céntimos con signo por clave debe/haber). Validación cruzada de totales del registro 33. **CSV/XLSX** con correspondencia de columnas reutilizando el análisis de R13.
  - **Sin duplicados (FR-043)**: huella `sha256(cuenta, fecha operación, fecha valor, importe, concepto normalizado, nº documento)` + `occurrence` (ordinal de huellas idénticas dentro del mismo extracto, para movimientos legítimamente iguales el mismo día). Índice único `(bank_account_id, fingerprint, occurrence)`; reimportar o solapar extractos → `ON CONFLICT DO NOTHING`.
  - **Sugerencias (FR-044, SC-009)**: función pura `src/lib/bank/matching.ts` con puntuación: número de factura en el concepto (+60), importe igual al pendiente (+30), NIF o nombre del cliente normalizado en el concepto (+20), importe único entre pendientes (+10), cercanía a vencimiento (+5). Solo ingresos; ordenadas por puntuación; candidatas acotadas a facturas pendientes del cliente/periodo (consulta indexada, sin N+1).
  - **Confirmación (FR-045)**: tabla `reconciliation (bank_transaction_id, document_id, amount_cents, payment_id)`; confirmar inserta el `payment` y la fila en una transacción con `FOR UPDATE` sobre el movimiento; restricción: suma asignada ≤ importe del movimiento. Deshacer elimina pago y fila (el pago queda auditado con `payment_deleted`). Estado del movimiento derivado (`pending` si asignado < importe, `reconciled`, o `ignored` por flag).
  - **Saldo para tesorería**: saldo final del registro 33 (o columna saldo del CSV si existe) en `bank_statement.closing_balance_cents` + fecha.
- **Alternatives considered**: *librería Norma 43 de terceros* (pocas, sin mantenimiento ni tipos — rechazado; el formato es estable y pequeño); *agregadores PSD2* (fuera de alcance por spec); *estado de conciliación almacenado en la factura* (contradice estados de cobro derivados — rechazado).

## R15. Acceso de solo lectura para la gestoría

- **Decision**: tabla `company_access (company_id, user_id, role='advisor', status, invited_email_hash, invite_token_hash, invite_expires_at, revoked_at)`. La persona de gestoría usa una cuenta Better Auth normal (puede no tener empresa propia). La **empresa activa** se guarda en la sesión (campo adicional `active_company_id` de la tabla `session` de Better Auth) y se valida en **cada petición** contra `company_access` activo o propiedad: retirar el acceso surte efecto inmediato (FR-050) porque no hay caché.
  - `resolveCompanyContext` pasa a devolver `{companyId, userId, role: 'owner' | 'advisor', plan}`; las rutas declaran `access: 'read' | 'write'`. `write` con rol `advisor` → `403 read_only_access`; recurso de otra empresa → `404` (regla v1).
  - El acceso de gestoría depende de que la empresa tenga Pro: al bajar de plan se suspende por comprobación en el contexto, sin mutar filas (R2).
  - Auditoría: `access_event` (solo INSERT): accesos (uno por sesión y día) y exportaciones, visible para el autónomo (FR-053).
  - Invitación: email con token aleatorio (hash en BD), caducidad 7 días, aceptación tras iniciar sesión o registrarse con ese email.
- **Rationale**: reutiliza el scoping por `company_id` existente; el control de escritura queda en un único punto, verificable con la matriz de permisos (SC-011).
- **Alternatives considered**: *plugin `organization` de Better Auth* (modela equipos con roles genéricos que la spec acaba de eliminar; trae tablas y semántica de más — rechazado); *empresa activa en cookie aparte* (otro secreto que firmar y sincronizar con la sesión — rechazado).

## R16. Correos con marca Factum

- **Decision**: remitente desde configuración `EMAIL_FROM="Factum <no-reply@{dominio-factum}>"` y `EMAIL_REPLY_TO` opcional; el dominio se verifica en Resend (SPF/DKIM/DMARC) antes de desplegar — dependencia externa listada en la spec. Plantillas con un layout común `src/services/email/templates/layout.ts` (marca Factum) para todos los propósitos: documento, verificación, recuperación, recordatorio, envío a asesoría, invitación de gestoría, avisos de suscripción, notificaciones. `appName` de Better Auth = «Factum». Test que falla si alguna plantilla contiene «Invoice Flash» (FR-001). Los documentos enviados por el autónomo usan `Reply-To` = email de su empresa, para que el cliente responda al autónomo.
- **Alternatives considered**: *enviar desde el dominio del autónomo* (exige verificación DNS por cliente — fuera de alcance).

## R17. Datos actualizados sin recargar (FR-002, FR-003, Edge Cases)

- **Decision**: hook único `useMutation` en `src/components/ui/async-action.tsx` (que ya centraliza estados de carga) llama a `router.refresh()` tras cada mutación correcta, salvo opt-out explícito. Así el layout servidor recalcula banner, contadores, plan e interfaz con los mismos datos autoritativos. Para cambios que llegan de fuera (webhook de Stripe tras Checkout) la ruta de retorno sincroniza antes de renderizar (R1). Pruebas E2E sin recarga para cada caso de US1.
- **Alternatives considered**: *estado global en cliente (Zustand/React Query) para contadores* (dos fuentes de verdad — rechazado); *`revalidatePath` en Server Actions* (la app usa route handlers REST, no Server Actions; migrarla no aporta — rechazado).

## R18. Asistente de configuración y factura de prueba

- **Decision**: `company.onboarding` jsonb `{completed: Step[], skipped: Step[], dismissed_at}` con pasos `fiscal_data, logo, collection_method, series, sample_invoice`. «Qué falta para facturar» se deriva (readiness existente + método de cobro opcional). La **factura de prueba** no es un `document`: se encola `pdf.sample {sample_id}` con los datos de ejemplo en `sample_render` (fila efímera), el consumidor renderiza con la misma plantilla y marca de agua «EJEMPLO – sin validez» y guarda en `samples/{company_id}/{id}.pdf`; el cron borra muestras de más de 7 días. Al no ser documento, nunca aparece en listados, exportaciones, métricas ni conciliación ni consume numeración o cupo (FR-049) por construcción.
- **Alternatives considered**: *documento con flag `is_sample`* (habría que excluirlo en cada consulta y cada futura; riesgo de fuga a métricas — rechazado); *render en la petición* (viola la regla v1 de PDF solo en cola — rechazado).

## R19. Conexión con asistentes de IA (MCP)

- **Decision**: servidor MCP remoto en el mismo Worker, ruta `/api/mcp`, con `@modelcontextprotocol/sdk` en **Streamable HTTP sin estado** (cada petición autenticada es independiente; compatible con Workers stateless). Autorización **OAuth 2.1 + PKCE + registro dinámico de clientes**, que es lo que exigen los clientes MCP (ChatGPT, Claude), proporcionada por los paquetes oficiales `@better-auth/oauth-provider` y `@better-auth/mcp` (verificado el 2026-10-20: versión 1.7.11, peer `better-auth ^1.7.11`; la 1.7.6 instalada ya no incluye los antiguos plugins `mcp`/`oidc-provider` en el paquete principal, así que hay que actualizar). Ofrecen registro dinámico de clientes (también sin autenticar, necesario para clientes MCP públicos), PKCE S256, página de consentimiento y de login configurables, metadatos `oauth-authorization-server` y `oauth-protected-resource`, revocación e introspección, y helpers `requireMcpAuth`/`createMcpProtectedRequestHandler`. Sus únicas dependencias son `jose` y `zod`, y el código distribuido no importa módulos `node:*` ni usa `Buffer`/`process.env`, así que es previsiblemente compatible con workerd (no ejecutado aún: smoke test en `pnpm preview` en T178). Tokens: JWT con el plugin `jwt` o opacos con `disableJwtPlugin`; se prefieren opacos, revocables al instante sin lista de revocación. Pantalla de consentimiento propia (FR-054).
  - **Herramientas** = fachada sobre los **mismos servicios** que usan los route handlers (`services/*`), con el mismo Zod, scoping por empresa, `requireFeature('ai_assistant')` y guarda de cupo (FR-055). Listas paginadas.
  - **Confirmación explícita (FR-056)**: `issue_document`/`void_document` en dos pasos: la primera llamada devuelve un resumen y un `confirmation_token` de un solo uso (5 min, hash en BD); solo `confirm_action(token)` ejecuta. Si el cliente soporta *elicitation*, se usa como capa adicional. El `document_event.actor` registra `ai:{connection_id}` en nombre del usuario.
  - **Ambigüedad**: búsquedas que devuelven varios clientes devuelven las opciones, nunca eligen (Edge Cases).
  - **Revocación inmediata**: `ai_connection` envuelve el cliente OAuth; cada petición comprueba conexión activa y plan Pro (sin caché). Rate limit por conexión con un nuevo binding `MCP_RATE_LIMITER` (60/min).
- **Coste**: la inferencia la paga el asistente del usuario (spec); la plataforma solo sirve peticiones Worker.
- **Alternatives considered**: *API keys personales* (los clientes MCP de consumo esperan OAuth; peor revocación y UX — rechazado); *SSE con sesión persistente / Durable Objects* (estado por conexión innecesario para herramientas CRUD — rechazado); *servidor MCP separado* (otro despliegue — rechazado).

## R20. Panel Pro, gráficos y tesorería

- **Decision**: endpoint de agregados `GET /dashboard` ampliado (facturado base/total, impuestos repercutidos sumando `tax_breakdown` jsonb, cobrado, pendiente, vencido) + `GET /dashboard/series?months=12` (facturado vs cobrado por mes, `date_trunc` en `Europe/Madrid`) + `GET /dashboard/top-clients?limit=5` + `GET /dashboard/treasury`. Todo en SQL agregado con índices existentes (`company, issued_at`, `company, paid_on`); estados de cobro derivados (regla v1). Gráficos con shadcn Charts (Recharts). Excluye anulados y, por construcción, la factura de prueba (R18).
- **Escalabilidad**: a 10x (100k docs/mes en total, ~100 por empresa) las agregaciones por empresa y periodo son baratas; si una empresa superase ~50k documentos/año se añadiría una tabla de agregados mensuales recalculada por job (plan de migración documentado, Principio II).
- **Alternatives considered**: *materializar agregados desde el inicio* (estado derivado que puede desincronizarse — rechazado a esta escala).

## R21. Notificaciones al usuario

- **Decision**: tabla `user_notification` (empresa, tipo, payload sin datos sensibles, `read_at`) mostrada en un indicador del encabezado; los avisos críticos (gracia de suscripción, bajada de plan, fallo de recurrencia) se envían además por email al propio usuario (permitido en todos los planes: no es «envío de documentos»). Clave de idempotencia por origen (p. ej. `recurring_cycle:{id}`) para no duplicar avisos ante reentregas.
- **Alternatives considered**: *solo email* (ruido y sin historial — rechazado); *web push* (permisos y complejidad — rechazado).

---

## Nuevas dependencias (todas JS puro, compatibles con workerd)

| Paquete | Uso | Instalación |
|---|---|---|
| `stripe` | Checkout, Portal, webhooks | `pnpm add stripe` |
| `xlsx` (SheetJS CE) | Excel de documento y periodo | `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` |
| `fflate` | ZIP de PDF en streaming | `pnpm add fflate` |
| `papaparse` (+ `@types/papaparse`) | CSV de catálogo y extractos | `pnpm add papaparse` · `pnpm add -D @types/papaparse` |
| `@modelcontextprotocol/sdk` | Servidor MCP | `pnpm add @modelcontextprotocol/sdk` (ya hay override de versión en `package.json`) |
| `cmdk`, `recharts` | Combobox y gráficos (vía `pnpx shadcn add command popover chart`) | componentes shadcn |

## Estimación de coste incremental (Principio IV)

Mismas escalas que la v1. Se suman a la estimación de [../001-invoice-flash/plan.md](../001-invoice-flash/plan.md).

| Concepto | Lanzamiento (~100 usuarios) | Objetivo, 10x (~1k) | Resiliencia, 100x (~10k) |
|---|---|---|---|
| Stripe (variable sobre ingresos: ~1,5 % + 0,25 € + ~0,7 % Billing) | ~0 $ fijo; ~0,40 € por cobro de 8 € | ídem | ídem |
| Resend extra (recordatorios ≤ 3/factura Pro, recurrencias, asesoría, avisos) | 0 $ (dentro de 3.000) | +0–20 $ (posible salto a Pro de Resend) | +90 $ (Scale) |
| Queues + Cron (cola `jobs`, ~5 mensajes/usuario/día) | 0 $ (dentro de 1M ops) | 0–2 $ | 5–15 $ |
| Neon (movimientos bancarios, eventos, exportaciones) | 0 $ | +2–5 $ | +10–30 $ |
| R2 (ZIP y Excel con caducidad 7 días, logotipos) | ~0 $ | ~0–1 $ | ~2–5 $ |
| MCP (peticiones Worker) | 0 $ | dentro de 10M req | +0–5 $ |
| **Incremento total infra** | **~0 $** | **~+5–30 $/mes** | **~+110–145 $/mes** |

Controles: límites de gasto ya activos (v1); los archivos exportados caducan y se borran a los 7 días; rate limits en `/x/*` y `/api/mcp`; recordatorios limitados por diseño (máx. por factura y uno por día).

Todas las incógnitas de la spec quedan resueltas; no quedan `NEEDS CLARIFICATION`.
