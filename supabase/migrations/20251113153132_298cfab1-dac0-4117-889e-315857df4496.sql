-- Crear tabla de perfiles de restaurantes
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_restaurante text NOT NULL,
  telefono varchar(20),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Habilitar RLS en profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "Los usuarios pueden ver su propio perfil"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Los usuarios pueden insertar su propio perfil"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Los usuarios pueden actualizar su propio perfil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger para actualizar updated_at en profiles
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Función para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nombre_restaurante, telefono)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre_restaurante', 'Mi Restaurante'),
    NEW.raw_user_meta_data->>'telefono'
  );
  RETURN NEW;
END;
$$;

-- Trigger para crear perfil al registrar usuario
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Añadir user_id a todas las tablas principales
ALTER TABLE public.trabajadores ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.salas ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.turnos ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.clientes ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.reservas ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.asignaciones_turno ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.historico_ocupacion ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.metricas_productividad ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.historial_reservas ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Crear índices para mejorar rendimiento
CREATE INDEX idx_trabajadores_user_id ON public.trabajadores(user_id);
CREATE INDEX idx_salas_user_id ON public.salas(user_id);
CREATE INDEX idx_turnos_user_id ON public.turnos(user_id);
CREATE INDEX idx_clientes_user_id ON public.clientes(user_id);
CREATE INDEX idx_reservas_user_id ON public.reservas(user_id);
CREATE INDEX idx_asignaciones_turno_user_id ON public.asignaciones_turno(user_id);

-- Actualizar políticas RLS para trabajadores
DROP POLICY IF EXISTS "Permitir lectura trabajadores" ON public.trabajadores;

CREATE POLICY "Los usuarios pueden ver sus propios trabajadores"
  ON public.trabajadores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propios trabajadores"
  ON public.trabajadores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propios trabajadores"
  ON public.trabajadores FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propios trabajadores"
  ON public.trabajadores FOR DELETE
  USING (auth.uid() = user_id);

-- Actualizar políticas RLS para salas
DROP POLICY IF EXISTS "Permitir lectura salas" ON public.salas;

CREATE POLICY "Los usuarios pueden ver sus propias salas"
  ON public.salas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias salas"
  ON public.salas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias salas"
  ON public.salas FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias salas"
  ON public.salas FOR DELETE
  USING (auth.uid() = user_id);

-- Políticas RLS para posiciones_sala
ALTER TABLE public.posiciones_sala ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios pueden ver posiciones de sus salas"
  ON public.posiciones_sala FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.salas 
    WHERE salas.id = posiciones_sala.sala_id 
    AND salas.user_id = auth.uid()
  ));

CREATE POLICY "Los usuarios pueden insertar posiciones en sus salas"
  ON public.posiciones_sala FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.salas 
    WHERE salas.id = posiciones_sala.sala_id 
    AND salas.user_id = auth.uid()
  ));

CREATE POLICY "Los usuarios pueden actualizar posiciones de sus salas"
  ON public.posiciones_sala FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.salas 
    WHERE salas.id = posiciones_sala.sala_id 
    AND salas.user_id = auth.uid()
  ));

CREATE POLICY "Los usuarios pueden eliminar posiciones de sus salas"
  ON public.posiciones_sala FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.salas 
    WHERE salas.id = posiciones_sala.sala_id 
    AND salas.user_id = auth.uid()
  ));

-- Políticas RLS para turnos
ALTER TABLE public.turnos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios pueden ver sus propios turnos"
  ON public.turnos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propios turnos"
  ON public.turnos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propios turnos"
  ON public.turnos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propios turnos"
  ON public.turnos FOR DELETE
  USING (auth.uid() = user_id);

-- Políticas RLS para clientes
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios pueden ver sus propios clientes"
  ON public.clientes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propios clientes"
  ON public.clientes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propios clientes"
  ON public.clientes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propios clientes"
  ON public.clientes FOR DELETE
  USING (auth.uid() = user_id);

-- Actualizar políticas RLS para reservas
DROP POLICY IF EXISTS "Permitir lectura reservas" ON public.reservas;

CREATE POLICY "Los usuarios pueden ver sus propias reservas"
  ON public.reservas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias reservas"
  ON public.reservas FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias reservas"
  ON public.reservas FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias reservas"
  ON public.reservas FOR DELETE
  USING (auth.uid() = user_id);

-- Políticas RLS para asignaciones_turno
ALTER TABLE public.asignaciones_turno ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios pueden ver sus propias asignaciones"
  ON public.asignaciones_turno FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias asignaciones"
  ON public.asignaciones_turno FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden actualizar sus propias asignaciones"
  ON public.asignaciones_turno FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden eliminar sus propias asignaciones"
  ON public.asignaciones_turno FOR DELETE
  USING (auth.uid() = user_id);

-- Políticas RLS para historico_ocupacion
ALTER TABLE public.historico_ocupacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios pueden ver su propio histórico"
  ON public.historico_ocupacion FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar su propio histórico"
  ON public.historico_ocupacion FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Políticas RLS para metricas_productividad
ALTER TABLE public.metricas_productividad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios pueden ver sus propias métricas"
  ON public.metricas_productividad FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar sus propias métricas"
  ON public.metricas_productividad FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Políticas RLS para historial_reservas
ALTER TABLE public.historial_reservas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Los usuarios pueden ver su propio historial"
  ON public.historial_reservas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios pueden insertar su propio historial"
  ON public.historial_reservas FOR INSERT
  WITH CHECK (auth.uid() = user_id);