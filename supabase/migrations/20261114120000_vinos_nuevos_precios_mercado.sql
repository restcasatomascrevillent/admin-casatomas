-- Precios de los 40 vinos nuevos: precio de tienda (busqueda web) x multiplicador de la casa por tramo.
-- Tramos (calibrados con Pazo Barrantes, Aalto PS, Baron de Chirel): <=12:2.5 <=20:2.3 <=30:1.9 <=45:1.45 >45:1.4
-- Los marcados SIN PRECIO conservan la estimacion anterior. Solo vinos aun sin publicar.
begin;
update "Vinos" set precio_eur=35.5 where id like 'e4ee83fb%' and activado=false and restaurante=false;  -- Casar Godello Viñedos en Propiedad
update "Vinos" set precio_eur=52 where id like '88f8aa7d%' and activado=false and restaurante=false;  -- Emilio Moro La Revelía
update "Vinos" set precio_eur=81 where id like '4c13d509%' and activado=false and restaurante=false;  -- Chivite 125 Blanco
update "Vinos" set precio_eur=53 where id like '117a840e%' and activado=false and restaurante=false;  -- Brión Cepas Vellas
update "Vinos" set precio_eur=35 where id like '9d21dc0b%' and activado=false and restaurante=false;  -- El Perro Verde Selección Especial
update "Vinos" set precio_eur=24.5 where id like 'd0e8cab8%' and activado=false and restaurante=false;  -- Juvé Ermita d'Espiells
update "Vinos" set precio_eur=46 where id like '40219f07%' and activado=false and restaurante=false;  -- Quinta da Muradella Alanda
update "Vinos" set precio_eur=79.5 where id like 'd387d56d%' and activado=false and restaurante=false;  -- Quinta da Muradella Gorvia
update "Vinos" set precio_eur=57 where id like 'c9d7c2f5%' and activado=false and restaurante=false;  -- Gerardo Méndez Cepas Vellas
update "Vinos" set precio_eur=32.5 where id like '93ba7e7f%' and activado=false and restaurante=false;  -- Maior de Mendoza Sobre Lías
update "Vinos" set precio_eur=52 where id like '3c4e1770%' and activado=false and restaurante=false;  -- Paco & Lola Vintage 2018
update "Vinos" set precio_eur=175 where id like '5feb592f%' and activado=false and restaurante=false;  -- Pazo Barrantes La Comtesse
update "Vinos" set precio_eur=36.5 where id like '30df5532%' and activado=false and restaurante=false;  -- Pazo Señorans 2025
update "Vinos" set precio_eur=77.5 where id like '82498517%' and activado=false and restaurante=false;  -- Pazo Señorans Selección de Añada
update "Vinos" set precio_eur=75 where id like 'ce1cd5f9%' and activado=false and restaurante=false;  -- Emilio Rojo Castes Branco
update "Vinos" set precio_eur=85 where id like '585b9e1b%' and activado=false and restaurante=false;  -- Qué Bonito Cacareaba
update "Vinos" set precio_eur=180.5 where id like 'f8153e46%' and activado=false and restaurante=false;  -- Tondonia Reserva Blanco 2014
update "Vinos" set precio_eur=90 where id like 'b40a02b0%' and activado=false and restaurante=false;  -- Sierra Cantabria Gran Vino
update "Vinos" set precio_eur=63.5 where id like '5f91a87f%' and activado=false and restaurante=false;  -- Ysios Blanco
update "Vinos" set precio_eur=36.5 where id like '9504466d%' and activado=false and restaurante=false;  -- Riscal Finca Montico 2024
update "Vinos" set precio_eur=58.5 where id like 'e4f95b3e%' and activado=false and restaurante=false;  -- A Coroa 200 Cestos
update "Vinos" set precio_eur=80 where id like '2253d847%' and activado=false and restaurante=false;  -- Rafael Palacios As Sortes
update "Vinos" set precio_eur=70.5 where id like '918a0b90%' and activado=false and restaurante=false;  -- Tantum Ergo Cava 2015
update "Vinos" set precio_eur=91.5 where id like 'a34df870%' and activado=false and restaurante=false;  -- Bollinger Special Cuvée
update "Vinos" set precio_eur=135 where id like '3393f537%' and activado=false and restaurante=false;  -- Laurent-Perrier Blanc de Blancs
update "Vinos" set precio_eur=93 where id like '0e213a1d%' and activado=false and restaurante=false;  -- Laurent-Perrier Héritage
update "Vinos" set precio_eur=140 where id like 'be82c492%' and activado=false and restaurante=false;  -- Roederer Rosé Vintage 2016
update "Vinos" set precio_eur=73 where id like '2dbb8e85%' and activado=false and restaurante=false;  -- Michel Gonet 3 Terroirs 2018
update "Vinos" set precio_eur=1250 where id like 'bfc151ad%' and activado=false and restaurante=false;  -- Salon 2013
update "Vinos" set precio_eur=79.5 where id like '4e63cd1b%' and activado=false and restaurante=false;  -- Veuve Clicquot Carte Jaune
update "Vinos" set precio_eur=25 where id like '12724d27%' and activado=false and restaurante=false;  -- Donna Gloria Prosecco
update "Vinos" set precio_eur=120 where id like '86aeaa2e%' and activado=false and restaurante=false;  -- Casar de Burbia El Castañal
update "Vinos" set precio_eur=168 where id like '83ae3d93%' and activado=false and restaurante=false;  -- Artadi San Lázaro 2022
update "Vinos" set precio_eur=224 where id like 'f09fc7a2%' and activado=false and restaurante=false;  -- Benjamín Romeo El Sauco 2017
update "Vinos" set precio_eur=112 where id like '3d4b2c14%' and activado=false and restaurante=false;  -- Château Giscours 2022
update "Vinos" set precio_eur=95 where id like '6658d43a%' and activado=false and restaurante=false;  -- Bouzy Rouge 2012
update "Vinos" set precio_eur=105.5 where id like '44fec55b%' and activado=false and restaurante=false;  -- Munierro de Antídoto 2022
update "Vinos" set precio_eur=65 where id like 'c0f6c61c%' and activado=false and restaurante=false;  -- Macán Clásico 2021
update "Vinos" set precio_eur=80 where id like 'e544d689%' and activado=false and restaurante=false;  -- Remírez de Ganuza Iraila Garnacha
update "Vinos" set precio_eur=52 where id like '5e0d6555%' and activado=false and restaurante=false;  -- Vatan 2023
commit;
