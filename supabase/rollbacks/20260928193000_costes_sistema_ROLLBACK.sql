-- ===========================================================================
-- ROLLBACK de migrations/20260928193000_costes_sistema.sql
--
-- ESTE FICHERO NO ES UNA MIGRACION. No devolverlo a supabase/migrations/:
-- la CLI lo indexaria como migracion y `supabase db push` lo ejecutaria en
-- orden alfabetico justo despues de la que revierte, creando y borrando las
-- cinco tablas en el mismo push. Se ejecuta A MANO (psql / SQL editor).
--
-- ---------------------------------------------------------------------------
-- AVISO 1 -- ESTE ROLLBACK SI BORRA DATOS, AL CONTRARIO QUE LOS DE RLS
-- ---------------------------------------------------------------------------
--
--   Los dos rollbacks anteriores (20260928120000, 20260928140000) solo tocan
--   politicas y privilegios: no hay nada que perder. ESTE NO.
--
--   `drop table public.ia_uso` borra TODA la contabilidad de consumo de IA
--   acumulada desde que se aplico la migracion. No esta en ningun otro sitio:
--   no hay agregado persistido (la vista `ia_uso_diario` se calcula al vuelo)
--   y el cron de retencion ya solo guarda 90 dias. Si se ejecuta esto con la
--   pantalla llevando un mes en produccion, ese mes de datos desaparece.
--
--   Lo mismo con `costes_fijos`: son los importes que alguien fue a mirar a
--   cinco facturas distintas a mano. Recuperarlos es volver a mirarlas.
--
--   POR ESO, ANTES DE EJECUTAR NADA DE AQUI, HACER COPIA:
--
--     create table public.zz_backup_ia_uso       as select * from public.ia_uso;
--     create table public.zz_backup_costes_fijos as select * from public.costes_fijos;
--     create table public.zz_backup_ia_precios   as select * from public.ia_precios;
--
--   O, mejor, sacarlo fuera de la base de datos:
--     \copy (select * from public.ia_uso)       to 'ia_uso.csv'       csv header
--     \copy (select * from public.costes_fijos) to 'costes_fijos.csv' csv header
--
--   Si lo que se quiere es solo "que la pantalla deje de verse", NO hace falta
--   este rollback: basta con quitar la ruta del frontend. Ver AVISO 3.
--
-- ---------------------------------------------------------------------------
-- AVISO 2 -- NO TOCA chat_web_uso, Y ESO IMPORTA
-- ---------------------------------------------------------------------------
--
--   `chat_web_uso`, `chat_web_config` y sus RPC (`chat_web_reservar_cupo`,
--   `chat_web_cerrar_uso`) son de la migracion 20260926121000 y este fichero
--   NO las toca. La unica relacion es que la vista `ia_uso_diario` los LEIA
--   con un UNION; borrar la vista no afecta a la tabla.
--
--   Consecuencia practica: despues de este rollback, chat-web SIGUE
--   contabilizando su consumo igual que antes, y sus topes de abuso siguen
--   funcionando. Lo unico que se pierde es la vista que los juntaba con los
--   demas.
--
-- ---------------------------------------------------------------------------
-- AVISO 3 -- HAY QUE REVERTIR EL FRONTEND ANTES, NO DESPUES
-- ---------------------------------------------------------------------------
--
--   La pantalla /super-admin/costes llama a 6 RPC. Borrarlas mientras la
--   pantalla siga desplegada la rompe con `PGRST202` ("function not found in
--   schema cache") en la primera carga — no un error entendible, un fallo
--   seco. Igual que paso con `asignar_mesas_reserva` en 20260926140000.
--
--   ORDEN CORRECTO:
--     1. Quitar la ruta y las entradas de menu del panel (App.tsx,
--        SuperAdminSidebar.tsx, SuperAdminPanel.tsx) y desplegar.
--     2. Ejecutar este fichero.
--
--   Al reves deja la pantalla viva sobre una base de datos sin las funciones.
--
-- ---------------------------------------------------------------------------
-- AVISO 4 -- LAS EDGE FUNCTIONS INSTRUMENTADAS
-- ---------------------------------------------------------------------------
--
--   `chat-facturas` y `format-novedad` llaman a `ia_registrar_uso` desde un
--   bloque `finally`. Borrar la RPC NO las rompe: el modulo
--   _shared/registrar-uso-ia.ts esta escrito para que un fallo de registro no
--   propague nunca (ver su cabecera). Lo que pasara es que cada peticion deje
--   un `console.error("[ia-uso] ...")` en los logs de Supabase.
--
--   Es ruido, no un fallo. Pero si el rollback es definitivo, conviene
--   deshacer tambien la instrumentacion de esas dos funciones y redesplegar,
--   o los logs se llenan. Se puede hacer con calma: nada esta roto mientras
--   tanto.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO SE PUEDE REVERTIR
-- ---------------------------------------------------------------------------
--
--   Nada del esquema: todo lo que crea la migracion es nuevo, asi que
--   borrarlo devuelve exactamente el estado anterior. No se modifica ninguna
--   tabla, funcion, vista ni politica preexistente, asi que no hay nada que
--   "restaurar a como estaba": solo hay que quitar lo añadido.
--
--   Lo unico irrecuperable son los DATOS del AVISO 1.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Vista. Antes que las tablas: depende de ia_uso y de chat_web_uso.
-- ---------------------------------------------------------------------------

drop view if exists public.ia_uso_diario;

-- ---------------------------------------------------------------------------
-- 2) Las 6 RPC. Con la firma completa: hay que borrar la que se creo, no una
--    que se le parezca. Si alguien cambio algun parametro, estos DROP no
--    encuentran nada y la funcion se queda viva — comprobarlo con la consulta
--    del final.
-- ---------------------------------------------------------------------------

drop function if exists public.ia_registrar_uso(text, text, integer, integer, integer, integer, integer, integer, text, text, text, integer);
drop function if exists public.ia_coste_serie(date, date, text);
drop function if exists public.ia_coste_por_funcion(date, date);
drop function if exists public.ia_coste_por_modelo(date, date);
drop function if exists public.ia_coste_mes();
drop function if exists public.ia_coste_alternativa(text, date, date);
drop function if exists public.ia_funciones_sin_registro(integer);

-- ---------------------------------------------------------------------------
-- 3) Trigger y su funcion. El trigger cae solo con la tabla, pero la funcion
--    no: se borra explicitamente para no dejar huerfana una funcion que no
--    usa nadie.
-- ---------------------------------------------------------------------------

drop trigger if exists trg_costes_fijos_actualizado on public.costes_fijos;
drop function if exists public.costes_fijos_marcar_actualizado();

-- ---------------------------------------------------------------------------
-- 4) Las 5 tablas.
--
--    ############  AQUI ES DONDE SE PIERDEN LOS DATOS  ############
--    Si no se ha hecho la copia del AVISO 1, este es el punto de no retorno.
--    ##############################################################
--
--    Sin CASCADE a proposito: si alguien creo despues una vista o una FK que
--    dependa de estas tablas, es mejor que el DROP falle y se vea, a que
--    CASCADE se lleve por delante algo que no es de esta migracion.
--    Las politicas, indices y constraints caen solos con cada tabla.
-- ---------------------------------------------------------------------------

drop table if exists public.ia_uso;
drop table if exists public.ia_coste_estimado;
drop table if exists public.costes_fijos;
drop table if exists public.ia_funciones;
-- ia_precios la ultima: ninguna FK apunta a ella (a proposito, para que un
-- modelo sin tarifa no impida registrar), pero es la que da sentido al resto.
drop table if exists public.ia_precios;

commit;

-- ---------------------------------------------------------------------------
-- 5) Cron de retencion. FUERA de la transaccion: cron.unschedule no es
--    transaccional y dejarlo dentro puede dejar el job colgado si el commit
--    falla. Mismo patron que usa la migracion al crearlo.
--
--    Si esto no se ejecuta, queda un job diario a las 3:25 haciendo DELETE
--    sobre una tabla que ya no existe: un error en el log de cron cada noche,
--    para siempre.
-- ---------------------------------------------------------------------------

select cron.unschedule('ia-uso-retencion') where exists (
  select 1 from cron.job where jobname = 'ia-uso-retencion'
);

-- ===========================================================================
-- VERIFICACION (a mano, despues). Contra el catalogo, no contra este SQL.
-- ===========================================================================
--
-- -- 1) Que no queda ninguna de las 5 tablas ni la vista:
-- select table_name, table_type
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name in ('ia_precios','ia_funciones','ia_uso','costes_fijos',
--                      'ia_coste_estimado','ia_uso_diario');
--   -- esperado: 0 filas.
--
-- -- 2) Que no queda ninguna de las 7 funciones (ni una con otra firma):
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and (p.proname like 'ia\_%' or p.proname = 'costes_fijos_marcar_actualizado')
-- order by p.proname;
--   -- esperado: 0 filas. Si sale alguna, es que se creo con una firma
--   -- distinta a la del DROP de arriba: borrarla a mano con esa firma.
--
-- -- 3) Que el cron ya no esta, y que el de chat-web SIGUE:
-- select jobname, schedule, active from cron.job
-- where jobname in ('ia-uso-retencion','chat-web-uso-retencion');
--   -- esperado: SOLO chat-web-uso-retencion, activo, a las 3:15.
--
-- -- 4) Que chat_web_uso no se ha tocado (AVISO 2):
-- select count(*) as filas,
--        min(created_at) as primera, max(created_at) as ultima
-- from public.chat_web_uso;
--   -- esperado: el mismo recuento que antes del rollback.
-- select proname from pg_proc
-- where proname in ('chat_web_reservar_cupo','chat_web_cerrar_uso');
--   -- esperado: las dos.
--
-- -- 5) Si se hizo copia, que sigue ahi:
-- select 'ia_uso' as t, count(*) from public.zz_backup_ia_uso
-- union all select 'costes_fijos', count(*) from public.zz_backup_costes_fijos;
--   -- Acordarse de BORRAR las zz_backup_* cuando ya no hagan falta, o se
--   -- quedan ahi para siempre sin RLS ninguna.
-- ---------------------------------------------------------------------------
