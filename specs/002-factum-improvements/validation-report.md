# Informe de validación en staging (T189)

**Estado: EN CURSO (2026-11-08).**

- Puertas automáticas: en verde en local.
- Escenarios V1–V14: validados en staging con las salvedades indicadas.
- Pendiente de la parte manual que ejecuta el responsable con un cliente de IA real:
  - V15: tasa de acierto y confirmación al emitir.
  - Recepción de correos con remitente «Factum» (V1.5).
- Usabilidad de V3.7 y V14: pendiente explícita en T188. No se ha inventado ningún dato.

Entorno:

- **Staging:** `https://invoice-flash-staging.sinergia-hub.workers.dev`.
  - Versión de Worker `16a1589d`, construida desde `275d9c2` en un checkout limpio, sin ficheros `.env` en el bundle.
  - Neon de staging en la migración 0015.
  - Stripe en modo sandbox, con el webhook de staging.
  - Resend con el dominio `factum.sinergia-hub.com` verificado.
  - `PRO_CHECKOUT_ENABLED=true`.
- **Correos de las pruebas:** van a la bandeja de pruebas de Resend (`delivered+…@resend.dev`), con `E2E_EMAIL_SINK=resend`.

## 1. Puertas de calidad (local, 2026-11-07/08)

| Puerta | Comando | Resultado |
|---|---|---|
| Lint y formato | `pnpm lint` | OK (1 aviso previo: `@ts-ignore` en `src/worker-entry.ts`) |
| Tipos | `pnpm exec tsc --noEmit` | OK |
| Unitarias | `pnpm test` | OK, 403 tests |
| Integración (Postgres real) | `pnpm test:integration` | OK, 56 ficheros, 288 tests |
| Rendimiento | `pnpm test:performance` | OK, 5 ficheros, 12 tests |
| E2E local (Playwright + axe) | `pnpm test:e2e --workers=1` | OK, 86 pasan y 4 omitidos (los de pago, sin clave de Stripe) |
| Dependencias | `pnpm audit --audit-level=high` | OK: ninguna alta (3 bajas, 12 moderadas) |

## 2. Suite E2E contra staging

- **Comando:**
  ```bash
  E2E_BASE_URL=<staging> E2E_DATABASE_URL=<neon staging> \
    E2E_STRIPE_SECRET_KEY=<sandbox> pnpm test:e2e:staging
  ```
- **Cómo se ejecuta:** con 1 worker y sin truncar nada; cada prueba crea su propia cuenta.

### 2.1 Cuelgue de páginas autenticadas (corregido)

- **Ejecución inicial (2026-11-06):** pasaron 8 de 45. Las páginas autenticadas se quedaban colgadas en `auth.api.getSession`.
- **Causa:** una precarga RSC iniciaba la inicialización de Better Auth y terminaba antes que ella, así que la promesa compartida no se resolvía nunca. Se confirmó con una versión instrumentada.
- **Corrección:** commit `275d9c2`; decisión en `research.md` R23.
- **Tras corregirlo:** pasaron 40 de 45 en 11,4 min, sin cuelgues ni `ERR_ABORTED`.

### 2.2 Los 5 fallos restantes

| Prueba | Causa | Resolución |
|---|---|---|
| `recurring` (axe `aria-required-children`) | **Defecto real.** El «Buscando…» del combobox estaba dentro del `listbox`; solo aparece con latencia real. | Corregido en `275d9c2`. Repetido en staging: pasa. |
| `accessibility-feedback` (216 ms > 100 ms) | **Artefacto de medida.** El texto «Registrando…» apareció en menos de 90 ms; el exceso era Playwright localizando el botón. | Corregido en la prueba (`275d9c2`). Repetido en staging: pasa. |
| `first-invoice` (429) | **Entorno.** El límite de Better Auth (3 registros cada 10 s por IP) está activo en staging, como en producción, y la suite registra cuentas seguidas. | Comportamiento esperado. La prueba pasa en local. |
| `upgrade-flow` (Pro «Próximamente») | **Entorno.** La prueba supone Pro sin venta, pero en staging `PRO_CHECKOUT_ENABLED=true`. | Comportamiento esperado. Pasa en local, con Pro desactivado. |
| `advisor-exports` (aceptar invitación) | **Limitación de la prueba.** Firma el token con el secreto de auth del entorno, que no está fuera de staging. | La invitación se envía en staging (`email_delivery` `advisor_invite` = `sent`). La aceptación está cubierta en local e integración. |

### 2.3 Pruebas nuevas solo para staging (2026-11-08, versión `16a1589d`)

Se saltan fuera de staging.

| Fichero | Resultado |
|---|---|
| `billing-lifecycle.staging.spec.ts` | 2 de 2 (Stripe real, webhooks y test clocks) |
| `assistant-limits.staging.spec.ts` | 1 de 1 (limitador de Cloudflare real) |
| `export-zip.staging.spec.ts` | 1 de 1 (colas, renders de PDF y R2 reales) |

## 3. Escenarios del quickstart

**Leyenda:**

- **E2E-stg:** prueba E2E que pasa contra staging.
- **E2E-local:** prueba E2E que pasa en local.
- **INT:** prueba de integración con Postgres real y, cuando hace falta, reloj inyectado, como prescribe el quickstart.
- **UNIT:** prueba unitaria.
- **Manual:** pendiente del responsable.

| Escenario | Evidencia | Resultado |
|---|---|---|
| V1.1–1.3 Fluidez | E2E-stg `fluency-fixes` (3 pruebas) | OK |
| V1.4 Sin notas vacías ni email del cliente | UNIT `pdf-template`; E2E-stg `document-design`, `share-link` | OK |
| V1.5 Remitente «Factum» | UNIT `email-branding`. En staging se enviaron 50 correos en la suite (verificación, documento, asesoría y avisos de facturación). | Envío OK. **Falta revisar en una bandeja real el remitente «Factum».** |
| V2.1 Planes | E2E-local `upgrade-flow` (Pro «Próximamente» con la venta desactivada); INT `billing-contract` | OK. En staging Pro se vende a propósito. |
| V2.2 Cupo y bloqueo | E2E-stg `upgrade-flow` y `proforma-receipt`; INT `quota-per-type` | OK |
| V2.3 Cupo independiente por tipo | INT `quota-per-type`; E2E-stg `proforma-receipt` | OK |
| V2.4 Mejorar → Checkout → emitir sin rehacer | E2E-stg «contratar Esencial con tarjeta de prueba emite la factura bloqueada» (Checkout real, tarjeta 4242) | OK |
| V2.5 Reentrega del webhook | E2E-stg `billing-lifecycle` (reentrega con `POST /v1/events/:id/retry` al endpoint de staging) | OK: sigue habiendo 1 `plan_change` |
| V2.6 Abandonar Checkout | E2E-stg «abandonar el pago en Stripe deja el borrador sin número» | OK |
| V2.7 Anual, cancelación y fin de periodo | E2E-stg `billing-lifecycle`, con test clock | OK, con la salvedad de abajo |
| V2.8 Fallo en la renovación | E2E-stg `billing-lifecycle`, más INT `billing-grace` para el aviso del día 5 y la degradación | OK, con la salvedad de abajo |
| V3.1–3.6 Interfaz sencilla | E2E-stg `simple-ui` (3 pruebas), `recurring`, `reminders` y `reconciliation` sin Pro (invitación, no error); INT `permission-matrix` (403 `feature_not_in_plan`) | OK |
| V3.7 Usabilidad ≥ 9/10 | — | **Pendiente (T188).** |
| V4 Editor ágil | E2E-stg `editor-agile` (2 pruebas), `catalog`, `first-invoice` (se crea y descarga otra factura en menos de 2 min) | OK. El cronómetro de 90 s no se midió por separado. |
| V5 Cobro e impuestos | INT `payment-tax-config-contract`, `payment-tax-snapshot` | OK. Sin prueba E2E propia en staging. |
| V6 Documento profesional | E2E-stg `document-design` (SVG rasterizado, vista pública, Excel Pro); INT `document-design` | OK |
| V7 Clientes y catálogo | E2E-stg `clients-catalog` (4 pruebas: búsqueda sin acentos, archivar y restaurar, CSV con errores por fila, rechazo de 5.001 filas) y `clients` | OK |
| V8 Gestoría y exportaciones | E2E-stg `advisor-exports` (exportación Esencial y envío a la asesoría) y `export-zip` (**300 facturas: XLSX y ZIP con 300 PDF en 152 s, 1 MiB**); INT `exports`, `advisor-access` (aceptar, solo lectura, `403 read_only_access`, revocar, registro) y `daily-planner` (envío trimestral programado); E2E-local de aceptación de la gestoría | OK, salvo la contratación de Pro desde el Portal (abajo) |
| V9 Presupuestos y albaranes | E2E-stg `quotes-delivery-notes`; INT `quotes-delivery-notes` (9 pruebas) | OK |
| V10 Recurrencias | INT `recurring` con reloj inyectado (12 ciclos, caída de 3 días, cliente archivado, `skipped_plan`, solo afecta al futuro); E2E-stg `recurring` | OK |
| V11 Recordatorios | INT `reminders` con reloj inyectado; E2E-stg `reminders` | OK |
| V12 Conciliación | E2E-stg `reconciliation`; INT `bank-reconciliation` (14 pruebas, incluida la SC-009 con ≥ 80 %) | OK |
| V13 Panel y tesorería | INT `dashboard-pro` (cifras contra una consulta de control, al céntimo); E2E-stg `payments` | OK |
| V14 Asistente inicial | E2E-stg `onboarding` (2 pruebas); INT `onboarding-sample` (PDF «EJEMPLO», sin consumir cupo, purga a los 7 días) | OK. **Usabilidad: pendiente (T188).** |
| V15 Asistente de IA | Detalle abajo | **Parcial; falta la parte manual.** |

### Salvedades de V2.7 y V2.8

- **V2.7:**
  - El cambio a anual se hizo por API de Stripe, que genera los mismos webhooks que el Portal.
  - Ajustes muestra «Anual» y «Termina el», y el plan sigue en Esencial.
  - Al pasar el fin de periodo con el test clock, la empresa pasa a Básico con los mismos documentos y un segundo `plan_change`.
- **V2.8:**
  - En staging, la renovación fallida (`pm_card_chargeCustomerFail`) deja la suscripción `past_due`.
  - Se abre una gracia de 7 días con el plan Esencial intacto, y Ajustes muestra el aviso.
  - La gracia corre con el reloj de la app, no con el de Stripe. Por eso el aviso del día 5 y la degradación al vencer se validan en INT `billing-grace`.
  - El cron diario real de staging no se ha observado en esta validación.

### Detalle de V15

- **Validado en staging:**
  - Conexión OAuth (registro dinámico y PKCE), consentimiento, uso de MCP y revocación: E2E-stg `assistant-connection`.
  - Sin Pro no se puede conectar: E2E-stg.
  - Al bajar de Pro, la conexión deja de funcionar (403): E2E-stg `assistant-limits`.
- **Cubierto por INT `mcp-tools`:** nombre ambiguo devuelve opciones, emitir exige `confirm_action`, el actor es la IA y las confirmaciones caducan.
- **Limitación por ráfaga** (`assistant-limits`):
  - Se lanzaron 250 llamadas en 38 s; el primer 429 llegó en la llamada 151.
  - El limitador de Cloudflare (60/min por conexión, R19) es aproximado: usa contadores por máquina que se sincronizan de forma asíncrona.
  - Corta las ráfagas, pero no al umbral exacto. Si se necesita un límite estricto, haría falta un contador propio (Durable Object o base de datos). **Lo decide el responsable.**
- **Pendiente (manual):** con un cliente real (Claude), medir la tasa de borradores correctos (≥ 8/10), la confirmación al emitir, «vía asistente de IA» en el historial, el nombre ambiguo y la revocación.

### Contratación de Pro desde el Portal (V8)

- El Portal del sandbox no tenía activado el cambio de suscripción, así que Stripe rechazaba el flujo `subscription_update_confirm`.
- Se activó el 2026-11-08 con los 4 precios de Factum y `always_invoice`. Tras eso, Stripe acepta la sesión de cambio a Pro anual.
- **Pendiente:** recorrer el cambio desde la interfaz, como parte de la prueba manual de V15.
- **Para producción:** la configuración del Portal debe incluir los mismos productos y precios. Ya lo exige `docs/operations/v2-runbook.md` §1.3, y se ha añadido la comprobación explícita.

## 4. Observaciones para producción

1. **Correos:** el manejador de Resend transforma cualquier respuesta no OK en `provider_unavailable` sin guardar el código HTTP.
   - Durante una ráfaga de registros fallaron 2 correos de verificación; probablemente fue el límite de Resend, pero no puede confirmarse.
   - Se recomienda registrar el código de estado.
2. **Título de las páginas:** el `<title>` y la cabecera de la app siguen diciendo «Invoice Flash».
3. **Rotación de credenciales:** los bundles anteriores de staging (01/10) y producción (13/10) se construyeron desde un checkout con `.env.local` y pueden contener sus valores.
   - Se recomienda rotar esas credenciales.
   - La guía de despliegue ya exige un checkout limpio.
