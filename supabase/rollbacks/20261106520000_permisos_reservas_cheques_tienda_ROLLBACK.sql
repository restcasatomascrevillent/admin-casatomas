set client_encoding = 'UTF8';
-- ROLLBACK de 20261106520000_permisos_reservas_cheques_tienda.sql (quien solo
-- tiene «Ver»). Aplicar a mano SOLO si hay que deshacerlo. Idempotente.
--
-- Devuelve canjear_cheque_regalo(text) a la versión de
-- 20261008161255_caducidad_cheques_regalo: canjear vuelve a exigir el permiso
-- de EDICIÓN de 'cheques'. Lo demás de esa migración no tocaba la BD.
--
-- Antes de aplicarlo, volver a publicar el panel de antes (el nuevo enseña
-- «Canjear cheque» a quien solo tiene «Ver», y con este rollback la BD se lo
-- rechazaría con «No tienes permiso para canjear cheques»).
begin;
set local lock_timeout = '5s';

create or replace function public.canjear_cheque_regalo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cheques_regalo;
begin
  if auth.uid() is null or not coalesce(public.has_section_permission(auth.uid(), 'cheques', 'edit'), false) then
    raise exception 'No tienes permiso para canjear cheques' using errcode = '42501';
  end if;
  -- La validez se comprueba dentro del UPDATE: una verificación antigua no autoriza el canje.
  update public.cheques_regalo set usado = true, canjeado_en = clock_timestamp(), canjeado_por = auth.uid()
    where codigo = upper(trim(p_codigo)) and estado = 'pagado' and not coalesce(usado, false)
      and caduca_el >= (clock_timestamp() at time zone 'Europe/Madrid')::date
    returning * into c;
  if not found then
    if exists (select 1 from public.cheques_regalo where codigo = upper(trim(p_codigo))
      and caduca_el < (clock_timestamp() at time zone 'Europe/Madrid')::date) then
      raise exception 'El cheque está caducado y no puede canjearse';
    end if;
    raise exception 'El cheque no es válido o ya ha sido canjeado';
  end if;
  return public.verificar_cheque_regalo(c.codigo);
end $$;

comment on function public.canjear_cheque_regalo(text) is null;
revoke all on function public.canjear_cheque_regalo(text) from public, anon;
grant execute on function public.canjear_cheque_regalo(text) to authenticated;

notify pgrst, 'reload schema';

commit;
