# Tareas pendientes que dependen del titular

Estado a 2026-10-06. Todas las tareas de código de `specs/001-invoice-flash/tasks.md`
están hechas salvo cinco que exigen accesos, personas o decisiones fuera del
repositorio: T122, T123, T129, T130 y T131.

Nunca pegues secretos, URLs de conexión, correos de destinatarios ni datos de
clientes en el repositorio, en tickets ni en los ficheros de evidencia (ver
[deployment-checklist.md](./deployment-checklist.md)).

## Orden recomendado

1. T122 y T123 (comprobaciones de infraestructura, ~1 h).
2. Crear el entorno de **producción** (no existe aún, ver más abajo).
3. T129 (despliegue y smoke de producción).
4. T130 (prueba de usabilidad con 10 personas; se puede preparar en paralelo).
5. T131 (validación final; cierra todo).

## Hallazgo previo: producción no está creada

Con `wrangler` (cuenta *Sinergia HUB*) se comprobó el 2026-10-06:

| Recurso | Staging | Producción |
|---|---|---|
| Bucket R2 | `invoice-flash-storage-staging` existe, UE (`EEUR`) | `invoice-flash-storage` creado el 2026-10-06, UE, privado (r2.dev off, sin dominios) |
| `r2.dev` | desactivado | n/a |
| Dominios personalizados R2 | ninguno | n/a |
| Colas + DLQ | las 4 existen | no existen |

Consecuencia: T122, T123 y T129 se pueden cerrar para staging ahora, y para
producción solo después de crear sus recursos (deployment-checklist.md § 0).

---

## T122 — Reverificar cifrado y privacidad (Neon + R2)

Doc de referencia: [storage-encryption.md](../security/storage-encryption.md).

**R2 (staging): ya comprobado por CLI el 2026-10-06.** Falta guardar la evidencia:

1. Repite si quieres los comandos (solo lectura):
   ```bash
   pnpm exec wrangler r2 bucket dev-url get invoice-flash-storage-staging -J eu
   pnpm exec wrangler r2 bucket domain list invoice-flash-storage-staging -J eu
   ```
   Esperado: «Public access via the r2.dev URL is disabled» y «no custom domains».
2. Haz una captura de Cloudflare > R2 > `invoice-flash-storage-staging` > Settings
   y súbela a tu sistema de evidencias (ticket privado). Anota su URL HTTPS.
3. Para producción: crea el bucket (`pnpm exec wrangler r2 bucket create
   invoice-flash-storage -J eu`) y repite 1–2.

**Neon (no verificable desde aquí: la URL de staging solo está en secretos de Cloudflare):**

1. En el gestor de secretos copia la `DATABASE_URL` del entorno. Comprueba que el
   host termina en `.neon.tech` y que lleva `sslmode=require` (o `verify-full`).
2. Ejecuta con `psql` (sin pegar la URL en ningún sitio):
   ```sql
   SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid();
   ```
   Aviso: en Neon devuelve `ssl = false` aunque el cliente use TLS (el proxy de Neon
   termina el TLS). Usa en su lugar `psql "$DATABASE_URL" -c '\conninfo'` y comprueba
   `SSL Connection | true`. Guarda la salida sin host ni usuario.
3. Revisa en https://neon.com/docs/security/security-overview que el cifrado en
   reposo (AES-256) sigue vigente; anota la fecha.
4. Ramas de CI: el CI usa Postgres local, así que el modo es `no-ci-branches`.
   Enlaza el workflow `.github/workflows/ci.yml` (job con `postgres:16`) como evidencia.
5. Rellena la parte `neon` y `r2` del JSON de evidencia pre-deploy (plantilla en
   [cloud-cost-controls.md](./cloud-cost-controls.md)), fuera del repo, p. ej.
   `~/secure/predeploy-staging.json`.

Al terminar, marca T122 como `[X]` (o pídemelo).

**Resultado de las comprobaciones automáticas (2026-10-06, sin secretos):**
R2 staging y producción: UE, `r2.dev` desactivado, sin dominios personalizados.
Neon staging y producción (endpoints distintos): `sslmode=require` y
`\conninfo` → `SSL Connection | true`. Cifrado en reposo: AES-256 en NVMe según la
documentación de Neon. Pendiente solo lo manual: subir capturas, URLs de evidencia
y JSON (pasos 5 y siguientes).

## T123 — Reverificar controles de coste

Doc de referencia: [cloud-cost-controls.md](./cloud-cost-controls.md). Las alertas de
presupuesto no se ven con el token actual de `wrangler` (solo lectura de cuenta), así
que es manual.

**Cloudflare**
1. Dashboard > Manage Account > Billing > Billable Usage > **Budget alerts**.
2. Confirma que hay una alerta de ámbito cuenta, umbral > 0 (la plantilla usa
   1000 céntimos de USD) y al menos un destinatario.
3. Usa la función de prueba si existe y confirma que llega el aviso. Si no existe,
   no fuerces gasto: anótalo y pide aprobación para un ejercicio controlado.
4. Guarda captura + fecha + nº de destinatarios + umbral (sin correos).

**Neon**
1. Neon > Billing: confirma el plan.
2. Free: activa monitorización de uso y revisa límites (`billingSpendPossible: false`).
3. De pago: activa Spending Limit mensual y avisos al 80 % y 100 %; prueba entrega.
4. Rellena `cloudflareCost` y `neonCost` en el mismo JSON de evidencia.

**Validar**
```bash
DEPLOY_ENVIRONMENT=staging \
PREDEPLOY_EVIDENCE_FILE=~/secure/predeploy-staging.json \
DATABASE_URL='<url staging>' SENTRY_DSN='<dsn>' \
pnpm verify:predeploy
```
Debe terminar con código 0. Si falla, corrige la evidencia real; no la edites para
forzar el verde.

## T129 — Reverificar despliegue y smoke móvil de producción

Antecedente: el 2026-09-30 se hizo una prueba en móvil (staging) y la factura se
descargó bien. Desde entonces se desplegaron T132–T136 (incluido el arreglo del
PDF) y se añade T137, así que hay que repetirla sobre la versión a publicar.

1. Crea los recursos de producción (deployment-checklist.md § 0: R2 en UE, 4 colas,
   secretos con `wrangler secret put <N> --env production`, rama Neon principal).
2. Aplica migraciones (incluye la `0003_chief_revanche` de T137):
   ```bash
   DATABASE_URL='<url directa producción>' pnpm db:migrate:prod
   pnpm deploy:production
   ```
   Anota el ID de versión del Worker.
3. En un móvil real (viewport 320–767 px), dentro de 24 h:
   registro → email de verificación → login → datos de empresa → factura de dos
   líneas con cliente con NIF y dirección → emitir → PDF (primero 202, luego
   descarga) → enlace público desde otro dispositivo → desactivarlo y comprobar 404.
4. Revisa que no haya mensajes en las DLQ.
5. Dispara el error controlado y localiza el evento en Sentry con su `request_id`.
6. Rellena el JSON post-deploy (plantilla en cloud-cost-controls.md) y ejecuta:
   ```bash
   DEPLOY_ENVIRONMENT=production DEPLOY_BASE_URL=https://<host>/ \
   POSTDEPLOY_EVIDENCE_FILE=~/secure/postdeploy-production.json \
   SENTRY_ORG_SLUG=<org> SENTRY_PROJECT_SLUG=<proyecto> SENTRY_AUTH_TOKEN=<token> \
   pnpm verify:postdeploy
   ```
7. Marca T129 como `[X]` y registra commit, PR (#29 y siguientes), versión del
   Worker y quién ejecutó (deployment-checklist.md § Registro).

## T130 — Prueba de usabilidad V13

Criterio (quickstart V13): ≥ 10 participantes del perfil objetivo (autónomos o
pequeños negocios) que **no** hayan usado Invoice Flash; mediana < 10 min; al menos
9 de 10 completan la primera factura sin ayuda.

1. Recluta 10+ personas y fija sesiones de ~20 min (presenciales o por vídeo).
2. Prepara el entorno (staging o producción) con registro abierto; cada persona
   usa su propia cuenta.
3. Dale solo la meta de la spec: «Crea tu cuenta y emite tu primera factura».
   Cronómetro al mostrar el registro. El facilitador **no** da indicaciones.
4. Registra por participante, anonimizado (P01, P02…): minutos hasta emitir,
   éxito autónomo (sí/no), abandono (sí/no), bloqueos observados.
5. Calcula la mediana (solo sesiones autónomas) y el nº de éxitos.
6. Escribe `specs/001-invoice-flash/usability-report.md` con la tabla, la mediana,
   el resultado frente al criterio y las mejoras detectadas. Si no se cumple,
   abre tareas de mejora antes de T131. Puedo preparar la plantilla del informe.

## T131 — Validación final (quickstart V1–V13)

Hazla al final, con T122, T123, T129 y T130 cerradas.

1. Ejecuta las puertas de calidad (quickstart § Puertas): `pnpm lint`,
   `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`,
   `pnpm test:performance` y `pnpm audit --audit-level=high`.
2. Recorre los escenarios V1–V13 del quickstart y anota el resultado de cada uno.
3. Escribe `specs/001-invoice-flash/validation-report.md` con: resultados, enlace
   al informe de usabilidad, referencia del PR aprobado, nombres de los checks
   requeridos de CI y un resumen no sensible.
4. Confirma que `main` está protegida (repository-governance.md) y que el PR final
   tiene al menos una aprobación. Puedo ejecutar el paso 1 y preparar el borrador
   del informe cuando me lo pidas.
