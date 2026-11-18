set client_encoding = 'UTF8';
-- Deshace 20261212420000_tickets_documentos_automaticos: quita los disparadores y las funciones. Los tickets ya creados se quedan
-- (son tickets normales); se pierden solo origen y clave_origen.
set lock_timeout = '5s';

drop trigger if exists trg_facturas_ticket_revision on public.facturas;
drop trigger if exists trg_ocr_trabajos_ticket_fallo on public.ocr_trabajos;
drop function if exists public.facturas_ticket_revision();
drop function if exists public.ocr_trabajos_ticket_fallo();
drop function if exists public.documentos_tickets_pendientes(date);
drop function if exists public.documento_ticket_revisar(bigint);
drop index if exists public.peticiones_clave_origen_uq;
alter table public.peticiones drop column if exists clave_origen;
alter table public.peticiones drop column if exists origen;
