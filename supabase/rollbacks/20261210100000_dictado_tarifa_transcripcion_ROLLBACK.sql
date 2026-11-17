set client_encoding = 'UTF8';
delete from public.ia_funciones where funcion = 'transcribir-dictado';
delete from public.ia_precios where modelo = 'gpt-4o-mini-transcribe';
