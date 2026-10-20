-- ===========================================================================
--  chat-web — URL de reservas online por defecto
--
--  20260926121000_chat_web_proteccion.sql creó chat_web_config.url_reservas
--  NULLABLE y sin default, así que en una instalación limpia el bot no
--  conocía la web de reservas (fallaban res-como-reservar-es, res-how-book-en
--  y limite-turno-13-es de supabase/functions/chat-web/evals/).
--
--  La función chat-web también usa esta URL como constante de respaldo
--  (URL_RESERVAS_DEFECTO), pero la config es la que manda y la que se edita
--  desde el panel (Bot Web → Protección y consumo), así que se rellena aquí.
--
--  Idempotente: solo toca la fila si url_reservas es NULL o vacía (no pisa un
--  valor puesto a mano) y el default se puede fijar las veces que haga falta.
--  Requiere 20260926121000_chat_web_proteccion.sql aplicada.
-- ===========================================================================

begin;

alter table public.chat_web_config
  alter column url_reservas set default 'https://casa-tomas-story.vercel.app/reservas';

update public.chat_web_config
   set url_reservas = 'https://casa-tomas-story.vercel.app/reservas'
 where id
   and (url_reservas is null or btrim(url_reservas) = '');

commit;

-- Comprobación manual:
-- select url_reservas from public.chat_web_config;
