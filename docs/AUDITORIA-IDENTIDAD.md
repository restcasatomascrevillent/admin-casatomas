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
