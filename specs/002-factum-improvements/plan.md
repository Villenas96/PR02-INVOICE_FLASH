# Implementation Plan: Factum — Mejoras de producto v2

**Branch**: `002-factum-improvements` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-factum-improvements/spec.md` (aprobada por el propietario el 2026-10-20)

## Summary

Segunda versión del producto sobre la v1 en producción: 35 mejoras de `notas.md` en 15 historias (P1–P5). Corrige los defectos de fluidez detectados en uso real, convierte el producto en negocio con tres planes (Básico gratis, Esencial, Pro) con cupo **por tipo de documento** y suscripción autogestionada, introduce una interfaz sencilla por defecto para quien solo quiere facturar, y añade presupuestos y albaranes con conversión entre documentos, métodos de cobro e impuestos propios, documento más profesional, exportación y acceso de solo lectura para la gestoría, recurrencias, recordatorios, conciliación bancaria por fichero, panel con tesorería, asistente inicial y conexión con asistentes de IA vía MCP.

**Enfoque técnico**: se conserva íntegro el stack v1 (Next.js 15 en Cloudflare Workers vía OpenNext, Neon Postgres + Drizzle, Better Auth, pdf-lib + R2, Resend vía Queues, Tailwind 4 + shadcn/ui, pnpm). Se añaden **Stripe Billing** (Checkout + Customer Portal + webhooks reconciliados por relectura) para la suscripción; una **tercera cola** `invoice-flash-jobs` y un **segundo cron diario** que solo planifica trabajo idempotente (recurrencias, recordatorios, envíos a la asesoría, gracia); **SheetJS CE** y **fflate** para Excel y ZIP en streaming hacia R2; **unaccent + pg_trgm** para búsqueda sin acentos; y un **servidor MCP** sin estado con OAuth 2.1 del propio Better Auth. Los planes siguen definidos en una única fuente versionada (`src/lib/plan.ts`) y la guarda transaccional de emisión de la v1 se amplía a cupo por tipo sin cambiar su orden de locks. La auditoría del código existente (research R0) muestra que los defectos de US1 tienen causas locales y que duplicar, editar/eliminar borradores y archivar clientes ya existen en la API: solo falta exponerlos. Detalle de decisiones en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, React 19, Node.js 22 LTS en desarrollo, workerd en producción (sin cambios respecto a la v1).

**Primary Dependencies**: las de la v1 + `stripe` (fetch HTTP client, `constructEventAsync`), `xlsx` (SheetJS CE desde tarball oficial versionado), `fflate`, `papaparse`, `@modelcontextprotocol/sdk`, plugin OAuth/MCP de Better Auth, componentes shadcn `command`/`popover`/`chart` (`cmdk`, `recharts`). Todas JS puro y compatibles con workerd (research, «Nuevas dependencias»).

**Storage**: Neon Postgres (12 migraciones nuevas `0004`–`0015`, versionadas y reversibles; extensiones `unaccent`, `pg_trgm`) + R2 (logotipos direccionados por contenido, exportaciones e importaciones con caducidad de 7 días, muestras de onboarding). Ver [data-model.md](./data-model.md).

**Testing**: Vitest unit (todos los módulos nuevos de `src/lib`), Vitest integración contra Postgres real (matriz de permisos completa, cupo por tipo concurrente, reentregas de cada mensaje de cola, webhooks duplicados/desordenados, recurrencias de 12 ciclos con reloj inyectado, conciliación sin duplicados), Playwright (+axe, móvil/escritorio, escenarios de US1 sin recarga), Stripe CLI y test clocks para la suscripción, MCP Inspector para el servidor MCP, pruebas de usabilidad moderadas para SC-004 y SC-010.

**Target Platform**: web responsive, navegadores evergreen; backend en Cloudflare Workers (fetch + queue + scheduled en el mismo Worker).

**Project Type**: aplicación web full-stack, proyecto único Next.js (sin cambios).

**Performance Goals**: los de la v1 (CRUD p95 < 300 ms, búsqueda p95 < 200 ms, feedback < 100 ms, PDF p95 < 3 s) se extienden a los endpoints nuevos; búsqueda sin acentos p95 < 200 ms con 10.000 clientes por empresa; exportación de 500 documentos (XLSX + ZIP) lista en < 60 s; análisis de un CSV de 5.000 filas < 15 s; panel Pro < 500 ms p95 con 12 meses de datos; SC-003: factura en < 90 s.

**Constraints**: todas las de la v1 (céntimos, numeración solo al emitir con `company → document_series`, inmutabilidad con snapshot, estados de cobro derivados, scoping por `company_id`, colas idempotentes, sin PDF en HTTP). Nuevas: cambio de plan solo tras cobro confirmado y reconciliado de forma idempotente; funciones comprobadas en servidor; bajada de plan sin mutar ni borrar datos; IBAN nunca en logs ni errores; enlaces de descarga con token ≥ 128 bits hasheado y caducidad; un documento por ciclo de recurrencia y un recordatorio por factura y día garantizados por índices únicos; Worker con memoria acotada (ZIP por multipart).

**Scale/Scope**: escalas de la v1 (100 / 1.000 / 10.000 usuarios; 1k / 10k / 100k documentos/mes) más ~5 mensajes de cola por usuario Pro y día y hasta 3 recordatorios por factura. 60 requisitos funcionales, 15 historias, ~20 pantallas nuevas o modificadas, 12 migraciones.

Sin `NEEDS CLARIFICATION` pendientes: todas resueltas en [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principio | Evaluación | Estado |
|---|-----------|------------|--------|
| I | Calidad de Código | Toda regla nueva vive en `src/lib/*` puro con unitarias obligatorias (plan y plan efectivo, navegación, IBAN, desglose por nombre de impuesto, transiciones de conversión, recurrencias, recordatorios, Norma 43, sugerencias de conciliación, huella, CSV, filas de exportación). Flujos críticos nuevos con integración contra Postgres real (cupo por tipo, conversiones, facturación de albaranes, recurrencias, conciliación, webhooks). Sin `any`; dependencias nuevas tipadas. Se elimina código muerto en el camino (`converted_*`, `default_tax_rate`, enum `free`). | ✅ PASS |
| II | Escalabilidad por Diseño | Exportaciones, importaciones, recurrencias, recordatorios, muestras y envíos programados en la cola `jobs`; el cron solo inserta reclamos y encola. ZIP en streaming con multipart R2 (sin cargar en memoria). Colecciones nuevas paginadas por cursor; top-clientes acotado a 5. Índices declarados por patrón (trigram, `next_run_on` parcial, huella única, vínculos). Agregados del panel con índices existentes y plan de migración a agregados mensuales documentado (R20). Workers stateless: la empresa activa vive en la sesión en BD. | ✅ PASS |
| III | Seguridad como Requisito | Secretos de Stripe solo en Cloudflare Secrets/`.dev.vars`. Webhook con firma verificada y relectura en la API. Zod en todo borde nuevo: formularios, CSV, Norma 43, webhooks, herramientas MCP. Autorización: contexto `{company_id, role}` en cada petición, `write` denegado a gestoría, `404` para ajenos, funciones por plan en servidor, revocaciones sin caché. OAuth 2.1 + PKCE para MCP y confirmación de un solo uso para emitir/anular. IBAN, conceptos bancarios, emails y tokens fuera de logs (`logSafe` + regla de patrón IBAN). Datos de tarjeta nunca tocan la app (Checkout/Portal). Rate limits en `/x/*` y `/api/mcp`. `pnpm audit` cubre las dependencias nuevas. | ✅ PASS |
| IV | Eficiencia de Costes | Estimación incremental a 1x/10x/100x en research.md (≈ +0 / +5–30 / +110–145 $/mes de infraestructura; Stripe solo variable sobre ingresos, sin cuota fija). Sin servicios siempre encendidos nuevos. Exportaciones y muestras caducan y se borran a los 7 días; logotipos huérfanos purgados. Elegido Stripe frente a merchant of record por coste (~2,2 % frente a ~5 % + 0,50 €). Recordatorios acotados por diseño. | ✅ PASS |
| V | Experiencia UI/UX | Interfaz sencilla por defecto en Básico/Esencial (flujo crítico más corto); crear cliente/producto sin salir del editor; selectores con búsqueda accesibles por teclado (ARIA combobox); datos actualizados sin recarga mediante un patrón único (`router.refresh()` en el hook de mutación); funciones no incluidas → explicación + invitación, nunca error; errores nuevos accionables en español. shadcn/ui sigue siendo el sistema único (sin el rediseño visual aplazado). axe y responsive en todas las pantallas nuevas; usabilidad moderada para SC-004/SC-010. | ✅ PASS |

**Restricciones adicionales**: migraciones versionadas y reversibles, con cambios de enum separados de su uso ✅; auditoría inmutable ampliada (`document_event` con nuevos tipos y actores `advisor:`/`ai:`/`system:`, `plan_change` y `access_event` solo INSERT) ✅; logging estructurado con `request_id` en consumidores y cron ✅; UI en español, código/commits en inglés ✅.

**Resultado gate inicial**: PASS — sin violaciones que justificar.

**Re-check post-Phase 1**: PASS. El diseño revisado mantiene cada invariante v1: (1) el cupo por tipo es una modificación local de la sentencia atómica con el mismo orden `company → document_series`; las tres nuevas vías de emisión (facturar albaranes, ciclo recurrente, `confirm_action` MCP) usan la guarda común con estrategias de idempotencia cerradas (`converted_from`, `recurring_cycle`). (2) La inmutabilidad se refuerza: logotipos por contenido, método de cobro y nombre de impuesto congelados. Los únicos campos mutables en documentos emitidos (`quote_decision`, `reminders_enabled`, `released_at` del vínculo) son estado operativo, no contenido fiscal ni impreso, con evento de auditoría. (3) Estados derivados: presupuesto, albarán, movimiento bancario y acceso suspendido se calculan en consulta; el plan efectivo se materializa en `company.plan` solo porque la guarda de emisión lo lee bajo lock, y siempre por la reconciliación con `plan_change` en la misma transacción. (4) Ningún trabajo pesado en HTTP salvo el Excel de un documento, acotado y < 50 ms (research R12). Sin nuevas violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/002-factum-improvements/
├── spec.md              # Spec aprobada
├── plan.md              # Este fichero
├── research.md          # Phase 0: R0 auditoría + R1–R21 decisiones
├── data-model.md        # Phase 1: delta del modelo y migraciones 0004–0015
├── quickstart.md        # Phase 1: validación por incremento
├── contracts/
│   └── api.md           # Phase 1: delta REST, colas, MCP y matriz de permisos
├── checklists/
│   └── requirements.md  # Checklist de calidad de la spec
└── tasks.md             # Phase 2 (/speckit-tasks — no lo crea este comando)
```

### Source Code (repository root)

Mismo proyecto único Next.js. Solo se muestran directorios **nuevos (+)** o **modificados (~)**.

```text
src/
├── app/
│   ├── (app)/
│   │   ├── layout.tsx ~               # navegación por plan/ui_mode, contadores por tipo, selector de empresa
│   │   ├── dashboard/ ~               # resumen sencillo / panel Pro (US13)
│   │   ├── documents/ ~               # tipos nuevos, «Nuevo ▾», acciones en listado, print/ + (US4, US9)
│   │   ├── clients/ ~  catalog/ ~     # búsqueda, archivados, unidades, importación (US7)
│   │   ├── settings/ ~                # página única (sencilla) / pestañas (completa): cobro, impuestos, unidades, series, gestoría, integraciones
│   │   ├── billing/ +                 # planes, retorno de Checkout (US2)
│   │   ├── onboarding/ +              # asistente inicial (US14)
│   │   ├── recurring/ +               # recurrencias (US10)
│   │   ├── reconciliation/ +          # conciliación (US12)
│   │   ├── exports/ +                 # exportación y envíos a la asesoría (US8)
│   │   └── oauth/consent/ +           # consentimiento MCP (US15)
│   ├── api/
│   │   ├── v1/ ~                      # endpoints de contracts/api.md
│   │   ├── webhooks/stripe/ +
│   │   └── mcp/ +
│   └── x/[token]/ +                   # descarga pública caducable
├── components/
│   ├── ui/combobox.tsx +              # selector con búsqueda (R8)
│   ├── ui/async-action.tsx ~          # useMutation + router.refresh() (R17)
│   ├── plan/ ~                        # contador por tipo, FeatureUpsell, página de planes
│   └── documents/ ~, settings/ ~, onboarding/ +, recurring/ +, reconciliation/ +, exports/ +, dashboard/ ~
├── db/schema/ ~                       # tablas nuevas (una por fichero) y columnas
├── db/migrations/ ~                   # 0004–0015 + .down.sql
├── lib/
│   ├── plan.ts ~  billing-plan.ts +  navigation.ts +  iban.ts +  units.ts +
│   ├── billing/ ~  numbering/ ~  documents/conversion.ts ~
│   ├── recurrence.ts +  reminders.ts +
│   ├── bank/ +                        # norma43, matching, fingerprint
│   ├── csv/ +  exports/ +
├── services/
│   ├── context.ts ~                   # {company_id, role}, read/write, active company
│   ├── entitlements.ts +              # requireFeature
│   ├── document-issuance.ts ~         # cupo por tipo + estrategia recurring_cycle
│   ├── document-conversion.ts ~  document-links.ts +
│   ├── billing/ +                     # stripe client, checkout, portal, reconcile
│   ├── advisor-access.ts +  exports/ +  imports/ +  bank/ +  recurring/ +  reminders/ +
│   ├── notifications.ts +  onboarding.ts +
│   ├── mcp/ +                         # servidor, herramientas, confirmaciones
│   ├── email/templates/ ~             # layout Factum + nuevos propósitos
│   └── pdf/ ~                         # logotipos, bloque de pago, observaciones, sin email, muestra
└── workers/
    ├── queue-consumer.ts ~            # + cola jobs
    ├── handlers/ ~                    # recurring-run, reminder-send, export-build, import-*, pdf-sample, billing-grace
    ├── scheduled.ts ~                 # + planificador 0 5 * * *
    └── messages.ts ~                  # esquemas Zod de mensajes nuevos

tests/
├── unit/ ~          # un fichero por módulo nuevo de lib
├── integration/ ~   # permisos, cupo por tipo, conversiones, recurrencias, recordatorios, conciliación, exportaciones, webhooks, MCP
├── e2e/ ~           # US1 sin recarga, planes, interfaz sencilla, editor, gestoría, conciliación, onboarding
├── fixtures/ ~      # csv/, bank/*.n43, pdf/
└── performance/ ~   # búsqueda trigram, exportación 500 docs, panel
```

**Structure Decision**: se mantiene el proyecto único Next.js de la v1 y su separación `lib` (puro) / `services` (I/O) / `workers` (colas y cron). Stripe, MCP y la gestoría se integran como servicios del mismo Worker, sin nuevos despliegues: un solo deployable sigue minimizando coste y operación (Principio IV).

## Entrega por incrementos

La spec pide incrementos desplegables por prioridad. Cada incremento lleva sus migraciones, pasa CI y se despliega con los gates v1.

| Inc. | Historias | Contenido base que introduce | Migraciones | Depende de |
|---|---|---|---|---|
| **1 (P1)** | US1, US2, US3 | Hook de mutación con refresco; combobox; plantillas Factum; planes por tipo + `requireFeature`; Stripe; navegación por plan y `FeatureUpsell` | 0004, 0005 | — |
| **2 (P2)** | US4, US5, US6 | Series automáticas y archivado; métodos de cobro; impuestos propios; unidades; logotipos inmutables; nuevo diseño de PDF; Excel por documento | 0006, 0007 | Inc. 1 (plan para Excel Pro) |
| **3 (P3)** | US7, US8, US9, US10 | Búsqueda trigram; importación CSV; cola `jobs` + planificador; exportaciones; gestoría y contexto con roles; presupuestos/albaranes y `document_link`; recurrencias | 0008–0011 | Inc. 2 (impuestos con nombre para Excel; métodos de cobro) |
| **4 (P4)** | US11, US12, US13, US14 | Recordatorios; extractos y conciliación; panel Pro y tesorería; asistente inicial y muestra | 0012–0014 | Inc. 2 (cuentas bancarias), Inc. 3 (cola `jobs`, importación) |
| **5 (P5)** | US15 | OAuth de Better Auth, servidor MCP, confirmaciones | 0015 | Inc. 1–4 (servicios que expone) |

Nota: la interfaz sencilla (US3, Inc. 1) solo muestra «Nuevo ▾» con los tipos existentes (factura, proforma) hasta que el Inc. 3 añade presupuestos y albaranes.

El Inc. 1 se despliega en dos pasos: release de compatibilidad (T011, `0004`) y después el resto (`0005` + código v2). Ver data-model, «Migración del plan».

Pro se muestra desde el Inc. 1 como «Próximamente» y solo es contratable desde el Inc. 3 (flag `PRO_CHECKOUT_ENABLED`, comprobado también en servidor por el checkout). Ver spec, Assumptions, «Comercialización de Pro».

Dentro de cada incremento, `/speckit-tasks` ordenará primero lo fundacional (esquema, `lib` con tests, contexto/entitlements) y después cada historia de forma independiente comprobable. La numeración final de migraciones se fija al generarlas con drizzle-kit en el orden real de entrega; data-model.md describe su contenido.

**Cambios que modifican reglas de la v1** (deben reflejarse en tests existentes, no solo añadirse): cupo único → cupo por tipo; enum de plan; proforma convertible «una vez» → «una vez sin confirmación»; `converted_*` → `document_link`; desglose de impuestos por `(nombre, tipo)`; los PDF dejan de mostrar el email del cliente y «Sin notas».

## Deployment and Merge Gates

Los de la v1 sin cambios (Sentry con `request_id`, TLS/cifrado verificados, R2 privado, alertas de gasto, PR con aprobación y CI verde, sin push directo). El verificador pre-deploy se amplía por incremento: secreto y endpoint de webhook de Stripe registrados en el entorno, dominio de Factum verificado en Resend, cola `invoice-flash-jobs` y su DLQ existentes, cron `0 5 * * *` registrado, `billing_price` sincronizado, rate limiters nuevos presentes. Smoke post-deploy: Checkout de prueba en staging y email recibido con remitente Factum (ver [quickstart.md](./quickstart.md#despliegue)).

## Complexity Tracking

Sin violaciones constitucionales que justificar. Decisiones que merecen constancia para la revisión:

| Decisión | Por qué | Alternativa más simple descartada |
|---|---|---|
| `company.plan` materializado además de `subscription` | La guarda de emisión necesita el plan bajo el mismo `FOR UPDATE` de la empresa; derivarlo de `subscription` en esa sentencia añadiría un join y la lógica de gracia a SQL. Se escribe solo en la reconciliación, junto a `plan_change`. | Derivar siempre en consulta (lógica de gracia duplicada en SQL y TS). |
| Excel de un documento generado en la petición | Acotado (≤ líneas del editor), < 50 ms de CPU, no es «larga duración»; encolarlo empeora la UX de un clic sin beneficio. | Encolar también este caso. |
| Campos operativos mutables en documentos emitidos (`quote_decision`, `reminders_enabled`, `document_link.released_at`) | Son estados comerciales/operativos, no contenido fiscal ni impreso; cada cambio queda en `document_event`. | Tablas de estado separadas para cada uno (más joins sin ganancia de integridad). |
| Bajada de plan sin mutar datos Pro | Restaurar «tal como estaba» sin recordar estados previos; la comprobación en el momento de uso es la única fuente de verdad. | Pausar recurrencias y revocar accesos al degradar (habría que guardar y restaurar el estado anterior). |
