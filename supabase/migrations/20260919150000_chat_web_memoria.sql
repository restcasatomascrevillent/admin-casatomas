-- ============================================================================
--  chat-web — memoria conversacional + soporte de rate limiting persistente
-- ----------------------------------------------------------------------------
--  Origen: supabase/functions/chat-web/schema.sql, que nunca se movió a
--  migrations/ (B-5 de docs/REVISION-PUERTOS-N8N.md). Verificado contra el
--  proyecto jeamoczmbfsnwkfjxcyo: `chat_web_conversaciones` y
--  `chat_web_mensajes` NO existen todavía.
--
--  DEBE APLICARSE ANTES DE DESPLEGAR LA FUNCIÓN `chat-web`: su rate limiter
--  persistente ahora falla CERRADO, así que sin estas tablas el bot rechaza
--  todas las peticiones con un mensaje de "vuelve a intentarlo".
--
--  Mismo patrón relacional que chat_facturas_conversaciones/chat_facturas_mensajes,
--  en vez de reutilizar la tabla n8n_chat_histories (shape jsonb estilo LangChain,
--  con nombre y formato heredados de n8n).
-- ============================================================================

create table if not exists public.chat_web_conversaciones (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique, -- "{id}_{idioma}", mismo formato de sessionKey que usaba memoryPostgresChat en n8n
  idioma text not null default 'es',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_web_mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.chat_web_conversaciones(id) on delete cascade,
  session_id text not null,
  rol text not null check (rol in ('user','assistant')),
  contenido text not null,
  ip text, -- IP del visitante (x-forwarded-for), solo para el rate limit por IP; puede ser null
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_web_mensajes_conversacion
  on public.chat_web_mensajes (conversacion_id, created_at);

-- Índices que usa el rate limiter (conteo de mensajes de usuario en ventana de tiempo)
create index if not exists idx_chat_web_mensajes_session_creado
  on public.chat_web_mensajes (session_id, created_at) where rol = 'user';

create index if not exists idx_chat_web_mensajes_ip_creado
  on public.chat_web_mensajes (ip, created_at) where rol = 'user' and ip is not null;

-- RLS: la función usa la service role key (bypassa RLS), pero conviene cerrar
-- estas tablas a anon/authenticated por si alguna vez se consultan desde el
-- cliente. Sin policies = nadie con anon/authenticated key puede leer/escribir.
alter table public.chat_web_conversaciones enable row level security;
alter table public.chat_web_mensajes enable row level security;
