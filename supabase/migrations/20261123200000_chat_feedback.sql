set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261123200000_chat_feedback — 👍/👎 de las respuestas del copiloto de
-- Facturas (11/11/2026)
-- ===========================================================================
-- Cada valoración guarda lo necesario para reproducir el fallo y, si se
-- revisa, convertirlo en un caso de la batería de evaluación
-- (scripts/chat-feedback-a-eval.mjs →
--  supabase/functions/chat-facturas/__tests__/eval/preguntas.json):
--   pregunta, respuesta, historial previo (jsonb: [{rol, contenido}]),
--   herramientas (jsonb: [{nombre, argumentos, resultado, error?}], la traza
--   que devuelve chat-facturas), modelo, valoracion (+1/-1), comentario
--   opcional («¿Qué estaba mal?»), revisado.
--
-- Permisos:
--   * Insertar: cualquier usuario autenticado, SOLO a su nombre
--     (usuario_id = auth.uid()) y sin marcar como revisado.
--   * Leer: quien puede leer Facturas (can_read_section('facturas')).
--   * Marcar «revisado»: quien puede escribir en Facturas
--     (can_write_section('facturas'), como conversaciones/facturas). Solo la
--     columna `revisado`; revisado_por/revisado_at los pone un trigger.
--   * Borrar: nadie desde el panel (service_role sí).
--   * Más la restrictiva acceso_panel_no_bloqueado (patrón 20261013082609).
--
-- Un voto por usuario y mensaje (índice único parcial sobre mensaje_id).
-- Necesita: can_read_section / can_write_section. Idempotente.
-- Rollback: supabase/rollbacks/20261123200000_chat_feedback_ROLLBACK.sql
-- Test:     supabase/tests/chat_feedback_test.sql
-- ===========================================================================

begin;

do $$
begin
  if to_regprocedure('public.can_read_section(text)') is null or to_regprocedure('public.can_write_section(text)') is null then
    raise exception 'chat_feedback: faltan can_read_section / can_write_section.';
  end if;
end;
$$;

-- ─── 1. Tabla ───────────────────────────────────────────────────────────────

create table if not exists public.chat_feedback (
  id              bigint generated always as identity primary key,
  usuario_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversacion_id uuid,
  mensaje_id      uuid,
  pregunta        text not null check (char_length(pregunta) between 1 and 16000),
  respuesta       text not null check (char_length(respuesta) <= 40000),
  historial       jsonb not null default '[]'::jsonb check (jsonb_typeof(historial) = 'array'),
  herramientas    jsonb not null default '[]'::jsonb check (jsonb_typeof(herramientas) = 'array'),
  modelo          text check (modelo is null or char_length(modelo) <= 80),
  valoracion      smallint not null check (valoracion in (-1, 1)),
  comentario      text check (comentario is null or char_length(comentario) <= 1000),
  revisado        boolean not null default false,
  revisado_por    uuid,
  revisado_at     timestamptz,
  created_at      timestamptz not null default now()
);

comment on table public.chat_feedback is
  '👍/👎 de las respuestas del copiloto de Facturas (20261123200000). Los 👎 revisados alimentan la batería de evaluación (scripts/chat-feedback-a-eval.mjs).';

create unique index if not exists chat_feedback_un_voto_por_mensaje
  on public.chat_feedback (usuario_id, mensaje_id) where mensaje_id is not null;
create index if not exists chat_feedback_pendientes
  on public.chat_feedback (created_at desc) where valoracion = -1 and not revisado;

-- ─── 2. Quién revisó y cuándo (no lo escribe el cliente) ───────────────────

create or replace function public.chat_feedback_marcar_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.revisado is distinct from old.revisado then
    new.revisado_por := case when new.revisado then auth.uid() else null end;
    new.revisado_at  := case when new.revisado then now() else null end;
  end if;
  return new;
end;
$$;
revoke all on function public.chat_feedback_marcar_revision() from public, anon, authenticated;

drop trigger if exists trg_chat_feedback_revision on public.chat_feedback;
create trigger trg_chat_feedback_revision before update on public.chat_feedback
  for each row execute function public.chat_feedback_marcar_revision();

-- ─── 3. RLS y permisos ──────────────────────────────────────────────────────

alter table public.chat_feedback enable row level security;

drop policy if exists chat_feedback_insert_propio on public.chat_feedback;
create policy chat_feedback_insert_propio on public.chat_feedback for insert to authenticated
  with check (usuario_id = (select auth.uid()) and revisado = false);

drop policy if exists chat_feedback_select_seccion on public.chat_feedback;
create policy chat_feedback_select_seccion on public.chat_feedback for select to authenticated
  using ((select public.can_read_section('facturas')));

drop policy if exists chat_feedback_update_seccion on public.chat_feedback;
create policy chat_feedback_update_seccion on public.chat_feedback for update to authenticated
  using ((select public.can_write_section('facturas')))
  with check ((select public.can_write_section('facturas')));

revoke all on public.chat_feedback from anon, authenticated;
grant select, insert on public.chat_feedback to authenticated;
grant update (revisado) on public.chat_feedback to authenticated;
grant all on public.chat_feedback to service_role;

do $$
begin
  if to_regprocedure('private.sesion_panel_permitida()') is not null then
    drop policy if exists "acceso_panel_no_bloqueado" on public.chat_feedback;
    create policy "acceso_panel_no_bloqueado" on public.chat_feedback as restrictive for all to authenticated
      using ((select private.sesion_panel_permitida())) with check ((select private.sesion_panel_permitida()));
  end if;
end;
$$;

do $$
begin
  raise notice 'chat_feedback: aplicada';
end;
$$;

commit;

-- VERIFICACIÓN (solo lectura):
--   select polname from pg_policy where polrelid = 'public.chat_feedback'::regclass order by 1;
--   select valoracion, revisado, count(*) from public.chat_feedback group by 1, 2;
