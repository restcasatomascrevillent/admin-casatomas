-- Deshace 20261213010000_guardado_facturas_rapido: vuelve a los horarios, a
-- reanudar_trabajos_ocr de antes (cuerpos de
-- producción del 20/11/2026). No borra la columna reintentos_auto (inofensiva).

do $cron$
declare
  r record;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  for r in
    select * from (values
      ('avisos-telegram-fallos',        '*/5 * * * *'),
      ('avisos-telegram-pendientes',    '*/5 * * * *'),
      ('clasificar-productos',          '*/5 * * * *'),
      ('reservas-web-keep-warm',        '*/5 * * * *'),
      ('instagram-programador',         '*/5 * * * *'),
      ('procesar-logs-web',             '*/5 * * * *'),
      ('facturas-originales-drive',     '*/10 * * * *'),
      ('embeddings-nombres',            '*/10 * * * *'),
      ('emails-reserva-reintentar-fallidos', '*/15 * * * *'),
      ('avisos-telegram-vigilante',     '*/15 * * * *'),
      ('ia-modelos-openai',             '15 6 * * *')
    ) as v(nombre, horario)
  loop
    perform cron.alter_job(j.jobid, schedule := r.horario)
       from cron.job j
      where j.jobname = r.nombre and j.schedule is distinct from r.horario;
  end loop;
end
$cron$;

create or replace function public.reanudar_trabajos_ocr()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n integer := 0;
begin
  -- 1. Piezas con el lease caducado (el worker murió): fallo técnico → reintento.
  for r in select id from public.ocr_trabajo_paginas where estado = 'procesando' and lease_hasta < now() loop
    perform public.ocr_fallo_pagina(r.id, 'lease caducado (el worker no cerró la pieza)');
    n := n + 1;
  end loop;

  -- 2. Trabajos que pasan del límite → fallido.
  update public.ocr_trabajos
     set estado = 'fallido', error = coalesce(error, 'tiempo agotado (15 min) sin terminar'),
         terminado_at = now(), lease_hasta = null
   where estado in ('pendiente', 'pagina1', 'paginas', 'consolidando') and limite_at < now();

  -- 3. Consolidación con el lease caducado: reintento (máx. 3) o fallido.
  update public.ocr_trabajos
     set estado = 'fallido', error = coalesce(error, 'la consolidación falló 3 veces'),
         terminado_at = now(), lease_hasta = null
   where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion >= 3;
  update public.ocr_trabajos
     set estado = 'paginas', lease_hasta = null, consolidar_despachado_at = null
   where estado = 'consolidando' and lease_hasta < now() and intentos_consolidacion < 3;

  -- 4. Trabajos activos sin movimiento en 60 s → volver a despachar.
  for r in select id from public.ocr_trabajos
            where estado in ('pendiente', 'pagina1', 'paginas') and updated_at < now() - interval '60 seconds' loop
    n := n + public.ocr_despachar(r.id);
  end loop;
  return n;
end;
$function$;

drop function if exists public.ocr_reanudar_fallidos_transitorios();
drop function if exists public.ocr_reanudar_fallido_interno(uuid);
