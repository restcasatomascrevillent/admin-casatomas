-- Create blacklist table for emails and phones
CREATE TABLE public.blacklist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('email', 'telefono')),
  valor TEXT NOT NULL,
  nombre TEXT,
  motivo TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tipo, valor)
);

-- Enable RLS
ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Authenticated users can view blacklist"
ON public.blacklist
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert blacklist"
ON public.blacklist
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update blacklist"
ON public.blacklist
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete blacklist"
ON public.blacklist
FOR DELETE
TO authenticated
USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_blacklist_updated_at
BEFORE UPDATE ON public.blacklist
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();