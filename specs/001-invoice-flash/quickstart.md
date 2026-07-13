# Quickstart: Invoice Flash — Guía de validación

**Date**: 2026-07-09 | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/api.md](./contracts/api.md)

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
pnpm test              # Vitest unitarias (lib/: billing, numbering, payments, money)
pnpm test:integration  # Vitest contra Postgres real (numeración concurrente, scoping por company)
pnpm test:e2e          # Playwright (flujos críticos + axe WCAG 2.1 AA, viewport móvil y escritorio)
pnpm audit             # sin vulnerabilidades altas/críticas
```

## Escenarios de validación end-to-end

### V1 — Registro → primera factura → PDF (US1, SC-001)

1. Registrarse con email y contraseña; iniciar sesión.
2. Intentar crear factura → la app guía primero a completar empresa (nombre, NIF, dirección) [US1-AC1].
3. Completar perfil de empresa; crear factura con un cliente y 2 líneas con IVA distinto (21% y 10%).
4. **Esperado**: base, desglose de IVA por tipo, retención (si configurada) y total exactos al céntimo; número `2026-0001` asignado al emitir; PDF descargado con todos los datos fiscales, desglose por tipo de impuesto y total [US1-AC2/AC3; SC-003].
5. Intentar emitir un borrador sin cliente o sin líneas → error claro que indica qué falta, no se emite [US1-AC4].

### V2 — Control de cobros (US2, SC-004)

1. Con 4 facturas emitidas: una sin pagos con vencimiento futuro, una con pago total, una con pago parcial, una sin pagos con vencimiento pasado.
2. **Esperado** en el panel: estados Pendiente / Pagada / Parcialmente pagada / Vencida respectivamente, la vencida destacada, y totales cobrado/pendiente/vencido del periodo correctos en una sola pantalla.
3. Registrar un pago que supera lo pendiente → la app avisa y pide confirmación explícita.
4. Eliminar un pago → el estado de la factura se rederiva automáticamente [FR-026].

### V3 — Clientes (US3, SC-007)

1. Crear 3 clientes; buscar por nombre y por NIF → resultados inmediatos.
2. Emitir factura a un cliente; después **editar** los datos del cliente y **archivarlo**.
3. **Esperado**: la factura emitida conserva los datos originales (snapshot); el cliente archivado no aparece en selectores pero su historial se conserva; su ficha muestra documentos y pendiente de cobro.

### V4 — Catálogo (US4)

1. Crear conceptos con precio e IVA por defecto; añadir línea a una factura desde el catálogo → descripción/precio/IVA se rellenan y son editables en la línea.
2. Modificar la línea y después editar/eliminar el concepto del catálogo.
3. **Esperado**: el documento no cambia en ningún caso (línea desacoplada del catálogo).

### V5 — Compartir por enlace y email (US5, SC-006)

1. Emitir factura → generar enlace → abrirlo en ventana de incógnito (y en viewport móvil).
2. **Esperado**: el documento se ve y el PDF se descarga sin cuenta; al desactivar el enlace, deja de funcionar (404); un token inventado da 404.
3. Con plan `pro`: enviar por email → el destinatario lo recibe y queda constancia en el historial. Con plan `free`: la opción comunica con claridad que es de plan superior y ofrece PDF/enlace [FR-022].
4. Anular el documento → el enlace público lo muestra claramente como anulado.

### V6 — Proformas y recibos (US6)

1. Crear proforma → **esperado**: numeración de serie propia y PDF marcado "proforma sin validez fiscal".
2. Convertirla en factura → hereda cliente y líneas, recibe el siguiente número de la serie de facturas, ambas quedan vinculadas y la proforma marcada como convertida.
3. Sobre una factura pagada, generar recibo → refleja importe, fecha de pago y factura de origen.

### V7 — Numeración correlativa bajo concurrencia (SC-003, test de integración)

- `pnpm test:integration` incluye un test que emite N facturas en paralelo sobre la misma serie.
- **Esperado**: N números únicos y correlativos, sin huecos ni duplicados.

### V8 — Aislamiento entre cuentas (FR-004, test de integración)

- Con dos usuarios A y B: A intenta leer/editar recursos de B por id directo vía API.
- **Esperado**: `404` en todos los casos; ningún dato ajeno en listados ni agregados.

## Despliegue (staging/producción)

```bash
pnpm build             # build Next.js + adaptador OpenNext
pnpm deploy            # wrangler deploy (Workers + Queues + R2 bindings)
pnpm db:migrate:prod   # migraciones contra la rama principal de Neon
```

Verificación post-deploy: alta → factura → PDF → enlace público desde un móvil real; alertas de presupuesto activas en Cloudflare y Neon; errores fluyendo a Sentry.
