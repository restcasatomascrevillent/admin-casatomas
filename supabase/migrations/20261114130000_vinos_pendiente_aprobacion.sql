-- Marcador «pendiente de aprobación» para vinos que hay que decidir a mano.
-- + precios de compra reales (facturas) x2,0 (multiplicador de la casa: Aalto PS 69,5->130,
--   Baron de Chirel 69->140, Victorino 26,9->54). Solo vinos aun sin publicar.
begin;
alter table "Vinos" add column if not exists pendiente_aprobacion boolean not null default false;
alter table "Vinos" add column if not exists nota_pendiente text;

update "Vinos" set precio_eur=26    where id like '9d21dc0b%' and activado=false and restaurante=false; -- El Perro Verde Sel. Especial (coste 12,90)
update "Vinos" set precio_eur=40    where id like '3c4e1770%' and activado=false and restaurante=false; -- Paco & Lola 2018 (coste 20,05)
update "Vinos" set precio_eur=120   where id like 'e544d689%' and activado=false and restaurante=false; -- Iraila 2024 (coste 60; confirmar que es el mismo vino)
update "Vinos" set precio_eur=112.5 where id like '86aeaa2e%' and activado=false and restaurante=false; -- El Castañal 2023 (coste 56,25)
update "Vinos" set precio_eur=126   where id like '3d4b2c14%' and activado=false and restaurante=false; -- Giscours 2022 (coste 63)

update "Vinos" set precio_eur=null, pendiente_aprobacion=true,
  nota_pendiente='Sin precio fiable: referencia ambigua (¿Meín Castes Brancas? tienda 21-32 €). Decidir vino y precio.'
  where id like 'ce1cd5f9%' and activado=false and restaurante=false;
update "Vinos" set precio_eur=null, pendiente_aprobacion=true,
  nota_pendiente='Sin precio fiable: solo salió 718 € de la añada 2011. Comprobar que existe este vino y fijar precio.'
  where id like 'b40a02b0%' and activado=false and restaurante=false;
update "Vinos" set precio_eur=null, pendiente_aprobacion=true,
  nota_pendiente='Sin precio en tiendas españolas (referencia 1.200-1.350 €). Fijar precio a mano.'
  where id like 'bfc151ad%' and activado=false and restaurante=false;
update "Vinos" set precio_eur=null, pendiente_aprobacion=true,
  nota_pendiente='Sin ofertas ni compras: vino raro (Bouzy rouge 2012). Decidir si se incorpora y precio.'
  where id like '6658d43a%' and activado=false and restaurante=false;
commit;
