# Informe de usabilidad V13 (SC-001, SC-005)

**Estado: PLANTILLA — sin resultados.** Las celdas `…` se rellenan con datos reales de
las sesiones. No hay ningún resultado registrado todavía (T130 pendiente).

Protocolo de referencia: `spec.md` § «Protocolo de validación de usabilidad» y
`quickstart.md` § V13.

## Criterios de aceptación

| Criterio | Umbral | Resultado | ¿Cumple? |
|---|---|---|---|
| SC-001: mediana de tiempo (solo sesiones autónomas completadas) | < 10 min | … | … |
| SC-005: participantes que emiten su primera factura sin ayuda | ≥ 9 de 10 | … / … | … |

## Datos de la sesión

- Entorno: `https://factum.sinergia-hub.com` (versión del Worker: …)
- Fechas de las sesiones: … a …
- Facilitador: …
- Participantes totales: … (mínimo 10)

## Resultados por participante (anonimizado)

No se guardan nombres, correos ni datos fiscales reales. Usa identificadores `P01…P10`.

| ID | Perfil (autónomo / pyme / sector) | Dispositivo | Minutos hasta PDF descargado | ¿Autónoma? (sí/no) | ¿Abandono? (sí/no, en qué paso) | Bloqueos observados |
|---|---|---|---|---|---|---|
| P01 | … | … | … | … | … | … |
| P02 | … | … | … | … | … | … |
| P03 | … | … | … | … | … | … |
| P04 | … | … | … | … | … | … |
| P05 | … | … | … | … | … | … |
| P06 | … | … | … | … | … | … |
| P07 | … | … | … | … | … | … |
| P08 | … | … | … | … | … | … |
| P09 | … | … | … | … | … | … |
| P10 | … | … | … | … | … | … |

## Cálculo

- Sesiones autónomas completadas: …
- Mediana de minutos de esas sesiones: …
- Éxitos autónomos sobre el total de participantes: … / …

## Conclusión

… (cumple / no cumple SC-001 y SC-005)

## Hallazgos y mejoras

| # | Hallazgo (paso, participantes afectados) | Gravedad | Acción / tarea |
|---|---|---|---|
| 1 | … | … | … |

Si no se cumple algún criterio, abre tareas de mejora en `tasks.md` y repite la
prueba con participantes nuevos antes de cerrar T131.

---

# Guion del facilitador

## Antes de empezar

1. Reclutar 10 o más autónomos o responsables de pequeños negocios que **no** hayan
   usado Invoice Flash. Sesiones de unos 20 minutos.
2. Cada participante necesita un correo real al que tenga acceso (la cuenta exige
   verificación por email) y una contraseña propia. Si no quiere usar su correo
   personal, puede crear uno temporal.
3. Datos que escribirá el participante: usa datos ficticios o de prueba para la
   empresa y el cliente (NIF y dirección de cliente son obligatorios para emitir
   una factura). Avísale de que no hace falta introducir datos fiscales reales.
4. Comprueba antes de cada sesión que el entorno responde y que el registro está
   abierto. Prepara un cronómetro y una copia en blanco de la tabla.
5. Pide permiso para anotar tiempos y observaciones y explica que son anónimos.

## Qué le dices al participante (y nada más)

> «Vas a probar una aplicación de facturación. Tu objetivo es: registrarte,
> configurar tu empresa, crear una factura de dos líneas, emitirla y descargar el
> PDF. Hazlo como lo harías normalmente. No puedo ayudarte con cómo se usa; si te
> atascas, sigue intentándolo como harías solo. Puedes parar cuando quieras.»

Abre la pantalla de registro y **arranca el cronómetro en ese momento**.

## Durante la sesión

- No des ninguna indicación sobre navegación, qué datos introducir o los pasos de
  facturación. Cualquier ayuda de ese tipo hace que la sesión no sea autónoma.
- Solo puedes intervenir ante incidencias ajenas al producto (caída del entorno,
  correo que no llega por un problema técnico). Anótalas y repite la sesión si
  invalidan el resultado.
- Observa y anota en silencio: dónde duda, qué botón busca, qué error ve, a qué
  paso renuncia.
- **Para el cronómetro** cuando se complete la primera descarga del PDF.

## Qué anotar por sesión

1. Minutos y segundos hasta la descarga del PDF.
2. ¿Terminó sin ayuda? Si pidió o recibió ayuda, la sesión es «no autónoma».
3. Si abandonó: en qué paso (registro, verificación de email, empresa, cliente,
   líneas, emisión, PDF).
4. Bloqueos y comentarios, con la frase literal cuando sea útil.

## Después de cada sesión

- Pasa los datos a la tabla con el identificador `P0X`; no guardes el nombre.
- Elimina o desactiva la cuenta de prueba si el participante no quiere conservarla.
- No pegues correos, contraseñas ni datos de clientes en este informe.

## Al terminar las 10 sesiones

1. Calcula la mediana solo con las sesiones autónomas completadas, y los éxitos
   autónomos sobre todos los participantes.
2. Rellena «Cálculo», «Conclusión» y «Hallazgos».
3. Marca T130 como `[X]` en `tasks.md` y enlaza este informe desde
   `validation-report.md` (T131).
