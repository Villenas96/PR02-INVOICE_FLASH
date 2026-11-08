# Feature Specification: Factum — Mejoras de producto v2

**Feature Branch**: `002-factum-improvements`

**Created**: 2026-10-15

**Status**: Approved (2026-10-20)

**Input**: User description: "Ya hemos completado el spec001 y quiero crear el segundo con todas las mejoras que hay en notas.md. Solo hay que hacer las que pongan mejoras a realizar." (35 mejoras de la sección «MEJORAS A REALIZAR» de `notas.md`; la sección «MEJORAS UI PARA MÁS ADELANTE» queda fuera de alcance).

**Base**: amplía y, donde se indica, modifica la especificación aprobada `specs/001-invoice-flash/spec.md`. Todo lo que esta spec no cambie explícitamente sigue vigente.

## Clarifications

### Session 2026-10-15

- Q: ¿A quién se dirige el producto? → A: Exclusivamente a autónomos. Se eliminan los roles de equipo (Administrador, Empleado, Contable); de la mejora 31 solo queda el acceso de solo lectura para la gestoría.
- Q: ¿Qué planes existen? → A: Tres: **Básico** (gratis, para probar y emitir las primeras facturas sin pagar), **Esencial** (autónomo que solo quiere facturar, con interfaz muy sencilla) y **Pro** (amplía límites y añade conciliación, recordatorios, recurrencias, MCP, gráficos, exportación avanzada, etc.).
- Q: ¿Qué ocurre al alcanzar el límite mensual? → A: Se mantiene el bloqueo de la v1, con invitación a mejorar de plan que permite pagar y continuar la acción en curso sin perder lo hecho.
- Q: ¿Presupuestos y albaranes en el plan Básico? → A: Sí. El cupo es **por tipo de documento**: Básico permite 5 documentos emitidos de cada tipo al mes.
- Q: ¿Cómo cuentan presupuestos y albaranes para el cupo? → A: Igual que el resto: cada tipo tiene su propio cupo mensual independiente.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correcciones de fluidez detectadas en el uso real (Priority: P1)

El autónomo utiliza la app sin encontrarse con los fallos detectados tras la v1: el banner de datos fiscales desaparece en cuanto guarda sus datos, el contador de documentos del mes se actualiza al emitir, el editor muestra el nombre del cliente seleccionado (no su identificador interno), el PDF no muestra «Notas. Sin notas.» cuando no hay notas ni incluye el email del cliente, y todos los correos que reciben él o sus clientes llegan con la marca y la dirección de remitente de Factum.

**Why this priority**: son defectos visibles en el flujo principal que restan confianza; su coste es bajo y su impacto alto. Mejoras de `notas.md`: 1, 3, 4, 7, 17, 27.

**Independent Test**: con una cuenta nueva (Básico), completar los datos fiscales, crear un borrador con cliente y emitirlo, verificando cada comportamiento sin recargar la página; los correos de verificación y recuperación se comprueban con esa cuenta y el envío de documento con una cuenta Esencial.

**Acceptance Scenarios**:

1. **Given** una cuenta nueva con el banner «completa tus datos fiscales» visible, **When** el usuario guarda datos fiscales completos, **Then** el banner desaparece inmediatamente sin recargar la página.
2. **Given** un contador que muestra «2 de 5 facturas este mes», **When** el usuario emite una factura, **Then** el contador muestra «3 de 5» inmediatamente sin recargar la página.
3. **Given** el editor de un borrador, **When** el usuario selecciona un cliente, **Then** ve el nombre o razón social del cliente (y su NIF si lo tiene), nunca un identificador interno.
4. **Given** un documento sin notas/observaciones, **When** se genera su PDF o su vista pública, **Then** no aparece ningún bloque de notas ni el texto «Sin notas».
5. **Given** un cliente con email, **When** se genera el PDF de una de sus facturas, **Then** el email del cliente no aparece en el documento.
6. **Given** cualquier correo enviado por la plataforma (envío de documento, recordatorio, verificación de cuenta, recuperación de contraseña, avisos), **When** el destinatario lo recibe, **Then** el remitente se identifica como Factum con una dirección del dominio de Factum y no aparece la marca «Invoice Flash».

---

### User Story 2 - Elegir plan, mejorar y gestionar la suscripción (Priority: P1)

El autónomo ve en todo momento qué plan tiene (Básico, Esencial o Pro), cuánto ha consumido de cada tipo de documento y qué incluye cada plan. Desde el contador, desde la entrada «Mejorar» y desde la página de planes puede contratar Esencial o Pro, pagar en línea y seguir trabajando al instante con los nuevos límites y funciones. Después gestiona su suscripción por sí mismo: cambiar de plan o periodicidad, actualizar el medio de pago, descargar las facturas de su suscripción y cancelar.

**Why this priority**: convierte el producto en un negocio sostenible; hoy no existe forma de pasar a un plan de pago y el límite solo bloquea. Mejoras: 2, 35.

**Independent Test**: con una cuenta en Básico, agotar las 5 facturas del mes, contratar Esencial desde la invitación con un medio de pago de prueba, emitir la factura que estaba bloqueada sin rehacerla, pasar a Pro (contratable desde el incremento 3) y comprobar que aparecen sus funciones; después cancelar y verificar el paso a Básico al final del periodo.

**Acceptance Scenarios**:

1. **Given** un usuario en Básico, **When** abre la página de planes, **Then** ve la comparativa de Básico, Esencial y Pro con precio, periodicidad (mensual/anual), límites por tipo de documento y funciones, con su plan actual señalado.
2. **Given** un usuario que ha consumido el 80 % de su cupo mensual de un tipo de documento, **When** mira el contador, **Then** ve un aviso no bloqueante con invitación a mejorar de plan.
3. **Given** un usuario en Básico que ya ha emitido 5 facturas este mes, **When** intenta emitir otra, **Then** la emisión se bloquea sin consumir numeración y se le invita a mejorar de plan; al completar el pago, puede emitir esa misma factura sin rehacerla.
4. **Given** el cupo de facturas agotado, **When** el usuario emite un presupuesto o un albarán con cupo disponible en su tipo, **Then** puede hacerlo: cada tipo de documento tiene su propio cupo.
5. **Given** un usuario que contrata un plan y completa el pago, **When** vuelve a la app, **Then** su plan, límites, funciones e interfaz se actualizan sin intervención manual ni recarga.
6. **Given** un usuario suscrito, **When** abre la gestión de su suscripción, **Then** puede cambiar de plan o periodicidad, actualizar el medio de pago, descargar sus facturas de suscripción y cancelar.
7. **Given** un usuario que cancela, **When** termina el periodo ya pagado, **Then** pasa a Básico conservando todos sus datos y documentos.
8. **Given** un cobro de renovación fallido, **When** el pago no se regulariza en el periodo de gracia, **Then** la cuenta pasa a Básico, se avisa al usuario antes y después, y no se pierde ningún dato.

---

### User Story 3 - Interfaz sencilla para quien solo quiere facturar (Priority: P1)

En los planes Básico y Esencial el autónomo trabaja con una interfaz mínima: al entrar ve su lista de facturas, un botón destacado «Nueva factura» y un resumen breve de cobrado, pendiente y vencido. Clientes y productos se crean y buscan desde la propia factura; presupuestos y albaranes están disponibles en «Nuevo ▾» sin ocupar sitio hasta que los usa; los ajustes caben en una sola página. Las funciones de Pro no aparecen en los menús: solo hay una entrada discreta «Mejorar a Pro». En Pro la interfaz es completa y el usuario puede volver a la sencilla si lo prefiere.

**Why this priority**: es la propuesta de valor del plan Esencial («factura y listo») y la primera impresión del plan Básico; sin ella, añadir 35 mejoras complicaría la app para el autónomo que no las necesita.

**Independent Test**: con una cuenta en Básico, verificar que la navegación solo muestra lo indicado y que se puede emitir una factura con cliente y producto nuevos sin salir del editor; cambiar a Pro y verificar la interfaz completa y la opción de volver a la sencilla.

**Acceptance Scenarios**:

1. **Given** un usuario en Básico o Esencial, **When** entra en la app, **Then** ve la lista de facturas, el botón «Nueva factura», un resumen de cobrado/pendiente/vencido y una navegación reducida (Facturas, Clientes, Productos, Ajustes y «Mejorar a Pro»), sin opciones de funciones de Pro.
2. **Given** el editor en la interfaz sencilla, **When** el usuario escribe un cliente o un producto que no existe, **Then** puede crearlo en el momento sin salir de la factura.
3. **Given** un usuario en interfaz sencilla que nunca ha creado un presupuesto, **When** abre «Nuevo ▾», **Then** puede crear factura, presupuesto o albarán; a partir de usar un tipo, sus documentos aparecen en la navegación.
4. **Given** un usuario en Básico o Esencial, **When** intenta acceder directamente a una función de Pro, **Then** ve una explicación breve de la función con invitación a mejorar, no un error.
5. **Given** un usuario en Pro, **When** activa «Interfaz sencilla» en sus ajustes, **Then** ve la interfaz reducida conservando el acceso a sus funciones Pro desde un menú «Más».
6. **Given** un usuario que baja de Pro a Esencial o Básico, **When** vuelve a entrar, **Then** ve la interfaz sencilla y sus datos de funciones Pro se conservan sin mostrarse.

---

### User Story 4 - Editor de documentos más ágil (Priority: P2)

Al crear un documento el usuario busca clientes, productos, series, impuestos y unidades escribiendo libremente; crea un producto nuevo en el catálogo sin salir del editor; cambia la serie del documento antes de emitirlo; edita o elimina borradores; duplica cualquier factura para reutilizarla; e imprime un documento con un clic. Al emitir su primera proforma, presupuesto o albarán ya tiene la serie creada con el mismo formato que la de facturas.

**Why this priority**: reduce directamente el tiempo de facturación, que es la promesa central. Mejoras: 6, 8, 9, 11, 13, 15, 24. Disponible en todos los planes.

**Independent Test**: crear un borrador buscando cliente y producto por texto, crear un producto nuevo desde la línea, cambiar la serie, guardar, editarlo, duplicarlo, eliminar el duplicado, emitir e imprimir; emitir una primera proforma sin configurar series.

**Acceptance Scenarios**:

1. **Given** cualquier selector con listas potencialmente largas (clientes, productos, series, tipos de impuesto, unidades, métodos de cobro), **When** el usuario escribe parte de un texto, **Then** la lista se filtra al instante y puede elegir con teclado o ratón; sigue pudiendo desplegar la lista completa sin escribir.
2. **Given** una línea del editor con un concepto escrito a mano que no existe en el catálogo, **When** el usuario elige «Guardar en catálogo», **Then** el producto se crea con su descripción, precio, impuesto y unidad, y la línea queda vinculada a él sin perder lo escrito.
3. **Given** un borrador, **When** el usuario cambia la serie en el editor, **Then** el borrador queda asociado a la nueva serie y, al emitirse, recibe el siguiente número de esa serie.
4. **Given** la lista de documentos o el detalle de un borrador, **When** el usuario elige editar o eliminar el borrador, **Then** puede hacerlo (eliminar pide confirmación); los documentos emitidos no ofrecen eliminar, solo anular.
5. **Given** una factura emitida, anulada o en borrador, **When** el usuario la duplica, **Then** se crea un borrador nuevo con el mismo cliente, líneas, impuestos, método de cobro y observaciones, con fechas recalculadas a hoy y sin número.
6. **Given** una empresa con serie de facturas «2026-» y sin serie de proformas, **When** el usuario emite su primera proforma, **Then** el sistema ha creado automáticamente una serie de proformas con el mismo formato (p. ej. «PRO-2026-») y la proforma se numera sin pedir configuración previa. Lo mismo aplica a presupuestos y albaranes.
7. **Given** el detalle de un documento emitido, **When** el usuario pulsa «Imprimir», **Then** se abre directamente el diálogo de impresión con la versión imprimible del documento.

---

### User Story 5 - Configuración de cobro e impuestos propia (Priority: P2)

El autónomo registra sus métodos de cobro (varias cuentas bancarias, Bizum, PayPal, efectivo, otros), marca uno por defecto y elige en cada factura cuál se muestra. También gestiona sus propios tipos de impuesto con nombre y porcentaje (p. ej. IGI 4,5 % en Andorra, IGIC en Canarias) además de los de IVA.

**Why this priority**: sin estos datos la factura no indica cómo pagar y no sirve a autónomos fuera del IVA peninsular. Mejoras: 5, 20. Disponible en todos los planes.

**Independent Test**: crear dos cuentas bancarias y un Bizum, marcar una por defecto, crear un impuesto «IGI 4,5 %», emitir una factura con ese impuesto y otra cuenta, y verificar cálculos y PDF.

**Acceptance Scenarios**:

1. **Given** la configuración, **When** el usuario añade un método de cobro tipo cuenta bancaria con titular, IBAN y BIC opcional, **Then** el sistema valida el formato del IBAN y lo guarda; puede añadir varios y marcar uno por defecto.
2. **Given** varios métodos de cobro, **When** el usuario crea una factura, **Then** se preselecciona el método por defecto y puede elegir otro o ninguno.
3. **Given** la configuración de impuestos, **When** el usuario crea un tipo «IGI» al 4,5 %, **Then** puede usarlo en productos y líneas, y los cálculos y desgloses muestran «IGI 4,5 %» con exactitud al céntimo.
4. **Given** un tipo de impuesto usado en documentos emitidos, **When** el usuario lo edita o archiva, **Then** los documentos emitidos conservan el nombre y porcentaje con que se emitieron.

---

### User Story 6 - Documento más profesional (Priority: P2)

Las facturas muestran el logotipo del autónomo y, si existe, el del cliente; al pie aparecen las fechas de vencimiento junto al método de cobro (p. ej. el IBAN del emisor) y un cuadro de observaciones cuando las hay. En Pro, cada documento puede descargarse también como hoja de cálculo.

**Why this priority**: la imagen del documento es lo que ve el cliente final. Mejoras: 14, 16, 18, 26. Diseño en todos los planes; hoja de cálculo por documento en Pro.

**Independent Test**: con logotipo de emisor y de cliente, cuenta bancaria por defecto y observaciones, emitir una factura y revisar PDF y vista pública; en Pro, descargar además la hoja de cálculo.

**Acceptance Scenarios**:

1. **Given** un emisor con logotipo, **When** se genera el PDF o la vista pública de cualquier documento, **Then** el logotipo aparece en la cabecera con proporciones correctas.
2. **Given** un cliente con logotipo, **When** se genera un documento para ese cliente, **Then** su logotipo aparece junto a sus datos en el documento y en su ficha.
3. **Given** una factura con vencimiento y método de cobro «cuenta bancaria», **When** se genera el PDF, **Then** al pie aparece un bloque de pago con fecha(s) de vencimiento, importe y datos de la cuenta (titular, IBAN, BIC).
4. **Given** una factura con observaciones, **When** se genera el PDF, **Then** aparecen en un cuadro «Observaciones» diferenciado; sin observaciones el cuadro no aparece.
5. **Given** un usuario Pro con un documento emitido, **When** elige «Descargar Excel», **Then** obtiene una hoja de cálculo con los datos del emisor y cliente, número, fechas, líneas (con unidad), desglose de impuestos, retención y total, cuyos importes coinciden exactamente con el PDF.

---

### User Story 7 - Clientes y catálogo más potentes (Priority: P3)

El usuario busca clientes por cualquier dato visible en la tabla, archiva y restaura clientes desde la lista o la ficha, añade el logotipo de cada cliente y define la unidad de medida de cada producto. En Pro, además, carga su catálogo de golpe importando un fichero CSV.

**Why this priority**: acelera el alta inicial y el día a día con carteras grandes. Mejoras: 10, 12, 16, 19, 21. Importación CSV en Pro; el resto en todos los planes.

**Independent Test**: buscar clientes por ciudad o email, archivar y restaurar uno desde la lista, asignar unidades a productos; en Pro, importar un CSV de 50 productos con algunas filas erróneas y revisar el informe.

**Acceptance Scenarios**:

1. **Given** una lista de clientes, **When** el usuario escribe en el buscador parte de cualquier dato mostrado en la tabla (nombre, NIF, email, teléfono, dirección, ciudad), **Then** aparecen los clientes coincidentes, sin distinguir mayúsculas ni acentos.
2. **Given** un cliente activo, **When** el usuario lo archiva desde la lista o la ficha, **Then** desaparece de la vista por defecto y de los selectores; un filtro «Archivados» permite verlo y restaurarlo.
3. **Given** el formulario de producto, **When** el usuario elige una unidad (unidad, hora, día, mes, kg, g, l, m, m², m³, km, servicio) o crea una propia, **Then** la unidad se propone al añadir el producto a un documento, es editable en la línea y aparece en el documento.
4. **Given** un usuario Pro con un fichero CSV de productos, **When** lo importa, **Then** ve una previsualización con la correspondencia de columnas, el número de filas válidas y los errores por fila, y confirma antes de crear nada.
5. **Given** un CSV con productos cuya descripción ya existe en el catálogo, **When** el usuario confirma la importación, **Then** elige entre omitir o actualizar los existentes, y recibe un resumen de creados, actualizados, omitidos y erróneos.

---

### User Story 8 - Exportar y compartir con la gestoría (Priority: P3)

En Esencial, el autónomo descarga con un clic el Excel del trimestre (o mes) y lo envía a su asesoría desde la app. En Pro, además, exporta eligiendo tipos, fechas, estado y cliente, descarga los PDF en un archivo comprimido, programa el envío automático mensual o trimestral a la asesoría y da a su gestoría acceso de solo lectura.

**Why this priority**: elimina la tarea más repetida al cerrar cada trimestre. Mejoras: 22, 23 y 31 (reducida a gestoría).

**Independent Test**: en Esencial, exportar el Excel del trimestre anterior y enviarlo a la asesoría; en Pro, exportar con filtros en Excel + PDF, programar envío trimestral y verificar la recepción en la fecha programada; invitar a una gestoría y comprobar que solo puede consultar y exportar.

**Acceptance Scenarios**:

1. **Given** un usuario Esencial o Pro, **When** elige «Exportar para mi gestoría» y un periodo (mes actual, mes anterior, trimestre actual, trimestre anterior, año), **Then** obtiene un Excel con una fila por documento: número, fecha, cliente, NIF, base por tipo de impuesto, cuota por tipo, retención, total y estado de cobro, con totales que cuadran.
2. **Given** un usuario Esencial o Pro con email de asesoría configurado, **When** pulsa «Enviar a mi asesoría» sobre un periodo, **Then** la asesoría recibe un email con un enlace de descarga caducable del paquete de ese periodo, y el envío queda registrado.
3. **Given** un usuario Pro, **When** exporta filtrando por tipos de documento, rango de fechas libre, estado y cliente, y elige Excel y/o PDF comprimidos, **Then** obtiene solo los documentos que cumplen los filtros.
4. **Given** una exportación de cientos de documentos, **When** el usuario la solicita, **Then** el sistema la prepara en segundo plano y le avisa cuando está lista, sin bloquear la app.
5. **Given** un usuario Pro con envío trimestral programado, **When** termina un trimestre, **Then** la asesoría recibe automáticamente el paquete del trimestre anterior.
6. **Given** un usuario Pro, **When** invita a su gestoría por email, **Then** la gestoría accede con su propia cuenta y solo puede consultar documentos, clientes y pagos y exportar, sin modificar nada; el autónomo puede retirarle el acceso en cualquier momento.
7. **Given** una persona de gestoría con acceso a varios autónomos, **When** cambia de empresa, **Then** solo ve los datos de la empresa activa.

---

### User Story 9 - Presupuestos y albaranes con conversión entre documentos (Priority: P3)

Además de facturas, proformas y recibos, el autónomo crea presupuestos y albaranes, y convierte un documento en otro con un clic: presupuesto → albarán, presupuesto → factura, presupuesto → proforma, albarán → factura (uno o varios albaranes del mismo cliente en una factura), proforma → factura. Los documentos quedan vinculados entre sí.

**Why this priority**: completa el ciclo comercial del autónomo que presupuesta o entrega material antes de facturar. Mejora: 25. Disponible en todos los planes, con cupo por tipo.

**Independent Test**: crear un presupuesto, marcarlo como aceptado, convertirlo en albarán, convertir dos albaranes del mismo cliente en una única factura y verificar vínculos, numeración, totales y consumo del cupo de cada tipo.

**Acceptance Scenarios**:

1. **Given** el editor, **When** el usuario crea un presupuesto, **Then** se numera en su propia serie, admite fecha de validez y su PDF se identifica como presupuesto sin validez fiscal.
2. **Given** un presupuesto emitido, **When** el usuario lo marca como aceptado o rechazado, **Then** el estado queda visible en listados y en el historial.
3. **Given** un presupuesto o albarán emitido, **When** el usuario elige «Convertir en…» y el tipo de destino, **Then** se crea un borrador (o documento emitido si así lo elige y tiene cupo en el tipo destino) con cliente y líneas heredados, vinculado al origen, y el origen queda marcado como convertido.
4. **Given** varios albaranes emitidos y no facturados del mismo cliente, **When** el usuario los selecciona y elige «Facturar», **Then** se crea una única factura con todas sus líneas agrupadas por albarán y todos quedan marcados como facturados.
5. **Given** un albarán ya facturado, **When** el usuario intenta facturarlo de nuevo, **Then** el sistema lo impide e indica la factura en la que ya está incluido.

---

### User Story 10 - Facturas recurrentes programadas (Priority: P3)

El usuario Pro configura una factura recurrente para un cliente (p. ej. cuota mensual de mantenimiento) indicando periodicidad (semanal, mensual, trimestral, semestral, anual o cada N días/semanas/meses), fecha de inicio, fin opcional y qué hacer en cada ciclo: crear borrador, emitir, o emitir y enviar por email. El sistema genera los documentos en su fecha sin intervención.

**Why this priority**: elimina trabajo repetitivo en autónomos con cuotas. Mejora: 28. Plan Pro.

**Independent Test**: crear una recurrencia mensual con emisión automática que empiece hoy, avanzar la fecha y verificar que se genera exactamente una factura por ciclo, con numeración correcta y aviso al usuario.

**Acceptance Scenarios**:

1. **Given** una plantilla recurrente mensual con inicio el día 1, **When** llega el día 1 de cada mes, **Then** se genera exactamente un documento para ese ciclo con las fechas del ciclo y la acción configurada.
2. **Given** una recurrencia configurada para «emitir y enviar», **When** se genera el documento, **Then** se emite con el siguiente número de la serie, se envía al email del cliente y el usuario recibe aviso.
3. **Given** una recurrencia activa, **When** el usuario la pausa, la reanuda, la edita o la finaliza, **Then** los cambios solo afectan a los ciclos futuros.
4. **Given** un ciclo en el que la emisión no es posible (cliente archivado o sin datos fiscales, plan sin la función), **When** llega la fecha, **Then** el sistema crea el documento como borrador o pausa la recurrencia según el caso, avisa al usuario del motivo y no se duplica en reintentos. Si el motivo es que el plan ya no incluye la función, el ciclo se omite (no se genera nada ni se recupera al volver a Pro) y se avisa una sola vez por recurrencia.

---

### User Story 11 - Recordatorios automáticos de pago (Priority: P4)

El usuario Pro activa recordatorios automáticos por email a sus clientes para facturas pendientes, configurando cuándo se envían (X días antes del vencimiento, el día del vencimiento y cada N días después, hasta un máximo). Puede desactivarlos por cliente o por factura.

**Why this priority**: mejora el cobro sin esfuerzo, pero depende de tener facturas y email operativos. Mejora: 30. Plan Pro.

**Independent Test**: configurar recordatorios (3 días antes, al vencer, cada 7 días después, máximo 3), emitir una factura con vencimiento cercano y verificar envíos, contenido y parada al registrar el pago.

**Acceptance Scenarios**:

1. **Given** recordatorios activos y una factura pendiente con email de cliente, **When** se cumple cada momento configurado, **Then** el cliente recibe un email con el importe pendiente, el vencimiento, el método de cobro y el enlace al documento, y queda registrado en el historial.
2. **Given** una factura que pasa a pagada o anulada, **When** llega el siguiente recordatorio programado, **Then** no se envía.
3. **Given** un cliente con recordatorios desactivados, **When** tiene facturas vencidas, **Then** no recibe recordatorios.
4. **Given** una factura cuyo cliente no tiene email, **When** tocaría enviar un recordatorio, **Then** no se envía y el usuario ve un aviso en la factura.

---

### User Story 12 - Conciliación bancaria (Priority: P4)

El usuario Pro importa los movimientos de su cuenta bancaria desde el fichero que descarga de su banco. En un apartado de conciliación ve, por un lado, las facturas pendientes de cobro y, por otro, los ingresos sin casar; el sistema propone coincidencias y el usuario las confirma. Al casar un movimiento con una factura se registra el pago automáticamente.

**Why this priority**: es la forma fiable de saber qué se ha cobrado de verdad, pero requiere el resto del flujo de cobros maduro. Mejora: 29. Plan Pro.

**Independent Test**: importar un extracto con 20 movimientos (algunos coinciden con facturas por importe y referencia), confirmar sugerencias, casar manualmente uno parcial, reimportar el mismo fichero y verificar que no se duplican movimientos.

**Acceptance Scenarios**:

1. **Given** una cuenta bancaria registrada en los métodos de cobro, **When** el usuario importa un extracto en un formato soportado, **Then** ve una previsualización y, al confirmar, los movimientos quedan asociados a esa cuenta; los ya importados se detectan y no se duplican.
2. **Given** movimientos de ingreso sin casar, **When** el usuario abre la conciliación, **Then** ve las coincidencias sugeridas con factura(s) por importe, número de factura en el concepto y nombre/NIF del cliente, ordenadas por confianza.
3. **Given** una sugerencia, **When** el usuario la confirma, **Then** se registra un pago en la factura con la fecha e importe del movimiento y ambos quedan conciliados.
4. **Given** un movimiento que cubre varias facturas o una factura cobrada en varios movimientos, **When** el usuario los casa manualmente, **Then** el sistema reparte los importes y actualiza el estado de cobro de cada factura.
5. **Given** un movimiento conciliado por error, **When** el usuario deshace la conciliación, **Then** se elimina el pago generado y factura y movimiento vuelven a estar pendientes.
6. **Given** un ingreso que no corresponde a ninguna factura, **When** el usuario lo marca como «ignorar», **Then** deja de aparecer entre los pendientes de casar.

---

### User Story 13 - Panel de resumen y tesorería (Priority: P4)

En Básico y Esencial el usuario ve un resumen sencillo (cobrado, pendiente y vencido del periodo). En Pro ve un panel completo con las métricas principales del periodo elegido (facturado, cobrado, pendiente, vencido, impuestos repercutidos), gráficos de evolución mensual y principales clientes, y un bloque de tesorería con el saldo del último extracto importado y los cobros previstos de los próximos 30 días.

**Why this priority**: da visión del negocio de un vistazo; aprovecha los datos que generan el resto de historias. Mejora: 32.

**Independent Test**: con datos de 12 meses, abrir el panel en cada plan, cambiar el periodo y comprobar que cada métrica y gráfico coincide con la suma de los documentos y pagos correspondientes.

**Acceptance Scenarios**:

1. **Given** un usuario en Básico o Esencial, **When** abre la pantalla principal, **Then** ve cobrado, pendiente y vencido del periodo seleccionado, coincidentes al céntimo con sus facturas.
2. **Given** un usuario Pro con documentos y pagos en varios meses, **When** abre el panel con un periodo (mes, trimestre, año o personalizado), **Then** ve facturado (base y total), cobrado, pendiente, vencido e impuestos repercutidos, coincidentes al céntimo con los documentos.
3. **Given** el panel Pro, **When** el usuario mira los gráficos, **Then** ve la facturación frente a cobros de los últimos 12 meses y los 5 clientes con mayor facturación del periodo.
4. **Given** un usuario Pro con extractos importados y facturas pendientes, **When** mira la tesorería, **Then** ve el último saldo conocido por cuenta con su fecha y los cobros previstos de los próximos 30 días según vencimientos.

---

### User Story 14 - Asistente de configuración inicial (Priority: P4)

Al registrarse, un asistente guía al autónomo paso a paso: datos fiscales, logotipo, método de cobro, serie de numeración y una factura de prueba de ejemplo para ver el resultado. Puede saltarse pasos y retomarlo después.

**Why this priority**: reduce el abandono en el primer uso. Mejora: 33. Todos los planes.

**Independent Test**: registrar una cuenta nueva, completar el asistente hasta generar la factura de prueba y verificar que no consume numeración ni cupo; repetir saltando pasos y retomando.

**Acceptance Scenarios**:

1. **Given** una cuenta recién registrada, **When** el usuario entra por primera vez, **Then** se le ofrece el asistente con indicación del progreso (paso X de N).
2. **Given** el paso de factura de prueba, **When** el usuario la genera, **Then** ve el PDF de ejemplo con sus datos marcado claramente como «EJEMPLO – sin validez», sin consumir numeración ni cupo ni aparecer en listados ni exportaciones.
3. **Given** un usuario que cierra el asistente a medias, **When** vuelve a la app, **Then** puede retomarlo desde el paso pendiente y la app indica qué falta para poder facturar.

---

### User Story 15 - Gestionar documentos desde mi asistente de IA (Priority: P5)

El usuario Pro conecta su asistente de IA (ChatGPT, Claude u otros compatibles con el estándar MCP) a su cuenta y, en lenguaje natural, consulta clientes y documentos, crea borradores, emite, registra pagos o pide un resumen de cobros. Puede revocar el acceso en cualquier momento.

**Why this priority**: diferencial innovador pero no imprescindible para facturar. Mejora: 34. Plan Pro.

**Independent Test**: conectar un asistente compatible, pedirle «crea una factura para el cliente X con 3 horas de consultoría», verificar el borrador creado, emitirlo tras confirmación, y revocar el acceso comprobando que deja de funcionar.

**Acceptance Scenarios**:

1. **Given** un usuario Pro en la configuración de integraciones, **When** conecta su asistente, **Then** autoriza explícitamente el acceso y la conexión aparece listada con fecha y último uso.
2. **Given** un asistente conectado, **When** el usuario le pide consultar o crear clientes, productos o borradores, **Then** las operaciones se realizan con las mismas validaciones y límites del plan que en la app.
3. **Given** una petición del asistente para emitir o anular un documento, **When** se ejecuta, **Then** se requiere confirmación explícita y el historial registra que la acción se hizo vía asistente de IA en nombre del usuario.
4. **Given** una conexión activa, **When** el usuario la revoca o deja de tener plan Pro, **Then** cualquier petición posterior de ese asistente queda denegada inmediatamente.

---

### Edge Cases

- **Datos actualizados sin recargar**: cualquier acción que cambie un dato visible en otra parte de la pantalla (banner de datos fiscales, contadores de cupo, plan, interfaz, estados de cobro) MUST reflejarse sin recargar la página.
- **Cupo por tipo**: agotar el cupo de un tipo no afecta a los demás; una conversión con emisión directa consume cupo del tipo destino y se bloquea si ese tipo está agotado (puede crearse como borrador); la generación de un recibo consume cupo de recibos.
- **Emisión bloqueada y mejora de plan**: el borrador bloqueado se conserva intacto durante el pago; si el pago falla o se abandona, el borrador sigue disponible y nada se ha numerado.
- **Factura de prueba del asistente**: nunca consume numeración, cupo ni aparece en listados, exportaciones, métricas ni conciliación.
- **Cambio de serie en borrador**: si la serie elegida se archiva antes de emitir, la emisión se bloquea con un mensaje accionable.
- **Creación automática de series**: si ya existe una serie con el prefijo que se generaría automáticamente, se crea una variante única y se informa al usuario; nunca se reutiliza una serie de otro tipo de documento.
- **Eliminar borrador**: solo borradores; nunca consume ni libera numeración (los borradores no tienen número). Eliminar un borrador generado por una recurrencia no detiene la recurrencia.
- **Duplicar documento con datos obsoletos**: si el cliente, un producto o un impuesto están archivados, el duplicado se crea igualmente y se avisa de lo que hay que revisar antes de emitir.
- **Importación CSV**: ficheros con codificación distinta (UTF-8, Latin-1), separador `;` o `,`, decimales con coma, precios negativos, columnas obligatorias ausentes o más de 5.000 filas: se informa por fila o se rechaza con un mensaje accionable; no se crea nada hasta confirmar.
- **IBAN inválido**: se rechaza con indicación del error; IBAN y datos bancarios nunca aparecen en mensajes de error ni registros técnicos.
- **Impuestos con decimales**: porcentajes con hasta 2 decimales (4,5 %, 0,5 %); el redondeo se aplica a la cuota por tipo y al total, exacto al céntimo y consistente en pantalla, PDF, Excel y exportaciones.
- **Logotipos**: formatos o tamaños no admitidos se rechazan con mensaje claro; un logotipo con proporciones extremas se ajusta sin deformarse; cambiar un logotipo no altera los documentos ya emitidos.
- **Conversión de documentos**: un documento anulado no puede convertirse; no se permiten ciclos (una factura no se convierte en presupuesto); convertir dos veces el mismo origen al mismo tipo requiere confirmación.
- **Recurrencias**: fechas inexistentes (día 31 en meses cortos) se generan el último día del mes; si el sistema no pudo generar un ciclo a tiempo, lo genera al recuperarse sin duplicar; finalizar una recurrencia no afecta a lo ya generado.
- **Recordatorios**: nunca más de un recordatorio por factura y día; nunca a clientes sin email; se detienen al pagar o anular.
- **Conciliación**: reimportar el mismo extracto o extractos solapados no duplica movimientos; los movimientos de cargo (salidas) se importan para el saldo pero no se proponen para casar con facturas; un movimiento no puede casarse por más de su importe.
- **Suscripción**: pagos duplicados o avisos del procesador de pagos repetidos o desordenados no generan cambios de plan dobles; una cuenta nunca queda en un plan de pago sin cobro confirmado más allá del periodo de gracia.
- **Bajada de plan**: al bajar de Pro, las funciones Pro se desactivan sin borrar datos (los ciclos de recurrencia que caen durante la bajada se omiten, sin recuperarse al volver, con un único aviso por recurrencia; los recordatorios no se envían; el envío automático a la asesoría y el acceso de la gestoría se suspenden, las conexiones de IA se bloquean) y la interfaz pasa a sencilla; al bajar a Básico se desactiva además el envío por email. Al volver a mejorar todo se reactiva tal como estaba. Si el usuario ya ha emitido en el mes más documentos de un tipo que el nuevo límite, no puede emitir más de ese tipo hasta el mes siguiente.
- **Gestoría**: un acceso retirado pierde la sesión en esa empresa de inmediato; cualquier intento de modificar datos con rol de gestoría queda denegado; un intento de acceso a un recurso de otra empresa responde como inexistente.
- **Asistente de IA**: peticiones ambiguas (varios clientes coinciden) devuelven las opciones en lugar de elegir; un volumen anómalo de peticiones se limita.
- **Exportaciones y envíos a la asesoría**: un periodo sin documentos genera un aviso en lugar de un paquete vacío; los enlaces de descarga caducan.

## Requirements *(mandatory)*

### Functional Requirements

**Correcciones y marca (mejoras 1, 3, 4, 7, 17, 27)**

- **FR-001**: Todos los correos enviados por la plataforma MUST usar el nombre de remitente «Factum» y una dirección del dominio de Factum; ningún correo MUST mostrar la marca «Invoice Flash».
- **FR-002**: El banner de datos fiscales incompletos MUST desaparecer inmediatamente al guardar datos fiscales completos, sin recargar la página.
- **FR-003**: Los contadores de cupo MUST actualizarse inmediatamente tras cualquier operación que consuma cupo (emisión, conversión con emisión, recibo, recurrencia), sin recargar la página.
- **FR-004**: En ninguna pantalla MUST mostrarse un identificador interno en lugar de un dato legible; el cliente seleccionado se muestra por nombre o razón social y NIF.
- **FR-005**: Los documentos (PDF, vista pública, hoja de cálculo) MUST omitir el bloque de notas/observaciones cuando esté vacío.
- **FR-006**: Los documentos MUST NOT incluir el email del cliente.

**Planes y suscripción (mejoras 2, 35) — modifica FR-027 de la spec 001**

- **FR-007**: El sistema MUST ofrecer tres planes —**Básico** (gratuito), **Esencial** y **Pro**— y una página de planes con la comparativa de precio, periodicidad (mensual y anual), límites y funciones de cada uno, accesible desde el menú, los contadores, la entrada «Mejorar» y cualquier función reservada.
- **FR-008**: El cupo MUST contarse **por tipo de documento** (factura, proforma, recibo, presupuesto, albarán) y por mes natural, con las reglas de cómputo de la v1 (zona `Europe/Madrid`, cuentan los emitidos aunque se anulen, no cuentan borradores, repeticiones idempotentes no consumen, rechazo sin efectos bajo concurrencia). Límites: Básico 5 de cada tipo, Esencial 100 de cada tipo, Pro sin límite comercial (con un tope técnico de uso razonable de 1.000 de cada tipo al mes contra abusos).
- **FR-009**: Al 80 % del cupo de un tipo, el contador MUST mostrar un aviso no bloqueante con invitación a mejorar. Al 100 %, la emisión de ese tipo MUST bloquearse sin consumir numeración y MUST ofrecer mejorar de plan; tras confirmarse el pago, el usuario MUST poder completar la emisión bloqueada sin rehacer el documento.
- **FR-010**: El usuario MUST poder contratar Esencial o Pro con pago en línea; el cambio de plan MUST aplicarse automáticamente solo tras la confirmación del cobro.
- **FR-011**: El usuario MUST poder gestionar su suscripción por sí mismo: cambiar de plan y de periodicidad, actualizar el medio de pago, consultar y descargar las facturas de su suscripción y cancelar. La cancelación surte efecto al final del periodo pagado; un cobro de renovación fallido da un periodo de gracia de 7 días con avisos antes de pasar a Básico. Ningún cambio de plan MUST borrar datos.
- **FR-012**: Las funciones MUST asignarse a los planes según esta tabla:

  | Función (mejora) | Básico | Esencial | Pro |
  |---|:-:|:-:|:-:|
  | Facturas, proformas, recibos, presupuestos y albaranes con PDF individual y enlace público (25) | ✅ | ✅ | ✅ |
  | Mejoras del editor: buscadores, producto desde la línea, duplicar, editar/eliminar borradores, cambiar serie, series automáticas, imprimir (6, 8, 9, 11, 13, 15, 24) | ✅ | ✅ | ✅ |
  | Diseño del documento: logos, bloque de pago, observaciones, sin email de cliente (14, 16, 18, 27) | ✅ | ✅ | ✅ |
  | Métodos de cobro, impuestos propios, unidades, archivar y buscar clientes (5, 12, 19, 20, 21) | ✅ | ✅ | ✅ |
  | Conversión entre documentos (25) | ✅ | ✅ | ✅ |
  | Asistente de configuración inicial (33) | ✅ | ✅ | ✅ |
  | Resumen sencillo cobrado/pendiente/vencido (32) | ✅ | ✅ | ✅ |
  | Interfaz sencilla | ✅ | ✅ | Opcional |
  | Envío de documentos por email | — | ✅ | ✅ |
  | Excel del periodo para la gestoría y envío manual a la asesoría (22, 23) | — | ✅ | ✅ |
  | Exportación avanzada: filtros libres, PDF comprimidos, Excel por documento (22, 26) | — | — | ✅ |
  | Envío automático a la asesoría (23) | — | — | ✅ |
  | Acceso de solo lectura para la gestoría (31) | — | — | ✅ |
  | Importación de catálogo por CSV (10) | — | — | ✅ |
  | Facturas recurrentes (28) | — | — | ✅ |
  | Recordatorios de pago (30) | — | — | ✅ |
  | Conciliación bancaria (29) | — | — | ✅ |
  | Panel completo con gráficos y tesorería (32) | — | — | ✅ |
  | Conexión con asistentes de IA (34) | — | — | ✅ |

- **FR-013**: Los cambios de plan MUST ser idempotentes frente a notificaciones de pago repetidas o desordenadas y quedar registrados con fecha y origen. El acceso a cada función MUST comprobarse en el servidor según el plan vigente, no solo ocultarse en la interfaz.

**Interfaz sencilla**

- **FR-057**: En Básico y Esencial, la app MUST presentar la interfaz sencilla: pantalla principal con lista de facturas, acción destacada «Nueva factura» y resumen cobrado/pendiente/vencido; navegación reducida a Facturas, Clientes, Productos, Ajustes y «Mejorar a Pro»; ajustes en una sola página.
- **FR-058**: En la interfaz sencilla, las funciones de Pro MUST NOT aparecer en menús ni pantallas; el acceso directo a una de ellas MUST mostrar una explicación breve con invitación a mejorar, no un error.
- **FR-059**: Presupuestos, albaranes y proformas MUST estar disponibles desde «Nuevo ▾» y MUST aparecer en la navegación sencilla solo a partir del primer documento de ese tipo.
- **FR-060**: En Pro, la interfaz MUST ser completa por defecto y el usuario MUST poder activar la interfaz sencilla conservando el acceso a sus funciones Pro desde un menú «Más».

**Editor y documentos (mejoras 6, 8, 9, 11, 13, 15, 24)**

- **FR-014**: Todos los selectores de listas potencialmente largas (clientes, productos, series, tipos de impuesto, unidades, métodos de cobro) MUST permitir búsqueda por texto libre además de desplegar la lista, operables por teclado.
- **FR-015**: El usuario MUST poder crear un cliente o un producto del catálogo desde el editor sin abandonarlo.
- **FR-016**: El usuario MUST poder elegir y cambiar la serie de un borrador desde el editor entre las series activas de su tipo de documento.
- **FR-017**: El usuario MUST poder editar y eliminar borradores desde el listado y el detalle; eliminar MUST pedir confirmación. Los documentos emitidos MUST seguir sin poder eliminarse.
- **FR-018**: El usuario MUST poder duplicar facturas, proformas, presupuestos y albaranes (en cualquier estado) como borrador nuevo con fechas recalculadas, desde el listado y el detalle.
- **FR-019**: Cuando la empresa no tenga serie para un tipo de documento, el sistema MUST crearla automáticamente con el mismo formato que la serie de facturas (prefijo propio del tipo, mismo patrón de año y relleno) en el momento en que se necesite, sin pedir configuración.
- **FR-020**: El detalle de cualquier documento emitido MUST ofrecer «Imprimir», que abre el diálogo de impresión con la versión imprimible.

**Cobros e impuestos (mejoras 5, 20)**

- **FR-021**: El sistema MUST permitir gestionar métodos de cobro: cuenta bancaria (titular, IBAN validado, BIC opcional, alias), Bizum, PayPal, efectivo y «otro» con texto libre; activar, archivar y marcar uno por defecto.
- **FR-022**: Cada factura MUST poder llevar un método de cobro (preseleccionado el de defecto, modificable o ninguno), que queda congelado en el documento al emitirse.
- **FR-023**: El sistema MUST permitir gestionar tipos de impuesto con nombre y porcentaje (hasta 2 decimales), marcar uno por defecto y archivarlos; los documentos emitidos MUST conservar nombre y porcentaje con que se emitieron.

**Diseño y formatos del documento (mejoras 14, 16, 18, 26)**

- **FR-024**: Los documentos MUST mostrar el logotipo del emisor en la cabecera cuando exista.
- **FR-025**: El sistema MUST permitir subir un logotipo por cliente, visible en su ficha y en los documentos emitidos a ese cliente (congelado al emitir).
- **FR-026**: El diseño de factura MUST incluir al pie un bloque de pago con vencimiento(s), importe a pagar y datos del método de cobro (en cuentas bancarias: titular, IBAN y BIC), y un cuadro «Observaciones» cuando las haya.
- **FR-027**: Los usuarios Pro MUST poder descargar cualquier documento emitido en formato hoja de cálculo, con importes idénticos al PDF.

**Clientes y catálogo (mejoras 10, 12, 19, 21)**

- **FR-028**: La búsqueda de clientes MUST cubrir todos los datos mostrados en la tabla (nombre, NIF, email, teléfono, dirección, ciudad), sin distinguir mayúsculas ni acentos.
- **FR-029**: El usuario MUST poder archivar y restaurar clientes desde la lista y desde la ficha, con filtro para ver archivados.
- **FR-030**: Los productos y las líneas de documento MUST admitir unidad de medida, elegida de una lista predefinida o creada por el usuario; la unidad aparece en el documento.
- **FR-031**: Los usuarios Pro MUST poder importar productos desde CSV con plantilla descargable, correspondencia de columnas, previsualización, validación por fila, elección ante duplicados (omitir/actualizar) y resumen final; no se crea nada sin confirmación. Límite: 5.000 filas por fichero.

**Exportación y gestoría (mejoras 22, 23, 31)**

- **FR-032**: Los usuarios Esencial y Pro MUST poder descargar el Excel de un periodo predefinido (mes actual/anterior, trimestre actual/anterior, año) con una fila por documento y desglose fiscal, y enviarlo manualmente al email de su asesoría mediante un enlace caducable; cada envío queda registrado.
- **FR-033**: Los usuarios Pro MUST poder exportar filtrando por tipos de documento, rango de fechas libre, estado y cliente, en hoja de cálculo y/o archivo comprimido con los PDF. Las exportaciones grandes MUST prepararse en segundo plano con aviso al usuario y enlace caducable.
- **FR-034**: Los usuarios Pro MUST poder programar el envío automático del paquete a la asesoría con periodicidad mensual o trimestral.

**Presupuestos y albaranes (mejora 25)**

- **FR-035**: El sistema MUST soportar presupuestos (con fecha de validez y estados aceptado/rechazado) y albaranes como nuevos tipos de documento, con series propias, numeración correlativa al emitir e inmutabilidad tras la emisión, igual que el resto de documentos; ninguno de los dos tiene validez fiscal de factura y así lo indican.
- **FR-036**: El sistema MUST permitir convertir: presupuesto → proforma, albarán o factura; albarán → factura; proforma → factura; y agrupar varios albaranes no facturados del mismo cliente en una sola factura. Los documentos quedan vinculados en ambos sentidos y el origen marcado como convertido/facturado.
- **FR-037**: El sistema MUST impedir facturar dos veces un mismo albarán y convertir documentos anulados.

**Recurrencias (mejora 28) — Pro**

- **FR-038**: El usuario MUST poder crear plantillas recurrentes con cliente, líneas, serie, método de cobro, periodicidad (semanal, mensual, trimestral, semestral, anual o cada N días/semanas/meses), fecha de inicio, fin opcional (fecha o número de ciclos) y acción por ciclo (crear borrador, emitir, emitir y enviar).
- **FR-039**: El sistema MUST generar exactamente un documento por ciclo, aun ante reintentos o recuperación tras fallo, y avisar al usuario de cada generación y de cada ciclo que no pudo emitirse (que queda como borrador).
- **FR-040**: El usuario MUST poder pausar, reanudar, editar (solo afecta a ciclos futuros) y finalizar recurrencias, y ver los documentos generados por cada una.

**Recordatorios de pago (mejora 30) — Pro**

- **FR-041**: El usuario MUST poder configurar recordatorios automáticos por email de facturas pendientes: días antes del vencimiento, el día del vencimiento, cada N días tras vencer y número máximo; activables globalmente y desactivables por cliente y por factura.
- **FR-042**: Los recordatorios MUST detenerse al pagarse o anularse la factura, no MUST enviarse más de uno por factura y día, y cada envío MUST quedar en el historial del documento.

**Conciliación bancaria (mejora 29) — Pro**

- **FR-043**: El usuario MUST poder importar extractos bancarios en el formato estándar de la banca española (Norma 43) y en CSV/hoja de cálculo con correspondencia de columnas, asociados a una cuenta bancaria de sus métodos de cobro, sin duplicar movimientos ya importados.
- **FR-044**: El sistema MUST ofrecer un apartado de conciliación con facturas pendientes de cobro e ingresos pendientes de casar, y proponer coincidencias por importe, número de factura en el concepto y nombre/NIF del cliente.
- **FR-045**: Confirmar una conciliación MUST registrar el pago correspondiente en la factura; se admiten relaciones uno-a-varios en ambos sentidos; deshacer la conciliación MUST eliminar el pago generado; los movimientos pueden marcarse como ignorados.

**Panel de resumen (mejora 32)**

- **FR-046**: Todos los planes MUST mostrar el resumen de cobrado, pendiente y vencido del periodo. En Pro, el panel MUST mostrar además facturado (base y total) e impuestos repercutidos, gráfico de facturación frente a cobros de 12 meses, 5 principales clientes y tesorería (último saldo por cuenta con su fecha y cobros previstos a 30 días).
- **FR-047**: Todas las cifras del panel MUST coincidir al céntimo con los documentos y pagos subyacentes y excluir documentos anulados y la factura de prueba.

**Asistente de configuración (mejora 33)**

- **FR-048**: El sistema MUST ofrecer a las cuentas nuevas un asistente por pasos (datos fiscales, logotipo, método de cobro, serie, factura de prueba) con progreso visible, pasos omitibles y posibilidad de retomarlo.
- **FR-049**: La factura de prueba MUST generarse como ejemplo marcado «sin validez», sin numeración, sin consumir cupo y sin aparecer en listados, exportaciones, métricas ni conciliación.

**Acceso de la gestoría (mejora 31, reducida) — Pro**

- **FR-050**: El usuario Pro MUST poder invitar a su gestoría por email (invitación caducable a los 7 días) y retirarle el acceso en cualquier momento con efecto inmediato.
- **FR-051**: La gestoría MUST acceder con su propia cuenta y solo poder consultar documentos, clientes y pagos, descargar PDF y realizar exportaciones; cualquier modificación MUST denegarse.
- **FR-052**: Una persona de gestoría MUST poder tener acceso a varios autónomos y cambiar de empresa activa; todos los datos MUST limitarse a la empresa activa.
- **FR-053**: Las acciones de la gestoría (accesos y exportaciones) MUST registrarse con la persona que las realiza, visibles para el autónomo.

**Asistente de IA (mejora 34) — Pro**

- **FR-054**: El usuario MUST poder conectar asistentes de IA compatibles con el estándar MCP mediante autorización explícita, ver las conexiones activas con último uso y revocarlas con efecto inmediato.
- **FR-055**: El asistente MUST poder consultar clientes, productos, documentos y estados de cobro, crear clientes, productos y borradores, emitir, enviar y registrar pagos, siempre con las mismas validaciones y límites del plan que en la app.
- **FR-056**: Emitir o anular desde el asistente MUST requerir confirmación explícita, y el historial MUST indicar que la acción se realizó vía asistente de IA en nombre del usuario.

### Key Entities

- **Empresa** *(ampliada)*: la actividad del autónomo (una por cuenta). Añade logotipo usado en documentos, configuración de recordatorios, email y periodicidad de la asesoría, preferencia de interfaz y estado del asistente de configuración.
- **Plan**: Básico, Esencial o Pro; define límites por tipo de documento y funciones disponibles (tabla FR-012). Los precios son configurables sin desarrollo.
- **Suscripción**: plan, periodicidad, estado (activa, en gracia, cancelada al final del periodo), fechas del periodo, facturas de suscripción e historial de cambios.
- **Acceso de gestoría**: relación entre una persona de gestoría y una empresa, con invitación (email, caducidad) y estado (pendiente, activo, retirado, suspendido). Una persona de gestoría puede tener varios accesos.
- **Método de cobro**: tipo (cuenta bancaria, Bizum, PayPal, efectivo, otro), datos según tipo (IBAN y titular en cuentas), alias, por defecto, activo/archivado.
- **Tipo de impuesto**: nombre, porcentaje (2 decimales), por defecto, activo/archivado. Se congela en las líneas al emitir.
- **Unidad de medida**: nombre/abreviatura; predefinidas o propias del usuario.
- **Cliente** *(ampliado)*: añade logotipo y preferencia de recordatorios.
- **Producto de catálogo** *(ampliado)*: añade unidad de medida; puede originarse por importación CSV.
- **Documento** *(ampliado)*: nuevos tipos presupuesto y albarán; método de cobro, observaciones, unidad por línea, logotipos congelados al emitir; vínculos de conversión (origen–destino, varios albaranes → una factura); estado de presupuesto (aceptado/rechazado) y de albarán (facturado).
- **Serie** *(ampliada)*: se crea automáticamente por tipo de documento con el formato de la serie de facturas.
- **Plantilla recurrente**: cliente, líneas, serie, método de cobro, periodicidad, inicio, fin, acción por ciclo, estado (activa/pausada/finalizada) y documentos generados por ciclo.
- **Recordatorio enviado**: factura, fecha y resultado del envío.
- **Extracto y movimiento bancario**: cuenta bancaria, fecha, importe, concepto, saldo; estado (pendiente, conciliado, ignorado) y vínculos de conciliación con facturas y pagos.
- **Exportación / envío a asesoría**: filtros, formato, estado, enlace caducable, destinatario y fecha.
- **Conexión de asistente de IA**: usuario, fecha de autorización, último uso, estado (activa/revocada/suspendida).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los fallos reportados en las mejoras 3, 4, 7, 17 y 27 dejan de reproducirse, verificados con pruebas de extremo a extremo sin recargar la página.
- **SC-002**: Un usuario en Básico pasa de ver la invitación a mejorar a tener Esencial o Pro activo y completar la emisión bloqueada en menos de 3 minutos.
- **SC-003**: Un usuario con clientes y productos configurados crea y emite una factura nueva en menos de 90 segundos (mejora frente a los 2 minutos de la v1), localizando cliente y producto escribiendo texto.
- **SC-004**: En la interfaz sencilla, al menos 9 de cada 10 participantes de una prueba de usabilidad emiten una factura a un cliente y producto nuevos sin ayuda y sin salir del editor.
- **SC-005**: Un catálogo de 500 productos se importa desde CSV, incluida la revisión de errores, en menos de 5 minutos.
- **SC-006**: El Excel trimestral para la gestoría se obtiene o envía en menos de 1 minuto de trabajo del usuario (Esencial), o en cero si está programado (Pro).
- **SC-007**: El 100% de los importes en PDF, hoja de cálculo, exportaciones y panel coinciden al céntimo entre sí y con los documentos, incluidos impuestos con decimales.
- **SC-008**: Las recurrencias generan exactamente un documento por ciclo en el 100% de los casos (sin duplicados ni ciclos perdidos) en un periodo de prueba de 12 ciclos.
- **SC-009**: Al menos el 80% de los ingresos de un extracto que corresponden a facturas con número en el concepto o importe único se sugieren correctamente sin intervención manual.
- **SC-010**: Al menos 9 de cada 10 participantes de una prueba de usabilidad completan el asistente inicial y generan su factura de prueba sin ayuda.
- **SC-011**: En pruebas de permisos, el 100% de las funciones no incluidas en cada plan y de las modificaciones intentadas por una gestoría quedan denegadas, y ninguna persona accede a datos de una empresa a la que no tiene acceso.
- **SC-012**: Un usuario crea un borrador correcto desde su asistente de IA con una sola petición en lenguaje natural en al menos 8 de cada 10 intentos de prueba.
- **SC-013**: El usuario identifica cobrado, pendiente y vencido en menos de 10 segundos desde la pantalla principal en cualquier plan, y la previsión de cobros a 30 días desde el panel Pro.

## Assumptions

- **Público objetivo**: el producto se dirige exclusivamente a autónomos. Cada cuenta es una persona con una única actividad emisora; no hay equipos ni empleados. La única persona adicional con acceso es la gestoría (Pro), en solo lectura. Sustituye a la mejora 31 original (roles Administrador, Empleado, Contable y Gestoría).
- **Alcance**: incluye las 35 mejoras de «MEJORAS A REALIZAR» de `notas.md`. Quedan fuera las «MEJORAS UI PARA MÁS ADELANTE» (modo oscuro/claro, rediseño de interfaz y branding general, landing de Factum). Por ello la mejora 1 se limita a los correos; el resto de la interfaz puede seguir mostrando el nombre actual hasta el rediseño de marca. La interfaz sencilla (US3) es una reorganización de la navegación por plan, no el rediseño visual aplazado.
- **Trazabilidad**: mejora 1→US1/FR-001; 2→US2/FR-007–009; 3→FR-002; 4→FR-004; 5→US5/FR-021–022; 6→FR-015; 7→FR-003; 8→FR-014; 9→FR-018; 10→FR-031; 11→FR-017; 12→FR-029; 13→FR-016; 14→FR-024; 15→FR-019; 16→FR-025; 17→FR-005; 18→FR-026; 19→FR-028; 20→FR-023; 21→FR-030; 22→US8/FR-032–033; 23→US8/FR-032, FR-034; 24→FR-020; 25→US9/FR-035–037; 26→FR-027; 27→FR-006; 28→US10/FR-038–040; 29→US12/FR-043–045; 30→US11/FR-041–042; 31→US8/FR-050–053 (reducida); 32→US13/FR-046–047; 33→US14/FR-048–049; 34→US15/FR-054–056; 35→US2/FR-010–013. Planes e interfaz sencilla: US2, US3, FR-007–013, FR-057–060.
- **Funciones parcialmente existentes**: la v1 ya contempla duplicar documentos, archivar clientes y descartar borradores, pero en el uso real no resultan accesibles donde el usuario los busca. Esta spec exige que estén disponibles desde listado y detalle; la planificación debe auditar lo existente antes de reimplementar.
- **Migración de planes de la v1**: las cuentas en el plan `gratuito` de la v1 pasan a Básico y las del plan `pago` a Esencial, conservando sus límites efectivos o mejorándolos.
- **Cupo por tipo**: modifica la regla de la v1 (cupo único de documentos). El tope técnico de Pro (1.000 por tipo y mes) es una protección contra abusos, no un límite comercial anunciado.
- **Observaciones**: el campo «Notas» de la v1 pasa a mostrarse como «Observaciones» en el documento (mejoras 17 y 18); no se crea un segundo campo.
- **Presupuesto vs. proforma**: se mantienen ambos tipos. El presupuesto es una oferta con validez y aceptación; la proforma, un documento previo a la factura para anticipos o trámites.
- **Email**: Básico no incluye envío por email (regla de la v1); entrega con PDF o enlace. Las funciones que envían emails automáticos (recordatorios, recurrencias con envío, envío programado a la asesoría) son de Pro.
- **Pagos de la suscripción**: se usa un procesador de pagos externo con pago con tarjeta; los precios concretos se deciden fuera de esta spec (orientativos: Esencial 5–8 €/mes, Pro 12–15 €/mes, anual con 2 meses gratis) y deben poder cambiarse sin desarrollo. Los precios incluyen el IVA del 21 %, y para contratar se exigen NIF y dirección de facturación, de modo que las facturas de la suscripción son facturas válidas y deducibles para el autónomo. Clientes en Canarias, Ceuta y Melilla (sin IVA) quedan fuera de este primer alcance.
- **Conciliación**: se basa en ficheros descargados del banco; la conexión directa con bancos (agregadores/PSD2) queda fuera de alcance.
- **Mercado**: se mantiene la orientación a España, pero los impuestos configurables permiten operar con IGIC, IPSI o IGI (Andorra). Moneda por defecto EUR; multimoneda queda fuera de alcance.
- **Asistente de IA**: se usa el estándar abierto MCP, que es el que admiten los asistentes citados por el usuario; los costes de IA los asume el asistente del usuario, no la plataforma.
- **Formatos**: «Excel» se entiende como hoja de cálculo compatible con Excel; CSV para importación con plantilla descargable.
- **Facturación electrónica estructurada** (Facturae/Verifactu) sigue fuera de alcance.
- **Dependencias**: dominio de correo de Factum verificado para envío; cuenta en un procesador de pagos; la spec 001 implementada y en producción.
- **Comercialización de Pro**: Pro se muestra en la página de planes desde el incremento 1, pero solo se puede contratar desde el incremento 3, cuando ya existen exportación avanzada, gestoría, recurrencias e importación de catálogo. Hasta entonces aparece como «Próximamente», sin botón de compra, controlado por un flag documentado.
- **Volumen**: esta spec agrupa 35 mejoras; se espera que la planificación las entregue por incrementos según la prioridad de las historias (P1 → P5), cada una desplegable de forma independiente.
