-- ===========================================================================
-- ROLLBACK de supabase/migrations/20260927100000_mesas_numero_fiable.sql
-- ===========================================================================
--
-- Este fichero NO es una migracion y no debe copiarse a
-- supabase/migrations/ (ver supabase/rollbacks/README.md: dentro de
-- migrations/ la CLI lo indexaria como una migracion mas y `supabase db
-- push` lo ejecutaria en orden alfabetico justo despues de la migracion que
-- revierte -- `..._ROLLBACK.sql` ordena DESPUES de
-- `20260927100000_mesas_numero_fiable.sql`, asi que el indice unico se
-- crearia y se borraria en el mismo push). Se ejecuta A MANO (psql / SQL
-- editor) y solo para deshacer un despliegue que salio mal.
--
-- ---------------------------------------------------------------------------
-- QUE REVIERTE
-- ---------------------------------------------------------------------------
--   1. Borra el indice `public.uq_mesas_espacio_nombre_real`.
--   2. Devuelve `public.vista_capacidad_espacios`,
--      `public.fn_capacidad_efectiva_espacio(uuid)` y
--      `public.fn_capacidad_efectiva_marca(text)` a la version EXACTA de
--      `20260926120000_capacidad_efectiva_mesas.sql`: vuelven a sumar TODAS
--      las mesas activas, fusionadas incluidas, y sus `comment on ...`
--      vuelven a decir que no hay que excluir `is_merged`.
--
--   La vista se hace con DROP + CREATE, no con `create or replace`: la
--   version nueva tiene seis columnas MAS al final
--   (`plazas_mesas_fusionadas`, `plazas_mesas_todas`,
--   `plazas_mesas_sin_duplicar`, `mesas_reales`, `mesas_fusionadas`,
--   `mesas_originales_huerfanas`) y `create or replace view` sabe AÑADIR
--   columnas pero no QUITARLAS. Por eso hay que recuperar a mano, despues
--   del CREATE, el `security_invoker = on` y los grants: el DROP se los
--   lleva.
--
-- ---------------------------------------------------------------------------
-- *** LO QUE **NO** SE PUEDE REVERTIR: LOS NOMBRES DE LAS MESAS ***
-- ---------------------------------------------------------------------------
--   La migracion RENOMBRA filas de `public.mesas` (sufijo ` (revisar)`) y,
--   en el caso de un nombre de un solo caracter sin digitos y sin ningun
--   uso, ademas la DESACTIVA (`activa = false`). Eso son DATOS, y este
--   fichero NO los repone:
--
--     · El nombre original no esta guardado en ningun sitio. La migracion lo
--       deja por `raise notice` en la salida de `supabase db push` / del
--       editor SQL cuando se aplica -- si esa salida no se guardo, el nombre
--       original se sabe por la pantalla del dueño y por nada mas.
--     · Y aunque estuviera guardado, reponerlo a ciegas seria peor: puede
--       que el dueño ya haya resuelto esas mesas a mano (les haya dado su
--       numero de verdad) DESPUES de aplicar la migracion, y un UPDATE
--       automatico le pisaria el trabajo.
--
--   Asi que los nombres se reponen A MANO. Las dos consultas para
--   localizarlos estan al final de este fichero (son de solo lectura). No
--   hay ninguna fila borrada que recuperar: la migracion no hace ni un
--   DELETE, a proposito.
--
-- ---------------------------------------------------------------------------
-- *** AVISO 1: BORRAR EL INDICE REABRE EL BUG QUE EL DUEÑO QUISO CERRAR ***
-- ---------------------------------------------------------------------------
--   `uq_mesas_espacio_nombre_real` es la UNICA garantia de que dos mesas de
--   la misma sala no tengan el mismo numero. La pantalla avisa
--   (`nombreMesaDuplicado()` en `src/components/espacios/nombresMesa.ts`),
--   pero un aviso en el navegador no es una garantia: cualquier cosa que
--   escriba en `mesas` sin pasar por ese formulario (el editor de plano al
--   guardar, una RPC, un INSERT desde el editor SQL, otro cliente) puede
--   volver a meter dos mesas "9" en el Salon. Ese es EXACTAMENTE el estado
--   del que se venia el 2026-09-27.
--
--   Borrarlo no rompe nada al instante y no falla nunca: el problema
--   aparece semanas despues, cuando alguien asigna la mesa "9" equivocada.
--
-- ---------------------------------------------------------------------------
-- *** AVISO 2: SI LA REGLA DE AFORO POR MESAS ESTA ENCENDIDA ***
-- ---------------------------------------------------------------------------
--   Este rollback NO borra `fn_capacidad_efectiva_marca(text)`: la deja con
--   el cuerpo viejo. Asi que, al contrario que
--   `20260926120000_capacidad_efectiva_mesas_ROLLBACK.sql` (que la BORRA y
--   dejaria todas las reservas rotas con un `function does not exist`), aqui
--   no se rompe nada de golpe.
--
--   Lo que pasa es mas silencioso y por eso mas peligroso: si alguien
--   encendio la regla, el trigger `trg_validar_capacidad` llama a esa
--   funcion, y con el cuerpo viejo vuelve a sumar las mesas fusionadas junto
--   con las originales que el editor no consiguio borrar. El aforo se INFLA
--   (el Salon vuelve a declarar 64 plazas en vez de 36) y el sistema empieza
--   a aceptar reservas para sillas que no existen. No hay ningun error: solo
--   salas sobrevendidas.
--
--   COMPROBAR ANTES DE EJECUTAR (consulta 1 del final): si el trigger la
--   usa, revertir el trigger PRIMERO o asumir a sabiendas el aforo inflado.
--
--   A fecha 2026-09-27 la regla NO esta encendida: el trigger sigue sumando
--   `espacios_reserva.capacidad_maxima` y nadie llama a estas dos funciones.
--   Con la regla apagada, este rollback no cambia ni una sola reserva.
--
-- ---------------------------------------------------------------------------
-- SI LO QUE SE QUIERE ES QUE NO QUEDE NADA DE ESTO
-- ---------------------------------------------------------------------------
--   Este fichero deja la vista y las dos funciones EXISTIENDO, en su version
--   de `20260926120000`. Si lo que se busca es que no exista ninguno de los
--   tres objetos (por ejemplo porque se decide abandonar el enfoque de
--   capacidad por mesas), ejecutar DESPUES
--   `supabase/rollbacks/20260926120000_capacidad_efectiva_mesas_ROLLBACK.sql`,
--   leyendo su propio aviso critico antes.
--
--   Ojo con el caso raro pero posible: si `20260926120000` nunca se aplico y
--   la que se aplico fue solo `20260927100000` (que crea los tres objetos por
--   su cuenta, porque usa `create or replace`), este rollback los deja en una
--   version que no corresponde a ninguna migracion aplicada. Funciona igual
--   -- son objetos de solo lectura que no llama nadie -- pero conviene
--   saberlo, y en ese caso lo limpio es encadenar el rollback de
--   `20260926120000` a continuacion.
--
-- ---------------------------------------------------------------------------
-- QUE NO REVIERTE (ademas de los nombres)
-- ---------------------------------------------------------------------------
--   * El aforo, porque la migracion nunca lo cambio: `trg_validar_capacidad`
--     y `public.validar_capacidad_reserva()` quedan intactos y siguen
--     sumando `espacios_reserva.capacidad_maxima` (paso 1, tal como lo dejo
--     `20260922190000_aforo_por_marca.sql`).
--   * Nada de `EditorPlanoEspacio.tsx`: los dos `delete` que no comprueban su
--     error (dentro de `handleSave`, ~572 el de las mesas originales
--     absorbidas por una fusion y ~609 el de la fila fusionada al
--     desfusionar) siguen donde estaban, con migracion o sin ella.
--   * `mesas_pkey` ni ningun otro indice: solo se borra el que creo la
--     migracion.
--
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. El indice unico parcial
-- ---------------------------------------------------------------------------
--   LEER EL "AVISO 1" DE ARRIBA ANTES DE EJECUTAR ESTA LINEA: a partir de
--   aqui la base vuelve a aceptar dos mesas con el mismo numero en la misma
--   sala.
--
--   Sin `concurrently` (no puede ir dentro de una transaccion) y con
--   `if exists` para que sea idempotente.
drop index if exists public.uq_mesas_espacio_nombre_real;

-- ---------------------------------------------------------------------------
-- 2. La vista, a la version de 20260926120000 (copia literal)
-- ---------------------------------------------------------------------------
--   DROP + CREATE porque hay que QUITAR columnas (ver arriba). El `comment
--   on view` de abajo es tambien el literal de 20260926120000, incluida la
--   afirmacion de que no hay que excluir `is_merged` -- que es FALSA en
--   produccion (el borrado de las originales al fusionar puede fallar en
--   silencio), pero es lo que decia esa version y revertir es volver ahi.
--
--   UNICA DESVIACION del texto literal de 20260926120000, deliberada: la
--   referencia al codigo. Esa version citaba "EditorPlanoEspacio.tsx ~183" y
--   esa linea ya no es ese codigo -- era falsa. Aqui se cita el sitio real,
--   verificado sobre `main` el 2026-09-27: los dos `delete` de `handleSave`
--   (~572 el de las mesas originales absorbidas por una fusion y ~609 el de
--   la fila fusionada al desfusionar). Todo lo demas del comentario, incluido
--   el razonamiento equivocado, se restaura palabra por palabra. Se corrige
--   porque este texto acaba DENTRO de la base de datos y es la unica pista
--   que tendra quien lo lea dentro de seis meses.
drop view if exists public.vista_capacidad_espacios;

create view public.vista_capacidad_espacios
with (security_invoker = on)
as
select
  e.id                                                        as espacio_id,
  e.nombre                                                    as nombre,
  coalesce(e.caracteristicas->>'marca', 'casa_tomas')         as marca,
  e.activa                                                    as activa,

  -- La que MANDA HOY: lo que el trigger `trg_validar_capacidad` suma en su
  -- paso 1 (ver 20260922190000_aforo_por_marca.sql).
  e.capacidad_maxima                                          as capacidad_declarada,

  -- La capacidad efectiva "cableada pero dormida": lo que sientan las
  -- mesas del plano. Ver arriba por qué NO se excluye `is_merged`.
  coalesce(sum(m.capacidad) filter (where m.activa is not false), 0)::integer
                                                              as plazas_mesas,

  count(m.id) filter (where m.activa is not false)::integer    as mesas_activas,
  count(m.id)::integer                                         as mesas_totales,

  (coalesce(sum(m.capacidad) filter (where m.activa is not false), 0)
     - coalesce(e.capacidad_maxima, 0))::integer               as diferencia,

  (coalesce(sum(m.capacidad) filter (where m.activa is not false), 0)
     = coalesce(e.capacidad_maxima, 0))                        as cuadra

from public.espacios_reserva e
left join public.mesas m on m.espacio_id = e.id
group by
  e.id,
  e.nombre,
  e.caracteristicas,
  e.activa,
  e.capacidad_maxima;

comment on view public.vista_capacidad_espacios is
  'INFORMATIVA — no la usa el aforo. Compara, por espacio, la capacidad declarada (espacios_reserva.capacidad_maxima, la que MANDA HOY en trg_validar_capacidad) con la suma de plazas de las mesas activas del plano (capacidad efectiva, cableada pero dormida). Incluye espacios inactivos y espacios sin mesas (LEFT JOIN, plazas_mesas = 0). No se excluyen las mesas con is_merged porque el editor de plano BORRA las filas originales al fusionar (los dos delete de handleSave en EditorPlanoEspacio.tsx, ~572 y ~609): sumar todas las mesas activas no duplica plazas. Sirve para cuadrar cada espacio ANTES de encender la regla de capacidad efectiva.';

-- ---------------------------------------------------------------------------
-- 3. Las dos funciones, a la version de 20260926120000 (copia literal)
-- ---------------------------------------------------------------------------
--   `create or replace` basta: la firma y el tipo de retorno no cambian, y
--   asi no hay que volver a dar los grants (que un replace conserva). Aun
--   asi se repiten al final, por si este fichero se ejecuta sobre una base
--   donde las funciones no existian.
create or replace function public.fn_capacidad_efectiva_espacio(p_espacio_id uuid)
returns integer
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(sum(m.capacidad), 0)::integer
  from public.mesas m
  where m.espacio_id = p_espacio_id
    and m.activa is not false;
$$;

alter function public.fn_capacidad_efectiva_espacio(uuid) set search_path = 'public';

comment on function public.fn_capacidad_efectiva_espacio(uuid) is
  'INFORMATIVA — hoy no la llama el trigger de aforo. Suma la capacidad de las mesas activas (activa IS NOT FALSE) de un espacio; 0 si no tiene mesas o el uuid no existe. No excluye is_merged (el editor de plano borra las originales al fusionar). No filtra por espacios_reserva.activa a propósito: pregunta por el plano de ESE espacio.';

-- LEER EL "AVISO 2" DE ARRIBA ANTES DE EJECUTAR ESTO: si el trigger de aforo
-- ya llama a esta funcion, con el cuerpo viejo vuelve a inflar el aforo
-- (Salon: 64 plazas en vez de 36) sin dar ningun error.
create or replace function public.fn_capacidad_efectiva_marca(p_marca text)
returns integer
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(sum(m.capacidad), 0)::integer
  from public.espacios_reserva e
  join public.mesas m on m.espacio_id = e.id
  where e.activa = true
    and coalesce(e.caracteristicas->>'marca', 'casa_tomas') = coalesce(p_marca, 'casa_tomas')
    and m.activa is not false;
$$;

alter function public.fn_capacidad_efectiva_marca(text) set search_path = 'public';

comment on function public.fn_capacidad_efectiva_marca(text) is
  'INFORMATIVA HOY — el trigger trg_validar_capacidad NO la llama todavía (sigue sumando capacidad_maxima). Es el sustituto preparado del paso 1 de validar_capacidad_reserva(): suma las plazas de las mesas activas de todos los espacios ACTIVOS de una marca, con el mismo criterio exacto que el trigger (coalesce(caracteristicas->>marca, casa_tomas) por igualdad). Devuelve 0, nunca NULL: si una marca no tiene ninguna mesa cargada devuelve 0 y encenderla bloquearía el 100% de sus reservas. Ver el bloque "CÓMO ENCENDER LA REGLA" en 20260926120000_capacidad_efectiva_mesas.sql antes de usarla.';

-- ---------------------------------------------------------------------------
-- 4. Grants (el DROP de la vista se llevo los suyos)
-- ---------------------------------------------------------------------------
--   Mismo patron que 20260926120000: nunca a `public` ni a `anon`. Si la
--   vista se queda sin este bloque, nadie del panel puede leerla.
revoke all on public.vista_capacidad_espacios from public, anon;
grant select on public.vista_capacidad_espacios to authenticated, service_role;

revoke all on function public.fn_capacidad_efectiva_espacio(uuid) from public, anon;
grant execute on function public.fn_capacidad_efectiva_espacio(uuid) to authenticated, service_role;

revoke all on function public.fn_capacidad_efectiva_marca(text) from public, anon;
grant execute on function public.fn_capacidad_efectiva_marca(text) to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- COMPROBACION PREVIA (ejecutar ANTES del bloque de arriba; solo lectura)
-- ---------------------------------------------------------------------------
--   1) ¿Esta encendida la regla de aforo por mesas? (AVISO 2)
--      select pg_get_functiondef('public.validar_capacidad_reserva()'::regprocedure)
--             like '%fn_capacidad_efectiva_marca%' as la_usa_el_trigger;
--      -- FALSE -> adelante, este rollback no cambia ninguna reserva.
--      -- TRUE  -> PARAR. Con el cuerpo viejo el aforo se infla en silencio.
--      --          Revertir el trigger primero, o asumirlo a sabiendas.
--
--   2) Cuanto va a cambiar la cuenta de plazas al volver atras (solo
--      lectura; se ejecuta con la version NUEVA de la vista todavia puesta):
--      select nombre as sala, capacidad_declarada,
--             plazas_mesas               as ahora_solo_reales,
--             plazas_mesas_todas         as despues_del_rollback,
--             plazas_mesas_sin_duplicar  as la_cuenta_honesta,
--             mesas_originales_huerfanas
--      from public.vista_capacidad_espacios
--      order by marca, nombre;
--      -- Donde `mesas_originales_huerfanas` > 0, volver atras vuelve a
--      -- contar esas plazas DOS veces.
--
-- ---------------------------------------------------------------------------
-- LO QUE HAY QUE REPONER A MANO DESPUES (solo lectura)
-- ---------------------------------------------------------------------------
--   3) Mesas que la migracion marco. El nombre original NO esta en ningun
--      sitio: hay que dárselo a mano desde el editor de plano
--      (`src/pages/Espacios.tsx`), mesa por mesa.
--      select e.nombre as sala, m.id, m.nombre, m.capacidad, m.activa,
--             m.updated_at,
--             (select count(*) from public.asignaciones_mesa a
--               where a.mesa_id = m.id) as asignaciones
--      from public.mesas m
--      join public.espacios_reserva e on e.id = m.espacio_id
--      where m.nombre like '%(revisar%'
--      order by e.nombre, m.nombre;
--
--   4) Y de esas, las que ademas quedaron DESACTIVADAS (son las que tenian
--      un nombre de un solo caracter sin digitos y sin ningun uso; si alguna
--      era una mesa de verdad, hay que reactivarla ademas de renombrarla):
--      select e.nombre as sala, m.id, m.nombre, m.capacidad
--      from public.mesas m
--      join public.espacios_reserva e on e.id = m.espacio_id
--      where m.nombre like '%(revisar%'
--        and m.activa = false
--      order by e.nombre, m.nombre;
--      -- OJO: esta consulta tambien saca mesas que el dueño hubiera
--      -- desactivado a mano por su cuenta. Comprobar antes de reactivar.
--
-- ---------------------------------------------------------------------------
-- VERIFICACION POSTERIOR (solo lectura)
-- ---------------------------------------------------------------------------
--   5) El indice ya no esta (y `mesas_pkey` si):
--      select i.relname, ix.indisunique
--      from pg_index ix
--      join pg_class i on i.oid = ix.indexrelid
--      where ix.indrelid = 'public.mesas'::regclass
--      order by i.relname;
--      -- esperado: aparece mesas_pkey y NO aparece
--      --           uq_mesas_espacio_nombre_real
--
--   6) La vista vuelve a tener 10 columnas y vuelve a sumar las fusionadas:
--      select column_name, ordinal_position
--      from information_schema.columns
--      where table_schema = 'public'
--        and table_name = 'vista_capacidad_espacios'
--      order by ordinal_position;
--      -- esperado: 10 filas, de espacio_id a cuadra. Si salen 16, el DROP
--      -- no se ejecuto.
--
--   7) Sigue con security_invoker y sin permisos para anon/public (si esto
--      no sale 'on', la vista salta la RLS de espacios_reserva/mesas y
--      reabre la fuga que cerro 20260918084909):
--      select c.relname, c.reloptions, c.relacl::text
--      from pg_class c
--      join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relname = 'vista_capacidad_espacios';
--      -- esperado: reloptions = {security_invoker=on}
--
--   8) Las dos funciones vuelven a NO filtrar is_merged:
--      select p.proname,
--             pg_get_functiondef(p.oid) like '%is_merged%' as filtra_fusionadas,
--             p.prosecdef, p.provolatile, p.proconfig
--      from pg_proc p
--      where p.pronamespace = 'public'::regnamespace
--        and p.proname in ('fn_capacidad_efectiva_espacio',
--                          'fn_capacidad_efectiva_marca');
--      -- esperado: filtra_fusionadas = false en las dos, prosecdef = true,
--      --           provolatile = 's', proconfig = {search_path=public}
--
--   9) El aforo sigue funcionando igual que antes (el trigger no se toca ni
--      al aplicar la migracion ni al revertirla):
--      select coalesce(caracteristicas->>'marca', 'casa_tomas') as marca,
--             coalesce(sum(capacidad_maxima), 0) as capacidad_total
--      from public.espacios_reserva
--      where activa = true
--      group by 1;
--      -- esperado (datos de 2026-09-27): ('casa_tomas', 170), ('touza', 80)
-- ---------------------------------------------------------------------------
