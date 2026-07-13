# Research: Invoice Flash — Elección de stack y decisiones técnicas

**Date**: 2026-07-09 | **Plan**: [plan.md](./plan.md)

**Contexto de entrada**: el usuario no impone stack; único requisito duro: **si se usa Node, el gestor de paquetes es exclusivamente pnpm**. Criterio de selección: máxima eficacia coste/eficiencia (alineado con el Principio IV de la constitución), para una app web responsive de facturación (mercado español, un solo desarrollador, v1 acotada).

Precios verificados en julio de 2026 contra fuentes públicas (ver "Fuentes" al final).

---

## R1. Lenguaje y plataforma: TypeScript full-stack

- **Decision**: TypeScript 5.x en modo `strict` para todo el sistema (UI, API, jobs), sobre Node.js 22 LTS en desarrollo y workerd (V8 isolates) en producción. Gestor de paquetes: **pnpm** (requisito del usuario).
- **Rationale**: un único lenguaje elimina duplicación de modelos y validadores entre cliente y servidor (los esquemas Zod y los tipos de dominio se comparten); el tipado estricto satisface el Principio I; el ecosistema serverless más barato (Cloudflare, Vercel, Netlify) es JS-first, lo que habilita las opciones de menor coste del Principio IV. Para un solo desarrollador, un solo lenguaje/toolchain es la mayor ganancia de eficiencia disponible.
- **Alternatives considered**:
  - *Python (FastAPI) + React SPA*: dos lenguajes, dos toolchains, dos despliegues; el hosting serverless de Python con scale-to-zero es más caro/friccionado. Rechazado por coste operativo y de desarrollo.
  - *Go + React SPA*: excelente rendimiento pero sobredimensionado para CRUD + PDF; mismo problema de doble stack. Rechazado.
  - *PHP (Laravel)*: productivo, pero requiere servidor siempre encendido (viola preferencia de scale-to-zero) y tipado más débil. Rechazado.

## R2. Framework: Next.js 15 (App Router, full-stack)

- **Decision**: Next.js 15 con App Router y React 19 como framework único (páginas + route handlers REST + server components).
- **Rationale**: un solo deployable (menos coste y ops); SSR para la vista pública de documentos (US5: debe cargar rápido en móvil sin cuenta); ecosistema más amplio (shadcn/ui, Better Auth, adaptadores de despliegue OpenNext) — reduce código propio; portable entre Cloudflare/Vercel/Node autoalojado, evitando lock-in del proveedor de hosting.
- **Alternatives considered**:
  - *SvelteKit / SolidStart*: menor huella, pero ecosistema de componentes accesibles y auth notablemente menor → más código propio, más coste de desarrollo. Rechazado.
  - *Remix/React Router 7*: viable, pero menor soporte de tooling de despliegue en Cloudflare vía OpenNext y comunidad menor que Next. Rechazado por eficiencia.
  - *Hono + SPA React separada*: máximo control y mínima huella en Workers, pero dos apps que mantener y sin SSR out-of-the-box para el enlace público. Rechazado.

## R3. Hosting: Cloudflare Workers vía OpenNext (`@opennextjs/cloudflare`)

- **Decision**: desplegar la app Next.js en Cloudflare Workers con el adaptador OpenNext, plan Workers Paid (5 $/mes, incluye 10M requests, Queues y Cron Triggers).
- **Rationale**: es la opción serverless comercial más barata verificada: 5 $/mes fijos frente a 20 $/asiento/mes de Vercel Pro (el plan Hobby de Vercel prohíbe uso comercial y esto es un SaaS). Incluye en el mismo plan las piezas que la arquitectura necesita: Queues (trabajo asíncrono, Principio II), R2 (objetos sin egreso) y Cron. Escala a cero de facto (pago por petición). A 10x sigue en ~5–10 $/mes, mientras Vercel crece por asiento + uso.
- **Riesgo aceptado y mitigación**: OpenNext lo opera uno mismo (vs. `git push` en Vercel) y workerd no es Node completo. Mitigación: (a) las dependencias elegidas son compatibles con workerd (`pdf-lib` JS puro, driver Neon serverless, Better Auth edge-ready); (b) Next.js es portable: si el adaptador bloquease el desarrollo, migrar a Vercel Pro (20 $/mes) es un cambio de configuración, no de código. Esta portabilidad es parte de la decisión.
- **Alternatives considered**:
  - *Vercel Pro*: mejor DX, cero fricción, pero 20 $/mes mínimo + uso; a 10x típicamente 40–70 $/mes. Queda como **fallback documentado** si OpenNext genera fricción real.
  - *VPS (Hetzner ~5 €/mes) + Coolify*: barato pero siempre encendido (la constitución exige justificar recursos always-on), sin escala automática y con coste de ops (parcheo, backups) que recae en el único desarrollador. Rechazado.
  - *Railway / Fly.io (~5 $/mes)*: contenedor siempre-encendido o con cold starts agresivos; menos integrado (colas y objetos aparte). Rechazado.

## R4. Base de datos: Neon Postgres serverless + Drizzle ORM

- **Decision**: Neon Postgres (plan Free: 0,5 GB, 100 CU-h/mes, scale-to-zero con suspensión a los 5 min) con `@neondatabase/serverless` (funciona sobre WebSocket/HTTP en Workers) y Drizzle ORM + drizzle-kit para esquema y migraciones versionadas.
- **Rationale**: la facturación exige transacciones ACID y bloqueo de filas para la numeración correlativa sin huecos (FR-013) y tipos exactos — Postgres lo da de serie. Neon escala a cero (coste 0 en lanzamiento) y su plan de pago es puro uso sin mínimo mensual (compute 0,106 $/CU-h, storage 0,35 $/GB-mes tras las bajadas de precio de 2026) → ~10–20 $/mes a 10x. El branching de Neon da bases de datos de prueba efímeras gratis para integración en CI. Drizzle: ORM TypeScript-first, ligero, compatible con workerd, migraciones SQL versionadas y reversibles (mandato constitucional), sin runtime pesado.
- **Alternatives considered**:
  - *Cloudflare D1 (SQLite)*: aún más barato e integrado, pero transaccionalidad limitada (sin transacciones interactivas multi-statement con bloqueo de fila desde el Worker), lo que complica la garantía de numeración correlativa bajo concurrencia. Rechazado por riesgo en el requisito más crítico.
  - *Supabase*: bundle atractivo (Postgres+Auth+Storage) pero acopla auth y storage al proveedor; el plan Pro (25 $/mes) es más caro que Neon+R2+Better Auth a igual volumen. Rechazado por coste y acoplamiento.
  - *Prisma en vez de Drizzle*: engine más pesado en edge, generación de cliente adicional; Drizzle es más eficiente en Workers. Rechazado.

## R5. Autenticación: Better Auth

- **Decision**: Better Auth (open source, self-hosted en la propia app) con email/contraseña + verificación + recuperación, sesiones en Postgres vía adaptador Drizzle.
- **Rationale**: coste cero a cualquier escala (vs. proveedores por MAU); los datos de usuarios quedan en nuestra base (datos fiscales sensibles, Principio III); soporta runtimes edge; adaptador Drizzle oficial genera las tablas. Cubre FR-001 completo sin código criptográfico propio.
- **Alternatives considered**:
  - *Clerk / Auth0*: excelente DX pero coste por MAU que crece justo con el éxito (Clerk gratis hasta 10k MAU pero features clave de pago; Auth0 caro pronto). Rechazado por Principio IV.
  - *Auth.js (NextAuth v5)*: gratuito también, pero el flujo credentials + reset de contraseña es de segunda clase (orientado a OAuth). Better Auth lo trae de serie. Rechazado.

## R6. Generación de PDF: `pdf-lib` con plantilla propia, caché en R2

- **Decision**: generar los PDF con `pdf-lib` (TypeScript puro, sin dependencias de Node/navegador) mediante una plantilla de factura propia (layout tabular acotado); render disparado como job de Cloudflare Queues al emitir el documento, resultado almacenado en R2 y servido desde ahí en descargas posteriores (los documentos emitidos son inmutables → caché permanente). Fallback: render on-demand si se descarga antes de completarse el job.
- **Rationale**: es la opción más barata y rápida (~50–300 ms, sin headless Chrome, sin servicio externo por documento) y la única de las candidatas 100% compatible con workerd sin flags de compatibilidad frágiles. Una factura es un documento tabular acotado: una plantilla propia es ~1 fichero de layout, coste asumible y control total del resultado (desglose de IVA, marca "proforma sin validez fiscal", etc.).
- **Alternatives considered**:
  - *@react-pdf/renderer*: DX excelente (JSX), pero compatibilidad irregular en workerd (fontkit/Buffer) → riesgo de bloqueo en el runtime elegido. Rechazado; reconsiderar si se migrase a runtime Node.
  - *Puppeteer/Playwright (HTML→PDF)*: máxima fidelidad visual pero exige headless Chrome (imposible en Workers, caro en cualquier serverless: memoria y arranque). Rechazado por coste.
  - *API externa (DocRaptor, PDFMonkey…)*: coste por documento que escala con el uso exactamente al revés de lo deseado. Rechazado.

## R7. Email transaccional: Resend, enviado vía cola

- **Decision**: Resend (Free: 3.000 emails/mes, 100/día) para el envío de documentos por email (US5, solo plan de pago del usuario final) y los emails de auth (verificación, reset). Envío siempre asíncrono a través de Cloudflare Queues con registro en el historial del documento.
- **Rationale**: capa gratuita suficiente para el lanzamiento (el envío de documentos está limitado por plan de todos modos); SDK TypeScript de primera; 20 $/mes (50k emails) a 10x, dentro del presupuesto. La cola da reintentos automáticos y desacopla del request (Principio II).
- **Alternatives considered**:
  - *Amazon SES*: el más barato a gran escala (~0,10 $/1.000) pero alta fricción inicial (salir del sandbox, reputación, sin plantillas). Documentado como **ruta de migración a 10x+** si el volumen supera el plan Pro de Resend.
  - *SendGrid*: eliminó su capa gratuita; DX inferior. Rechazado.

## R8. UI: Tailwind CSS 4 + shadcn/ui

- **Decision**: Tailwind CSS 4 + shadcn/ui (componentes copiados al repo, base Radix) como sistema de diseño único; tokens de tema centralizados.
- **Rationale**: cumple el Principio V con mínimo esfuerzo: componentes accesibles (teclado, ARIA) por defecto, consistencia visual por sistema único, responsive utility-first. Coste cero, sin dependencia de runtime (el código vive en el repo).
- **Alternatives considered**: *MUI/Ant* (bundle pesado, estética genérica, theming costoso — rechazado); *CSS propio* (reinventar accesibilidad viola eficiencia — rechazado).

## R9. Trabajo asíncrono y tareas programadas

- **Decision**: Cloudflare Queues (incluido en Workers Paid) para render de PDF al emitir y envío de emails, con reintentos y dead-letter queue. **Sin cron para vencimientos**: el estado "vencida" se deriva en tiempo de consulta (`due_date < hoy` y no pagada del todo), no se materializa.
- **Rationale**: cumple "trabajo pesado fuera de la petición" (Principio II) sin servicio adicional. Derivar el vencimiento al consultar elimina un job programado, evita estados desincronizados y hace el requisito FR-024 trivialmente correcto en cualquier zona horaria de consulta.
- **Alternatives considered**: *Inngest/Trigger.dev* (otro proveedor y otra factura para necesidades que Queues ya cubre — rechazado); *cron nocturno que marca vencidas* (estado materializado que puede quedar obsoleto entre ejecuciones — rechazado por corrección).

## R10. Manejo de dinero e impuestos

- **Decision**: todos los importes como **enteros en céntimos** (`integer`/`bigint` en Postgres, `number` entero en TS con tipo nominal `Cents`); cantidades y porcentajes como `numeric` escalado (cantidad con 3 decimales, porcentajes con 2). Redondeo half-up al céntimo por línea y desglose de impuestos agregado por tipo desde las líneas redondeadas. IVA multi-tipo por línea; retención IRPF global del documento según configuración del emisor.
- **Rationale**: garantiza SC-003 (exactitud al céntimo, sin errores de coma flotante) con el tipo más simple posible; el redondeo por línea y suma de líneas es el criterio habitual en facturación española y hace los totales reproducibles. La lógica vive en `src/lib/billing` pura y exhaustivamente testeada (Principio I).
- **Alternatives considered**: *decimal.js/big.js* (dependencia extra innecesaria si nunca salimos de céntimos enteros — rechazado); *numeric en BD y float en app* (reintroduce coma flotante — rechazado).

## R11. Numeración correlativa sin huecos (FR-013, edge case de concurrencia)

- **Decision**: tabla `document_series` con contador `next_number`; la asignación ocurre **solo al emitir** (los borradores no consumen número) dentro de una transacción con `SELECT ... FOR UPDATE` sobre la fila de la serie: leer, asignar, incrementar y emitir atómicamente.
- **Rationale**: el bloqueo de fila serializa emisiones concurrentes de la misma serie garantizando unicidad y correlatividad; asignar al emitir (no al crear borrador) elimina los huecos por borradores abandonados. Las secuencias de Postgres no sirven: no son transaccionales (dejan huecos en rollback).
- **Alternatives considered**: *sequence de Postgres* (huecos en rollback — rechazado); *MAX(number)+1 con unique constraint y retry* (correcto pero con reintentos bajo carga; el FOR UPDATE es más simple de razonar — rechazado); *UUID + numeración diferida* (incumple correlatividad visible — rechazado).

## R12. Calidad: linting, formato, pruebas y CI

- **Decision**: Biome (linter + formateador único, escrito en Rust) + `tsc --noEmit` como puerta de tipos; Vitest para unitarias e integración (integración contra Postgres real vía Neon branch efímera en CI o Docker en local); Playwright para E2E de flujos críticos con chequeo axe (WCAG 2.1 AA); GitHub Actions como CI (capa gratuita) con puertas: lint, tipos, tests, `pnpm audit` + Dependabot.
- **Rationale**: Biome sustituye ESLint+Prettier con una sola dependencia y ~10x menos tiempo de CI (Principio IV también aplica a CI); Vitest comparte config con el stack Vite/Next; el chequeo axe automatizado hace verificable el mandato WCAG del Principio V.
- **Alternatives considered**: *ESLint+Prettier* (más plugins específicos de Next, pero dos herramientas, config más frágil y CI más lento; las reglas críticas están cubiertas por Biome — rechazado); *Jest* (más lento, config legacy — rechazado).

## R13. Observabilidad

- **Decision**: logging estructurado JSON con `request_id` correlacionado (middleware propio ligero) emitido a Workers Logs; errores no controlados a Sentry (capa gratuita, SDK Cloudflare); alertas de presupuesto activadas en Cloudflare y Neon desde el primer despliegue.
- **Rationale**: cumple el mandato constitucional de observabilidad con coste 0 en lanzamiento. NIF, importes y datos personales quedan excluidos de logs por convención de serialización central (un único helper `logSafe`).
- **Alternatives considered**: *Axiom/Baselime* (buenos, pero Workers Logs + Sentry gratis cubren v1 — rechazado por ahora).

## R14. Almacenamiento de objetos: Cloudflare R2

- **Decision**: R2 para logotipos de empresa y PDFs cacheados. Bucket privado; el acceso pasa siempre por el Worker (autorización por sesión o por token de enlace público).
- **Rationale**: sin coste de egreso (los PDF se descargan muchas veces — es exactamente el caso donde S3 cobra y R2 no); 10 GB gratis; misma cuenta/factura que el hosting.
- **Alternatives considered**: *S3* (egreso de pago — rechazado); *BD bytea* (infla la base más cara del stack — rechazado).

---

## Resumen del stack

| Capa | Elección | Coste lanzamiento |
|------|----------|-------------------|
| Lenguaje | TypeScript 5 strict (pnpm) | — |
| Framework | Next.js 15 App Router + React 19 | — |
| Hosting | Cloudflare Workers (OpenNext) | 5 $/mes |
| BD | Neon Postgres + Drizzle ORM | 0 $ |
| Auth | Better Auth | 0 $ |
| PDF | pdf-lib + caché R2 (job en cola) | 0 $ |
| Email | Resend vía Cloudflare Queues | 0 $ |
| Objetos | Cloudflare R2 | ~0 $ |
| UI | Tailwind 4 + shadcn/ui | 0 $ |
| Calidad | Biome, Vitest, Playwright, GitHub Actions | 0 $ |
| Observabilidad | Workers Logs + Sentry free | 0 $ |

**Total: ~5–6 $/mes en lanzamiento; ~35–55 $/mes a 10x.** Todas las incógnitas de Technical Context quedan resueltas; no restan NEEDS CLARIFICATION.

## Fuentes

- [Neon — Pricing](https://neon.com/pricing) · [Neon plans — Docs](https://neon.com/docs/introduction/plans) · [Neon Serverless Postgres Pricing 2026](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/)
- [Vercel — Pricing](https://vercel.com/pricing) · [Vercel Pricing Explained 2026](https://kuberns.com/blogs/vercel-pricing/) · [Vercel Cost in 2026](https://makerkit.dev/blog/saas/vercel-cost)
- [Cloudflare Workers — Pricing docs](https://developers.cloudflare.com/workers/platform/pricing/) · [Workers & Pages Pricing](https://www.cloudflare.com/plans/developer-platform/) · [OpenNext Cloudflare](https://opennext.js.org/cloudflare) · [Next.js on Vercel vs Cloudflare](https://vercel.com/kb/guide/next-js-on-vercel-vs-cloudflare)
- [Resend — Pricing](https://resend.com/pricing) · [Resend — New Free Tier](https://resend.com/blog/new-free-tier)
