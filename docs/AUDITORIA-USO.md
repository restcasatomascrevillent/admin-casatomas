# Auditoría legible y chat de facturas

La vista del superadmin consulta `audit_log_visible`, con las mismas políticas de acceso que `audit_log` (vista `security_invoker`). El histórico original no se borra. Se excluyen procesos internos de OCR, estadísticas, contadores y otros estados auxiliares. Los accesos con sesión y los intentos pendientes se consultan seleccionando su acción explícita.

Los registros muestran quién actuó, qué hizo y los datos relevantes. Los precios se muestran en euros, los booleanos como Sí/No y los cambios con su valor anterior y nuevo. UUID, navegador, sesión, petición y JSON quedan en «Detalles técnicos». Los filtros por acción específica, resultado y texto se aplican en SQL, antes de paginar, también en las vistas por día y por mes.

## IA de facturas

`chat-facturas` registra, en el servidor, la pregunta, respuesta, conversación, consultas realizadas por las herramientas, argumentos sanitizados, resultado, duración y tipos de adjuntos. El autor procede de la validación del JWT; no de un identificador enviado por el navegador. Regenerar una respuesta se identifica expresamente y no comparte el caché de una pregunta normal.

Se conservan los mensajes históricos ya auditados. Las nuevas preguntas y respuestas se agrupan en el evento del servidor para evitar duplicarlas como mutaciones SQL. Las altas y bajas de conversaciones siguen registrándose; los cambios automáticos del título o fecha no añaden ruido.

## Reversión

El botón aparece para carta, contenido, configuraciones compatibles, plantillas, borradores y ciertos permisos. Primero se obtiene una previsualización con una sesión real de superadmin. Para confirmar se vuelven a validar el correo y contraseña de la misma cuenta que inició sesión y se comprueba su pertenencia actual a `super_admins`.

El endpoint `auditoria-revertir` ejecuta la operación en el servidor. El navegador no puede llamar directamente a la RPC de restauración. La contraseña y los tokens de la validación no se guardan en auditoría ni se devuelven al navegador; la sesión de comprobación es aislada y se cierra al terminar. Se admiten cinco validaciones por usuario y minuto.

La operación bloquea el registro, comprueba que su estado coincida con el que dejó el evento y rechaza una reversión repetida o con cambios incompatibles. Al deshacer una creación, rechaza registros relacionados para evitar borrados en cascada. Se conservan los campos generados y los identificadores. La restauración y su nuevo evento de auditoría se confirman en una misma transacción.

No hay restauración automática de pagos, facturas emitidas, correos enviados, credenciales o bytes de archivos. Restaurar contenido no recupera un archivo que ya haya sido borrado. Las operaciones con secretos ocultos o datos insuficientes se rechazan.

## Verificación

- Vitest: identidad del usuario, registro del chat y sus herramientas, formateo, componentes y validación de reversión.
- `node scripts/verificar-auditoria.mjs`: prueba aislada en PGlite de actualizaciones, restauración de borrados, identidades generadas, conflictos, relaciones, permisos, límite de intentos, sanitización, histórico y eliminación del ruido.
- La migración y las funciones Edge deben estar desplegadas antes de publicar la interfaz. La migración del repositorio debe conservar el mismo número de versión que la aplicada en Supabase.
