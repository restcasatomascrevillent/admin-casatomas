-- Reconstruida desde supabase_migrations.schema_migrations (version 20260429120919).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


-- Table for client ↔ GW team portal chat
CREATE TABLE IF NOT EXISTS public.client_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sender_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message     text NOT NULL DEFAULT '',
    file_url    text,
    file_name   text,
    is_read     boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_client_messages_client_id
    ON public.client_messages (client_id, created_at ASC);

-- Enable RLS
ALTER TABLE public.client_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: client sees their own thread; sender (GW admin) sees what they sent
CREATE POLICY "client_messages_select"
    ON public.client_messages FOR SELECT
    USING (client_id = auth.uid() OR sender_id = auth.uid());

-- INSERT: only the authenticated user can send as themselves
CREATE POLICY "client_messages_insert"
    ON public.client_messages FOR INSERT
    WITH CHECK (sender_id = auth.uid());

-- UPDATE: client or sender can mark as read (is_read update)
CREATE POLICY "client_messages_update"
    ON public.client_messages FOR UPDATE
    USING (client_id = auth.uid() OR sender_id = auth.uid());
