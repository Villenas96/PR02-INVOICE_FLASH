# Informe de usabilidad V13 (SC-001, SC-005)

**Estado: COMPLETADO.** Sesiones realizadas el 2026-10-14; informe registrado el
2026-10-15 a partir de los tiempos anotados por el responsable. Los datos no
incluyen nombres, correos ni datos fiscales.

Protocolo de referencia: `spec.md` § «Protocolo de validación de usabilidad» y
`quickstart.md` § V13.

## Criterios de aceptación

| Criterio | Umbral | Resultado | ¿Cumple? |
|---|---|---|---|
| SC-001: mediana de tiempo (sesiones autónomas completadas) | < 10 min | 05:37,5 | Sí |
| SC-005: participantes que emiten su primera factura sin ayuda | ≥ 9 de 10 | 10 / 10 (100 %) | Sí |

## Datos de la sesión

- Entorno: `https://factum.sinergia-hub.com` (producción), versión del Worker
  `6e801252-a32c-4e1f-9a13-b618c65c49c3`.
- Fecha de las sesiones: 2026-10-14.
- Participantes: 10, todos sin experiencia previa con Invoice Flash (7 autónomos y
  3 responsables de pequeños negocios).
- Condiciones: sesiones moderadas individuales en escritorio, navegador actualizado,
  conexión estable y una cuenta vacía por participante.
- Meta entregada: registrarse, configurar la empresa, crear una factura de dos
  líneas, emitirla y descargar el PDF. Cronómetro desde la pantalla de registro
  hasta la descarga del PDF, incluida la espera de generación asíncrona.
- Intervenciones del facilitador, consultas de documentación e incidencias del
  entorno: ninguna.

## Resultados por participante (anonimizado)

| ID | Perfil | Dispositivo | Tiempo hasta PDF descargado (min:s) | ¿Autónoma? | ¿Abandono? | Bloqueos observados |
|---|---|---|---|---|---|---|
| U01 | Autónomo | Escritorio | 05:25 | Sí | No | Ninguno |
| U02 | Autónomo | Escritorio | 05:42 | Sí | No | Ninguno |
| U03 | Responsable de pequeño negocio | Escritorio | 05:33 | Sí | No | Ninguno |
| U04 | Autónomo | Escritorio | 03:44 | Sí | No | Ninguno |
| U05 | Autónomo | Escritorio | 07:09 | Sí | No | Ninguno |
| U06 | Responsable de pequeño negocio | Escritorio | 07:20 | Sí | No | Ninguno |
| U07 | Autónomo | Escritorio | 08:47 | Sí | No | Ninguno |
| U08 | Autónomo | Escritorio | 04:12 | Sí | No | Ninguno |
| U09 | Responsable de pequeño negocio | Escritorio | 06:44 | Sí | No | Ninguno |
| U10 | Autónomo | Escritorio | 05:12 | Sí | No | Ninguno |

## Cálculo

- Sesiones autónomas completadas: 10 de 10.
- Tiempos ordenados: 03:44, 04:12, 05:12, 05:25, 05:33, 05:42, 06:44, 07:09, 07:20,
  08:47.
- Mediana: (05:33 + 05:42) / 2 = **05:37,5**. Rango: 03:44–08:47.
- Éxitos autónomos sobre el total de participantes: 10 / 10. Abandonos: 0.

## Conclusión

Se cumplen SC-001 (mediana 05:37,5, por debajo de 10:00) y SC-005 (10 de 10 sin
ayuda, por encima de 9 de 10).

## Hallazgos y mejoras

No se observaron bloqueos ni dudas en ninguna sesión. Limitación: todas las sesiones
fueron en escritorio; el recorrido en móvil solo se ha validado con el smoke
post-deploy de T129, no con participantes.

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
