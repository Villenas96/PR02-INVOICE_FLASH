<!--
Sync Impact Report
==================
Version change: (template) → 1.0.0
Modified principles: n/a (adopción inicial)
Added sections:
  - Core Principles (5): I. Calidad de Código, II. Escalabilidad por Diseño,
    III. Seguridad como Requisito, IV. Eficiencia de Costes, V. Experiencia UI/UX
  - Restricciones y Estándares Adicionales
  - Flujo de Desarrollo y Puertas de Calidad
  - Governance
Removed sections: ninguna (se reemplazaron todos los placeholders de la plantilla)
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ compatible (gate "Constitution Check"
    genérico; se rellena a partir de esta constitución en cada plan)
  - .specify/templates/spec-template.md ✅ compatible (sin referencias que actualizar)
  - .specify/templates/tasks-template.md ✅ compatible (sin referencias que actualizar)
  - .specify/templates/checklist-template.md ✅ compatible (sin referencias que actualizar)
Follow-up TODOs: ninguno
-->

# INVOICE FLASH Constitution

## Core Principles

### I. Calidad de Código (NO NEGOCIABLE)

Todo código incorporado al proyecto DEBE cumplir:

- **Legibilidad primero**: el código se escribe para ser leído. Nombres descriptivos,
  funciones cortas con una única responsabilidad, y sin abreviaturas crípticas.
- **Tipado estricto**: el código DEBE usar tipado estático o anotaciones de tipos
  completas donde el lenguaje lo permita; no se admite `any`/tipos dinámicos sin
  justificación documentada en el PR.
- **Linting y formato automatizados**: linter y formateador configurados en el repo y
  ejecutados en CI; un PR con errores de lint NO PUEDE fusionarse.
- **Pruebas obligatorias**: toda lógica de negocio nueva DEBE llegar acompañada de
  pruebas unitarias; los flujos críticos (facturación, cálculo de importes, estados de
  factura) DEBEN tener además pruebas de integración. La cobertura de los módulos de
  negocio no puede disminuir respecto a `main`.
- **Sin código muerto**: no se fusiona código comentado, features desactivadas sin
  flag documentado, ni dependencias sin uso.

Razón: la calidad no se recupera después; cada excepción se convierte en el estándar
de facto del siguiente PR.

### II. Escalabilidad por Diseño

- **Sin estado en el cómputo**: los servicios y handlers DEBEN ser stateless; todo
  estado persistente vive en la base de datos o en almacenamiento gestionado, nunca en
  memoria de proceso o disco local.
- **Trabajo pesado fuera de la petición**: operaciones de larga duración (OCR,
  generación de PDF, envíos masivos, importaciones) DEBEN ejecutarse de forma
  asíncrona mediante colas o jobs, nunca bloqueando la petición HTTP.
- **Paginación y límites por defecto**: toda API o consulta que devuelva colecciones
  DEBE paginar y aceptar límites; queda prohibido cargar tablas completas en memoria.
- **Índices y acceso a datos justificados**: cada consulta nueva sobre tablas con
  crecimiento esperado DEBE tener índice de soporte o justificación explícita; los
  patrones N+1 se consideran defectos bloqueantes en revisión.
- **Diseño para crecer 10x**: las decisiones de arquitectura se evalúan contra un
  escenario de 10 veces el volumen actual de facturas/usuarios; si la solución no
  sobrevive a ese escenario, DEBE documentarse el plan de migración.

Razón: un sistema de facturación crece con cada cliente; re-arquitecturar bajo carga
es mucho más caro que diseñar límites desde el inicio.

### III. Seguridad como Requisito (NO NEGOCIABLE)

- **Ningún secreto en el repositorio**: credenciales, claves API y certificados viven
  en gestores de secretos o variables de entorno; un secreto commiteado exige rotación
  inmediata.
- **Validación en el borde**: toda entrada externa (formularios, API, ficheros
  subidos, webhooks) DEBE validarse y sanearse en el servidor; la validación en
  cliente es solo UX, nunca control de seguridad.
- **Autorización explícita**: cada endpoint DEBE comprobar autenticación y
  autorización a nivel de recurso (una factura solo es visible por su propietario u
  organización); el acceso por defecto es denegado.
- **Datos sensibles protegidos**: datos fiscales y personales (NIF, IBAN, importes)
  DEBEN cifrarse en tránsito (TLS) y en reposo, y quedan excluidos de logs y mensajes
  de error.
- **Dependencias vigiladas**: escaneo automático de vulnerabilidades en CI;
  vulnerabilidades críticas o altas bloquean el despliegue hasta mitigarse.

Razón: una aplicación de facturas maneja datos fiscales y financieros; una fuga no es
un bug, es un incidente legal.

### IV. Eficiencia de Costes

- **Coste como criterio de diseño**: toda propuesta de infraestructura o servicio
  externo (OCR, LLM, email, almacenamiento) DEBE incluir una estimación de coste
  mensual a volumen actual y a 10x antes de aprobarse.
- **Preferencia por serverless/escalado a cero** para cargas intermitentes; los
  recursos siempre-encendidos requieren justificación.
- **Cachear antes que recomputar**: resultados caros (renders de PDF, respuestas de
  OCR/IA, agregaciones) DEBEN cachearse cuando la frescura lo permita; las llamadas a
  APIs de pago DEBEN deduplicarse y tener límites de gasto configurados.
- **Observabilidad de coste**: presupuestos y alertas de gasto configurados en el
  proveedor cloud desde el primer despliegue; una sorpresa en la factura se trata como
  incidente.
- **Borrar lo que no se usa**: entornos, recursos y datos huérfanos se eliminan; los
  entornos de prueba tienen caducidad definida.

Razón: los costes cloud crecen en silencio; controlarlos a posteriori significa pagar
la lección.

### V. Experiencia UI/UX

- **Flujos críticos sin fricción**: crear y enviar una factura DEBE poder completarse
  en el mínimo de pasos posible; cada paso adicional en un flujo crítico requiere
  justificación en la spec.
- **Feedback inmediato**: toda acción del usuario DEBE tener respuesta visible en
  menos de 100 ms (estado de carga, confirmación o error); nunca se deja al usuario
  ante una pantalla muda.
- **Errores accionables**: los mensajes de error DEBEN decir qué pasó y qué puede
  hacer el usuario, en lenguaje claro; los códigos técnicos van al log, no a la
  pantalla.
- **Accesibilidad**: la interfaz DEBE cumplir WCAG 2.1 AA (contraste, navegación por
  teclado, etiquetas en formularios); esto se verifica antes de fusionar cambios de UI.
- **Consistencia visual**: componentes, espaciados y tipografía provienen de un
  sistema de diseño único; no se introducen estilos ad-hoc por pantalla.
- **Responsive por defecto**: toda vista DEBE ser usable en móvil y escritorio; las
  vistas críticas se prueban en ambos antes de fusionar.

Razón: en una herramienta de facturación la confianza del usuario depende de que la
interfaz sea clara, rápida y predecible; una mala UX se traduce directamente en
errores de facturación.

## Restricciones y Estándares Adicionales

- **Idioma**: la documentación de producto y la UI se redactan en español; el código,
  identificadores y mensajes de commit en inglés.
- **Migraciones versionadas**: todo cambio de esquema de base de datos DEBE ir en una
  migración versionada, reversible y revisada; nunca cambios manuales en entornos.
- **Trazabilidad de facturas**: las operaciones sobre facturas (creación, edición,
  envío, anulación) DEBEN registrarse en un log de auditoría inmutable con actor y
  timestamp.
- **Observabilidad**: logging estructurado (JSON) con correlación por petición;
  errores no controlados se reportan a un sistema de tracking desde el primer
  despliegue.

## Flujo de Desarrollo y Puertas de Calidad

- **Spec antes de código**: toda feature sigue el flujo Spec-Kit
  (specify → plan → tasks → implement); no se implementa sin spec aprobada.
- **Constitution Check**: cada plan DEBE evaluar el diseño contra los cinco principios
  y registrar violaciones justificadas en "Complexity Tracking"; una violación sin
  justificación bloquea el plan.
- **Revisión obligatoria**: ningún cambio llega a `main` sin revisión; el revisor
  verifica explícitamente calidad (I), seguridad (III) y, en cambios de UI, el
  principio V.
- **CI como puerta**: lint, tipos, pruebas y escaneo de seguridad DEBEN pasar en verde
  antes de fusionar; no existen fusiones con CI en rojo "para arreglarlo después".

## Governance

- Esta constitución prevalece sobre cualquier otra práctica o convención del proyecto;
  en caso de conflicto entre un documento y la constitución, gana la constitución.
- **Enmiendas**: cualquier cambio se propone vía PR sobre este fichero, con
  justificación y análisis de impacto sobre plantillas y specs existentes; requiere
  aprobación del propietario del proyecto.
- **Versionado semántico**: MAJOR para eliminaciones o redefiniciones incompatibles de
  principios; MINOR para principios o secciones nuevas o ampliadas materialmente;
  PATCH para clarificaciones y correcciones de redacción.
- **Cumplimiento**: todo PR y toda revisión de plan DEBEN verificar conformidad con
  los principios; las excepciones se documentan con fecha y plan de resolución, y se
  revisan en cada nueva feature.

**Version**: 1.0.0 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-07-09
