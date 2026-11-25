set client_encoding = 'UTF8';
-- ROLLBACK de 20261224100000_cortesia_20_minutos_correo.sql: si la versión
-- vigente del correo 'propuesta' es la que creó esa migración, la borra y
-- vuelve a marcar como vigente la versión sobre la que se hizo. Si después se
-- ha editado la plantilla desde el panel, no toca nada (quitar la frase desde
-- el editor de plantillas).
-- La plantilla de WhatsApp se revierte desplegando la versión anterior de
-- `whatsapp-reservas` (la plantilla nueva en Meta se puede dejar o borrar).
begin;

do $$
declare
  v_nueva public.plantillas_email_reserva;
  v_base integer;
begin
  select * into v_nueva
    from public.plantillas_email_reserva
    where tipo = 'propuesta' and es_actual and nota_version like '20 minutos de cortesía (migración 20261224100000%';

  if not found then
    raise notice 'La versión vigente de ''propuesta'' no es la de la migración 20261224100000: no se toca.';
    return;
  end if;

  v_base := substring(v_nueva.nota_version from 'sobre la versión (\d+)')::integer;

  delete from public.plantillas_email_reserva where id = v_nueva.id;
  update public.plantillas_email_reserva set es_actual = true
    where tipo = 'propuesta' and version = coalesce(
      v_base,
      (select max(version) from public.plantillas_email_reserva where tipo = 'propuesta')
    );
end;
$$;

commit;
