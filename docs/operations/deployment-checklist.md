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

> ⚠️ **Hueco abierto:** `wrangler.jsonc` define hoy un solo Worker (`invoice-flash`),
> un solo bucket y unas únicas colas, sin bloque `env.staging`. Mientras no exista,
> staging y producción desplegarían sobre los mismos recursos. Antes del primer
> despliegue a producción hay que añadir un entorno `staging` con Worker, bucket y
> colas propios, o usar cuentas de Cloudflare separadas.

**Cloudflare**

- [ ] Bucket R2 `invoice-flash-storage` creado, privado, sin dominio público ni
  `r2.dev` (ver storage-encryption.md).
- [ ] Colas creadas: `invoice-flash-pdf-render`, `invoice-flash-email-send` y sus DLQ
  `invoice-flash-pdf-render-dlq`, `invoice-flash-email-send-dlq`.
- [ ] Namespace de rate limiting `PUBLIC_RATE_LIMITER` disponible para `/d/*`.
- [ ] Secretos cargados con `pnpm exec wrangler secret put <NOMBRE>`:
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`,
  `RESEND_FROM_EMAIL`, `SENTRY_DSN`.
- [ ] Alerta de presupuesto activa y probada (cloud-cost-controls.md § Cloudflare).

**Neon**

- [ ] Rama del entorno creada, TLS obligatorio (`sslmode=require`).
- [ ] Monitorización de uso (Free) o Spending Limit con avisos 80 %/100 % (pago).

**Resend y Sentry**

- [ ] Dominio remitente de `RESEND_FROM_EMAIL` verificado en Resend.
- [ ] Proyecto Sentry creado y token de solo lectura de eventos para
  `verify:postdeploy`.

**GitHub (job de rendimiento, `.github/workflows/performance.yml`)**

- [ ] Variable `NEON_PROJECT_ID` y variable `NEON_STAGING_BRANCH` (rama padre de
  las ramas efímeras).
- [ ] Secreto `NEON_API_KEY` con permiso para crear y borrar ramas.
- [ ] Opcionales: `NEON_DATABASE` y `NEON_ROLE` si no son `neondb`/`neondb_owner`.

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
pnpm build                                           # Next.js + OpenNext
DATABASE_URL='<url directa del entorno>' pnpm db:migrate:prod
pnpm run deploy                                      # Worker + colas + R2
```

Usa `pnpm run deploy`, no `pnpm deploy`: este último es un comando nativo de pnpm
para workspaces y no ejecuta el script.

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

- **Código:** `pnpm exec wrangler rollback <version-id>` vuelve a la versión anterior
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
