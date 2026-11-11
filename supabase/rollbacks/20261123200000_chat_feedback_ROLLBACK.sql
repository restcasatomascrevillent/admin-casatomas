set client_encoding = 'UTF8';
-- Vuelta atrás de 20261123200000_chat_feedback.sql
-- OJO: borra las valoraciones guardadas. Si hay 👎 sin pasar a la batería,
-- exporta antes: node scripts/chat-feedback-a-eval.mjs --simular
begin;
drop trigger if exists trg_chat_feedback_revision on public.chat_feedback;
drop table if exists public.chat_feedback;
drop function if exists public.chat_feedback_marcar_revision();
commit;
