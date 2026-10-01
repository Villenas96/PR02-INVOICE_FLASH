# Feature Specification: Invoice Flash — Facturación sencilla para autónomos y pequeños negocios

**Feature Branch**: `001-invoice-flash`

**Created**: 2026-07-09

**Status**: Approved

**Approved**: 2026-07-30

**Input**: User description: "Invoice Flash es una app sencilla para autónomos y pequeños negocios que quieren crear facturas rápido, tener sus clientes ordenados y saber qué cobros están pendientes. La idea es evitar que la gente dependa de Word, Excel o plantillas sueltas para facturar. El usuario podrá configurar su empresa, guardar sus clientes, tener una lista de servicios o conceptos que suele facturar y crear documentos como facturas, proformas o recibos en pocos minutos. Después podrá descargar el PDF, compartir un enlace profesional con el cliente o enviarlo por email si su plan lo permite. Invoice Flash también ayudará a controlar los cobros. No debe ser un ERP, ni software contable complejo, ni herramienta de stock. Promesa: 'Factura rápido, organiza tus clientes y controla tus cobros sin montar un ERP.'"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configurar mi empresa y crear mi primera factura (Priority: P1)

Un autónomo se registra en Invoice Flash, completa los datos fiscales de su empresa (nombre o razón social, NIF, dirección, logotipo opcional), crea una factura añadiendo un cliente y una o varias líneas de concepto con precio e impuestos, y descarga el PDF con aspecto profesional listo para enviar. Todo el recorrido, desde cuenta nueva hasta PDF descargado, se completa en minutos y sin formación previa.

**Why this priority**: Es el núcleo de la promesa del producto ("factura rápido"). Sin esta capacidad no existe producto; con solo esta capacidad ya se sustituye a Word/Excel, que es el problema principal que se quiere resolver.

**Independent Test**: Puede probarse de forma completamente aislada: registrar una cuenta nueva, rellenar el perfil de empresa, crear una factura con cliente y líneas introducidos manualmente, y verificar que el PDF descargado contiene todos los datos fiscales obligatorios, numeración correcta y cálculos exactos.

**Acceptance Scenarios**:

1. **Given** una cuenta recién creada sin perfil de empresa, **When** el usuario intenta crear una factura, **Then** el sistema le guía primero a completar los datos mínimos de su empresa (nombre/razón social, NIF, dirección).
2. **Given** un perfil de empresa completo, **When** el usuario crea una factura con un cliente y dos líneas (cantidad, precio unitario, tipo de impuesto), **Then** el sistema calcula automáticamente base imponible, impuestos, retención (si aplica) y total, y asigna el siguiente número correlativo de la serie.
3. **Given** una factura creada, **When** el usuario pulsa "Descargar PDF", **Then** obtiene un PDF con los datos del emisor, del cliente, número y fecha de factura, líneas, desglose de impuestos y total.
4. **Given** una factura en edición con datos incompletos (sin cliente o sin líneas), **When** el usuario intenta emitirla, **Then** el sistema indica de forma clara qué falta y no la emite.

---

### User Story 2 - Controlar qué facturas están cobradas, pendientes o vencidas (Priority: P2)

El usuario consulta un panel donde ve de un vistazo sus facturas clasificadas por estado de cobro: pagadas, pendientes y vencidas. Puede registrar el pago de una factura (total o parcial) indicando fecha e importe, y el estado se actualiza automáticamente. Las facturas cuya fecha de vencimiento ha pasado sin pago completo se marcan como vencidas sin intervención del usuario.

**Why this priority**: "Controla tus cobros" es la segunda pata de la promesa y el principal dolor tras la propia emisión: saber quién debe dinero. Convierte la app de un generador de PDFs en una herramienta de gestión de cobros.

**Independent Test**: Con un conjunto de facturas emitidas (creadas con la funcionalidad P1), registrar pagos sobre algunas, dejar otras sin pagar con vencimiento pasado, y verificar que el listado y los totales por estado (pagado, pendiente, vencido) son correctos.

**Acceptance Scenarios**:

1. **Given** una factura emitida con fecha de vencimiento futura y sin pagos, **When** el usuario consulta el listado, **Then** la factura aparece como "Pendiente".
2. **Given** una factura pendiente, **When** el usuario registra un pago por el importe total, **Then** la factura pasa a estado "Pagada" y muestra la fecha de pago.
3. **Given** una factura pendiente cuya fecha de vencimiento ya pasó, **When** el usuario consulta el listado, **Then** la factura aparece como "Vencida" y destacada visualmente.
4. **Given** una factura con un pago parcial registrado, **When** el usuario consulta su detalle, **Then** ve el importe cobrado, el importe pendiente y el estado "Parcialmente pagada".
5. **Given** varias facturas en distintos estados, **When** el usuario abre el panel principal, **Then** ve los importes totales cobrado, pendiente y vencido del periodo seleccionado.

---

### User Story 3 - Gestionar mi cartera de clientes (Priority: P3)

El usuario mantiene una lista de clientes con sus datos fiscales y de contacto (nombre/razón social, NIF, dirección, email). Puede crear, buscar, editar y archivar clientes, y al crear un documento selecciona el cliente de la lista sin volver a teclear sus datos. Desde la ficha de un cliente ve su historial de documentos y qué le queda pendiente de pagar.

**Why this priority**: "Organiza tus clientes" es la tercera pata de la promesa. Acelera drásticamente la facturación recurrente, pero una factura puntual puede crearse con datos introducidos a mano, por eso va detrás de P1 y P2.

**Independent Test**: Crear varios clientes, buscarlos por nombre y NIF, editar uno, archivar otro, y crear una factura seleccionando un cliente existente verificando que sus datos se vuelcan automáticamente al documento.

**Acceptance Scenarios**:

1. **Given** la lista de clientes vacía, **When** el usuario crea un cliente con nombre, NIF y email, **Then** el cliente aparece en la lista y puede seleccionarse al crear documentos.
2. **Given** una lista con múltiples clientes, **When** el usuario busca por nombre o NIF, **Then** obtiene resultados coincidentes de forma inmediata.
3. **Given** un cliente con facturas emitidas, **When** el usuario abre su ficha, **Then** ve su historial de documentos y el importe pendiente de cobro de ese cliente.
4. **Given** un cliente con facturas asociadas, **When** el usuario lo archiva, **Then** el cliente deja de aparecer en las listas de selección pero sus facturas históricas se conservan intactas.
5. **Given** una factura ya emitida a un cliente, **When** el usuario edita los datos del cliente, **Then** la factura emitida conserva los datos con los que fue emitida.

---

### User Story 4 - Reutilizar servicios y conceptos habituales (Priority: P4)

El usuario guarda un catálogo de servicios o conceptos que factura con frecuencia (descripción, precio unitario, tipo de impuesto por defecto). Al crear un documento, añade líneas eligiendo del catálogo y solo ajusta cantidad o precio si hace falta.

**Why this priority**: Reduce aún más el tiempo de creación de facturas recurrentes, pero es una comodidad: sin catálogo, las líneas pueden escribirse a mano.

**Independent Test**: Crear varios conceptos en el catálogo, crear una factura añadiendo líneas desde el catálogo y verificar que descripción, precio e impuesto se rellenan automáticamente y son editables en la línea.

**Acceptance Scenarios**:

1. **Given** un catálogo con conceptos guardados, **When** el usuario añade una línea a un documento desde el catálogo, **Then** la descripción, el precio unitario y el impuesto por defecto se rellenan automáticamente.
2. **Given** una línea añadida desde el catálogo, **When** el usuario modifica precio o descripción en esa línea, **Then** el cambio afecta solo al documento, no al concepto guardado en el catálogo.
3. **Given** un concepto usado en facturas anteriores, **When** el usuario lo edita, **Then** los documentos ya emitidos no se ven alterados y el concepto continúa disponible en los selectores con sus valores actualizados para documentos nuevos.
4. **Given** un concepto usado en facturas anteriores, **When** el usuario lo archiva, **Then** deja de aparecer en los selectores, puede restaurarse y los documentos ya emitidos no se ven alterados.

---

### User Story 5 - Compartir el documento por enlace o email (Priority: P5)

Tras emitir un documento, el usuario puede compartirlo de tres formas: descargando el PDF, copiando un enlace público de aspecto profesional donde el cliente ve el documento sin necesidad de cuenta, o enviándolo por email directamente desde la app si su plan lo incluye.

**Why this priority**: Amplía la entrega más allá del PDF descargado (que ya cubre P1). El enlace y el email aportan imagen profesional y comodidad, pero no bloquean el flujo básico de facturar.

**Independent Test**: Emitir una factura, generar el enlace y abrirlo desde un navegador sin sesión verificando que se ve el documento; con un plan que lo permita, enviarla por email y verificar la recepción; con un plan que no lo permita, verificar que la opción aparece como característica de plan superior.

**Acceptance Scenarios**:

1. **Given** una factura emitida, **When** el usuario genera el enlace para compartir, **Then** cualquier persona con el enlace puede ver el documento y descargar su PDF sin iniciar sesión.
2. **Given** un enlace compartido, **When** el usuario lo desactiva, **Then** el enlace deja de mostrar el documento.
3. **Given** un usuario con plan que incluye envío por email, **When** envía la factura al email del cliente, **Then** el cliente recibe un email con el documento y el usuario ve constancia del envío en el historial del documento.
4. **Given** un usuario con plan sin envío por email, **When** intenta usar esa opción, **Then** el sistema se lo comunica con claridad y le ofrece las alternativas disponibles (PDF y enlace).

---

### User Story 6 - Crear proformas y recibos, y convertir proformas en facturas (Priority: P6)

Además de facturas, el usuario puede crear proformas (presupuestos/documentos previos sin validez fiscal) y generar recibos como justificantes de pagos registrados sobre facturas emitidas. Los recibos no se crean ni editan manualmente: cada uno corresponde a un pago concreto, total o parcial. Una proforma aceptada por el cliente puede convertirse en factura con un clic, heredando cliente y líneas y recibiendo numeración de factura.

**Why this priority**: Completa el ciclo comercial habitual de un autónomo (proforma → factura → recibo), pero el producto ya es viable emitiendo solo facturas.

**Independent Test**: Crear una proforma, verificar que usa su propia serie de numeración y se identifica claramente como "proforma" en el PDF, convertirla en factura y verificar que la factura resultante hereda los datos y recibe el siguiente número de la serie de facturas.

**Acceptance Scenarios**:

1. **Given** el editor de documentos, **When** el usuario crea una proforma, **Then** el documento se numera en la serie de proformas y su PDF se identifica claramente como proforma sin validez fiscal.
2. **Given** una proforma emitida, **When** el usuario la convierte en factura, **Then** se crea una factura con el mismo cliente y líneas, con el siguiente número de la serie de facturas, y la proforma queda vinculada y marcada como convertida.
3. **Given** una factura emitida con un pago registrado, total o parcial, **When** el usuario genera el recibo de ese pago, **Then** se crea como máximo un recibo para ese pago, con numeración propia, importe y fecha del pago, datos inmutables del emisor y del cliente, y referencia a la factura.

---

### Edge Cases

- **Numeración correlativa**: si dos facturas se crean casi simultáneamente, el sistema garantiza números únicos y correlativos sin duplicados ni huecos dentro de la serie.
- **Cambio de año**: al comenzar un nuevo año, el usuario puede iniciar una nueva serie anual (p. ej. 2027-001) sin romper la correlatividad de la serie anterior.
- **Cliente archivado o editado**: los documentos emitidos conservan una copia inmutable de los datos del cliente y del emisor tal como estaban en el momento de la emisión.
- **Factura emitida por error**: una factura emitida no puede eliminarse; puede anularse, quedando registrada como anulada y excluida de los totales de cobro.
- **Cliente sin datos fiscales**: al emitir una factura a un cliente sin NIF o sin dirección, el sistema indica qué dato falta y no la emite ni consume numeración ni cupo; una proforma a ese cliente sí puede emitirse y su PDF omite los datos ausentes. *(Aclarado el 2026-10-02 tras la prueba en staging.)*
- **PDF que no puede generarse**: si los datos guardados de un documento emitido impiden generar su PDF, el documento queda con el PDF marcado como fallido y un mensaje accionable (anular y emitir uno nuevo), en lugar de quedar indefinidamente "generando".
- **Importes y cantidades inválidos**: el sistema rechaza líneas con cantidad cero o negativa y precios negativos, explicando el motivo.
- **Impuestos mixtos**: un documento con líneas a distintos tipos de impuesto muestra el desglose por cada tipo en pantalla y en el PDF.
- **Pago superior al pendiente**: el sistema avisa si un pago registrado supera el importe pendiente de la factura y pide confirmación.
- **Recibo repetido**: si ya existe un recibo para un pago, repetir la acción devuelve el recibo existente y no consume otro número de la serie.
- **Enlace público de documento anulado**: si el documento se anula, el enlace público lo muestra claramente como anulado.
- **Vencimiento sin fecha**: si el usuario no indica fecha de vencimiento, se aplica el plazo por defecto configurado en su empresa (30 días si no lo cambia).
- **Límite del plan alcanzado**: el plan gratuito permite emitir 5 documentos por mes natural y el plan de pago 100. Al alcanzar el 80% se muestra un aviso no bloqueante; al alcanzar el límite se bloquea cualquier operación que vaya a crear un nuevo documento emitido —incluidas la conversión con emisión directa y la generación de un recibo— hasta el mes siguiente, sin afectar borradores, repeticiones idempotentes que devuelvan un documento existente ni el acceso a documentos ya creados.
- **Emisiones simultáneas en el límite**: si varias operaciones intentan emitir por distintas vías cuando quedan menos plazas que solicitudes, solo se crean tantos documentos como cupo disponible; las rechazadas no consumen numeración ni generan PDF o eventos.

## Requirements *(mandatory)*

### Functional Requirements

**Cuenta y perfil de empresa**

- **FR-001**: El sistema MUST permitir a un usuario registrarse, iniciar sesión y recuperar su contraseña.
- **FR-002**: El sistema MUST permitir configurar el perfil de empresa del emisor: nombre o razón social, NIF, dirección fiscal, email, teléfono opcional, logotipo opcional y preferencias de facturación (serie de numeración, plazo de vencimiento por defecto, tipo de impuesto por defecto, moneda).
- **FR-003**: El sistema MUST exigir los datos fiscales mínimos del emisor (nombre/razón social, NIF, dirección) antes de permitir emitir el primer documento.
- **FR-004**: Cada usuario MUST poder acceder únicamente a sus propios datos (empresa, clientes, documentos, pagos); todo acceso ajeno queda denegado.

**Clientes**

- **FR-005**: El sistema MUST permitir crear, ver, editar, buscar y archivar clientes con: nombre o razón social, NIF, dirección, email opcional, teléfono opcional y notas opcionales. NIF y dirección pueden guardarse vacíos, pero MUST estar informados para emitir una factura a ese cliente (no para una proforma); los formularios de cliente MUST indicarlo.
- **FR-006**: El sistema MUST permitir buscar clientes por nombre y por NIF con resultados inmediatos.
- **FR-007**: La ficha de cliente MUST mostrar su historial de documentos y el importe total pendiente de cobro de ese cliente.
- **FR-008**: Archivar un cliente MUST ocultarlo de las listas de selección sin afectar a sus documentos históricos, y MUST poder revertirse.

**Catálogo de servicios/conceptos**

- **FR-009**: El sistema MUST permitir crear, editar, buscar, archivar y restaurar conceptos del catálogo con: descripción, precio unitario y tipo de impuesto por defecto. Los conceptos archivados MUST ocultarse de los selectores sin alterar documentos existentes.
- **FR-010**: Al añadir una línea desde el catálogo, los valores MUST poder ajustarse en el documento sin modificar el concepto guardado.

**Documentos (facturas, proformas, recibos)**

- **FR-011**: El sistema MUST permitir crear borradores de facturas y proformas compuestos por: cliente, fecha de emisión, fecha de vencimiento (facturas), líneas (descripción, cantidad, precio unitario, tipo de impuesto, descuento opcional por línea) y notas opcionales. Los recibos MUST generarse exclusivamente desde un pago existente sobre una factura emitida, no admiten creación o edición manual de líneas y MUST ser únicos por pago.
- **FR-012**: Para facturas y proformas, el sistema MUST calcular automáticamente base imponible, desglose de impuestos por tipo, retención si el emisor la tiene configurada y total, con exactitud al céntimo. Para recibos, el total MUST coincidir exactamente con el importe del pago vinculado y no MUST aplicarse base imponible, impuestos ni retención.
- **FR-013**: El sistema MUST asignar numeración automática, única y correlativa por serie y por tipo de documento, sin duplicados ni huecos; el usuario MUST poder definir el prefijo y el número inicial de cada serie.
- **FR-014**: Las facturas y proformas MUST tener un estado de ciclo de vida: borrador (editable), emitido (inmutable en su contenido) y anulado. Los recibos se generan directamente como emitidos e inmutables. Ningún documento emitido puede eliminarse; solo puede anularse.
- **FR-015**: Los documentos emitidos MUST conservar una copia inmutable de los datos del emisor y del cliente en el momento de la emisión.
- **FR-016**: El sistema MUST permitir convertir una proforma en factura heredando cliente y líneas, asignando numeración de la serie de facturas y vinculando ambos documentos.
- **FR-017**: El sistema MUST permitir duplicar una factura o proforma existente como nuevo borrador; los recibos no pueden duplicarse porque siempre se derivan de un pago.
- **FR-018**: El sistema MUST registrar cada operación relevante sobre un documento (creación, emisión, envío, anulación, pagos) con actor y fecha, en un historial visible en el detalle del documento.

**Entrega y compartición**

- **FR-019**: El usuario MUST poder descargar cualquier documento emitido como PDF de aspecto profesional con los campos aplicables a su tipo. Facturas y proformas MUST incluir datos del emisor y del cliente, tipo y número, fechas, líneas, desglose de impuestos y total; las proformas MUST indicar que carecen de validez fiscal. Los recibos MUST incluir datos del emisor y del cliente, número propio, importe y fecha del pago y referencia a la factura original.
- **FR-020**: El usuario MUST poder generar un enlace público por documento que permita verlo y descargar su PDF sin cuenta; el enlace MUST poder desactivarse en cualquier momento y MUST ser imposible de adivinar.
- **FR-021**: Los usuarios cuyo plan lo incluya MUST poder enviar el documento por email al cliente desde la app, quedando constancia del envío en el historial del documento.
- **FR-022**: Cuando una función no esté incluida en el plan del usuario, el sistema MUST comunicarlo con claridad y ofrecer las alternativas disponibles, sin errores confusos.

**Cobros**

- **FR-023**: El usuario MUST poder registrar pagos sobre una factura emitida indicando importe, fecha y método opcional; se admiten pagos parciales y múltiples pagos por factura.
- **FR-024**: El sistema MUST derivar automáticamente el estado de cobro de cada factura: pendiente, parcialmente pagada, pagada o vencida (pendiente o parcial con vencimiento pasado); las facturas anuladas quedan excluidas de los estados de cobro.
- **FR-025**: El usuario MUST poder ver un panel con las facturas filtrables por estado de cobro, cliente y rango de fechas, con los importes totales cobrado, pendiente y vencido del periodo.
- **FR-026**: El usuario MUST poder corregir o eliminar un pago registrado por error, recalculándose el estado de la factura.

**Planes**

- **FR-027**: El sistema MUST soportar un plan gratuito, con 5 documentos emitidos por mes natural y sin envío por email, y un plan de pago, con 100 documentos emitidos por mes natural y envío por email. PDF y enlace compartible MUST estar disponibles en ambos planes. El mes natural se calcula en la zona `Europe/Madrid`; cuentan todos los documentos que hayan sido emitidos durante el mes, aunque después se anulen, y no cuentan los borradores. El límite MUST comprobarse de forma uniforme antes de cualquier operación que cree un nuevo documento emitido, incluidas la emisión convencional, la conversión de proforma con emisión directa y la generación de recibos; una repetición idempotente que devuelve un documento ya existente no consume cupo adicional ni queda bloqueada por haber alcanzado después el límite. Bajo solicitudes simultáneas, las operaciones que excedan el cupo disponible MUST rechazarse sin consumir numeración ni generar efectos secundarios. El sistema MUST mostrar en todo momento el plan, sus capacidades, el consumo mensual y el límite aplicable.

### Key Entities

- **Empresa (perfil del emisor)**: datos fiscales y de contacto del negocio del usuario, logotipo y preferencias de facturación (series, vencimiento por defecto, impuesto por defecto, moneda). Una por cuenta de usuario.
- **Cliente**: persona o negocio al que se factura; datos fiscales y de contacto, estado activo/archivado. Pertenece a una empresa; relacionado con sus documentos.
- **Concepto de catálogo**: servicio o producto habitual con descripción, precio unitario y tipo de impuesto por defecto. Pertenece a una empresa; sirve de plantilla para líneas de documento.
- **Documento**: factura, proforma o recibo. Tiene tipo, serie y número, fechas aplicables, estado de ciclo de vida (borrador/emitido/anulado) e instantánea inmutable de emisor y cliente al emitirse. Las facturas y proformas tienen cliente, líneas y totales calculados. Una proforma puede estar vinculada a la factura en que se convirtió; un recibo se genera ya emitido, se vincula a la factura y al pago único que justifica, y refleja el importe y la fecha de ese pago.
- **Línea de documento**: descripción, cantidad, precio unitario, tipo de impuesto y descuento opcional. Pertenece a un documento; puede originarse en un concepto de catálogo sin quedar acoplada a él.
- **Pago**: importe, fecha y método opcional, asociado a una factura. Una factura puede tener varios pagos; de la suma de pagos se deriva el estado de cobro. Cada pago puede tener como máximo un recibo.
- **Enlace público**: acceso de solo lectura a un documento emitido, activable y desactivable, no adivinable.
- **Plan**: nivel de suscripción del usuario que determina las capacidades disponibles. En v1, `gratuito` permite 5 documentos emitidos por mes natural sin email y `pago` permite 100 con email; ambos incluyen PDF y enlace.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En la prueba de usabilidad definida, la mediana de tiempo para completar registro → configuración de empresa → primera factura emitida y PDF descargado es inferior a 10 minutos, sin ayuda sobre el uso del producto.
- **SC-002**: Un usuario con empresa y clientes ya configurados crea y emite una factura nueva en menos de 2 minutos.
- **SC-003**: El 100% de las facturas y proformas emitidas presentan base, impuestos, retención y total exactos al céntimo; el 100% de los recibos coincide exactamente con el pago vinculado sin cálculos fiscales. Todos los documentos tienen numeración única y correlativa por serie, sin duplicados ni huecos.
- **SC-004**: El usuario identifica qué facturas están pagadas, pendientes y vencidas, y sus importes totales, en una sola pantalla y en menos de 10 segundos.
- **SC-005**: Al menos 9 de cada 10 participantes de la prueba de usabilidad emiten su primera factura sin recibir ayuda sobre el uso del producto ni consultar documentación adicional.
- **SC-006**: Un cliente final que recibe un enlace compartido visualiza el documento y descarga el PDF sin crear cuenta, en el primer intento, desde móvil o escritorio.
- **SC-007**: Los documentos emitidos permanecen íntegros e inalterados frente a ediciones o archivado posteriores de clientes, conceptos o datos de empresa en el 100% de los casos.

### Protocolo de validación de usabilidad

- Participan al menos 10 autónomos o responsables de pequeños negocios que no hayan utilizado antes Invoice Flash.
- Cada participante comienza con una cuenta vacía y recibe únicamente una descripción de la meta: registrarse, configurar su empresa, crear una factura de dos líneas, emitirla y descargar el PDF.
- El cronómetro comienza al mostrar la pantalla de registro y termina al completarse la primera descarga del PDF.
- La persona facilitadora solo puede resolver incidencias ajenas al producto, como una caída del entorno. Cualquier indicación sobre navegación, datos que introducir o pasos de facturación cuenta como ayuda y la sesión no se considera autónoma para SC-001/SC-005.
- Se registran de forma anonimizada el tiempo total, la finalización autónoma y el punto de abandono. SC-001 usa la mediana de tiempos de las sesiones completadas sin ayuda; SC-005 usa todos los participantes.

## Assumptions

- **Mercado y fiscalidad**: el producto se orienta inicialmente al mercado español: impuestos tipo IVA (con tipos configurables), retención tipo IRPF opcional configurada por el emisor, y moneda por defecto EUR (configurable). No se cubren otros regímenes fiscales en v1.
- **Cuenta unipersonal**: cada cuenta corresponde a un único usuario con una única empresa emisora. Equipos multiusuario y multiempresa quedan fuera del alcance de v1.
- **Planes**: los límites iniciales de v1 son 5 documentos emitidos por mes natural para el plan gratuito y 100 para el plan de pago. El periodo usa `Europe/Madrid`; emitir consume cupo de forma irreversible aunque el documento se anule. El precio comercial se decidirá fuera de esta spec. Cualquier cambio futuro de límites exige actualizar conjuntamente requisitos, pruebas y comunicación al usuario antes de entrar en vigor.
- **Facturas rectificativas**: la corrección formal mediante factura rectificativa queda fuera de v1; el mecanismo disponible es anular y emitir una nueva factura.
- **Sin integraciones externas**: no hay conexión con pasarelas de pago, bancos, software contable ni presentación de impuestos en v1. El registro de pagos es manual.
- **Sin stock ni compras**: en línea con la visión declarada, no hay gestión de inventario, proveedores ni gastos.
- **Idioma**: la interfaz y los documentos generados se presentan en español en v1.
- **Facturación electrónica estructurada** (formatos legales tipo Facturae/Verifactu) queda fuera de v1; el PDF y el enlace son los formatos de entrega.
- **Plataforma**: aplicación web responsive usable desde móvil y escritorio; no hay apps nativas en v1.
