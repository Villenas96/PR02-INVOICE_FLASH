# Research: Invoice Flash — Elección de stack y decisiones técnicas

**Date**: 2026-07-09 | **Updated**: 2026-07-30 | **Plan**: [plan.md](./plan.md)

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
- **Rationale**: es la opción serverless comercial más barata verificada: 5 $/mes fijos frente a 20 $/asiento/mes de Vercel Pro (el plan Hobby de Vercel prohíbe uso comercial y esto es un SaaS). Incluye Queues y R2, y escala a cero de facto. Workers Paid incluye 10M peticiones y 30M CPU-ms/mes; Queues incluye 1M de operaciones/mes. El objetivo v1 permanece en ~5–10 $/mes; el escenario conservador de resiliencia puede alcanzar ~10–50 $/mes según peticiones y CPU.
- **Riesgo aceptado y mitigación**: OpenNext lo opera uno mismo (vs. `git push` en Vercel) y workerd no es Node completo. Mitigación: (a) las dependencias elegidas son compatibles con workerd (`pdf-lib` JS puro, driver Neon serverless, Better Auth edge-ready); (b) Next.js es portable: si el adaptador bloquease el desarrollo, migrar a Vercel Pro (20 $/mes) es un cambio de configuración, no de código. Esta portabilidad es parte de la decisión.
- **Alternatives considered**:
  - *Vercel Pro*: mejor DX, cero fricción, pero 20 $/mes mínimo + uso; a 10x típicamente 40–70 $/mes. Queda como **fallback documentado** si OpenNext genera fricción real.
  - *VPS (Hetzner ~5 €/mes) + Coolify*: barato pero siempre encendido (la constitución exige justificar recursos always-on), sin escala automática y con coste de ops (parcheo, backups) que recae en el único desarrollador. Rechazado.
  - *Railway / Fly.io (~5 $/mes)*: contenedor siempre-encendido o con cold starts agresivos; menos integrado (colas y objetos aparte). Rechazado.

## R4. Base de datos: Neon Postgres serverless + Drizzle ORM

- **Decision**: Neon Postgres (plan Free: 0,5 GB, 100 CU-h/mes, scale-to-zero con suspensión a los 5 min) con `@neondatabase/serverless` (funciona sobre WebSocket/HTTP en Workers) y Drizzle ORM + drizzle-kit para esquema y migraciones versionadas.
- **Rationale**: la facturación exige transacciones ACID y bloqueo de filas para la numeración correlativa sin huecos (FR-013) y tipos exactos — Postgres lo da de serie. Neon escala a cero: 0 $ en lanzamiento, ~10–20 $/mes en el objetivo v1 y un sobre conservador de ~50–120 $/mes en el escenario de resiliencia, que se recalibrará con uso real. Neon cifra los datos en reposo con AES-256, gestiona claves mediante KMS/Key Vault y exige conexiones TLS; la aplicación usa `sslmode=require` y verifica la configuración pre-deploy. El branching da bases de prueba efímeras para CI, con limpieza/caducidad obligatoria. Drizzle aporta migraciones SQL versionadas y reversibles.
- **Alternatives considered**:
  - *Cloudflare D1 (SQLite)*: aún más barato e integrado, pero transaccionalidad limitada (sin transacciones interactivas multi-statement con bloqueo de fila desde el Worker), lo que complica la garantía de numeración correlativa bajo concurrencia. Rechazado por riesgo en el requisito más crítico.
  - *Supabase*: bundle atractivo (Postgres+Auth+Storage) pero acopla auth y storage al proveedor; el plan Pro (25 $/mes) es más caro que Neon+R2+Better Auth a igual volumen. Rechazado por coste y acoplamiento.
  - *Prisma en vez de Drizzle*: engine más pesado en edge, generación de cliente adicional; Drizzle es más eficiente en Workers. Rechazado.

## R5. Autenticación: Better Auth

- **Decision**: Better Auth (open source, self-hosted en la propia app) con email/contraseña + verificación + recuperación, sesiones en Postgres vía adaptador Drizzle. Sus callbacks de verificación y recuperación persisten una entrega y encolan únicamente un `delivery_id`; nunca invocan Resend desde la petición. La recuperación responde igual exista o no la cuenta.
- **Rationale**: coste cero a cualquier escala (vs. proveedores por MAU); los datos de usuarios quedan en nuestra base (datos fiscales sensibles, Principio III); soporta runtimes edge; adaptador Drizzle oficial genera las tablas. Referenciar el registro temporal de verificación permite construir el enlace en el consumidor sin transportar tokens, URLs ni destinatarios por la cola. Cubre FR-001 completo sin código criptográfico propio ni enumeración de cuentas.
- **Alternatives considered**:
  - *Clerk / Auth0*: excelente DX pero coste por MAU que crece justo con el éxito (Clerk gratis hasta 10k MAU pero features clave de pago; Auth0 caro pronto). Rechazado por Principio IV.
  - *Auth.js (NextAuth v5)*: gratuito también, pero el flujo credentials + reset de contraseña es de segunda clase (orientado a OAuth). Better Auth lo trae de serie. Rechazado.

## R6. Generación de PDF: `pdf-lib` con plantilla propia, caché en R2

- **Decision**: generar los PDF con `pdf-lib` exclusivamente en un consumidor de Cloudflare Queues al emitir; almacenar el resultado en R2 con clave determinista y servirlo desde caché permanente. El documento persiste `pdf_status` (`pending|ready|failed`). Si una descarga llega antes de terminar, responde `202 pdf_processing` con `Retry-After`; no existe render on-demand dentro de HTTP.
- **Rationale**: cumple literalmente el mandato de sacar trabajo pesado de la petición y conserva coste/rendimiento (~50–300 ms de render aislado). La clave determinista y la comprobación de `pdf_status` hacen idempotentes las reentregas. Una plantilla propia permite definir criterios verificables: bloques fiscales, jerarquía, tabla multipágina, totales, marca de proforma y snapshots visuales.
- **Alternatives considered**:
  - *@react-pdf/renderer*: DX excelente (JSX), pero compatibilidad irregular en workerd (fontkit/Buffer) → riesgo de bloqueo en el runtime elegido. Rechazado; reconsiderar si se migrase a runtime Node.
  - *Puppeteer/Playwright (HTML→PDF)*: máxima fidelidad visual pero exige headless Chrome (imposible en Workers, caro en cualquier serverless: memoria y arranque). Rechazado por coste.
  - *API externa (DocRaptor, PDFMonkey…)*: coste por documento que escala con el uso exactamente al revés de lo deseado. Rechazado.

## R7. Email transaccional: Resend, enviado vía cola

- **Decision**: Resend (Free: 3.000 emails/mes; Pro: 20 $/mes por 50.000; Scale: 90 $/mes por 100.000) para documentos y auth. Una tabla común `email_delivery` discrimina `document`, `verify_email` y `reset_password`; `company_id`/`document_id` son opcionales para autenticación y esta referencia el registro temporal de Better Auth. Cada solicitud crea una fila con clave única estable; Queues transporta solo `delivery_id`; el consumidor selecciona la plantilla por propósito y usa `email/{delivery_id}` como `idempotencyKey` de Resend. Solo una entrega documental registra `document_event`.
- **Rationale**: Cloudflare Queues entrega al menos una vez, por lo que un reintento puede repetir efectos. Resend conserva claves de idempotencia durante 24 horas (máx. 256 caracteres) y devuelve la respuesta original ante repetición. La tabla local evita duplicados conocidos; los reintentos automáticos se acotan a menos de 24 horas y a la vigencia del token de auth. Tras la ventana aplicable no se reintenta automáticamente un estado incierto: requiere una solicitud nueva. Destinatario, mensaje y referencias temporales se eliminan tras la retención definida; tokens, URLs, destinatarios y mensajes nunca viajan en la cola ni aparecen en logs.
- **Alternatives considered**:
  - *Amazon SES*: el más barato a gran escala (~0,10 $/1.000) pero alta fricción inicial (salir del sandbox, reputación, sin plantillas). Documentado como **ruta de migración a 10x+** si el volumen supera el plan Pro de Resend.
  - *SendGrid*: eliminó su capa gratuita; DX inferior. Rechazado.

## R8. UI: Tailwind CSS 4 + shadcn/ui

- **Decision**: Tailwind CSS 4 + shadcn/ui (componentes copiados al repo, base Radix) como sistema de diseño único; tokens de tema centralizados.
- **Rationale**: cumple el Principio V con mínimo esfuerzo: componentes accesibles (teclado, ARIA) por defecto, consistencia visual por sistema único, responsive utility-first. Coste cero, sin dependencia de runtime (el código vive en el repo).
- **Alternatives considered**: *MUI/Ant* (bundle pesado, estética genérica, theming costoso — rechazado); *CSS propio* (reinventar accesibilidad viola eficiencia — rechazado).

## R9. Trabajo asíncrono y tareas programadas

- **Decision**: Cloudflare Queues para render de PDF y email, con reintentos, backoff y dead-letter queue. Los consumidores asumen entrega al menos una vez: reclaman un estado persistido, detectan trabajos terminales y producen efectos idempotentes. **Sin cron para vencimientos**: se derivan en consulta.
- **Rationale**: cumple "trabajo pesado fuera de la petición" sin servicio adicional. La idempotencia evita PDFs duplicados y correos repetidos. Derivar vencimiento elimina estados desincronizados y mantiene FR-024 correcto.
- **Alternatives considered**: *Inngest/Trigger.dev* (otro proveedor y otra factura para necesidades que Queues ya cubre — rechazado); *cron nocturno que marca vencidas* (estado materializado que puede quedar obsoleto entre ejecuciones — rechazado por corrección).

## R10. Manejo de dinero e impuestos

- **Decision**: todos los importes como **enteros en céntimos** (`integer`/`bigint` en Postgres, `number` entero en TS con tipo nominal `Cents`); cantidades y porcentajes como `numeric` escalado (cantidad con 3 decimales, porcentajes con 2). Facturas/proformas usan redondeo half-up al céntimo por línea, impuestos agregados por tipo y retención global. Un recibo no ejecuta cálculo fiscal: `total_cents` copia exactamente `payment.amount_cents` y base/impuestos/retención quedan a cero.
- **Rationale**: garantiza SC-003 sin errores de coma flotante y evita atribuir fiscalidad nueva a un justificante de pago. El redondeo por línea y suma de líneas es el criterio habitual en facturación española y hace los totales reproducibles. La lógica vive en `src/lib/billing` y `src/lib/documents/receipts` pura y exhaustivamente testeada (Principio I).
- **Alternatives considered**: *decimal.js/big.js* (dependencia extra innecesaria si nunca salimos de céntimos enteros — rechazado); *numeric en BD y float en app* (reintroduce coma flotante — rechazado).

## R11. Numeración correlativa sin huecos (FR-013, edge case de concurrencia)

- **Decision**: tabla `document_series` con contador `next_number`; la asignación ocurre **solo al emitir** (los borradores no consumen número) dentro de una transacción con `SELECT ... FOR UPDATE` sobre la fila de la serie: leer, asignar, incrementar y emitir atómicamente.
- **Rationale**: el bloqueo de fila serializa emisiones concurrentes de la misma serie garantizando unicidad y correlatividad; asignar al emitir (no al crear borrador) elimina los huecos por borradores abandonados. Las secuencias de Postgres no sirven: no son transaccionales (dejan huecos en rollback).
- **Alternatives considered**: *sequence de Postgres* (huecos en rollback — rechazado); *MAX(number)+1 con unique constraint y retry* (correcto pero con reintentos bajo carga; el FOR UPDATE es más simple de razonar — rechazado); *UUID + numeración diferida* (incumple correlatividad visible — rechazado).

## R12. Calidad: linting, formato, pruebas y CI

- **Decision**: Biome + `tsc --noEmit`; Vitest para unitarias e integración contra Postgres real; Playwright para E2E, axe, responsive y feedback <100 ms con respuestas de red retrasadas; runner Vitest/fetch concurrente contra staging para p95 de CRUD/búsqueda y medición aislada del consumidor PDF. GitHub Actions ejecuta lint, tipos, tests, rendimiento, `pnpm audit` y Dependabot. `main` exige PR, al menos una aprobación y checks requeridos en verde, sin push directo ni force-push.
- **Rationale**: cubre todas las puertas constitucionales y convierte los objetivos de rendimiento en umbrales verificables. Las pruebas unitarias incluyen cambio anual, conversión y recibos; las de integración prueban emisión atómica, autorización por recurso e idempotencia por reentrega. La protección de rama convierte la revisión obligatoria en una puerta verificable.
- **Alternatives considered**: *ESLint+Prettier* (más plugins específicos de Next, pero dos herramientas, config más frágil y CI más lento; las reglas críticas están cubiertas por Biome — rechazado); *Jest* (más lento, config legacy — rechazado).

## R13. Observabilidad

- **Decision**: logging estructurado JSON con `request_id` en Workers Logs; errores no controlados a Sentry; controles de gasto configurados y verificados. Un gate pre-deploy impide cualquier despliegue remoto hasta confirmar Sentry, TLS/cifrado, R2 privado y la alerta de gasto Cloudflare. Mientras Neon permanezca en Free no existe gasto facturable: se monitorizan sus límites de uso; antes de cualquier upgrade de pago se activa Spending Limit, con avisos al 80% y 100%. Se conserva evidencia no sensible y responsables en el runbook; un smoke test post-deploy confirma el flujo de errores.
- **Rationale**: cumple observabilidad y coste sin confundir documentación con configuración. NIF, importes, tokens, destinatarios y mensajes quedan excluidos de logs mediante `logSafe`.
- **Alternatives considered**: *Axiom/Baselime* (buenos, pero Workers Logs + Sentry gratis cubren v1 — rechazado por ahora).

## R14. Almacenamiento de objetos: Cloudflare R2

- **Decision**: R2 para logotipos y PDFs cacheados. Bucket privado; acceso siempre por Worker autorizado. R2 cifra automáticamente objetos y metadatos en reposo con AES-256-GCM y protege el tránsito con TLS; la verificación pre-deploy confirma bucket privado, HTTPS y configuración esperada.
- **Rationale**: sin coste de egreso, 10 GB gratis y cifrado gestionado sin claves propias en v1. El objeto PDF usa clave determinista para caché e idempotencia.
- **Alternatives considered**: *S3* (egreso de pago — rechazado); *BD bytea* (infla la base más cara del stack — rechazado).

## R15. Capacidades y límites de planes

- **Decision**: una tabla de capacidades versionada en `src/lib/plan.ts` define `free = {docLimit: 5, canSendEmail: false}` y `pro = {docLimit: 100, canSendEmail: true}`. El consumo cuenta documentos con `issued_at` dentro del mes natural `Europe/Madrid`, incluidos los anulados posteriormente; los borradores no cuentan. API y UI consumen exclusivamente esta fuente. Toda operación que vaya a crear un documento emitido —emisión convencional, conversión con `issue=true` o recibo— pasa por `src/services/document-issuance.ts`: puede resolver un resultado idempotente como vía rápida y, dentro de la transacción, bloquea primero la fila `company`, vuelve a resolverlo para cerrar carreras, cuenta el consumo, rechaza si no queda cupo y solo después bloquea la serie y crea los efectos.
- **Rationale**: valores concretos permiten pruebas deterministas y mensajes claros sin persistir límites redundantes por empresa. Contar documentos anulados evita eludir el límite después de consumir numeración y trabajo de PDF. La fila de empresa ofrece un punto de serialización ya existente para todas las vías de emisión; el orden fijo `company → document_series` evita carreras e interbloqueos y garantiza que un rechazo no consuma número, PDF ni evento. Versionarlo con el producto obliga a revisar requisitos, pruebas y comunicación cuando cambie.
- **Alternatives considered**: *límite persistido por empresa* (permite divergencias accidentales entre clientes del mismo plan — rechazado para v1); *contador mensual mutable* (exige conciliación y una entidad adicional — rechazado para v1); *comprobar `COUNT(*)` sin lock común en cada endpoint* (permite superar el cupo bajo concurrencia — rechazado); *configuración remota comercial* (más flexible, pero añade servicio, auditoría y estados de caché innecesarios en v1 — pospuesto).

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

**Escalas de coste**: ~5–6 $/mes en lanzamiento (100 usuarios/1k documentos), sobre conservador ~36–78 $/mes en objetivo v1 (1k/10k) y ~180–310 $/mes en resiliencia (10k/100k, hasta un email por documento). Los valores se recalibran con métricas antes de escalar. Todas las incógnitas técnicas quedan resueltas.

## Fuentes

- [Neon — Pricing](https://neon.com/pricing) · [Neon plans](https://neon.com/docs/introduction/plans) · [Neon security](https://neon.com/docs/security/security-overview) · [Neon spending limits](https://neon.com/blog/introducing-organization-spending-limits)
- [Vercel — Pricing](https://vercel.com/pricing) · [Vercel Pricing Explained 2026](https://kuberns.com/blogs/vercel-pricing/) · [Vercel Cost in 2026](https://makerkit.dev/blog/saas/vercel-cost)
- [Cloudflare Workers — Pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Queues delivery model](https://developers.cloudflare.com/queues/reference/how-queues-works/) · [R2 data security](https://developers.cloudflare.com/r2/reference/data-security/) · [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/) · [OpenNext Cloudflare](https://opennext.js.org/cloudflare)
- [Resend — Pricing](https://resend.com/pricing) · [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
