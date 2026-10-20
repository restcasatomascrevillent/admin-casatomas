-- Mensaje que acompaña al PDF de factura. Conserva las plantillas existentes.
begin;
alter table public.plantilla_factura_cheques
  add column if not exists email_mensaje text not null
  default 'Gracias por tu compra. Adjuntamos la factura de tu cheque regalo de Casa Tomás.';
alter table public.plantilla_factura_cheques
  drop constraint if exists plantilla_factura_cheques_email_mensaje_check;
alter table public.plantilla_factura_cheques
  add constraint plantilla_factura_cheques_email_mensaje_check
  check (length(trim(email_mensaje)) between 1 and 3000);
notify pgrst, 'reload schema';
commit;
