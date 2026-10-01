# Checklist de despliegue (staging y producción)

Procedimiento único para desplegar Invoice Flash en Cloudflare Workers. Cada
despliegue remoto —incluido el primer staging— recorre las cuatro fases en orden;
si una casilla falla, el despliegue se detiene. Complementa, sin duplicarlos, a:

- [cloud-cost-controls.md](./cloud-cost-controls.md): formato de la evidencia
  pre/post-deploy y controles de gasto.
- [storage-encryption.md](../security/storage-encryption.md): cifrado y privacidad
  de Neon y R2.
- [repository-governance.md](./repository-governance.md): protección de `main`.

Nunca se pegan secretos, URLs de conexión ni datos de clientes en este documento, en
tickets ni en los ficheros de evidencia.

## 0. Preparación única por entorno

Se hace una vez por entorno y se revisa si cambia la cuenta, el bucket o la rama.

Staging y producción comparten una cuenta de Cloudflare con plan **Workers Paid**
(el plan gratuito limita la CPU a 10 ms por petición y el hash de contraseñas de
Better Auth lo supera). Cada uno es un entorno de `wrangler.jsonc` con recursos
propios:

| Recurso | `staging` | `production` |
|---|---|---|
| Worker | `invoice-flash-staging` | `invoice-flash` |
| Bucket R2 | `invoice-flash-storage-staging` | `invoice-flash-storage` |
| Cola PDF (+ DLQ `-dlq`) | `invoice-flash-staging-pdf-render` | `invoice-flash-pdf-render` |
| Cola email (+ DLQ `-dlq`) | `invoice-flash-staging-email-send` | `invoice-flash-email-send` |
| Limitador `/d/*` | namespace `1002` | namespace `1001` |
| Rama Neon | rama de staging | rama principal |

**Cloudflare** (repetir con `ENV=staging` y `ENV=production`)

- [ ] Bucket R2 del entorno creado, privado, sin dominio público ni `r2.dev` (ver
  storage-encryption.md):
  `pnpm exec wrangler r2 bucket create <bucket> -J eu` (jurisdicción UE, obligatoria:
  `wrangler.jsonc` declara `"jurisdiction": "eu"`).
- [ ] Las cuatro colas del entorno creadas, DLQ incluidas:
  `pnpm exec wrangler queues create <cola>`.
- [ ] Secretos cargados con `pnpm exec wrangler secret put <NOMBRE> --env $ENV`:
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`,
  `RESEND_FROM_EMAIL`, `SENTRY_DSN`. Nunca se reutiliza un secreto entre entornos.
- [ ] Alerta de presupuesto de la cuenta activa y probada (cloud-cost-controls.md
  § Cloudflare).

**Neon**

- [ ] Rama del entorno creada, TLS obligatorio (`sslmode=require`).
- [ ] Monitorización de uso (Free) o Spending Limit con avisos 80 %/100 % (pago).

**Resend y Sentry**

- [ ] Dominio remitente de `RESEND_FROM_EMAIL` verificado en Resend.
- [ ] Proyecto Sentry creado y token de solo lectura de eventos para
  `verify:postdeploy`.

**Rendimiento (`.github/workflows/performance.yml`)**

No necesita configuración: corre con un Postgres local en el runner, igual que la
integración, y comprueba el p95 de la app y un **límite de consultas por petición**.
No se mide contra Neon desde GitHub porque no se puede elegir la región del runner y
cada consulta pagaría 60–130 ms de distancia. La latencia real extremo a extremo se
mide contra el Worker de staging tras desplegar (sección 3).

## 1. Antes de desplegar

- [ ] El commit a desplegar está en `main`, fusionado mediante PR aprobado y con
  todos los checks de CI en verde.
- [ ] El workflow **Performance** ha pasado sobre ese commit (o se lanza a mano con
  *Run workflow*) y su informe de umbrales está en verde. El informe queda como
  artefacto `performance-report-<run_id>` durante 90 días.
- [ ] `pnpm audit --audit-level=high` sin hallazgos.
- [ ] Revisadas las migraciones nuevas en `src/db/migrations/`: cada `.sql` tiene su
  `.down.sql` y es compatible con la versión del Worker actualmente desplegada
  (las migraciones se aplican antes del nuevo código).
- [ ] Evento de prueba de Sentry enviado con la integración de la app
  (`SENTRY_DSN=<dsn> pnpm sentry:test-event`); el script imprime `requestId`,
  `testEventId` y `triggeredAt` para la evidencia.
- [ ] Evidencia pre-deploy vigente (≤30 días) en un fichero fuera del repositorio y
  verificador en verde:

```bash
DEPLOY_ENVIRONMENT=staging \
PREDEPLOY_EVIDENCE_FILE=/ruta/segura/predeploy-staging.json \
DATABASE_URL='<url del entorno>' SENTRY_DSN='<dsn>' \
pnpm verify:predeploy
```

## 2. Despliegue

Exporta siempre `DATABASE_URL` en la propia orden: `drizzle.config.ts` carga
`.dev.vars` como respaldo, así que olvidarla migraría la base de desarrollo sin aviso.

```bash
DATABASE_URL='<url directa del entorno>' pnpm db:migrate:prod
pnpm deploy:staging        # o pnpm deploy:production: build OpenNext + wrangler
```

No existe un script de despliegue sin entorno, para que producción nunca se
despliegue por omisión. Antes del primer despliegue de un entorno puedes comprobar
sus bindings sin subir nada con
`pnpm exec opennextjs-cloudflare build && pnpm exec wrangler deploy --dry-run --env <entorno>`.

- [ ] Migraciones aplicadas sin error.
- [ ] `wrangler` confirma el despliegue; apunta el ID de versión.

## 3. Después de desplegar (en menos de 24 horas)

**Smoke funcional en un móvil real** (quickstart V1, V5, V7):

- [ ] Registro → email de verificación recibido → inicio de sesión.
- [ ] Datos de empresa → factura de dos líneas → emisión con número correlativo.
- [ ] PDF: primero `202` en proceso y después descarga correcta.
- [ ] Enlace público abierto sin sesión desde otro dispositivo; al desactivarlo
  devuelve 404.
- [ ] Sin mensajes acumulándose en las DLQ.

**Latencia real (quickstart V9)**

- [ ] p95 de las operaciones CRUD contra el Worker desplegado por debajo de 300 ms,
  medido por HTTP con una cuenta de prueba. Con Smart Placement el Worker corre
  junto a Neon, así que cada petición paga un solo viaje largo, no uno por
  consulta. *(Pendiente: script de medición contra staging.)*

**Sentry y verificador**

- [ ] Error controlado disparado sin datos fiscales ni personales; el evento aparece
  en Sentry con el tag `request_id` correcto.
- [ ] Evidencia post-deploy rellenada (cloud-cost-controls.md § post-deploy) y
  verificador en verde:

```bash
DEPLOY_ENVIRONMENT=staging \
DEPLOY_BASE_URL=https://<host-del-entorno>/ \
POSTDEPLOY_EVIDENCE_FILE=/ruta/segura/postdeploy-staging.json \
SENTRY_ORG_SLUG=<org> SENTRY_PROJECT_SLUG=<proyecto> SENTRY_AUTH_TOKEN=<token> \
pnpm verify:postdeploy
```

## 4. Marcha atrás

- **Código:** `pnpm exec wrangler rollback <version-id> --env <entorno>` vuelve a la versión anterior
  del Worker. Los mensajes ya encolados se procesan con la versión restaurada, y los
  consumidores son idempotentes.
- **Esquema:** solo si la migración es incompatible con la versión restaurada, aplica
  su `.down.sql` en orden inverso con `psql` sobre la URL directa del entorno.
  Antes, crea en Neon una rama de respaldo del estado actual.
- **Nunca** se borran documentos emitidos ni eventos de auditoría para deshacer un
  despliegue.

## Registro

Por cada despliegue a producción, anota en el ticket de cambio (sin secretos):
commit, PR, ID de versión del Worker, run del workflow Performance, referencias de
la evidencia pre/post-deploy y quién lo ejecutó. La validación final
(`specs/001-invoice-flash/validation-report.md`, T131) enlaza el primer despliegue
productivo.
