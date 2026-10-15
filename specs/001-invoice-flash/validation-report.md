# Informe de validación final (T131)

**Estado: BORRADOR — validación incompleta.** Solo constan las puertas automáticas
ejecutadas en local el 2026-10-13. Los escenarios manuales, la prueba de usabilidad
(T130) y la referencia del PR final siguen pendientes. No marcar T131 hasta cerrarlos.

## 1. Puertas de calidad (local, 2026-10-13)

| Puerta | Comando | Resultado |
|---|---|---|
| Lint y formato | `pnpm lint` | OK (1 aviso previo: `@ts-ignore` en `src/worker-entry.ts`) |
| Tipos | `pnpm typecheck` | OK |
| Unitarias | `pnpm test` | OK, 127 tests |
| Integración (Postgres real) | `pnpm test:integration` | OK, 27 ficheros, 94 tests |
| Rendimiento | `pnpm test:performance` | OK, 3 ficheros, 10 tests |
| E2E (Playwright + axe), modo CI | `CI=true pnpm test:e2e` | OK, 26 tests |
| Dependencias | `pnpm audit --audit-level=high` | OK (excepción documentada: `braces`, GHSA-vfj7-8cjw-p6xm, sin parche) |

Notas de la ejecución:

- Sin `CI=true`, la suite E2E corre en paralelo y dos pruebas de
  `first-invoice.spec.ts` fallaron de forma intermitente: axe medía el contraste de un
  botón a mitad de su transición de color, y en ocasiones el PDF terminaba antes de
  comprobar «Generando PDF…». El primer caso se corrigió en la prueba (desactivar
  transiciones antes de axe). El segundo no se ha corregido y no se reproduce en las
  condiciones del CI (1 worker, 2 reintentos).
- Las variables de las bases locales de integración y E2E se tomaron de `.env.local`
  y los secretos de prueba del workflow `ci.yml`. No se usaron bases remotas.

## 2. Escenarios del quickstart

Solo V7, V8 y parte de V9–V12 se cubren con pruebas automáticas. El resto exige
ejecución manual. No se ha registrado ningún resultado manual.

| Escenario | Cobertura automática | Resultado manual |
|---|---|---|
| V1 Registro → primera factura → PDF | E2E `first-invoice` | Smoke móvil en producción, 2026-10-13: correcto (ver §3) |
| V2 Control de cobros | integración | … |
| V3 Clientes | E2E/integración | … |
| V4 Catálogo | E2E/integración | … |
| V5 Compartir por enlace y email | integración | Enlace público en móvil: correcto (smoke §3). Email: … |
| V6 Proformas y recibos | integración | … |
| V7 Numeración bajo concurrencia | integración | n/a |
| V8 Aislamiento entre cuentas | integración | n/a |
| V9 Rendimiento y feedback | `test:performance`, E2E | Latencia contra producción: … |
| V10 Reentrega de colas | integración | … |
| V11 Seguridad y costes | `verify:predeploy` | ver §3 |
| V12 Capacidades y plan | integración | … |
| V13 Prueba de usabilidad | — | Cumple: 10 sesiones, mediana 05:37,5 y 10 de 10 autónomas (ver `usability-report.md`) |

## 3. Despliegue y controles de infraestructura

- Producción: `https://factum.sinergia-hub.com`, versión del Worker
  `6e801252-a32c-4e1f-9a13-b618c65c49c3` (2026-10-13). Migraciones 0000–0003
  aplicadas.
- `pnpm verify:predeploy` correcto para staging y producción (Neon TLS y cifrado, R2
  privado, Sentry, alerta de presupuesto de Cloudflare, Neon Free). La evidencia
  caduca el 2026-11-10.
- `pnpm verify:postdeploy` correcto para producción (smoke móvil 440×956 y
  correlación `request_id` en Sentry).
- Evidencias en un almacén privado fuera del repositorio; este informe no contiene
  secretos, URLs de conexión ni datos de clientes.

## 4. Gobierno del repositorio

- Checks requeridos en `main` (ruleset «Protect main»): Lint (Biome), Type check,
  Integration tests, E2E tests, Audit (high/critical), Unit tests + coverage gate.
  El workflow Performance se ejecuta aparte.
- Aprobaciones requeridas: 0 (excepción temporal documentada en
  `docs/operations/repository-governance.md`, titular único del repositorio).
- PR aprobado de referencia: … (pendiente: PR final de cierre de T131)

## 5. Pendiente para cerrar T131

- [X] T130: prueba de usabilidad (`usability-report.md`).
- [ ] Escenarios manuales V2–V6, V9, V10 y V12 con resultado registrado.
- [ ] Corregir o aceptar por escrito la carrera «Generando PDF…» de la prueba E2E.
- [ ] Referencia del PR final.
