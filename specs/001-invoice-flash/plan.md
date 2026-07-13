# Implementation Plan: Invoice Flash — Facturación sencilla para autónomos y pequeños negocios

**Branch**: `001-invoice-flash` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-invoice-flash/spec.md`

## Summary

Aplicación web responsive de facturación para autónomos y pequeños negocios del mercado español: perfil de empresa, clientes, catálogo de conceptos, documentos (facturas, proformas, recibos) con numeración correlativa garantizada, cálculo exacto al céntimo, PDF profesional, enlace público compartible, envío por email condicionado por plan, y panel de control de cobros con estados derivados (pendiente, parcial, pagada, vencida).

**Enfoque técnico**: monolito full-stack TypeScript con Next.js 15 (App Router), desplegado serverless en Cloudflare Workers vía adaptador OpenNext (escala a cero, ~5 $/mes), con Neon Postgres serverless (scale-to-zero, capa gratuita) + Drizzle ORM, Better Auth para autenticación, generación de PDF con `pdf-lib` (JS puro, compatible con workerd) cacheados en R2, envío de email asíncrono vía Cloudflare Queues + Resend, y UI con Tailwind CSS + shadcn/ui. Gestor de paquetes: **pnpm** (requisito del usuario). Estados de cobro y vencimiento derivados en tiempo de consulta (sin cron). Importes como enteros en céntimos. Detalle completo de decisiones y alternativas en [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x en modo `strict` (Node.js 22 LTS en desarrollo; runtime de producción workerd/V8 isolates en Cloudflare Workers). React 19.

**Primary Dependencies**: Next.js 15 (App Router, full-stack), Drizzle ORM + drizzle-kit (migraciones versionadas), Better Auth (autenticación email/contraseña + recuperación), Zod (validación en el borde), `pdf-lib` (generación de PDF en JS puro), Resend SDK (email transaccional), Tailwind CSS 4 + shadcn/ui (sistema de diseño), `@opennextjs/cloudflare` (adaptador de despliegue), `@neondatabase/serverless` (driver Postgres para Workers).

**Storage**: Neon Postgres serverless (datos relacionales; transacciones para numeración correlativa) + Cloudflare R2 (objetos: logotipos y PDFs cacheados, sin coste de egreso). Migraciones versionadas y reversibles con drizzle-kit.

**Testing**: Vitest (unitarias de lógica de negocio: cálculos, estados, numeración; integración contra Postgres de prueba vía Neon branch o Docker local) + Playwright (E2E de flujos críticos: registro→primera factura, registro de pagos, enlace público). Cobertura vigilada en CI (GitHub Actions).

**Target Platform**: Web responsive (móvil y escritorio), navegadores evergreen. Backend serverless en Cloudflare Workers (edge, escala a cero).

**Project Type**: Aplicación web full-stack (proyecto único Next.js; frontend + API route handlers + consumidor de cola en el mismo despliegue).

**Performance Goals**: p95 < 300 ms en operaciones CRUD; render de PDF < 500 ms (cacheado en R2 tras emisión, servido desde caché en descargas posteriores); búsqueda de clientes con resultados < 200 ms; feedback de UI < 100 ms (estados de carga optimistas).

**Constraints**: cálculos monetarios exactos al céntimo (enteros en céntimos, sin coma flotante); numeración correlativa sin huecos ni duplicados bajo concurrencia (transacción con bloqueo de fila sobre la serie); documentos emitidos inmutables (snapshot de emisor y cliente); enlaces públicos no adivinables (token aleatorio ≥128 bits); coste de infraestructura ≈ 5–6 $/mes en lanzamiento, < 60 $/mes a 10x.

**Scale/Scope**: v1 para ~1.000 usuarios activos, ~10.000 documentos/mes agregados (diseño validado a 10x: 10k usuarios / 100k docs/mes); ~15 pantallas; una empresa por usuario; español únicamente; 27 requisitos funcionales en 6 historias de usuario.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principio | Evaluación | Estado |
|---|-----------|------------|--------|
| I | Calidad de Código | TypeScript `strict` (sin `any` no justificado); Biome como linter+formateador único ejecutado en CI; Vitest para toda la lógica de negocio (cálculos, numeración, estados de cobro tienen además pruebas de integración con Postgres real); cobertura de módulos de negocio vigilada en CI. | ✅ PASS |
| II | Escalabilidad por Diseño | Workers stateless (estado en Neon/R2, nunca en proceso); envío de email vía Cloudflare Queues (asíncrono); PDF generado en job de cola al emitir y cacheado en R2 (fallback on-demand justificado: render `pdf-lib` < 500 ms acotado); todos los listados paginados por cursor con límite por defecto (25) y máximo (100); índices declarados en data-model.md para cada patrón de consulta; sin N+1 (consultas con joins/agregados explícitos); diseño validado a 10x (100k docs/mes ≪ límites de Workers/Neon Launch). | ✅ PASS |
| III | Seguridad como Requisito | Secretos en Cloudflare Secrets + `.dev.vars` fuera del repo; validación Zod en servidor para toda entrada (formularios, API, subida de logo, token público); autorización a nivel de recurso: toda consulta filtrada por `company_id` derivado de la sesión (deny by default, helper único de scoping); TLS extremo a extremo; R2 privado (PDF servido solo vía Worker autorizado o token de enlace); NIF/importes excluidos de logs; `pnpm audit` + Dependabot en CI bloqueando vulnerabilidades altas/críticas. | ✅ PASS |
| IV | Eficiencia de Costes | Estimación adjunta (ver tabla inferior): ~5–6 $/mes lanzamiento, ~35–55 $/mes a 10x; todo el stack escala a cero (Workers, Neon, R2); PDFs cacheados en R2 tras primer render (documentos emitidos son inmutables → caché perfecta); emails deduplicados por registro en historial; alertas de presupuesto en Cloudflare y Neon desde el primer despliegue. | ✅ PASS |
| V | Experiencia UI/UX | Flujo crear-factura en una sola pantalla (cliente + líneas + totales en vivo); estados de carga/confirmación < 100 ms (transiciones optimistas de React 19); errores accionables en español vía mapa central de errores (códigos técnicos solo a logs); shadcn/ui como sistema de diseño único (componentes accesibles por defecto, base Radix); verificación WCAG 2.1 AA (axe en Playwright) antes de fusionar UI; responsive verificado en viewport móvil y escritorio en E2E. | ✅ PASS |

**Restricciones adicionales**: migraciones versionadas/reversibles (drizzle-kit) ✅; log de auditoría inmutable de documentos (tabla `document_events`, solo inserción) ✅; logging estructurado JSON con `request_id` + Sentry (capa gratuita) desde el primer despliegue ✅; UI en español, código/commits en inglés ✅.

**Estimación de coste mensual** (Principio IV):

| Servicio | Lanzamiento (~100 usuarios) | 10x (~1.000 usuarios activos) |
|----------|------------------------------|-------------------------------|
| Cloudflare Workers Paid (incluye Queues, Cron) | 5 $ | 5–10 $ |
| Neon Postgres | 0 $ (Free: 0,5 GB, 100 CU-h, scale-to-zero) | ~10–20 $ (Launch, uso puro sin mínimo) |
| Cloudflare R2 (logos + PDFs, sin egreso) | ~0 $ | ~1–2 $ |
| Resend (email) | 0 $ (3.000/mes) | 20 $ (Pro, 50.000/mes) |
| Sentry (errores) | 0 $ (capa gratuita) | 0–26 $ |
| GitHub Actions (CI) | 0 $ | 0 $ |
| **Total** | **~5–6 $/mes** | **~35–55 $/mes** |

**Resultado gate inicial**: PASS — sin violaciones que justificar.

**Re-check post-Phase 1**: PASS — el modelo de datos añade índices por cada patrón de consulta, snapshots inmutables (Principio III/trazabilidad), y los contratos definen paginación y autorización en todos los endpoints. Sin nuevas violaciones.

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
│   ├── pdf/                    # render pdf-lib + caché R2
│   └── email/                  # productor de cola + plantillas Resend
├── workers/
│   └── queue-consumer.ts       # consumidor Cloudflare Queues (PDF al emitir, emails)
└── proxies/                    # middleware de auth y request-id

tests/
├── unit/                       # lib/* (Vitest)
├── integration/                # services + API contra Postgres real (Vitest)
└── e2e/                        # flujos críticos + axe accesibilidad (Playwright)
```

**Structure Decision**: proyecto único Next.js (opción "single full-stack app"). El frontend y la API comparten tipos y validadores Zod; la lógica de negocio vive aislada en `src/lib` (pura, sin I/O) para cumplir el mandato de pruebas unitarias del Principio I; `src/services` encapsula el acceso a datos y servicios externos. El consumidor de Queues se despliega como parte del mismo Worker (configuración OpenNext/wrangler). No hay necesidad de monorepo ni de separar backend/frontend: un solo deployable minimiza coste y fricción operativa (Principio IV).

## Complexity Tracking

Sin violaciones constitucionales que justificar. (Nota no bloqueante: el render de PDF tiene un fallback síncrono on-demand si el usuario descarga antes de que el job de cola termine; justificado en Constitution Check II por render acotado < 500 ms con `pdf-lib` y caché inmediata en R2.)
