# Quickstart: Factum v2 — Guía de validación

**Date**: 2026-10-20 | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/api.md](./contracts/api.md) | **Data model**: [data-model.md](./data-model.md)

Guía para levantar el entorno y validar de extremo a extremo cada incremento. No contiene implementación. El arranque, las puertas de calidad y los gates de despliegue de la v1 ([../001-invoice-flash/quickstart.md](../001-invoice-flash/quickstart.md)) siguen vigentes; aquí solo se añade lo nuevo.

## Prerrequisitos adicionales

- **Stripe** en modo test: cuenta, productos «Esencial» y «Pro» con precios mensual y anual con `lookup_key` `essential_monthly`, `essential_yearly`, `pro_monthly`, `pro_yearly`; Customer Portal activado (cambio de plan, medio de pago, facturas, cancelación al final del periodo).
- **Stripe CLI** para reenviar webhooks en local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
- **Resend**: dominio de Factum verificado (SPF/DKIM/DMARC) en staging y producción.
- Secretos nuevos en `.dev.vars` / Cloudflare Secrets (nunca en el repo): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO` (opcional).
- Bindings nuevos en `wrangler.jsonc` (todos los entornos): cola `invoice-flash-jobs` + DLQ, cron `0 5 * * *`, rate limiters `EXPORT_RATE_LIMITER` (`/x/*`) y `MCP_RATE_LIMITER`.
- Extensiones Postgres `unaccent` y `pg_trgm` (las crea la migración; Neon y Postgres 16 local las incluyen).

## Arranque local

```bash
pnpm install
pnpm db:migrate            # aplica 0004…0015
pnpm db:seed               # datos demo: cuentas en Básico, Esencial y Pro, 12 meses de documentos
pnpm dev
stripe listen --forward-to localhost:3000/api/webhooks/stripe   # en otra terminal
```

Para ejercitar cron y colas en local: `pnpm preview` (workerd) y disparar el planificador con `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+5+*+*+*"`. Los escenarios que dependen del tiempo (recurrencias, recordatorios, gracia) se prueban en integración con reloj inyectado (`now`), no esperando días reales.

## Puertas de calidad

Las mismas de la v1 (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:performance`, `pnpm audit`), más:

- Unitarias nuevas de `src/lib/*` listadas en data-model.md, con cobertura de negocio no inferior a `main`.
- Integración: matriz de permisos completa de [contracts/api.md](./contracts/api.md#matriz-de-permisos-sc-011--debe-cubrirse-con-tests-de-contrato); cupo por tipo bajo concurrencia; reentrega de cada mensaje de la cola `jobs`; webhooks Stripe duplicados y desordenados.
- E2E: cada escenario de US1 **sin recargar la página**; axe en todas las pantallas nuevas; móvil y escritorio.
- Test que falla si alguna plantilla de email contiene «Invoice Flash».

## Escenarios de validación por incremento

Cada escenario indica la historia y los criterios de la spec que valida.

### Incremento 1 — P1

**V1 · Correcciones de fluidez (US1, SC-001)** — cuenta nueva:
1. Guardar datos fiscales → el banner desaparece sin recargar.
2. Crear borrador, buscar y elegir cliente → se ve nombre y NIF, nunca un id; recargar el editor → sigue el nombre.
3. Emitir → el contador pasa de «0 de 5» a «1 de 5» sin recargar.
4. PDF y vista pública de una factura sin notas → sin bloque de notas; de un cliente con email → el email no aparece.
5. Recibir verificación y recuperación de contraseña (cuenta nueva) y envío de documento (cuenta Esencial del seed) → remitente «Factum» del dominio de Factum, sin «Invoice Flash».

**V2 · Planes y mejora con emisión bloqueada (US2, SC-002)** — cuenta Básico:
1. Página de planes: tres planes, mensual/anual, límites por tipo, plan actual marcado; Pro aparece como «Próximamente» sin botón de compra (`PRO_CHECKOUT_ENABLED` desactivado) y `POST /billing/checkout` con un precio Pro → `403 plan_not_available`.
2. Emitir 4 facturas → aviso del 80 %; emitir la 5.ª → límite; intentar la 6.ª → bloqueo sin número y botón «Mejorar».
3. Emitir una proforma → permitido (cupo independiente por tipo; con el Inc. 3, también presupuestos y albaranes).
4. Cronómetro: «Mejorar» → Checkout con tarjeta `4242 4242 4242 4242` → retorno → la 6.ª factura se emite sin rehacerla. Objetivo < 3 min.
5. Repetir el webhook con `stripe events resend <id>` → sin segundo `plan_change`.
6. Abandonar un Checkout con otra cuenta → el borrador sigue intacto y sin número.
7. Portal: cambiar a Esencial anual → periodicidad actualizada sin recargar; cancelar → sigue Esencial hasta fin de periodo; avanzar reloj de Stripe (test clock) → pasa a Básico con datos intactos. (La contratación de Pro se valida en V8, desde el Inc. 3.)
8. Test clock con tarjeta `4000 0000 0000 0341` (fallo en renovación) → aviso, gracia 7 días, aviso día 5, degradación a Básico; nada borrado.

**V3 · Interfaz sencilla (US3, SC-004)**:
1. Básico/Esencial: solo Facturas, Clientes, Productos, Ajustes y «Mejorar a Pro»; resumen cobrado/pendiente/vencido en la pantalla principal; ajustes en una página.
2. Emitir una factura con cliente y producto nuevos sin salir del editor.
3. «Nuevo ▾» → Proforma (y, desde el Inc. 3, Presupuesto y Albarán); tras emitir el primero de un tipo, aparece en la navegación.
4. Abrir `/recurring` en Esencial → explicación + invitación, no un error; `curl` a `/api/v1/recurring-templates` → `403 feature_not_in_plan`.
5. Pro (cuenta Pro del seed; en el Inc. 1 Pro aún no se vende): interfaz completa; activar «Interfaz sencilla» → reducida con menú «Más».
6. Bajar de Pro a Esencial (cuenta del seed) → interfaz sencilla; datos Pro conservados y ocultos.
7. Prueba de usabilidad moderada (≥ 10 participantes, protocolo v1): ≥ 9/10 emiten sin ayuda.

### Incremento 2 — P2

**V4 · Editor ágil (US4, SC-003)**: buscar cliente y producto escribiendo; «Guardar en catálogo» desde una línea manual; cambiar serie del borrador y emitir → número de la nueva serie; archivar esa serie antes de emitir → `series_archived` accionable; editar y eliminar borradores desde el listado (confirmación); duplicar una factura anulada → borrador con fechas de hoy y avisos de datos archivados; emitir la primera proforma/presupuesto/albarán sin configurar series → series `PRO-2026-`, `PRE-2026-`, `ALB-2026-`; «Imprimir» abre el diálogo. Cronómetro de factura nueva con datos existentes < 90 s.

**V5 · Cobro e impuestos (US5)**: dos cuentas bancarias + Bizum, una por defecto; IBAN con un dígito cambiado → rechazo sin mostrar el IBAN; impuesto «IGI 4,5 %»; factura con IGI y otra cuenta → desglose «IGI 4,5 %» exacto al céntimo; editar el IGI a 5 % → la factura emitida sigue en 4,5 %.

**V6 · Documento profesional (US6, SC-007)**: logotipo de emisor (subir un SVG → se rasteriza) y de cliente; bloque de pago con vencimiento, importe y titular/IBAN/BIC; cuadro «Observaciones» solo si hay; cambiar el logotipo → el PDF emitido no cambia; Pro: «Descargar Excel» → importes idénticos al PDF.

### Incremento 3 — P3

**V7 · Clientes y catálogo (US7, SC-005)**: buscar «malaga» encuentra «Málaga» por ciudad y por email parcial; archivar/restaurar desde la lista y filtro «Archivados»; unidades predefinidas y propia; Pro: importar `tests/fixtures/csv/catalog-500.csv` (Latin-1, `;`, coma decimal, filas erróneas) → previsualización con errores por fila, elegir «actualizar» duplicados, resumen final; 5.001 filas → rechazo. Cronómetro < 5 min.

**V8 · Gestoría (US8, SC-006, SC-011)**: Esencial: «Exportar para mi gestoría» trimestre anterior → Excel con una fila por documento y totales que cuadran; «Enviar a mi asesoría» → email con enlace que caduca a los 7 días; periodo vacío → aviso. Activar `PRO_CHECKOUT_ENABLED`: la página de planes muestra Pro contratable; desde Esencial, Portal → Pro anual → funciones Pro visibles sin recargar. Pro: exportación filtrada XLSX + ZIP de 300 documentos en segundo plano con aviso; programar envío trimestral y disparar el planificador con reloj al primer día del trimestre → un único envío; invitar gestoría, aceptar con otra cuenta, cambiar de empresa activa, intentar `PATCH` → `403 read_only_access`; revocar → la siguiente petición falla; el autónomo ve el registro de accesos y exportaciones.

**V9 · Presupuestos y albaranes (US9)**: presupuesto con validez → PDF «sin validez fiscal»; aceptarlo; convertir en albarán; dos albaranes del mismo cliente → «Facturar» → una factura con líneas agrupadas por albarán; facturar de nuevo uno → `delivery_note_already_invoiced` con número de factura; anular la factura → el albarán vuelve a «pendiente»; convertir un anulado → rechazo; repetir conversión al mismo tipo → pide confirmación; consumo de cupo por tipo correcto.

**V10 · Recurrencias (US10, SC-008)** — integración con reloj inyectado: plantilla mensual «emitir y enviar» con inicio el 31 → 12 ciclos generan exactamente 12 facturas (último día en meses cortos), numeración correlativa, emails y avisos; reentregar cada mensaje → sin duplicados; simular caída de 3 días → recupera los ciclos sin duplicar; cliente archivado → borrador + aviso; bajar a Esencial → ciclos `skipped_plan`; volver a Pro → continúa en el siguiente ciclo futuro; pausar/editar/finalizar solo afecta al futuro.

### Incremento 4 — P4

**V11 · Recordatorios (US11)**: política «3 días antes, al vencer, cada 7 después, máx. 3»; avanzar reloj → envíos en las fechas exactas, uno por día como máximo, en el historial; registrar el pago → no hay más; cliente sin email → aviso en la factura y sin envío; cliente con recordatorios desactivados → nada.

**V12 · Conciliación (US12, SC-009)**: importar `tests/fixtures/bank/sample.n43` (20 movimientos) → previsualización y confirmación; ≥ 80 % de los ingresos con número de factura o importe único sugeridos correctamente; confirmar sugerencias → pagos registrados; casar un movimiento con dos facturas y una factura con dos movimientos; intentar asignar más del importe → rechazo; deshacer → pago eliminado; reimportar el mismo fichero y uno solapado → 0 movimientos nuevos; marcar «ignorar».

**V13 · Panel y tesorería (US13, SC-013)**: con el seed de 12 meses, cada cifra del panel en cada plan coincide al céntimo con una consulta de control sobre documentos y pagos (script de verificación en integración); gráfico 12 meses y top 5; tesorería con saldo del último extracto y cobros previstos a 30 días; la factura de prueba no aparece en nada.

**V14 · Asistente inicial (US14, SC-010)**: cuenta nueva → asistente «paso 1 de 5»; generar factura de prueba → PDF «EJEMPLO – sin validez», contador de cupo sin cambios, no aparece en listados ni exportaciones; cerrar a medias y volver → retoma en el paso pendiente e indica qué falta. Usabilidad ≥ 9/10.

### Incremento 5 — P5

**V15 · Asistente de IA (US15, SC-012)**: con MCP Inspector (`pnpx @modelcontextprotocol/inspector`) y con un cliente real (Claude), conectar a `/api/mcp` → consentimiento → conexión listada; pedir «crea una factura para el cliente X con 3 horas de consultoría» → borrador correcto (≥ 8/10 intentos); emitir → exige `confirm_action`; historial muestra «vía asistente de IA»; nombre ambiguo → devuelve opciones; revocar → la siguiente llamada falla; bajar de Pro → bloqueado; ráfaga > 60/min → limitado.

## Despliegue

Gates v1 sin cambios (Sentry, cifrado/TLS, R2 privado, alertas de gasto, PR aprobado con CI verde). Añadidos por incremento antes de desplegar: webhook de Stripe registrado en el entorno con su secreto; dominio de Factum verificado en Resend; cola `jobs` y DLQ creadas; cron `0 5 * * *` visible en el Worker; precios de Stripe sincronizados (`billing_price` no vacío). Smoke test post-deploy: Checkout en modo test en staging y recepción de un email con remitente Factum.
