set client_encoding = 'UTF8';
-- Deshace 20261122153700_newsletter_plantillas.sql. BORRA las plantillas de
-- newsletter guardadas desde el panel y el registro de peticiones a la IA (las
-- plantillas de partida están en el código y siguen disponibles). El historial
-- de envíos (newsletter_envios) no se toca. Desactiva antes «Crear con IA»
-- (no desplegar o borrar la Edge Function newsletter-ia): sin la tabla de
-- peticiones responde 503 y no llama a la IA.
begin;

drop table if exists public.newsletter_ia_peticiones;
drop table if exists public.newsletter_plantillas;
drop function if exists public.newsletter_comprobar_cupo_ia();
drop function if exists public.newsletter_plantillas_fijar_autor();

do $$
begin
  if to_regclass('public.ia_modelo_funcion') is not null then
    execute $q$ delete from public.ia_modelo_funcion where funcion = 'newsletter-ia' $q$;
  end if;
  if to_regclass('public.ia_funciones') is not null then
    delete from public.ia_funciones where funcion = 'newsletter-ia';
  end if;
end;
$$;

commit;
