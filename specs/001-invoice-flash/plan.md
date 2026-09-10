# Implementation Plan: Invoice Flash — Facturación sencilla para autónomos y pequeños negocios

**Branch**: `001-invoice-flash` | **Date**: 2026-07-09 | **Updated**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-invoice-flash/spec.md`

## Summary

Aplicación web responsive de facturación para autónomos y pequeños negocios del mercado español: perfil de empresa, clientes, catálogo de conceptos, facturas y proformas con numeración correlativa y cálculo exacto al céntimo, recibos inmutables generados una sola vez por pago, PDF profesional, enlace público compartible, envío por email condicionado por plan, y panel de control de cobros con estados derivados (pendiente, parcial, pagada, vencida).

**Enfoque técnico**: monolito full-stack TypeScript con Next.js 15 (App Router), desplegado serverless en Cloudflare Workers vía adaptador OpenNext (escala a cero, ~5 $/mes), con Neon Postgres serverless (scale-to-zero, capa gratuita) + Drizzle ORM, Better Auth para autenticación, generación de PDF con `pdf-lib` exclusivamente en Cloudflare Queues y caché permanente en R2, y todo email —documentos, verificación y recuperación— persistido como entrega idempotente y enviado vía Cloudflare Queues + Resend. La UI usa Tailwind CSS + shadcn/ui. Gestor de paquetes: **pnpm** (requisito del usuario). Estados de cobro y vencimiento derivados en tiempo de consulta (sin cron). Importes como enteros en céntimos. Detalle completo de decisiones y alternativas en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x en modo `strict` (Node.js 22 LTS en desarrollo; runtime de producción workerd/V8 isolates en Cloudflare Workers). React 19.

**Primary Dependencies**: Next.js 15 (App Router, full-stack), Drizzle ORM + drizzle-kit (migraciones versionadas), Better Auth (autenticación email/contraseña + recuperación), Zod (validación en el borde), `pdf-lib` (generación de PDF en JS puro), Resend SDK (email transaccional), Tailwind CSS 4 + shadcn/ui (sistema de diseño), `@opennextjs/cloudflare` (adaptador de despliegue), `@neondatabase/serverless` (driver Postgres para Workers).

**Storage**: Neon Postgres serverless (datos relacionales; transacciones para numeración correlativa; cifrado AES-256 en reposo y TLS en tránsito) + Cloudflare R2 (logotipos y PDFs cacheados; cifrado AES-256-GCM automático en reposo; sin coste de egreso). Migraciones versionadas y reversibles con drizzle-kit. La configuración real de cifrado y TLS se verifica antes de cada despliegue productivo y queda documentada sin secretos.

**Testing**: Vitest (unitarias de toda lógica de negocio, incluidas reglas de cambio anual de serie, capacidades `free=5`/`pro=100`, conversión y recibos; integración contra Postgres real vía Neon branch o Docker local) + Playwright (E2E de flujos críticos, axe y feedback visible <100 ms) + runner Vitest/fetch concurrente reproducible contra staging para p95 de CRUD/búsqueda y medición aislada del consumidor PDF. Se prueban reentregas duplicadas de Queues, recibo único por pago, snapshot del emisor tras editar la empresa, aislamiento por empresa en cada contrato, la idempotencia de emails documentales y de autenticación sin enumeración de cuentas, y emisiones concurrentes mixtas —ruta convencional, conversión directa y recibo— en el borde del cupo para demostrar que ninguna vía lo sobrepasa ni consume numeración al ser rechazada. La validación final incluye sesiones moderadas con al menos 10 participantes según el protocolo de la spec. Cobertura y umbrales de rendimiento vigilados en CI (GitHub Actions).

**Target Platform**: Web responsive (móvil y escritorio), navegadores evergreen. Backend serverless en Cloudflare Workers (edge, escala a cero).

**Project Type**: Aplicación web full-stack (proyecto único Next.js; frontend + API route handlers + consumidor de cola en el mismo despliegue).

**Performance Goals**: p95 < 300 ms en operaciones CRUD; búsqueda de clientes p95 < 200 ms; render del consumidor PDF p95 < 500 ms y PDF disponible p95 < 3 s desde la emisión; feedback visible de UI < 100 ms para toda acción (estado optimista, carga, confirmación o error). Si el PDF aún no está disponible, la descarga responde `202 pdf_processing` con `Retry-After`; ninguna petición HTTP lo renderiza.

**Constraints**: cálculos fiscales exactos al céntimo para facturas/proformas y recibo igual al pago sin fiscalidad; numeración correlativa sin huecos ni duplicados bajo concurrencia (transacción con bloqueo de fila sobre la serie); documentos emitidos inmutables (snapshot de emisor y cliente); recibos únicos por pago y generados directamente como emitidos; capacidades v1 versionadas `free=5`/`pro=100` por mes natural `Europe/Madrid`, contando anulados ya emitidos; toda creación de un documento emitido usa una guarda transaccional compartida que bloquea primero la empresa, comprueba el cupo y solo después reserva numeración, mientras las repeticiones idempotentes que recuperan un documento existente omiten ese consumo; enlaces públicos no adivinables (token aleatorio ≥128 bits); consumidores de cola idempotentes porque Queues ofrece entrega al menos una vez; cifrado en tránsito y reposo verificado; ningún despliegue remoto antes de activar Sentry, controles de cifrado/TLS y alertas de gasto; coste objetivo ≈ 5–6 $/mes en lanzamiento y sobre conservador ≈ 36–78 $/mes en el objetivo v1.

**Scale/Scope**: lanzamiento con ~100 usuarios activos y ~1.000 documentos/mes; objetivo v1 (10x lanzamiento) con ~1.000 usuarios y ~10.000 documentos/mes; escenario de resiliencia (10x objetivo v1) con ~10.000 usuarios y ~100.000 documentos/mes. ~15 pantallas; una empresa por usuario; español únicamente; 27 requisitos funcionales en 6 historias de usuario.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principio | Evaluación | Estado |
|---|-----------|------------|--------|
| I | Calidad de Código | TypeScript `strict` (sin `any` no justificado); Biome como linter+formateador único ejecutado en CI; Vitest para toda la lógica de negocio, incluidas reglas de cambio anual, conversión y recibos; facturación, cálculo, numeración, estados de cobro e idempotencia tienen pruebas de integración con Postgres real; cobertura de módulos de negocio vigilada en CI. | ✅ PASS |
| II | Escalabilidad por Diseño | Workers stateless (estado en Neon/R2, nunca en proceso); todo email y PDF exclusivamente vía Cloudflare Queues; descarga sin PDF listo → `202` y reintento, nunca render síncrono; consumidores idempotentes ante entrega al menos una vez; todas las colecciones paginadas explícitamente por cursor con default 25 y máximo 100; índices declarados por patrón; sin N+1; diseño evaluado hasta 100k docs/mes. | ✅ PASS |
| III | Seguridad como Requisito | Secretos en Cloudflare Secrets + `.dev.vars` fuera del repo; Zod en servidor; toda consulta privada filtrada por `company_id`; matriz contractual final de aislamiento; respuestas de recuperación indistinguibles para impedir enumeración; TLS obligatorio; Neon y R2 cifrados en reposo con verificación pre-deploy; R2 privado; NIF/importes/tokens/email excluidos de logs y mensajes de cola; `pnpm audit` + Dependabot bloquean vulnerabilidades altas/críticas. | ✅ PASS |
| IV | Eficiencia de Costes | Tres escalas diferenciadas y presupuestadas; stack con scale-to-zero; PDFs cacheados permanentemente; email deduplicado mediante `email_delivery` + clave estable de Resend; alerta real de Cloudflare antes del primer despliegue; Neon Free se monitoriza sin gasto facturable y su Spending Limit se activa antes de pasar a un plan de pago. | ✅ PASS |
| V | Experiencia UI/UX | Flujo crear-factura en una pantalla; dashboard compone totales y facturas paginadas en esa misma vista; toda acción muestra feedback <100 ms mediante patrón común y pruebas con red retrasada; errores accionables en español; shadcn/ui como sistema único; axe WCAG 2.1 AA y responsive móvil/escritorio en E2E; protocolo moderado con ≥10 usuarios para SC-001/SC-005. | ✅ PASS |

**Restricciones adicionales**: migraciones versionadas/reversibles (drizzle-kit) ✅; log de auditoría inmutable de documentos (tabla `document_events`, solo inserción) ✅; logging estructurado JSON con `request_id` + Sentry desde el primer despliegue ✅; cifrado en reposo y alertas de gasto con evidencia pre-deploy ✅; protección de `main`, revisión aprobada y CI verde antes de fusionar ✅; UI en español, código/commits en inglés ✅.

**Estimación de coste mensual** (Principio IV):

| Servicio | Lanzamiento (~100 / 1k docs) | Objetivo v1, 10x (~1k / 10k docs) | Resiliencia, 100x lanzamiento (~10k / 100k docs) |
|----------|--------------------------------|--------------------------------------|--------------------------------------------------|
| Cloudflare Workers Paid + Queues | 5 $ | 5–10 $ | 10–50 $ |
| Neon Postgres | 0 $ | ~10–20 $ | ~50–120 $ |
| Cloudflare R2 | ~0 $ | ~1–2 $ | ~5–15 $ |
| Resend | 0 $ (≤3.000 emails) | 20 $ (≤50.000 emails) | 90 $ (≤100.000 emails) |
| Sentry | 0 $ | 0–26 $ | ≥26 $ |
| GitHub Actions | 0 $ | 0 $ | según minutos/retención |
| **Total orientativo** | **~5–6 $/mes** | **~36–78 $/mes** | **~180–310 $/mes** |

La tercera columna es un sobre conservador de resiliencia —incluye hasta un email por documento y hasta 100M peticiones Worker—, no el presupuesto operativo de v1. Debe recalibrarse con métricas reales antes de superar el objetivo v1.

**Resultado gate inicial**: PASS — sin violaciones que justificar.

**Re-check post-Phase 1**: PASS — el modelo añade índices por patrón, snapshots inmutables con regresión tras editar empresa, recibo único por pago sin fiscalidad, capacidades versionadas `free=5`/`pro=100` y una guarda transaccional común a toda vía de emisión, estado operativo de PDF y `email_delivery` idempotente para documentos y autenticación; los contratos hacen explícita la composición del dashboard, la paginación y la matriz de aislamiento. Quickstart añade la validación moderada, impide desplegar antes de verificar Sentry/cifrado/alertas y exige PR aprobado con CI verde. Sin nuevas violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/001-invoice-flash/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── api.md           # Contrato REST de la API interna + endpoints públicos
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Proyecto único Next.js full-stack (frontend, API y consumidor de cola en un solo despliegue). No se usa monorepo: una sola app instalable con pnpm.

```text
src/
├── app/                        # Next.js App Router
│   ├── (auth)/                 # login, registro, recuperación de contraseña
│   ├── (app)/                  # área privada
│   │   ├── dashboard/          # panel de cobros (US2)
│   │   ├── documents/          # listado, editor, detalle (US1, US6)
│   │   ├── clients/            # cartera de clientes (US3)
│   │   ├── catalog/            # catálogo de conceptos (US4)
│   │   └── settings/           # empresa, series, plan (US1)
│   ├── d/[token]/              # vista pública de documento por enlace (US5)
│   └── api/v1/                 # route handlers REST (ver contracts/api.md)
├── components/                 # shadcn/ui base + componentes de dominio
├── db/
│   ├── schema/                 # esquema Drizzle (una tabla por fichero)
│   └── migrations/             # migraciones versionadas drizzle-kit
├── lib/                        # lógica de negocio pura (sin I/O, 100% unit-testeable)
│   ├── money/                  # céntimos, redondeo, formato EUR
│   ├── billing/                # base imponible, desglose IVA, retención IRPF, totales
│   ├── documents/              # ciclo de vida, validación de emisión, snapshots
│   ├── numbering/              # asignación correlativa por serie
│   └── payments/               # derivación de estado de cobro
├── services/                   # orquestación (db + lib + colas + R2)
│   ├── document-issuance.ts    # guarda común de cupo + numeración + emisión atómica
│   ├── pdf/                    # render pdf-lib + caché R2
│   └── email/                  # entregas idempotentes + plantillas de documentos/auth
├── workers/
│   └── queue-consumer.ts       # consumidor Cloudflare Queues (PDF al emitir, emails)
└── proxies/                    # middleware de auth y request-id

tests/
├── unit/                       # lib/* (Vitest)
├── integration/                # services + API contra Postgres real (Vitest)
├── e2e/                        # flujos críticos + axe + feedback (Playwright)
└── performance/                # p95 API/búsqueda/PDF contra staging
```

**Structure Decision**: proyecto único Next.js (opción "single full-stack app"). El frontend y la API comparten tipos y validadores Zod; la lógica de negocio vive aislada en `src/lib` (pura, sin I/O) para cumplir el mandato de pruebas unitarias del Principio I; `src/services` encapsula el acceso a datos y servicios externos. El consumidor de Queues se despliega como parte del mismo Worker (configuración OpenNext/wrangler). No hay necesidad de monorepo ni de separar backend/frontend: un solo deployable minimiza coste y fricción operativa (Principio IV).

## Deployment and Merge Gates

Antes de cualquier despliegue remoto —incluido el primer staging— deben estar activos y verificados Sentry con `request_id`, TLS de Neon, cifrado y privacidad de R2, alerta real de gasto de Cloudflare y monitorización/Spending Limit de Neon acorde al plan contratado. El verificador pre-deploy bloquea si falta evidencia no sensible de cualquiera de estos controles. Después del despliegue se ejecuta un smoke test móvil y se comprueba que los errores de prueba llegan a Sentry.

Antes de fusionar en `main`, la rama debe pasar por pull request con al menos una aprobación, revisiones obsoletas descartadas, todos los checks requeridos en verde, push directo y force-push bloqueados. La validación final registra la referencia del PR y los nombres de los checks, sin datos sensibles.

## Complexity Tracking

Sin violaciones constitucionales que justificar. El diseño revisado elimina el fallback síncrono de PDF; la descarga pendiente usa `202 pdf_processing`. La entrega al menos una vez de Queues se absorbe mediante consumidores idempotentes, claves estables y estados persistidos. `email_delivery` admite documentos y autenticación porque los usuarios aún no tienen por qué disponer de empresa durante verificación/recuperación; solo las entregas documentales generan eventos de documento. Los límites de plan se versionan en código como una única fuente de verdad para evitar divergencia entre API, UI y pruebas; una guarda transaccional única serializa por empresa la emisión convencional, la conversión directa y los recibos antes de bloquear la serie, evitando tanto el bypass como los interbloqueos por distinto orden de locks. Cualquier cambio de capacidades es una modificación de producto revisable.
