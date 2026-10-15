# Informe de validación final (T131)

**Estado: COMPLETADO (2026-10-15).** Puertas automáticas ejecutadas en local el
2026-10-13; escenarios manuales y latencia real declarados por el responsable el
2026-10-15 (sin capturas ni registros adjuntos en este repositorio); prueba de
usabilidad en `usability-report.md`.

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
  comprobar «Generando PDF…». El primero se corrigió desactivando transiciones antes
  de axe (PR #46) y el segundo aceptando progreso o enlace de descarga (PR #48). Con
  las condiciones del CI (1 worker, 2 reintentos) la suite pasa 26 de 26. Lanzar
  esas dos pruebas 5 veces en paralelo en local, sin reintentos, aún produjo 8
  esperas agotadas de 5 s en páginas públicas; no se observan con la configuración
  del CI.
- Las variables de las bases locales de integración y E2E se tomaron de `.env.local`
  y los secretos de prueba del workflow `ci.yml`. No se usaron bases remotas.

## 2. Escenarios del quickstart

Los resultados manuales los ejecutó y declaró el responsable en producción
(`https://factum.sinergia-hub.com`); este repositorio no guarda sus capturas.

| Escenario | Cobertura automática | Resultado manual |
|---|---|---|
| V1 Registro → primera factura → PDF | E2E `first-invoice` | Smoke móvil en producción, 2026-10-13: correcto (ver §3) |
| V2 Control de cobros | integración, E2E `payments` | OK en producción |
| V3 Clientes | E2E `clients`, integración | OK en producción |
| V4 Catálogo | E2E `catalog`, integración | OK en producción |
| V5 Compartir por enlace y email | E2E `share-link`/`email-sharing`, integración | OK en producción (además, enlace público en móvil correcto en el smoke §3) |
| V6 Proformas y recibos | E2E `proforma-receipt`, integración | OK en producción |
| V7 Numeración bajo concurrencia | integración | n/a |
| V8 Aislamiento entre cuentas | integración | n/a |
| V9 Rendimiento y feedback | `test:performance`, E2E `accessibility-feedback` | p95 de CRUD contra producción ≈ 200 ms (< 300 ms), cifra declarada sin informe de medición adjunto |
| V10 Reentrega de colas | integración (`pdf-queue`, `email-idempotency`, `share-email`) | n/a (solo automático) |
| V11 Seguridad y costes | `verify:predeploy` | ver §3 |
| V12 Capacidades y plan | integración (`documents-contract`, `document-variants-contract`) | OK en producción |
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
- PR de referencia: PR_REF (cierre de T131), fusionado con los checks anteriores en verde.

## 5. Cierre

- [X] T130: prueba de usabilidad (`usability-report.md`).
- [X] Escenarios V1–V13 con resultado registrado (automático y/o manual, ver §2).
- [X] Carrera «Generando PDF…» de las pruebas E2E corregida (PR #48).
- [X] Referencia del PR final (§4).

Limitaciones aceptadas: los resultados manuales y la latencia real son declaraciones
del responsable sin evidencia adjunta; la prueba de usabilidad se hizo solo en
escritorio.
