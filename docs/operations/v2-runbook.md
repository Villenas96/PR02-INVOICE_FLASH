# Runbook v2 (Factum): Stripe, Resend, colas, cron y MCP

Operación de las piezas que añade `specs/002-factum-improvements/`. Todos los
comandos usan **pnpm** (`pnpm exec wrangler …`, `pnpx …`). Nunca pegues claves,
secretos, URLs de conexión ni correos de clientes en el repositorio, en tickets ni
en la evidencia.

## 1. Stripe

### Claves y secretos

| Variable | Dónde | Para qué |
|---|---|---|
| `STRIPE_SECRET_KEY` | secreto del Worker (`pnpm exec wrangler secret put STRIPE_SECRET_KEY --env <entorno>`) | API de Stripe. **Modo test** en local y staging. |
| `STRIPE_WEBHOOK_SECRET` | secreto del Worker | Verifica la firma de `/api/webhooks/stripe`. Uno por endpoint y entorno. |
| `STRIPE_TAX_RATE_ID` | variable/secreto del Worker | `txr_…` de IVA 21 % **incluido** en el precio. |
| `PRO_CHECKOUT_ENABLED` | variable del Worker | `false` hasta activar Pro (ver `pending-manual-tasks.md`). |

### Productos y precios

Cuatro precios con estos `lookup_key` (los lee la app y se copian a `billing_price`):
`essential_monthly`, `essential_yearly`, `pro_monthly`, `pro_yearly`.

### Ajustes del panel que NO se pueden fijar por API

Haz esto a mano en cada cuenta/entorno de Stripe y deja captura en la evidencia:

1. **Reintentos de pagos fallidos** (Billing → Subscriptions → Manage failed
   payments): reintentos que terminen **dentro de 7 días** y, al agotarse,
   **cancelar la suscripción**. La app abre el periodo de gracia al primer fallo,
   avisa el día 5 y degrada a Básico al vencer `grace_until`; Stripe no debe
   prolongarlo más.
2. **Datos de empresa** (Settings → Business → Public details) y el **tax rate de
   IVA 21 %** aplicado a las facturas de Stripe (copia su id a `STRIPE_TAX_RATE_ID`).
3. **Customer Portal** (Settings → Billing → Customer portal): cambio de plan
   restringido a los productos Esencial y Pro (mensual/anual), cambio de medio de
   pago, historial de facturas y cancelación **al final del periodo**.
   Comprueba que «Subscriptions → Customers can switch plans» queda activado y
   guardado. Sin él, el paso de Esencial a Pro (`subscription_update_confirm`)
   falla con «the subscription update feature in the portal configuration is
   disabled». Pasó en el sandbox de staging el 08/11/2026.

### Webhook

1. Registra el endpoint `https://<host>/api/webhooks/stripe` con los eventos que
   usa la app (suscripciones, facturas y checkout) y copia su secreto de firma.
2. Local: `stripe listen --api-key <clave sk_test de la cuenta> --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,price.created,price.updated,price.deleted,product.created,product.updated --forward-to 127.0.0.1:3000/api/webhooks/stripe`.
   `--events` es obligatorio en las versiones actuales del CLI, y `--api-key` asegura que se escuchan los eventos de la misma cuenta (o sandbox) que usa la app. El secreto de firma se obtiene con `stripe listen --api-key … --print-secret`.
3. E2E de pago (T035): exporta `E2E_STRIPE_SECRET_KEY`, `E2E_STRIPE_WEBHOOK_SECRET` y, opcionalmente, `E2E_STRIPE_TAX_RATE_ID`, deja `stripe listen` en marcha y ejecuta `pnpm test:e2e tests/e2e/upgrade-flow.spec.ts`. Sin la clave, el test de pago se salta. La cuenta necesita los cuatro precios con `lookup_key`.
4. Los eventos se **reconcilian releyendo la suscripción** en Stripe: reenviar o
   desordenar eventos es seguro. `stripe events resend <id>` no crea un segundo
   `plan_change`.

### Test clocks (probar renovaciones y gracia sin esperar)

1. En Stripe (modo test) crea un *test clock* y un cliente asociado a él.
2. Contrata un plan con ese cliente, avanza el reloj hasta la renovación y simula un
   pago fallido: debes ver `past_due` + `grace_until` en la app.
3. Avanza hasta el día 5 (aviso) y hasta pasado `grace_until` (degradación a
   Básico con los datos intactos). Bajar de plan **nunca** borra datos.

## 2. Resend

- El remitente es `EMAIL_FROM` (`Factum <no-reply@…>`). Verifica el dominio en
  Resend (SPF, DKIM y DMARC) en **cada** entorno antes de desplegar.
- Comprobación: tras desplegar, crea una invitación de gestoría o un recordatorio
  de prueba y confirma que llega con el remitente de Factum y que no cae en spam.
- Los documentos usan siempre el email de la empresa emisora como `Reply-To`.

## 3. Colas y DLQ

Tres colas por entorno, cada una con su DLQ (`-dlq`, máx. 3 reintentos):
`pdf-render`, `email-send` y `jobs` (`invoice-flash-jobs`; en staging con prefijo
`invoice-flash-staging-`). Los mensajes llevan solo identificadores opacos.

```bash
pnpm exec wrangler queues create invoice-flash-jobs
pnpm exec wrangler queues create invoice-flash-jobs-dlq
```

### Reproducir una DLQ

Todos los manejadores son idempotentes y el consumidor de la app despacha por el
**tipo** del mensaje (no por la cola), así que basta con enlazar temporalmente la
DLQ al mismo Worker:

```bash
pnpm exec wrangler queues consumer add invoice-flash-jobs-dlq invoice-flash
# espera a que se vacíe (panel de Cloudflare → Queues → backlog = 0)
pnpm exec wrangler queues consumer remove invoice-flash-jobs-dlq invoice-flash
```

Antes de reproducir, averigua **por qué** falló (Sentry, `pnpm exec wrangler tail`):
un mensaje cuyo tipo no tiene manejador lanza error a propósito para acabar en la
DLQ y no perderse en silencio.

## 4. Cron

| Cron | Qué hace |
|---|---|
| `0 5 * * *` | **Planificador**: solo selecciona trabajo pendiente, inserta reclamos idempotentes y encola (`billing.grace`, recordatorios, ciclos recurrentes, envíos a la gestoría). Un paso que falle no bloquea a los demás (resumen por paso en los logs). |
| `0 3 * * *` | **Purgas**: PII de envíos terminados a 30 días, verificaciones caducadas, logotipos huérfanos y facturas de ejemplo del asistente (7 días). |

- Comprobar que están activos: `pnpm exec wrangler deployments list --env <entorno>`
  y, en el panel, Worker → Triggers → Cron Triggers.
- Probar en local: `pnpm preview` y
  `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+5+*+*+*"`.
- Los reclamos son únicos por ciclo/aviso/fecha: relanzar el planificador el mismo
  día no duplica nada.

## 5. Servidor MCP (asistentes de IA, solo Pro)

- Endpoint: `POST https://<host>/api/mcp` (Streamable HTTP sin estado, JSON).
- Descubrimiento OAuth 2.1: `/.well-known/oauth-authorization-server` y
  `/.well-known/oauth-protected-resource` (+ `/api/mcp`). El flujo (registro
  dinámico de clientes públicos, PKCE S256, consentimiento en `/oauth/consent`)
  lo sirve Better Auth bajo `/api/auth/oauth2/*`.
- `BETTER_AUTH_URL` debe ser la URL pública **HTTPS** del entorno: es el emisor de
  los tokens y la audiencia es `<BETTER_AUTH_URL>/api/mcp`. Las claves de firma
  (`jwks`) se cifran con `BETTER_AUTH_SECRET`: **rotar ese secreto invalida las
  claves existentes** (los asistentes tendrán que reconectar).
- Cada petición comprueba la conexión (`ai_connection.status = active`) y que la
  empresa siga en Pro, sin caché: revocar o bajar de plan corta el acceso al
  instante. El propietario revoca en Ajustes → Asistentes de IA.
- Límite: 60 peticiones/min por conexión (`MCP_RATE_LIMITER`, respuesta 429).
- Emitir y anular exigen dos pasos (`request_issue`/`request_void` →
  `confirm_action` con token de un solo uso, 5 min). El actor queda en
  `document_event.actor` como `ai:{conexión}:user:{usuario}`.
- Diagnóstico: `pnpm exec wrangler tail --env <entorno>` y filtra por `mcp.`; los
  registros nunca contienen tokens ni cuerpos.
