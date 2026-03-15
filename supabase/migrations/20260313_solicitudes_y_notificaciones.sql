-- ============================================================
-- SOLICITUDES PENDIENTES
-- Registra peticiones que el bot telefónico no pudo resolver
-- (grupos grandes, sin disponibilidad, fuera de horario, etc.)
-- para que el restaurante las gestione manualmente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.solicitudes_pendientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT,
  telefono TEXT,
  email TEXT,
  fecha_solicitada DATE,
  hora_solicitada TEXT,
  numero_comensales INTEGER,
  notas_cliente TEXT,
  motivo_rechazo TEXT NOT NULL,
  -- Valores: 'grupo_grande', 'sin_disponibilidad', 'fuera_horario',
  --          'reserva_hoy', 'max_reservas_telefono', 'max_reservas_email',
  --          'corte_horario', 'otro'
  descripcion_rechazo TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  -- Valores: 'pendiente', 'contactado', 'resuelta', 'descartada'
  notas_internas TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON public.solicitudes_pendientes(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_created ON public.solicitudes_pendientes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitudes_telefono ON public.solicitudes_pendientes(telefono);

-- RLS
ALTER TABLE public.solicitudes_pendientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view solicitudes"
  ON public.solicitudes_pendientes FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert solicitudes"
  ON public.solicitudes_pendientes FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update solicitudes"
  ON public.solicitudes_pendientes FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Service role (para el webhook del teléfono) puede insertar
CREATE POLICY "Service role can insert solicitudes"
  ON public.solicitudes_pendientes FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "Service role can select solicitudes"
  ON public.solicitudes_pendientes FOR SELECT
  TO service_role USING (true);

-- ============================================================
-- NOTIFICACIONES DEL DASHBOARD
-- Notificaciones internas para que el restaurante vea alertas
-- desde el panel de administración.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notificaciones_dashboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  -- Valores: 'solicitud_pendiente', 'reserva_nueva', 'sistema'
  titulo TEXT NOT NULL,
  mensaje TEXT,
  referencia_id UUID,
  -- ID de la solicitud o reserva relacionada
  referencia_tipo TEXT,
  -- 'solicitud' | 'reserva'
  leida BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_notificaciones_leida ON public.notificaciones_dashboard(leida) WHERE leida = false;
CREATE INDEX IF NOT EXISTS idx_notificaciones_created ON public.notificaciones_dashboard(created_at DESC);

-- RLS
ALTER TABLE public.notificaciones_dashboard ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view notificaciones"
  ON public.notificaciones_dashboard FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can update notificaciones"
  ON public.notificaciones_dashboard FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can insert notificaciones"
  ON public.notificaciones_dashboard FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Service role can insert notificaciones"
  ON public.notificaciones_dashboard FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "Service role can select notificaciones"
  ON public.notificaciones_dashboard FOR SELECT
  TO service_role USING (true);

-- ============================================================
-- TRIGGER: Auto-crear notificación al insertar solicitud
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_notificar_solicitud()
RETURNS TRIGGER AS $$
DECLARE
  titulo_notif TEXT;
BEGIN
  CASE NEW.motivo_rechazo
    WHEN 'grupo_grande' THEN
      titulo_notif := 'Solicitud de grupo grande (' || COALESCE(NEW.numero_comensales::text, '?') || ' personas)';
    WHEN 'sin_disponibilidad' THEN
      titulo_notif := 'Solicitud sin disponibilidad para ' || COALESCE(TO_CHAR(NEW.fecha_solicitada, 'DD/MM'), '?');
    WHEN 'reserva_hoy' THEN
      titulo_notif := 'Solicitud de reserva para hoy';
    WHEN 'fuera_horario' THEN
      titulo_notif := 'Solicitud fuera de horario';
    WHEN 'corte_horario' THEN
      titulo_notif := 'Solicitud con poco margen horario';
    WHEN 'max_reservas_telefono' THEN
      titulo_notif := 'Cliente superó límite de reservas por teléfono';
    WHEN 'max_reservas_email' THEN
      titulo_notif := 'Cliente superó límite de reservas por email';
    ELSE
      titulo_notif := 'Nueva solicitud pendiente';
  END CASE;

  INSERT INTO public.notificaciones_dashboard (tipo, titulo, mensaje, referencia_id, referencia_tipo)
  VALUES (
    'solicitud_pendiente',
    titulo_notif,
    COALESCE(NEW.nombre, 'Cliente') || ' - Tel: ' || COALESCE(NEW.telefono, 'N/A') ||
      ' - ' || COALESCE(NEW.numero_comensales::text, '?') || ' pers. ' ||
      COALESCE(TO_CHAR(NEW.fecha_solicitada, 'DD/MM/YYYY'), '') || ' ' || COALESCE(NEW.hora_solicitada, ''),
    NEW.id,
    'solicitud'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notificar_solicitud
  AFTER INSERT ON public.solicitudes_pendientes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notificar_solicitud();
