# Copias de seguridad de la base de datos

El plan Free de Supabase **no hace copias automáticas**: solo las tienen los planes Pro y superiores. La propia Supabase recomienda que los proyectos gratuitos exporten sus datos con `supabase db dump` y los guarden fuera ([documentación](https://supabase.com/docs/guides/platform/backups)).

Por eso el workflow **«Copia de seguridad de la base de datos»** (`.github/workflows/copia-seguridad-bd.yml`) copia la base de datos de **producción** (`haqmmdfdzzatdnrrcgez`) **todas las noches** y la guarda **cifrada** en GitHub durante **14 días**.

## Qué guarda y qué no

| Sí | No |
|---|---|
| Todas las tablas y sus datos: reservas, cheques regalo, carta, facturas (los datos), usuarios del panel y permisos… | Los **ficheros** de Storage: fotos de la carta, fotos de novedades y PDF originales de facturas. Solo se guardan sus datos (nombre, ruta, tamaño). |
| Estructura: tablas, funciones, políticas de seguridad (RLS), triggers. | `vault.secrets`: está cifrado con la clave del proyecto y no sirve en otro. |
| Roles y el historial de migraciones. | Las colas internas de cron y de pg_net, que se regeneran solas. |

## Puesta en marcha (una vez, la hace el dueño)

1. En GitHub, en el repo **admin-casatomas**, entra en **Settings → Secrets and variables → Actions**.
2. Comprueba que existe **`SUPABASE_ACCESS_TOKEN`**. Es el token personal de la cuenta del restaurante que ya usa la migración. Si caducó, crea uno nuevo en https://supabase.com/dashboard/account/tokens y sustitúyelo.
3. Pulsa **New repository secret** y crea **`COPIA_SEGURIDAD_CLAVE`**: una frase larga, de 20 caracteres o más. **Guárdala también en tu gestor de contraseñas.** Sin ella las copias no se pueden abrir, ni siquiera por GitHub ni por Claude.
4. Prueba la copia: **Actions → Copia de seguridad de la base de datos → Run workflow**. Tarda unos minutos. Si sale en verde, en esa ejecución aparece un artefacto `casatomas-prod-AAAAMMDD-HHMM`.

A partir de ahí se ejecuta sola cada noche. Si falla, GitHub te avisa por correo.

## Cómo restaurar una copia

1. Descarga el artefacto desde la ejecución de Actions que quieras. Es un `.zip` que contiene `casatomas-prod-….tar.gz.gpg`.
2. Descífralo y descomprímelo:
   ```bash
   gpg --decrypt casatomas-prod-AAAAMMDD-HHMM.tar.gz.gpg > copia.tar.gz
   ```
   ```bash
   mkdir copia && tar -xzf copia.tar.gz -C copia
   ```
   `gpg` te pide la frase de `COPIA_SEGURIDAD_CLAVE`.
3. **Nunca restaures encima de producción sin hablarlo antes.** Lo normal es restaurar en un proyecto nuevo, o en la demo, y desde ahí recuperar lo que falte. Se cargan en este orden: `roles.sql`, `esquema.sql`, `datos.sql` y, si hace falta el historial, `historial_esquema.sql` y `historial_datos.sql`. Se hace con `psql` contra la conexión del proyecto de destino, siguiendo la guía de Supabase: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Límites que conviene saber

- GitHub guarda los artefactos 14 días y cuentan para el almacenamiento de Actions del plan gratuito. Una copia comprimida ocupa unos pocos MB, así que entra de sobra.
- Si algún día pasáis a **Supabase Pro**, Supabase hará además copias diarias propias con 7 días de historial y se podrán restaurar desde su panel. Este workflow puede seguir funcionando como copia fuera de Supabase.
- Los ficheros de Storage no van en la copia. Si se quieren guardar también, hay que añadir un paso que los descargue con la API de Storage (el script `copiar-storage.mjs` de la migración, en el repo de la web, sirve de base).
