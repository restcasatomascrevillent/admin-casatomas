-- Reconstruida desde supabase_migrations.schema_migrations (version 20260215171310).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.


CREATE TABLE IF NOT EXISTS public.historial_precios (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    producto_nombre text,
    proveedor text,
    precio numeric,
    fecha date,
    factura_id bigint REFERENCES public.facturas(id),
    created_at timestamptz DEFAULT now()
);

-- Habilitar RLS (opcional pero recomendado)
ALTER TABLE public.historial_precios ENABLE ROW LEVEL SECURITY;

-- Crear política para permitir inserción (ajustar según necesidades reales)
CREATE POLICY "Permitir inserción a autenticados" ON public.historial_precios
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Permitir select a autenticados" ON public.historial_precios
    FOR SELECT TO authenticated USING (true);
