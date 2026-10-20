# Verificación pre-deploy — comprobaciones de la v2 (Factum)

`pnpm verify:predeploy` mantiene todas las comprobaciones de la v1 (evidencia de Sentry,
Neon, R2 y costes; ver [deployment-checklist.md](./deployment-checklist.md)) y añade
las de la feature `002-factum-improvements`. Ninguna imprime valores secretos: solo
nombres, recuentos y estados.

```bash
DEPLOY_ENVIRONMENT=staging \
PREDEPLOY_EVIDENCE_FILE=/ruta/segura/predeploy-staging.json \
DATABASE_URL='<url del entorno>' SENTRY_DSN='<dsn>' \
STRIPE_WEBHOOK_SECRET='<whsec_… del entorno>' \
pnpm verify:predeploy
```

## Qué comprueba y cómo corregirlo

| Comprobación | Falla si… | Corrección |
|---|---|---|
| **Cola de trabajos** | El bloque `env.<entorno>` de `wrangler.jsonc` no tiene el productor `JOBS_QUEUE` → `invoice-flash[-staging]-jobs`, o su consumidor no usa `max_retries: 3` y la DLQ `…-jobs-dlq`. | Corrige `wrangler.jsonc` y crea las colas: `pnpm exec wrangler queues create invoice-flash-jobs` y `pnpm exec wrangler queues create invoice-flash-jobs-dlq` (con prefijo `-staging` en staging). |
| **Cron** | Falta `0 3 * * *` (purga de PII) o `0 5 * * *` (planificador diario). | Añade ambos en `triggers.crons` del entorno. |
| **Rate limiters** | Falta `PUBLIC_RATE_LIMITER`, `EXPORT_RATE_LIMITER` (descargas `/x/*`) o `MCP_RATE_LIMITER` (`/api/mcp`). | Añádelos en `unsafe.bindings` con un `namespace_id` propio por entorno. |
| **Límite de CPU** | `limits.cpu_ms` < 300000. | Los consumidores generan ZIP/XLSX y aplican importaciones de 5.000 filas: fija `cpu_ms: 300000`. |
| **Secreto del webhook de Stripe** | `STRIPE_WEBHOOK_SECRET` vacío o sin forma `whsec_…`. | Registra el endpoint `https://<dominio>/api/webhooks/stripe` en Stripe y guarda el secreto con `pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET --env <entorno>`. |
| **Precios sincronizados** | `billing_price` no tiene ningún precio activo. | Los precios llegan por los webhooks `price.*`/`product.*`. Tras registrar el webhook, reenvía los eventos de precio desde el dashboard de Stripe (o edita y guarda cada precio) y vuelve a ejecutar el verificador. |

Además del verificador, antes de desplegar la v2 en cada entorno:

- [ ] Secretos del Worker presentes: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `EMAIL_FROM` (`Factum <no-reply@…>`), `APP_BASE_URL`; `EMAIL_REPLY_TO` opcional.
  `RESEND_FROM_EMAIL` ya no se usa.
- [ ] Dominio de Factum verificado en Resend (SPF, DKIM, DMARC).
- [ ] `PRO_CHECKOUT_ENABLED` en `false` hasta el Incremento 3; en `true` solo cuando
  Pro sea contratable (comprobado también por el servidor en el checkout).

## Orden de despliegue del Incremento 1

La migración del plan es *expand/contract* (data-model, «Migración del plan»):

1. Desplegar la release de compatibilidad con la migración `0004_plan_tiers_expand`
   (el código acepta `free|basic` y `pro|essential`).
2. Solo con esa release en producción, aplicar `0005_billing` y desplegar el resto de la v2.
