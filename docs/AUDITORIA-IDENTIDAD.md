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

