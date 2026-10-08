set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##   NO APLICADA: la aplica el dueño a mano (ver PASOS)                  ##
-- ##   Mesas por PIEZAS + ajustes por servicio + Comedor según croquis     ##
-- ##   del 08/10/2026.                                                     ##
-- ===========================================================================
--
-- MODELO (acordado con el dueño el 08/10/2026)
--   · Pieza básica = mesa de 2. Plazas = 2 × piezas + picos (pico = +1 silla
--     en una cabecera). 2 piezas = 4, con pico 5; 3 piezas = 6, con pico 7.
--   · Plano base en `mesas` (columnas nuevas). Una mesa con `piezas` NULL no
--     se gestiona por piezas (Salón y Terraza, de momento): todo sigue igual.
--   · Ajustes POR SERVICIO (fecha + comida/cena) en `ajustes_mesa_servicio`:
--     piezas, picos y con qué mesa está junta. No tocan el plano base.
--   · Solo se pasan piezas entre mesas del mismo `grupo_piezas` (huecos
--     físicos del plano, nunca a través de columnas) y hasta `piezas_max`.
--   · `crece_hacia`: hacia qué lado se alarga la mesa al añadir piezas (el
--     pico se dibuja en la cabecera contraria).
--
-- COMEDOR (croquis del 08/10/2026, foto girada; lectura en el informe)
--   El croquis numera 2–12. Comparado con el plano aplicado el 02/10 es el
--   MISMO sitio para cada mesa, pero con otra numeración: la antigua 1 es la 6
--   y las de abajo suben uno (6→7 … 11→12). Se RENOMBRA cada fila por su
--   posición (mismo id): las asignaciones siguen en la misma mesa física.
--   Verificado el 08/10/2026 (solo SELECT): ninguna asignación de hoy en
--   adelante en el Comedor.
--   Pieza de 55 × 70 cm. Plazas base: 46 (datos confirmados por el dueño el 08/10).
--     2: 2 piezas (4)            · 3: 2 piezas (4), hueco para 1 más
--     4: 3 piezas + pico (7)     · 5: 3 piezas + pico (7)
--     6: 1 pieza (2; 3 con pico) · 7, 8, 9, 10, 11: 2 piezas (4) · 12: 1 (2)
--   Zonas que se pasan piezas: «comedor-3-4» (3 y 4) y «comedor-7-12».
--   La columna de 10/11/12 crece hacia la izquierda; la de 7/8/9, hacia la
--   derecha (entre las dos columnas solo queda pasillo). Paredes: sin tocar.
--
-- PASOS (desde adminpanelct/)
--   npx supabase db query --linked -f supabase/migrations/20261008170000_mesas_piezas_comedor.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

-- 1. Plano base por piezas ----------------------------------------------------
alter table public.mesas
  add column if not exists piezas smallint,
  add column if not exists picos_base smallint not null default 0,
  add column if not exists picos_max smallint not null default 0,
  add column if not exists piezas_max smallint,
  add column if not exists grupo_piezas text,
  add column if not exists crece_hacia text not null default 'derecha';

alter table public.mesas drop constraint if exists mesas_piezas_check;
alter table public.mesas add constraint mesas_piezas_check check (
  piezas is null or (
    piezas >= 1
    and picos_max between 0 and 2
    and picos_base between 0 and picos_max
    and coalesce(piezas_max, piezas) >= piezas
  )
);
alter table public.mesas drop constraint if exists mesas_crece_hacia_check;
alter table public.mesas add constraint mesas_crece_hacia_check
  check (crece_hacia in ('derecha', 'izquierda'));

comment on column public.mesas.piezas is 'Piezas (mesas de 2) del plano base. NULL = la mesa no se gestiona por piezas.';
comment on column public.mesas.picos_base is 'Picos (+1 silla en cabecera) del plano base.';
comment on column public.mesas.picos_max is 'Cabeceras donde cabe un pico (0-2).';
comment on column public.mesas.piezas_max is 'Hueco: máximo de piezas en fila que caben en su sitio.';
comment on column public.mesas.grupo_piezas is 'Mesas con el mismo grupo pueden pasarse piezas. NULL = ninguna.';
comment on column public.mesas.crece_hacia is 'Lado hacia el que se alarga al añadir piezas (derecha/izquierda).';

-- 2. Ajustes por servicio ------------------------------------------------------
create table if not exists public.ajustes_mesa_servicio (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references public.mesas(id) on delete cascade,
  espacio_id uuid not null references public.espacios_reserva(id) on delete cascade,
  fecha date not null,
  turno text not null check (turno in ('comida', 'cena')),
  piezas smallint not null check (piezas >= 0),
  picos smallint not null default 0 check (picos between 0 and 2),
  unida_a uuid references public.mesas(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint ajustes_mesa_servicio_unico unique (mesa_id, fecha, turno),
  constraint ajustes_mesa_servicio_no_consigo check (unida_a is null or unida_a <> mesa_id)
);

create index if not exists idx_ajustes_mesa_servicio_servicio
  on public.ajustes_mesa_servicio (espacio_id, fecha, turno);

comment on table public.ajustes_mesa_servicio is
  'Ajustes de piezas/picos/uniones de una mesa para un servicio (fecha + turno). No tocan el plano base.';

alter table public.ajustes_mesa_servicio enable row level security;

drop policy if exists ajustes_mesa_servicio_select on public.ajustes_mesa_servicio;
create policy ajustes_mesa_servicio_select on public.ajustes_mesa_servicio
  for select using ((select public.can_read_section('reservas'::text)));
drop policy if exists ajustes_mesa_servicio_insert on public.ajustes_mesa_servicio;
create policy ajustes_mesa_servicio_insert on public.ajustes_mesa_servicio
  for insert with check ((select public.can_write_section('reservas'::text)));
drop policy if exists ajustes_mesa_servicio_update on public.ajustes_mesa_servicio;
create policy ajustes_mesa_servicio_update on public.ajustes_mesa_servicio
  for update using ((select public.can_write_section('reservas'::text)))
  with check ((select public.can_write_section('reservas'::text)));
drop policy if exists ajustes_mesa_servicio_delete on public.ajustes_mesa_servicio;
create policy ajustes_mesa_servicio_delete on public.ajustes_mesa_servicio
  for delete using ((select public.can_write_section('reservas'::text)));

grant select, insert, update, delete on public.ajustes_mesa_servicio to authenticated;

drop trigger if exists trg_auditoria on public.ajustes_mesa_servicio;
create trigger trg_auditoria after insert or update or delete on public.ajustes_mesa_servicio
  for each row execute function public.fn_registrar_auditoria();

-- 3. Comedor de Casa Tomás según el croquis -----------------------------------
do $$
declare
  comedor constant uuid := '449cffc7-1189-4f3c-a0b3-b60b3442979d';
  n integer;
begin
  create temp table _piezas (
    nombre_antes text, pos_antes_x numeric, pos_antes_y numeric,
    nombre text, piezas smallint, picos smallint, picos_max smallint, piezas_max smallint,
    grupo text, crece text, pos_x numeric, pos_y numeric,
    mesa_id uuid
  ) on commit drop;
  -- DATOS SEMILLA (fáciles de corregir): una fila por mesa.
  --   nombre_antes/pos_antes = cómo está hoy (para localizar la fila)
  --   nombre | piezas | picos (pico puesto en el plano base) | picos_max (admite pico)
  --   | piezas_max (hueco) | grupo (zona que se pasa piezas) | crece | pos nueva (m)
  insert into _piezas values
    ('2',  3.92,  0.78, '2',  2, 0, 1, 2, null,           'derecha',   3.92,  0.78, null),
    ('3',  6.88,  0.58, '3',  2, 0, 1, 3, 'comedor-3-4',  'derecha',   6.30,  0.58, null),
    ('4',  6.88,  2.12, '4',  3, 1, 1, 3, 'comedor-3-4',  'derecha',   6.30,  2.12, null),
    ('5',  6.88,  3.65, '5',  3, 1, 1, 3, null,           'derecha',   6.30,  3.65, null),
    ('1',  2.93,  3.45, '6',  1, 0, 1, 1, null,           'derecha',   2.93,  3.45, null),
    ('6',  7.58, 11.36, '7',  2, 0, 1, 3, 'comedor-7-12', 'derecha',   7.20, 11.36, null),
    ('7',  7.58, 12.92, '8',  2, 0, 1, 3, 'comedor-7-12', 'derecha',   7.20, 12.92, null),
    ('8',  7.58, 14.48, '9',  2, 0, 1, 3, 'comedor-7-12', 'derecha',   7.20, 14.48, null),
    ('9',  5.61, 11.36, '10', 2, 0, 1, 3, 'comedor-7-12', 'izquierda', 5.70, 11.36, null),
    ('10', 5.61, 12.92, '11', 2, 0, 1, 3, 'comedor-7-12', 'izquierda', 5.70, 12.92, null),
    ('11', 5.61, 14.48, '12', 1, 0, 1, 3, 'comedor-7-12', 'izquierda', 6.25, 14.48, null);

  -- Las mesas activas tienen que ser exactamente las del 02/10 (nombre + sitio).
  if exists (
    (select nombre::text, round(pos_x, 2), round(pos_y, 2) from public.mesas
      where espacio_id = comedor and coalesce(activa, true) and not coalesce(is_merged, false))
    except (select nombre_antes, pos_antes_x, pos_antes_y from _piezas)
  ) or exists (
    (select nombre_antes, pos_antes_x, pos_antes_y from _piezas)
    except (select nombre::text, round(pos_x, 2), round(pos_y, 2) from public.mesas
      where espacio_id = comedor and coalesce(activa, true) and not coalesce(is_merged, false))
  ) then
    raise exception 'Las mesas del Comedor ya no son las del plano del 02/10. Revisar antes de aplicar.';
  end if;

  -- 1) Localizar cada fila UNA vez (nombre de antes + sitio) y guardar su id.
  update _piezas p set mesa_id = m.id
  from public.mesas m
  where m.espacio_id = comedor and m.nombre::text = p.nombre_antes
    and round(m.pos_x, 2) = p.pos_antes_x and round(m.pos_y, 2) = p.pos_antes_y
    and coalesce(m.activa, true) and not coalesce(m.is_merged, false);
  if exists (select 1 from _piezas where mesa_id is null)
     or (select count(distinct mesa_id) from _piezas) <> 11 then
    raise exception 'No se han localizado las 11 mesas del Comedor. Revisar antes de aplicar.';
  end if;

  -- 2) Renumerar en DOS fases: el índice único uq_mesas_espacio_nombre_real
  --    (espacio_id, lower(btrim(nombre))) se comprueba fila a fila y no se
  --    puede diferir; un 1→6 directo choca con la 6 que aún no se ha movido.
  update public.mesas m set nombre = '__tmp_' || m.id::text
  from _piezas p where m.id = p.mesa_id;
  get diagnostics n = row_count;
  if n <> 11 then raise exception 'nombres temporales: % (esperaba 11)', n; end if;

  update public.mesas m set
    nombre = p.nombre,
    piezas = p.piezas,
    picos_base = p.picos,
    picos_max = p.picos_max,
    piezas_max = p.piezas_max,
    grupo_piezas = p.grupo,
    crece_hacia = p.crece,
    capacidad = p.piezas * 2 + p.picos,
    forma = 'rectangular',
    ancho = p.piezas * 55,
    alto = 70,
    rotacion = 0,
    pos_x = p.pos_x,
    pos_y = p.pos_y
  from _piezas p
  where m.id = p.mesa_id;
  get diagnostics n = row_count;
  if n <> 11 then raise exception 'mesas actualizadas: % (esperaba 11)', n; end if;
end;
$$;

commit;

-- Comprobación rápida (debe dar 11 filas y 46 plazas):
-- select nombre, piezas, picos_base, capacidad, grupo_piezas from public.mesas
--  where espacio_id = '449cffc7-1189-4f3c-a0b3-b60b3442979d' and activa order by nombre::int;
