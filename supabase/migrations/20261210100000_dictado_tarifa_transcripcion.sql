set client_encoding = 'UTF8';
-- Dictado por voz del panel (transcribir-dictado): tarifa de gpt-4o-mini-transcribe
-- en ia_precios (USD por 1M de tokens; audio de entrada 3,00 / salida 5,00, ~0,003 $/min;
-- el texto de entrada, 1,25, se cobra aquí al mismo precio: sobrestima un pelo, lado seguro)
-- y alta de la función en ia_funciones. Tarifa pública sin verificar contra factura.
insert into public.ia_precios (modelo, usd_por_m_input, usd_por_m_output, notas, fuente)
values ('gpt-4o-mini-transcribe', 3.00, 5.00, 'Transcripción de audio (dictado). Entrada de audio 3,00 $/M; ~0,003 $/min.', 'Página de precios de OpenAI')
on conflict (modelo) do nothing;

do $$
begin
  if to_regclass('public.ia_funciones') is not null then
    insert into public.ia_funciones (funcion, descripcion, instrumentada, unidad, orden)
    values ('transcribir-dictado',
            'Dictado por voz del panel (chat de Facturas) en navegadores sin reconocimiento de voz: transcribe un audio corto, sin guardarlo. Clave general OPENAI_API_KEY; disparador usuario:<uuid>.',
            true, 'petición', 96)
    on conflict (funcion) do nothing;
  end if;
end;
$$;
