set client_encoding = 'UTF8';
-- ROLLBACK de 20261129153000_costes_servicios_ia.sql: quita la función
-- ia_coste_por_uso, las columnas nuevas de servicios_contratados (para qué,
-- precio confirmado, plan siguiente, su precio y qué pasa si se pasa: ¡se
-- pierde lo escrito en ellas!) y su `si_se_pasa` por métrica, y las columnas
-- que_hace y accion de ia_funciones. Borra del catálogo las dos funciones que
-- dio de alta si ninguna otra tabla las usa. Se queda, a propósito, la marca
-- «instrumentada» de las seis funciones que ya registraban su gasto: es un
-- dato correcto (volver a false haría avisar de un agujero que no existe).
begin;

drop function if exists public.ia_coste_por_uso(date, date);

update public.servicios_contratados
   set limites = (
         select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' then v - 'si_se_pasa' else v end), '{}'::jsonb)
           from jsonb_each(limites) as e(k, v))
 where exists (select 1 from jsonb_each(limites) as e(k, v) where jsonb_typeof(v) = 'object' and v ? 'si_se_pasa');

alter table public.servicios_contratados drop constraint if exists servicios_contratados_para_que_chk;
alter table public.servicios_contratados drop constraint if exists servicios_contratados_plan_siguiente_chk;
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_siguiente_chk;
alter table public.servicios_contratados drop constraint if exists servicios_contratados_si_se_pasa_chk;
alter table public.servicios_contratados drop constraint if exists servicios_contratados_precio_confirmado_chk;
alter table public.servicios_contratados drop column if exists para_que;
alter table public.servicios_contratados drop column if exists precio_confirmado_en;
alter table public.servicios_contratados drop column if exists plan_siguiente;
alter table public.servicios_contratados drop column if exists precio_siguiente;
alter table public.servicios_contratados drop column if exists si_se_pasa;

alter table public.ia_funciones drop constraint if exists ia_funciones_que_hace_chk;
alter table public.ia_funciones drop constraint if exists ia_funciones_accion_chk;
alter table public.ia_funciones drop column if exists que_hace;
alter table public.ia_funciones drop column if exists accion;

do $$
begin
  if to_regclass('public.ia_modelo_funcion') is not null then
    delete from public.ia_funciones f
     where f.funcion in ('buscar-puntuacion-parker', 'interpretar-reserva-manuscrita')
       and not exists (select 1 from public.ia_modelo_funcion m where m.funcion = f.funcion);
  else
    delete from public.ia_funciones where funcion in ('buscar-puntuacion-parker', 'interpretar-reserva-manuscrita');
  end if;
end;
$$;

commit;
