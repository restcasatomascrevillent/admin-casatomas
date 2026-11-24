-- ===========================================================================
--  Logs web · un script que el navegador mete en la página ya no cuenta como
--  fallo de la web aunque no esté en la línea 1 (CAS-33, CAS-34)
--
--  22/11/2026, Chrome en iPhone, un visitante: «RangeError: Maximum call stack
--  size exceeded» tres veces en /carta/carnes y /carta/entrantes-calientes, con
--  toda la pila en las líneas 195-236 de la propia página
--  («Fk@https://…/carta:236:392»). El HTML de la web tiene 18 líneas y su
--  código va en /assets/*.js: ese script no es nuestro. La regla de
--  20261213040000 solo miraba la línea 1 y abrió dos tickets.
--
--  web_logs_origen_error(): una regla más → navegador cuando TODOS los marcos
--  de la pila están en una página (ningún .js) y en la línea 100 o posterior.
--  web-casatomas garantiza al construir que ninguna página pasa de 99 líneas
--  (scripts/verificar-html.mjs). El resto de la función es idéntico a
--  20261213040000. Lo ya guardado no cambia (CAS-33 y CAS-34 se cierran a mano).
--
--  Sin aplicar en producción: demo primero (sfonaclosuafvlhutkon); producción
--  (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR de la release y con el «sí»
--  del dueño. Requiere 20261213040000. Idempotente. Tiene que terminar en
--  «logs_web_pila_fuera_del_html: aplicada».
--  Deshacer: supabase/rollbacks/20261220100000_logs_web_pila_fuera_del_html_ROLLBACK.sql
--  Pruebas: npm run test:logs-web:db (PGlite) y
--  supabase/functions/_shared/__tests__/logs-web-origen.test.ts (vitest): los
--  MISMOS casos (logs-web-origen-casos.json) pasan por el SQL y por origen.ts.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text)') is null then
    raise exception 'logs_web_pila_fuera_del_html: faltan las migraciones de Logs (20261213040000). No se ha cambiado nada.';
  end if;
end;
$$;

-- Origen de una ocurrencia (espejo de supabase/functions/_shared/logs-web/origen.ts).
create or replace function public.web_logs_origen_error(p_tipo text, p_fuente text, p_mensaje text, p_pila text, p_objetivo text,
                                                         p_propiedades jsonb, p_accion text, p_tras_publicar text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- 1. Versión antigua tras publicar: lo que pasó después manda.
    when p_tras_publicar = 'repetido' then 'web'
    when p_tras_publicar = 'sin_conexion' then 'conexion'
    when p_tras_publicar in ('sin_impacto', 'sin_datos') then 'version_antigua'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso')
         and p_accion in ('recarga_sin_efecto', 'aviso_version_nueva', 'sin_version_nueva') then 'web'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso') and p_accion = 'sin_conexion' then 'conexion'
    when p_tipo in ('error_js', 'error_promesa', 'error_react', 'error_recurso') and p_accion = 'recuperado_tras_recarga' then 'version_antigua'
    -- Imagen que no cargó y sí al volver a pedirla: corte momentáneo de la conexión (web-casatomas, CAS-17).
    when p_tipo = 'error_recurso' and p_accion = 'recuperada_al_reintentar' then 'conexion'
    when public.web_logs_es_version_antigua(p_tipo, p_mensaje, p_pila, p_objetivo) then 'version_antigua'
    -- 2. Nuestro aunque lo parezca de fuera.
    when p_tipo = 'error_despliegue' then 'web'
    when coalesce(p_fuente, 'navegador') <> 'navegador'
         and (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
             ~* 'falta_secreto|falta (el |la )?(secreto|clave|configur|firma)|not_configured|no_configurado|no está configurad|missing (secret|api key|env)|dns error|failed to lookup address|enotfound|name or service not known'
      then 'web'
    -- 3. El navegador o una extensión.
    -- Error de React al hidratar con la página cambiada por el navegador: traducida (rastro de Chrome/Edge)
    -- o cualquier cambio ajeno antes de hidratar (web-casatomas lib/dom-ajeno.ts). CAS-6/18/19/20.
    -- Hacen falta las dos cosas: sin la marca de la web, un desajuste es un fallo nuestro.
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo in ('error_js', 'error_promesa', 'error_react')
         and p_accion in ('pagina_traducida', 'dom_ajeno')
         and coalesce(p_mensaje, '') ~* 'minified react error #(418|421|422|423|425)([^0-9]|$)|hydration failed because|there was an error while hydrating|text content does not match server-rendered html|did not match\. server:'
      then 'navegador'
    when coalesce(p_fuente, 'navegador') = 'navegador'
         and ((coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, '') || E'\n' || coalesce(p_objetivo, ''))
                ~* '(chrome|moz|safari|safari-web|ms-browser|edge)-extension://|webkit-masked-url://'
              or (coalesce(p_mensaje, '') || E'\n' || coalesce(p_pila, ''))
                ~* 'resizeobserver loop|_autofillcallbackhandler|instantsearchsdkjsbridge|__gcrweb|weixinjsbridge|webkit\.messagehandlers|java object is gone|zalojsv2|getreadmode(config|render|extract)|symbrowser_|cefsharp|non-error promise rejection captured|can.t find variable: (gmo|zalo|_autofill)|__firefox__|window\.ethereum'
              or btrim(coalesce(p_mensaje, ''), E' \t\n\r') ~* '^(uncaught )?script error\.?$'
              or (p_tipo = 'error_recurso' and coalesce(p_objetivo, '')
                ~* 'googletagmanager\.com|google-analytics\.com|doubleclick\.net|googlesyndication\.com|clarity\.ms|hotjar\.com|cloudflareinsights\.com|fbevents\.js'))
      then 'navegador'
    -- Script que el navegador mete en la página: todos los marcos en la línea 1 de una página, ningún .js
    -- (Brave en iPhone, CAS-21/22/23/26/27/28). La web no tiene código propio en la línea 1 de su HTML.
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo in ('error_js', 'error_promesa', 'error_react')
         and btrim(coalesce(p_pila, ''), E' \t\n\r') <> ''
         and btrim(p_pila, E' \t\n\r') ~* '^(\s*(global code@|at |@)?https?://[^\s]+:1:[0-9]+\s*)+$'
         and p_pila !~* '\.m?js([?#:\s]|$)'
      then 'navegador'
    -- Script que el navegador mete en la página: todos los marcos en una página (ningún .js) y en la línea 100
    -- o posterior, que el HTML de la web no tiene (Chrome en iPhone, CAS-33/34). web-casatomas para el build
    -- si una página pasa de 99 líneas (scripts/verificar-html.mjs).
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo in ('error_js', 'error_promesa', 'error_react')
         and btrim(coalesce(p_pila, ''), E' \t\n\r') <> ''
         and btrim(p_pila, E' \t\n\r') ~* '^(\s*([^\s@]*@|at )?https?://[^\s]+:[1-9][0-9][0-9]+:[0-9]+\s*)+$'
         and p_pila !~* '\.m?js([?#:\s]|$)'
      then 'navegador'
    -- 4. La conexión del visitante.
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo = 'error_peticion'
         and (coalesce(p_propiedades ->> 'status', '') = '0' or coalesce(p_mensaje, '') ~* '^sin respuesta')
      then 'conexion'
    when coalesce(p_fuente, 'navegador') = 'navegador' and p_tipo in ('error_js', 'error_promesa', 'error_react')
         and coalesce(p_mensaje, '') ~* 'failed to fetch|load failed|networkerror when attempting to fetch resource|network ?error|network request failed|network connection was lost|internet connection appears to be offline|err_internet_disconnected|err_network_changed|err_connection_(reset|closed|refused|timed_out|aborted)|aborterror|user aborted a request|operation was aborted|signal is aborted|fetch is aborted|request aborted|failed to send a request to the edge function|authretryablefetcherror|^(typeerror: )?(cancelled|canceled|cancelado)$'
      then 'conexion'
    -- 5. Un servicio de fuera.
    when public.web_logs_proveedor_externo(p_tipo, p_fuente, p_mensaje, p_pila, p_objetivo) is not null then 'externo'
    -- 6. Lo nuestro.
    else 'web'
  end;
$$;
revoke all on function public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.web_logs_origen_error(text, text, text, text, text, jsonb, text, text) to authenticated, service_role;

do $$ begin raise notice 'logs_web_pila_fuera_del_html: aplicada'; end $$;

commit;
