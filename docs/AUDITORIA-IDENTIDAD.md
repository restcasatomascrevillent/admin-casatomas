# Identificación de la auditoría

Cada evento nuevo conserva `actor_label` y `actor_origin` en el servidor. El
usuario se resuelve por su UUID y su email se guarda en el evento. Si no hay una
sesión de usuario, se identifica la conexión API o SQL que ejecutó la acción.
Las cabeceras de actor solo se aceptan en conexiones `service_role`.

Las altas y bajas de usuarios crean un contexto breve antes de llamar a Auth.
Esto permite atribuir al administrador iniciador los permisos por defecto y
los borrados en cascada que ejecuta GoTrue con su propia conexión SQL. Si no se
puede preparar el contexto, la función rechaza la operación antes de modificar
el usuario. El contexto se elimina al terminar y caduca a los dos minutos.

Los históricos recuperan el email mediante el UUID del actor y otras entradas
que ya guardaban ese mismo UUID. Si no existe evidencia del autor, se conserva
la referencia individual del evento y la interfaz explica que el original no
guardó el autor. No se atribuye la acción al usuario afectado por el cambio ni
se inventa un responsable.

## Aplicación

Aplicar primero `20261007190000_audit_log_identidad_obligatoria.sql`, después
desplegar `admin-create-user`, `admin-delete-user` y `admin-set-super-admin`, y
por último el frontend. La migración presupone las dos migraciones anteriores
de auditoría (`20261007120000` y `20261007140000`).

El frontend lee los nuevos campos y su filtro de actor consulta `actor_label`.
Las funciones de alta/baja necesitan la RPC nueva; no desplegarlas antes del SQL.

Comprobación de datos después de aplicar:

```sql
select count(*) as identidades_vacias
from public.audit_log
where actor_label is null or btrim(actor_label) = '' or actor_origin is null;
-- Debe devolver 0.

select id, created_at, actor_label
from public.audit_log
where actor_origin = 'historico'
order by created_at desc;
-- Eventos anteriores cuyo autor no puede recuperarse de los datos existentes.
```

Pruebas del cliente y del ciclo de Auth:

```sh
npm test -- src/hooks/__tests__/useAuditLog.test.ts src/hooks/__tests__/audit-auth.test.ts src/pages/__tests__/SuperAdminAuditoria.test.tsx
```


## Limpieza completa y rechazo de operaciones sin identidad

La migración `20261007200000_audit_log_limpiar_y_exigir_identidad.sql` elimina
**todos** los registros de `audit_log`, incluidos los históricos, por petición
expresa del propietario. Se ejecuta después de la migración de identidad de
las 19:00. El bloqueo de la tabla, la validación y el borrado forman una única
transacción; el SQL final muestra los tres contadores de comprobación.

A partir de esa migración se cancela la operación original si no hay un UUID
de usuario existente, un proceso automático identificado por la conexión de
servicio o una cuenta SQL directa. Los procesos service_role deben indicar
`x-audit-source`; las tres funciones administrativas requieren además al
usuario iniciador. GoTrue no puede sustituir al iniciador por su cuenta de
sistema: el alta o la baja necesita el contexto que preparan las funciones ya
actualizadas. Esto también bloquea las altas/bajas de Auth realizadas fuera
del panel cuando no llevan contexto de auditoría. Las sesiones anónimas y las
sesiones sin UUID válido no pueden producir eventos.

La restricción de tabla prohíbe nuevos registros `historico`. Esta nueva
migración no requiere nuevos cambios de frontend ni de Edge Functions, pero
las funciones de la primera migración deben estar desplegadas.

## Cambios de permisos

Aplicar después `20261007210000_audit_log_cambios_permisos.sql`. Conceder,
modificar o retirar un acceso se registra como `actualizar`, aunque en SQL
se inserte o se elimine una fila de `user_permissions`. Los detalles incluyen
el estado efectivo anterior y posterior: una fila ausente equivale a no tener
acceso. Se conservan también las instantáneas originales y la identidad del actor.

Guardar permisos idénticos o actualizar únicamente marcas de tiempo no produce
un evento. El alta real de otras entidades sigue siendo `crear`. La migración
corrige la clasificación de los eventos de permisos existentes sin borrarlos
ni cambiar su autor, fecha o identificador. La validación estricta de identidad
de la migración anterior sigue vigente.

La lista de usuarios muestra el preset que coincide con los permisos actuales,
o «Acceso por permisos», y cuenta las secciones configurables con acceso y
edición. Solo un super admin tiene «Acceso completo». El rol base admin conserva
su capacidad de gestionar usuarios, indicada por separado. Al guardar se espera
a releer los permisos y, si procede, el nuevo rol antes de cerrar el diálogo.

## Cobertura de todo el panel

La migración `20261007220000_audit_log_panel_completo.sql` sustituye la lista de
13 tablas por la instalación sobre las tablas de negocio de `public`, además
de `auth.users` y `storage.objects`. Incluye reservas, espacios y asignaciones,
carta, menús, novedades, reseñas, facturas, productos, proveedores, cheques,
ecommerce, stock, newsletter, plantillas, configuración y sus documentos.
Un event trigger instala la auditoría en las nuevas tablas de negocio de
`public`; las particiones heredan el trigger de su tabla principal.

Se excluyen el propio rastro y su contexto, copias de respaldo y registros
derivados de historial, ocupación, límites de uso y métricas. El cambio de la
entidad original sí queda auditado. Las escrituras públicas anónimas de la web
no se atribuyen a un empleado; no son acciones del panel. Los 13 controles
sensibles iniciales siguen rechazando escrituras sin identidad.

Los triggers son transaccionales: si un cambio requiere un evento y no se
puede identificar su autor, también se rechaza el cambio. Cada evento conserva
el identificador del registro (incluidas claves compuestas), origen, operación
SQL y estados anterior/posterior. Un guardado idéntico o solo de marcas de
tiempo no crea eventos. Una asignación/retirada de rol, acceso o mesa es un
cambio; la creación real del usuario o documento es una creación.

Las funciones del servidor utilizan `_shared/audit-client.ts`. El UUID se
resuelve verificando el token con Auth, nunca leyendo una cabecera de identidad
del llamante. Un contexto aislado por petición conserva usuario y request_id
en clientes compartidos y tareas en segundo plano. Las tareas automáticas
llevan el nombre concreto de la función como origen. Las integraciones de
servicio ajenas al repositorio también deben aportar `x-audit-source` y, si
actúan en nombre de un usuario, un `x-audit-actor-id` verificado por ellas.
Si no se puede verificar un token de usuario, se detiene la petición antes
de ejecutar el handler; nunca se sustituye ese usuario por un proceso.
La delegación de avisos de reservas conserva el JWT del iniciador, de modo
que los registros de envío y las acciones de correo mantienen su identidad.

Además de las mutaciones, las acciones externas iniciadas por un usuario
(correos, sincronización, traducción, publicación, consultas del asistente...)
tienen un evento `ejecutar`, con resultado completado/fallido. No se guarda el
cuerpo HTTP. Si su registro falla tras un efecto externo, se devuelve error y
se pide comprobar el resultado antes de repetir; un servicio externo y
Postgres no comparten transacción. No se presenta una acción fallida como un
cambio de datos exitoso.

El contexto de Auth admite cambios de credenciales y se fija antes de las
cascadas. Se registra que cambió la contraseña, sin guardar la contraseña ni
su hash. Otros secretos, tokens, claves y binarios base64 se ocultan también
en objetos anidados. Login/logout esperan a registrar el acceso mientras el
token sigue disponible; un fallo se comunica, sin descartarlo en segundo plano.

### Activación de cobertura y accesos por dispositivo (8 de octubre)

**Publicar `main` no aplica estas migraciones ni despliega las funciones.**
La pantalla avisa mientras el registro completo no esté activo. El login
mantiene el comportamiento anterior hasta que `version_auditoria_panel()`
responda 2; en esa fase todavía no se recogen intentos fallidos ni sesiones
restauradas. No se anuncia una cobertura que el servidor no tenga.

Actualizar ambos repositorios a `main` y enlazarlos al proyecto existente
`jeamoczmbfsnwkfjxcyo`. No ejecutar de nuevo la migración de limpieza de las
20:00 ni aplicar indiscriminadamente todo el historial de migraciones.

1. Como `postgres`, ejecutar
   `supabase/migrations/20261007213000_audit_preparar_servidor.sql`.
   Prepara las columnas y RPC sin ampliar todavía los triggers.
   Presupone las migraciones de identidad, limpieza y permisos ya aplicadas.
2. Desde **adminpanelct** ejecutar `npx supabase functions deploy`, incluido
   el nuevo gateway `panel-auth` que aún no usa el frontend. Desde
   **casa-tomas-story**, desplegar las tres funciones compartidas de cheques:

   ```sh
   npx supabase functions deploy cheques-regalo-admin
   npx supabase functions deploy cheques-regalo-web
   npx supabase functions deploy stripe-webhook-cheques-regalo --no-verify-jwt
   ```

3. Ejecutar `supabase/migrations/20261007220000_audit_log_panel_completo.sql`.
4. Ejecutar `supabase/migrations/20261008080000_audit_accesos_dispositivos.sql`.
   Este último paso activa los accesos del nuevo frontend. Recargar el panel
   en las pestañas abiertas. Estas migraciones no eliminan registros.

Los handlers se actualizan antes de ampliar la cobertura para que ninguna
función siga escribiendo sin origen durante la transición. Integraciones
externas al código, como n8n, también deben enviar un `x-audit-source` concreto
y el iniciador verificado si actúan por un usuario. No se inventa ese iniciador.

Comprobaciones después de desplegar:

```sql
select public.version_auditoria_panel(); -- 2
select count(*) as sin_identidad from public.audit_log
where actor_label is null or btrim(actor_label)=''; -- 0
select accion, actor_origin, count(*) from public.audit_log
where tabla='accesos_panel' group by accion,actor_origin;
```

Desde dos navegadores/dispositivos: iniciar sesión con dos cuentas distintas,
fallar una contraseña, intentar un email inexistente y reabrir una sesión ya
iniciada. El super admin debe ver todos los casos, sus dispositivos y la hora.
Después crear, editar y eliminar una entidad, cambiar permisos y subir/borrar
un archivo. Un usuario normal no debe poder consultar `audit_log`.

### Qué identifica cada acceso

- El gateway `panel-auth` guarda el intento **antes** de comprobar credenciales.
  Completa la misma fila con éxito o fallo, sin duplicar intento y resultado.
  Si el proceso se interrumpe queda «Intento pendiente», no un éxito ficticio.
- Un intento fallido conserva el correo introducido y «identidad no verificada».
  Nunca se le asigna el UUID del dueño de ese correo, aunque la cuenta exista.
  El origen `intento` solo se permite en estos eventos desde el gateway.
- Accesos correctos y sesiones restauradas resuelven al usuario en Auth. El
  refresco del JWT no crea otro login; otra página/dispositivo sí registra acceso.
- Dispositivo significa instalación del navegador: UUID aleatorio en su
  almacenamiento local, sin fingerprinting. Borrarlo o usar modo privado puede
  crear otro ID. Navegador e IP son datos informativos de la petición, no pruebas
  de identidad de una persona. No se pueden recuperar datos que nunca se guardaron.
- La IP se conserva cuando la proporciona el transporte. No se guarda contraseña,
  hash, access token ni refresh token. La sesión se enlaza con su ID, no su token.
- El servidor limita a 30 intentos por IP/minuto; los rechazados también se ven.
  Un fallo al guardar el resultado no entrega tokens: se intenta revocar la
  sesión emitida y permanece el intento pendiente para investigación.
- El cierre conserva la solicitud antes de invalidar la sesión. Una caída de red
  o cerrar el navegador no equivale a un logout confirmado; no se inventa uno.
- Los efectos externos (como editar el prompt VAPI) indican su resultado y
  conservan al iniciador. VAPI marca expresamente que el resultado lo comunicó
  el cliente. Las operaciones SQL mantienen su rastro transaccional.
- Solo super admins leen el conjunto completo; no se filtra por el usuario o
  dispositivo actual. Hay paginación, búsqueda por usuario/UUID, dispositivo,
  acción y fechas (incluido el día final), y actualización cada 15 segundos.

### Verificación

```sh
npm run test:auditoria:db
npm test -- src/hooks/__tests__/audit-client.test.ts src/hooks/__tests__/audit-auth.test.ts src/hooks/__tests__/useAuth.auditoria.test.tsx src/hooks/__tests__/useAuditLog.test.ts src/hooks/__tests__/panel-auth.test.ts src/pages/__tests__/SuperAdminAuditoria.test.tsx
```

El banco de PostgreSQL usa PGlite en memoria: aplica las migraciones y comprueba
identidad, rechazo con rollback, clasificación, claves compuestas, archivos,
cascadas, secretos, acciones externas y tablas nuevas, sin conectar a producción.


## Activación verificada (8 de octubre de 2026)

Las funciones en producción incluyen el contexto de auditoría y las migraciones
`audit_log_panel_completo`, `audit_accesos_dispositivos` y
`audit_version_search_path` están aplicadas. La RPC de disponibilidad devuelve 2.
La cobertura pasó de 13 a 102 tablas, incluidos `auth.users` y `storage.objects`.
Los tres registros previos se conservaron y no hay registros sin identidad.

Se verificaron en producción, dentro de transacciones revertidas, los intentos
fallidos, accesos correctos, sesiones restauradas, dispositivos distintos y
protección frente a duplicados y accesos fabricados. Con el rol real
`authenticated`, un usuario normal no puede leer la auditoría; el superadmin
consulta todos los registros. No quedaron entradas de prueba. El gateway
responde y la publicación del frontend en Vercel finalizó correctamente.

Recargar las pestañas abiertas para utilizar el frontend actualizado. Los
intentos anteriores que nunca se registraron no se reconstruyen ni se inventan.
