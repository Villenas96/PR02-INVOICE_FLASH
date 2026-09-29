# Quickstart: Invoice Flash — Guía de validación

**Date**: 2026-07-09 | **Updated**: 2026-07-30 | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/api.md](./contracts/api.md)

Guía para levantar el entorno y validar de extremo a extremo que la feature funciona. No contiene implementación; los detalles viven en `tasks.md` y el código.

## Prerrequisitos

- Node.js 22 LTS y **pnpm ≥ 9** (`corepack enable`) — único gestor de paquetes permitido.
- Cuenta Neon (rama de desarrollo gratuita) o Docker (Postgres 16 local) para la BD.
- Cuenta Cloudflare (Workers Paid) solo para despliegue; el desarrollo local no la necesita.
- Claves en `.dev.vars` / `.env.local` (nunca en el repo): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY` (opcional en local), binding R2 (emulado por wrangler/miniflare en local).

## Arranque local

```bash
pnpm install
pnpm db:migrate        # aplica migraciones drizzle-kit
pnpm db:seed           # datos demo opcionales (empresa + clientes + catálogo)
pnpm dev               # Next.js en http://localhost:3000
```

## Puertas de calidad (deben pasar en verde antes de fusionar)

```bash
pnpm lint              # Biome (lint + formato)
pnpm typecheck         # tsc --noEmit (strict)
pnpm test              # Vitest unitarias, incluidas serie anual, conversión y recibos
pnpm test:integration  # Postgres real: emisión atómica, scoping, pagos e idempotencia
pnpm test:e2e          # Playwright: flujos, axe, responsive y feedback <100 ms
pnpm test:performance  # p95 CRUD/búsqueda/PDF contra staging reproducible
pnpm audit             # sin vulnerabilidades altas/críticas
```

## Escenarios de validación end-to-end

### V1 — Registro → primera factura → PDF (US1, SC-001)

1. Iniciar cronómetro; registrarse con email y contraseña, comprobar que la verificación queda encolada, abrir el email recibido y después iniciar sesión.
2. Intentar crear factura → la app guía primero a completar empresa (nombre, NIF, dirección) [US1-AC1].
3. Completar perfil de empresa; crear factura con un cliente y 2 líneas con IVA distinto (21% y 10%).
4. **Esperado**: base, desglose de IVA por tipo, retención (si configurada) y total exactos al céntimo; número `2026-0001` asignado al emitir. Mientras el job termina, PDF responde `202 pdf_processing` y la UI muestra progreso; después se descarga desde R2 con todos los datos fiscales y coincide con los snapshots visuales móvil/escritorio aprobados. Ninguna petición HTTP renderiza el PDF [US1-AC2/AC3; SC-003].
5. Intentar emitir un borrador sin cliente o sin líneas → error claro que indica qué falta, no se emite [US1-AC4].
6. **Esperado SC-001**: recorrido completo <10 minutos. Repetir con empresa y cliente configurados → nueva factura emitida <2 minutos (SC-002).
7. Editar nombre, NIF y dirección de la empresa después de emitir → el detalle y PDF ya emitidos conservan exactamente el snapshot original del emisor.

### V2 — Control de cobros (US2, SC-004)

1. Con 4 facturas emitidas: una sin pagos con vencimiento futuro, una con pago total, una con pago parcial, una sin pagos con vencimiento pasado.
2. Iniciar cronómetro. **Esperado** en <10 segundos y en una sola pantalla: lista paginada con estados Pendiente / Pagada / Parcialmente pagada / Vencida, vencidas destacadas, filtros aplicados tanto a lista como a agregados y totales cobrado/pendiente/vencido correctos.
3. Registrar un pago que supera lo pendiente → la app avisa y pide confirmación explícita.
4. Eliminar un pago → el estado de la factura se rederiva automáticamente [FR-026].

### V3 — Clientes (US3, SC-007)

1. Crear 3 clientes; buscar por nombre y por NIF → resultados inmediatos.
2. Emitir factura a un cliente; después **editar** los datos del cliente y **archivarlo**.
3. **Esperado**: la factura emitida conserva los datos originales (snapshot); el cliente archivado no aparece en selectores pero su historial se conserva; su ficha muestra documentos y pendiente de cobro.

### V4 — Catálogo (US4)

1. Crear conceptos con precio e IVA por defecto; añadir línea a una factura desde el catálogo → descripción/precio/IVA se rellenan y son editables en la línea.
2. Modificar la línea y después editar/archivar el concepto del catálogo (`DELETE` lógico y reversible); verificar que desaparece del selector y restaurarlo.
3. **Esperado**: el documento no cambia en ningún caso y el concepto restaurado vuelve a estar disponible.

### V5 — Compartir por enlace y email (US5, SC-006)

1. Emitir factura → generar enlace → pedir a un usuario de prueba que lo abra por primera vez en incógnito, tanto en viewport móvil como escritorio.
2. **Esperado**: el documento se ve y el PDF se descarga sin cuenta; al desactivar el enlace, deja de funcionar (404); un token inventado da 404.
3. Con plan `pro`: enviar por email → el destinatario lo recibe y queda constancia en el historial. Repetir la petición y entregar varias veces el mismo mensaje de cola con igual clave produce un único correo y un único evento. Con plan `free`: la opción comunica con claridad que es de plan superior y ofrece PDF/enlace [FR-022].
4. Anular el documento → el enlace público lo muestra claramente como anulado.

### V6 — Proformas y recibos (US6)

1. Crear proforma → **esperado**: numeración de serie propia y PDF marcado "proforma sin validez fiscal".
2. Convertirla en factura → hereda cliente y líneas, recibe el siguiente número de la serie de facturas, ambas quedan vinculadas y la proforma marcada como convertida.
3. Verificar que el editor genérico no permite un recibo manual. Sobre una factura con pago parcial, generar el recibo del pago → se crea directamente como emitido, con numeración propia, snapshots, importe, fecha y factura de origen; base, impuestos y retención son cero y el total coincide exactamente con el pago.
4. Repetir la generación para el mismo pago → se devuelve el mismo recibo, no se consume otro número y no se duplica el PDF/evento. Intentar duplicar el recibo → operación rechazada.

### V7 — Numeración correlativa bajo concurrencia (SC-003, test de integración)

- `pnpm test:integration` incluye un test que emite N facturas en paralelo sobre la misma serie.
- **Esperado**: N números únicos y correlativos, sin huecos ni duplicados.
- Crear una serie anual nueva con número inicial configurable → la serie anterior no cambia y la nueva comienza exactamente en ese número.

### V8 — Aislamiento entre cuentas (FR-004, test de integración)

- Con dos usuarios A y B: ejecutar la matriz contractual sobre todas las rutas privadas de empresa, series, clientes, catálogo, documentos, pagos, enlaces, email, conversión, duplicación y recibos.
- **Esperado**: A recibe `404` al leer o mutar cualquier recurso de B; ningún dato ajeno aparece en listados ni agregados. La suite final se ejecuta después de implementar todos los endpoints.

### V9 — Rendimiento y feedback

1. Ejecutar `pnpm test:performance` contra staging con dataset documentado.
2. **Esperado**: CRUD p95 <300 ms; búsqueda de clientes p95 <200 ms; render aislado de PDF p95 <500 ms; PDF disponible p95 <3 s.
3. Playwright retrasa artificialmente las mutaciones y verifica que cada acción muestra carga, estado optimista, confirmación o error visible en <100 ms.

### V10 — Reentrega de colas

1. Entregar dos veces `pdf.render` para el mismo documento → un objeto final y un evento `pdf_generated`.
2. Entregar varias veces `email.send` para el mismo `delivery_id`, incluso tras marcarlo `sent`.
3. Solicitar dos veces verificación y recuperación, y reentregar sus mensajes de cola. La recuperación de una cuenta inexistente responde igual que la de una existente.
4. **Esperado**: un único envío del proveedor por entrega; solo el email documental crea `email_sent`; intentos contabilizados y ningún destinatario, mensaje, token o URL de auth en logs o cuerpos de cola.

### V11 — Seguridad y costes de infraestructura

Antes de cualquier despliegue remoto, incluido el primer staging, verificar y registrar evidencia no sensible:

- Sentry activo con correlación por `request_id` y evento de prueba recibido.
- Neon con TLS obligatorio y cifrado en reposo; ramas de CI con caducidad/limpieza.
- R2 privado, HTTPS y cifrado automático en reposo.
- Alerta de presupuesto Cloudflare activa con destinatarios y umbral.
- En Neon Free, monitorización de límites sin gasto facturable; antes de cualquier upgrade, Spending Limit activo con avisos al 80% y 100%.
- Prueba de recepción de la alerta Cloudflare y, cuando Neon sea de pago, de sus alertas al 80%/100%.

Si falla cualquier comprobación, el despliegue queda bloqueado.

### V12 — Capacidades y límite del plan

1. En plan `free`, emitir 4 documentos durante el mes natural `Europe/Madrid` → aviso no bloqueante; emitir el quinto → permitido; intentar el sexto → `plan_limit_reached`.
2. Anular uno de los cinco → continúa consumiendo cupo. Los borradores no cuentan.
3. Confirmar que documentos existentes, PDF y enlaces siguen accesibles y que el email no está disponible.
4. Cambiar a `pro`: email disponible, aviso al documento 80, emisión permitida hasta el 100 y bloqueada desde el 101.
5. Avanzar al primer instante del mes siguiente en `Europe/Madrid` → consumo reiniciado a cero.
6. Con una sola plaza disponible, lanzar simultáneamente una emisión convencional, una conversión con `{issue:true}` y un recibo nuevo → exactamente una operación crea documento; las otras responden `plan_limit_reached` sin consumir número, evento ni PDF.
7. Tras agotar el cupo, repetir una conversión o recibo ya creados con la misma identidad idempotente → se devuelve el documento existente y el consumo no cambia.

### V13 — Prueba de usabilidad (SC-001, SC-005)

1. Reclutar al menos 10 participantes del perfil objetivo sin experiencia previa con Invoice Flash.
2. Entregar únicamente la meta definida en la spec y comenzar el cronómetro al mostrar registro.
3. Registrar de forma anonimizada tiempo, finalización autónoma y abandono; el facilitador no da indicaciones de uso.
4. **Esperado**: mediana inferior a 10 minutos entre sesiones autónomas y al menos 9 de 10 participantes completan la primera factura sin ayuda ni documentación.

## Despliegue (staging/producción)

```bash
pnpm verify:predeploy  # bloquea sin Sentry, cifrado/TLS, R2 privado y controles de coste
pnpm build             # build Next.js + adaptador OpenNext
pnpm db:migrate:prod   # migraciones versionadas contra la rama objetivo de Neon
pnpm run deploy        # wrangler deploy (Workers + Queues + R2 bindings); `pnpm deploy` es un comando nativo de pnpm
pnpm verify:postdeploy # smoke móvil + flujo de error a Sentry
```

Verificación post-deploy: alta → email de verificación encolado → factura → PDF asíncrono → enlace público desde un móvil real; V9–V12 en verde y errores fluyendo a Sentry. V13 se ejecuta antes de la aprobación final de producto.

Antes de fusionar en `main`: pull request con al menos una aprobación, revisiones obsoletas descartadas, checks requeridos en verde y push directo/force-push bloqueados. Registrar la referencia del PR y los nombres de los checks en el informe de validación.
