-- ===========================================================================
-- ROLLBACK de supabase/migrations/20261001113700_configuracion_web_fotos_platos.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md). Se ejecuta A MANO
-- y solo para deshacer un despliegue que salio mal:
--   npx supabase db query --linked -f supabase/rollbacks/20261001113700_configuracion_web_fotos_platos_ROLLBACK.sql
--
-- ANTES: revertir el panel (useConfiguracionWeb + interruptores de TabCarta).
-- Si no, no se rompe nada grave: el hook detecta la tabla ausente (PGRST205)
-- y deja los interruptores deshabilitados con un aviso. Las webs NO hace falta
-- revertirlas: sin la tabla, su lectura falla y publican las fotos (lo de
-- siempre en el siguiente build).
--
-- QUE SE PIERDE: los dos interruptores. Sin la tabla, el navegador no puede
-- releer el valor y se queda con el que horneó el último build: si ese build
-- se hizo con las fotos APAGADAS, la web sigue sin fotos hasta el siguiente
-- deploy, y desde ahí vuelven a verse. Copia previa si hace falta:
--   select * from public.configuracion_web;
--
-- No toca Platos ni ninguna otra tabla. Sin CASCADE a proposito: si alguien
-- creo despues algo que dependa de la tabla, mejor que falle y se vea.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

drop trigger if exists trg_configuracion_web_touch on public.configuracion_web;
drop table if exists public.configuracion_web;
drop function if exists public.configuracion_web_touch();

commit;

-- VERIFICACION:
--   select to_regclass('public.configuracion_web');                       -- -> NULL
--   select count(*) from pg_proc where proname = 'configuracion_web_touch'; -- -> 0
