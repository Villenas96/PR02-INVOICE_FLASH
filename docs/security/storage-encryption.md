# Cifrado y privacidad del almacenamiento

Este runbook reúne la evidencia bloqueante de Neon y R2 exigida antes de desplegar
Invoice Flash en `staging` o producción. La evidencia demuestra el estado real del
entorno; una captura antigua, una URL pública genérica o una afirmación sin
referencia no sirven.

La aplicación maneja datos fiscales y personales. Las credenciales, cadenas de
conexión completas, cabeceras, nombres de destinatarios y objetos R2 nunca se
incluyen en el JSON, en capturas compartidas ni en logs del verificador.

## Neon: TLS y cifrado en reposo

1. Obtén la cadena del branch objetivo desde el gestor de secretos, sin copiarla al
   repositorio.
2. Confirma que el host termina en `.neon.tech` y que la cadena contiene
   `sslmode=verify-full` o, como mínimo compatible con el plan,
   `sslmode=require`. No se admite `prefer`, `allow` ni `disable`.
3. Abre una conexión desde el mismo tipo de runtime que usará el despliegue y
   ejecuta:

   ```sql
   SELECT ssl, version, cipher
   FROM pg_stat_ssl
   WHERE pid = pg_backend_pid();
   ```

   Neon termina el TLS en su proxy y el cómputo Postgres ve la conexión interna, así
   que esta consulta devuelve `ssl = false` (también con el host directo, sin
   `-pooler`). No es una conexión sin cifrar. La prueba válida es la del cliente:
   `psql "$DATABASE_URL" -c '\conninfo'` debe mostrar `SSL Connection | true`
   (con `sslmode=require` la conexión falla si el TLS no se negocia). Conserva en el
   sistema de cambios una salida redactada que no incluya host, usuario, base de
   datos ni credenciales.
4. Registra la revisión de la política vigente de cifrado en reposo de Neon. Neon
   documenta TLS obligatorio y AES-256 en reposo en su
   [resumen de seguridad](https://neon.com/docs/security/security-overview).
5. Verifica que los branches efímeros de CI tengan caducidad en Neon o eliminación
   automatizada en `tests/integration/global-teardown.ts`. Guarda la referencia de
   la configuración o de una ejecución de limpieza correcta.

`verify:predeploy` también inspecciona `DATABASE_URL` sin imprimirla. Falla si el
host no es Neon o si falta un modo TLS obligatorio. La consulta real y el cifrado en
reposo se acreditan mediante evidencia revisada porque requieren acceso autenticado
al proyecto.

Campos correspondientes en la evidencia:

```json
{
  "neon": {
    "tlsConnectionVerifiedAt": "<ISO-8601 con zona>",
    "encryptionAtRestVerified": true,
    "encryptionEvidenceUrl": "https://<ticket-o-registro-privado>",
    "ciBranchCleanup": {
      "mode": "no-ci-branches",
      "verifiedAt": "<ISO-8601 con zona>",
      "evidenceUrl": "https://<registro-que-muestra-que-CI-no-usa-Neon>"
    }
  }
}
```

El CI actual no crea ramas en Neon (integración y rendimiento usan un Postgres
local del runner), por eso el modo es `no-ci-branches`. Si un job vuelve a crear
ramas, usa `"enabled": true` con `"mode": "expiration"` o
`"automated-deletion"` y enlaza la ejecución que demuestra la limpieza.

## R2: bucket privado, HTTPS y cifrado

R2 cifra automáticamente objetos y metadatos en reposo. Cloudflare documenta
AES-256 y GCM como modo preferido, además de TLS en tránsito, en
[R2 Data security](https://developers.cloudflare.com/r2/reference/data-security/).
Esto no convierte un bucket público en aceptable.

Para el bucket enlazado como `STORAGE_BUCKET`:

1. Abre R2 > `invoice-flash-storage` > Settings.
2. Comprueba que **Public Development URL (`r2.dev`)** está desactivada.
3. Comprueba que no hay **Custom Domains** conectados. Los PDF y logotipos se sirven
   únicamente a través del Worker autorizado; Cloudflare explica ambas vías de
   publicación en [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).
4. Comprueba que `wrangler.jsonc` contiene el binding privado
   `STORAGE_BUCKET` y que ninguna credencial S3 está en el repositorio.
5. Guarda una captura o exportación redactada de los ajustes y referencia el
   registro. No incluyas claves de objetos, nombres fiscales ni tokens públicos.

Campos correspondientes:

```json
{
  "r2": {
    "bucketName": "invoice-flash-storage",
    "bindingName": "STORAGE_BUCKET",
    "privateAccess": true,
    "publicDevelopmentUrlDisabled": true,
    "customDomainsDisabled": true,
    "httpsOnly": true,
    "encryptionAtRest": "AES-256-GCM",
    "verifiedAt": "<ISO-8601 con zona>",
    "evidenceUrl": "https://<ticket-o-registro-privado>"
  }
}
```

## Registro y caducidad

- El JSON local puede estar fuera del repositorio o en un fichero temporal con
  permisos restringidos. `PREDEPLOY_EVIDENCE_FILE` apunta a ese fichero.
- Cada referencia `evidenceUrl` debe usar HTTPS y apuntar a un registro accesible al
  revisor (ticket, control de cambios o almacén de evidencias).
- Toda comprobación incluida debe tener menos de 30 días y `validUntil` no puede
  haber vencido. Un cambio de bucket, branch, plan o proveedor invalida la evidencia
  inmediatamente.
- El JSON solo guarda estados, fechas, contadores y referencias. Las capturas o
  respuestas autenticadas viven en el sistema de evidencias, con su control de
  acceso y retención.

Ejecución:

```bash
DEPLOY_ENVIRONMENT=staging \
PREDEPLOY_EVIDENCE_FILE=/ruta/segura/predeploy-staging.json \
SENTRY_DSN="$SENTRY_DSN" \
DATABASE_URL="$DATABASE_URL" \
pnpm verify:predeploy
```

Un código de salida distinto de cero bloquea migración, build y deploy. No se omite
el control ni se modifica la evidencia para forzar un resultado verde.
