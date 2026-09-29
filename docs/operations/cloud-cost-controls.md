# Controles de coste y evidencia de despliegue

Este runbook define la puerta de gasto de Cloudflare/Neon y el contrato completo de
evidencia para `verify:predeploy` y `verify:postdeploy`. Las plantillas contienen
marcadores: **no son evidencia real**.

## Cloudflare

Antes del primer despliegue remoto:

1. En la cuenta objetivo abre Manage Account > Billing > Billable Usage > Budget
   alerts.
2. Crea o revisa una alerta de presupuesto de ámbito de cuenta con umbral mayor que
   cero y al menos un destinatario operativo. Cloudflare documenta que estas alertas
   son informativas y no detienen el consumo en
   [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).
3. Revisa también el consumo por producto de Workers, Queues y R2. El umbral debe
   corresponder al presupuesto aprobado del entorno, no al máximo teórico del
   proveedor.
4. Demuestra la recepción mediante la función de prueba que ofrezca la consola. Si
   esa cuenta no ofrece prueba, realiza un ejercicio controlado y aprobado por el
   responsable de costes. No generes gasto ni reduzcas umbrales sin autorización.
5. Guarda fecha, número de destinatarios, umbral en céntimos de USD y referencia al
   registro. No guardes direcciones de correo.

La alerta no es un límite duro: si dispara, el responsable debe revisar Billable
Usage, identificar el producto y decidir si limitar tráfico, pausar trabajos no
críticos o ampliar el presupuesto mediante cambio aprobado.

## Neon

La rama y el plan se revisan en Neon > Billing:

- **Plan Free**: confirma que la organización sigue en Free, activa la monitorización
  de uso y registra la revisión de límites. La evidencia declara
  `billingSpendPossible: false`; si hay cualquier recurso facturable, no uses esta
  variante.
- **Plan de pago**: antes del upgrade, habilita un Spending Limit mensual en
  céntimos de USD. Deben estar operativos los avisos del 80 % y 100 %. Neon describe
  esos dos avisos y la disponibilidad del control para planes de pago en
  [Organization Spending Limits](https://neon.com/blog/introducing-organization-spending-limits).
  Registra una prueba real de entrega con el mecanismo disponible o mediante un
  ejercicio controlado aprobado.

Al llegar al 80 %, se investiga la tendencia y se informa al responsable. Al 100 %,
se trata como incidente de coste: se limita el crecimiento no esencial y no se eleva
el límite sin un cambio aprobado. Los branches efímeros se limpian según
[storage-encryption.md](../security/storage-encryption.md).

## Evidencia pre-deploy

El fichero señalado por `PREDEPLOY_EVIDENCE_FILE` debe ajustarse a esta estructura.
Los marcadores `<...>` deben sustituirse por valores reales; las referencias deben
ser HTTPS y no contener secretos:

```json
{
  "schemaVersion": 1,
  "environment": "staging",
  "reviewedBy": "<identificador corporativo>",
  "verifiedAt": "<ISO-8601 con zona>",
  "validUntil": "<ISO-8601 posterior, máximo operativo 30 días>",
  "sentry": {
    "dsnConfigured": true,
    "requestIdCorrelationVerified": true,
    "requestId": "<UUID observado>",
    "testEventId": "<32 caracteres hexadecimales>",
    "eventReceivedAt": "<ISO-8601 con zona>",
    "evidenceUrl": "https://<evento-o-ticket-privado>"
  },
  "neon": {
    "tlsConnectionVerifiedAt": "<ISO-8601 con zona>",
    "encryptionAtRestVerified": true,
    "encryptionEvidenceUrl": "https://<ticket-o-registro-privado>",
    "ciBranchCleanup": {
      "enabled": true,
      "mode": "expiration",
      "verifiedAt": "<ISO-8601 con zona>",
      "evidenceUrl": "https://<ticket-o-ejecucion-de-CI>"
    }
  },
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
  },
  "cloudflareCost": {
    "budgetAlertEnabled": true,
    "thresholdUsdCents": 1000,
    "recipientCount": 1,
    "alertDeliveryTestedAt": "<ISO-8601 con zona>",
    "evidenceUrl": "https://<ticket-o-registro-privado>"
  },
  "neonCost": {
    "plan": "free",
    "billingSpendPossible": false,
    "usageMonitoringEnabled": true,
    "limitsReviewedAt": "<ISO-8601 con zona>",
    "evidenceUrl": "https://<ticket-o-registro-privado>"
  }
}
```

Para Neon de pago, sustituye únicamente `neonCost`:

```json
{
  "plan": "paid",
  "usageMonitoringEnabled": true,
  "spendingLimitEnabled": true,
  "spendingLimitUsdCents": 2000,
  "alertThresholdPercent": [80, 100],
  "alertDeliveryTestedAt": "<ISO-8601 con zona>",
  "evidenceUrl": "https://<ticket-o-registro-privado>"
}
```

El verificador falla si falta cualquier control, la evidencia tiene más de 30 días,
está caducada, corresponde a otro entorno o la configuración real no obliga TLS.

## Evidencia y verificación post-deploy

Dentro de las 24 horas posteriores a cada despliegue:

1. Abre el entorno con un viewport real entre 320 y 767 píxeles, completa el smoke
   móvil acordado y guarda referencia a la ejecución/captura.
2. Provoca un error controlado en una ruta instrumentada del despliegue, sin incluir
   datos fiscales o personales.
3. Localiza en Sentry el evento de 32 caracteres hexadecimales y comprueba que su tag
   `request_id` coincide con el UUID de la petición.
4. Crea el fichero temporal:

```json
{
  "schemaVersion": 1,
  "environment": "staging",
  "deployment": {
    "id": "<id o versión inmutable>",
    "baseUrl": "https://<host-del-entorno>/",
    "deployedAt": "<ISO-8601 con zona>",
    "evidenceUrl": "https://<despliegue-o-ticket>"
  },
  "mobileSmoke": {
    "passed": true,
    "checkedBy": "<identificador corporativo>",
    "checkedAt": "<ISO-8601 con zona>",
    "viewport": { "width": 390, "height": 844 },
    "evidenceUrl": "https://<ejecucion-o-captura>"
  },
  "sentry": {
    "testEventId": "<32 caracteres hexadecimales>",
    "requestId": "<UUID observado>",
    "triggeredAt": "<ISO-8601 con zona>",
    "receivedAt": "<ISO-8601 con zona>",
    "evidenceUrl": "https://<evento-o-ticket-privado>"
  }
}
```

5. Usa un token Sentry de solo lectura (`project:read`) desde el gestor de secretos.
   El script consulta la API oficial
   [Retrieve an Event for a Project](https://docs.sentry.io/api/events/retrieve-an-event-for-a-project/),
   verifica el ID y el tag `request_id`, y hace además una petición HTTPS real con
   agente móvil. Ni el token ni el DSN se imprimen:

```bash
DEPLOY_ENVIRONMENT=staging \
DEPLOY_BASE_URL=https://staging.example.com/ \
POSTDEPLOY_EVIDENCE_FILE=/ruta/segura/postdeploy-staging.json \
SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN" \
SENTRY_ORG_SLUG="<organizacion>" \
SENTRY_PROJECT_SLUG="<proyecto>" \
pnpm verify:postdeploy
```

Para Sentry autoalojado, añade `SENTRY_API_BASE_URL=https://sentry.example.com`.
Un fallo HTTP, una redirección fuera de HTTPS, HTML sin viewport, evidencia antigua,
evento inexistente o `request_id` distinto deja el despliegue sin validar y exige
corregir o revertir según el impacto.
