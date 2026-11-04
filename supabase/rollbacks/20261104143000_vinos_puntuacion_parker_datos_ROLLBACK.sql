set client_encoding = 'UTF8';
-- ROLLBACK de 20261104143000_vinos_puntuacion_parker_datos.sql. Aplicar a mano
-- SOLO si hay que deshacerlo.
--
-- Quita la puntuación Parker de los vinos que la migración rellenó, pero solo
-- si siguen con el MISMO valor (si alguien la cambió a mano en el panel, se
-- respeta). La columna se queda (la quita el rollback de 20261104140000).
begin;
set local lock_timeout = '5s';

update public."Vinos" v
   set puntuacion_parker = null,
       puntuacion_parker_anada = null
  from (values
    ('0b790f1a-03da-4f83-9c24-a6f0ab600b5a', 93, 2024),  -- Aaltos Blanco · 2024
    ('4b1d2247-12b9-4ffa-87b3-15df0a9c37f1', 94, 2023),  -- Ossian · 2023
    ('1214516e-edd2-4323-a044-12892572deb3', 89, 2023),  -- Bermejos (Lanzarote) · 2023
    ('b3a2d509-fb65-4400-8f24-35f1d705f0ce', 89, 2022),  -- Molitor Haus Klosterberg · 2022
    ('f04c83eb-6f74-4cce-bb74-46b4c2a6155d', 91, 2020),  -- Otazu (Chardonnay) · 2020
    ('3cc18639-ab51-49b4-93b2-695edde103ed', 88, 2019),  -- Lagar de Cervera · 2019
    ('4b7ebf1b-ca9e-4bd4-9697-7681c1a3e7ba', 97, 2023),  -- Leirana Genoveva · 2023
    ('813c4abb-4371-4dad-bc45-9360cf262e59', 94, 2022),  -- Pazo Barrantes · 2022
    ('869f78bc-2994-49a7-88b3-c5eec414b6df', 91, 2023),  -- Fefiñanes (Magnum) · 2023
    ('a21f8826-79e1-4662-9d9a-a0ac445a2e11', 91, 2023),  -- Fefiñanes · 2023
    ('dc364646-e73b-4b4f-8a64-c611abb6cef1', 88, 2019),  -- Lagar de Cervera (Magnum) · 2019
    ('4b111dd2-a09c-458a-9885-23638c072dcb', 93, 2018),  -- Viña Mein · 2018
    ('db8188b3-d7ac-4826-af2e-6d1e9b125f5e', 93, 2023),  -- El Paraguas · 2023
    ('a664cf8a-22ac-4fcd-86e2-1cd5246ae09a', 95, 2020),  -- Capellanía Reserva (Marqués de Murrieta) · 2020
    ('bc4b29d6-a9fa-40e4-8025-c7f12facc7e4', 89, 2016),  -- Godeval (Magnum) · 2016
    ('d7791c00-11e2-44cd-ab1d-9784a251e791', 90, 2016),  -- Godeval Cepas Vellas · 2016
    ('0bc74b8b-a40b-42ca-b892-976b5bfd5dc8', 92, null),  -- Ruinart Blanc de Blancs · sin añada (NV o saca)
    ('10be6613-ada0-4f56-9040-397322dab14e', 91, null),  -- Ruinart Rosé · sin añada (NV o saca)
    ('17783f91-d738-4c0c-8a41-c804691f37d8', 92, null),  -- Laurent‑Perrier Rosé Magnum · sin añada (NV o saca)
    ('1d2c19d4-9d36-4531-ad0a-4824109b43de', 96, 2002),  -- Dom Pérignon Plénitude 2 (2002) · 2002
    ('246cd25d-cf75-4eca-b2cb-72d5b5f6fb06', 95, 2013),  -- Dom Pérignon Vintage 2013 · 2013
    ('30cc8620-1c38-47fe-9204-b2ac7eb8eaa8', 93, 2015),  -- Laurent‑Perrier Millésimé · 2015
    ('43b2eb7f-9dd5-4270-9259-d66b0f2a651a', 95, null),  -- Krug Grande Cuvée 170ème Édition · sin añada (NV o saca)
    ('46f035f1-b2ca-4a69-b607-1806a93c6e8b', 93, 2016),  -- Moët Grand Vintage Rosé · 2016
    ('4a5bf9d9-d33e-4c58-bc1c-06eff214824f', 94, 2012),  -- Laurent‑Perrier Alexandra Rosé · 2012
    ('589fe171-e7f6-4f1c-8179-549d553e69f0', 97, 2016),  -- Louis Roederer Cristal · 2016
    ('5f98d412-135b-4f0d-979e-ba7c41162781', 93, 2005),  -- Dom Pérignon Rosé Vintage 2005 · 2005
    ('649ee78a-0e9e-4721-9868-01ac6ce89927', 96, null),  -- Laurent‑Perrier Grand Siècle · sin añada (NV o saca)
    ('7868ec03-9e7e-4d32-8e54-92d55964824a', 91, null),  -- Laurent‑Perrier La Cuvée · sin añada (NV o saca)
    ('7bd2fba7-244e-497c-b9f0-311dc36ec973', 93, 2016),  -- Moët & Chandon Grand Vintage · 2016
    ('abe8371f-60c9-45ca-8218-de51d04074ff', 94, 2015),  -- L. Roederer Brut Vintage Rosé 2015 · 2015
    ('b4536fd4-befe-4eb7-abba-4c56431d5da2', 92, null),  -- Laurent‑Perrier Rosé · sin añada (NV o saca)
    ('bbe44e79-bab7-4050-8fd8-55d721ee782a', 91, null),  -- Laurent‑Perrier Magnum · sin añada (NV o saca)
    ('c4774b34-0897-415c-b2c5-4b3cc2cf7e3e', 91, null),  -- Laurent‑Perrier Ultra Brut · sin añada (NV o saca)
    ('d2663b49-8a8b-478b-b55a-da292c026df0', 92, null),  -- L. Roederer Collection 243 · sin añada (NV o saca)
    ('dda98445-1106-466c-8020-6f9ca1c49cf5', 91, 2012),  -- L. Roederer Brut Vintage Rosé 2012 (Magnum) · 2012
    ('025139c6-042e-472b-9f3f-3e368c2012d0', 93, 2023),  -- Milsetentayseis La Peña Rosado (Magnum) · 2023
    ('6cce52a0-2fc7-48d3-8801-29ea2073e3b2', 93, 2021),  -- Abadía Retuerta Selección Especial · 2021
    ('d65dcbd3-4a7a-402e-80b4-a79b562714c8', 92, 2022),  -- El Sequé · 2022
    ('2caabdff-987d-4b46-9005-64c8536d8334', 94, 2023),  -- Mauro · 2023
    ('8ae1eafd-7999-4180-93dc-362364091af0', 97, 2022),  -- Terreus · 2022
    ('440003a6-1ddf-4b39-987d-72f3d1935ee3', 92, 2022),  -- Juan Gil Azul · 2022
    ('71df1c08-defa-415c-861f-9daa4fb54762', 94, 2021),  -- El Nido · 2021
    ('7477d8f5-3c41-45a9-8bd0-77247ef2aeca', 93, 2023),  -- Clio · 2023
    ('52eefbc4-b1e4-490a-872d-80647b067f6a', 95, 2017),  -- Finca Dofí 2017 · 2017
    ('9ae67aad-56ae-48e7-8c93-0c13614e51ec', 96, 2023),  -- Finca Dofí · 2023
    ('0628c633-b086-40f6-bcb7-125f64081d4b', 94, 2023),  -- Pícaro del Águila · 2023
    ('27696aa0-c54f-4baa-a65a-cd0442de84bb', 93, 2022),  -- Dominio del Pidio · 2022
    ('2e6a2e86-db54-4f26-937c-77f7f0708fac', 99, 2023),  -- Pingus · 2023
    ('40297e09-ca98-499f-bad5-c8fa36afdaf1', 92, 2022),  -- La Hormiga (Antídoto) · 2022
    ('43187593-0677-4f4b-9583-a3838dabd7f2', 94, 2022),  -- Aalto PS · 2022
    ('474b23ff-1c6e-4f6d-b25c-736e0640525d', 95, 2021),  -- Carraovejas Cuesta de las Liebres · 2021
    ('540c1075-8c8e-4a70-9fe7-d499b293741d', 93, 2023),  -- Carraovejas (Magnum) · 2023
    ('55c0d225-bb5a-424f-a3cb-a7ca81face5f', 97, 2010),  -- Único 2010 (Vega Sicilia) · 2010
    ('57cf57dc-6ce5-4407-adbb-d3d337bf1544', 94, 2022),  -- Ausàs Interpretación · 2022
    ('5bcf2f8f-f152-41f7-b583-45614728e928', 94, 2021),  -- Aalto 2021 · 2021
    ('6064cef2-c768-4c7c-9853-2409ff2b6270', 93, 2023),  -- Pago de Carraovejas · 2023
    ('61739fd3-7623-405f-b0d9-573a476df532', 92, 2022),  -- La Hormiga (Magnum) · 2022
    ('6278535b-bf41-4387-b017-9d77e51d4ab8', 94, 2021),  -- Carraovejas El Anejón (Magnum) · 2021
    ('64a0b92a-2903-406c-bee5-4ee40a0333f3', 96, 2018),  -- Vega Sicilia Valbuena 2018 · 2018
    ('64a1e485-69b4-4e50-a671-546cdcbf9cb9', 93, 2022),  -- Milsetentayseis Tinto · 2022
    ('701d9b3a-35c2-43a5-a613-b041886538a5', 95, 2022),  -- Alión · 2022
    ('82a51e05-5a64-47cc-92eb-b0fba170310c', 95, 2023),  -- Flor de Pingus · 2023
    ('9848ae25-9051-4a7f-bbfc-1474445f39db', 94, 2023),  -- Pícaro del Águila (Magnum) · 2023
    ('a62be9fe-cea2-49d1-9dcf-b0a988510afd', 97, 2021),  -- Dominio del Águila Reserva · 2021
    ('a8b39469-df9b-41bd-89a5-4b9c56c95775', 98, null),  -- Único Reserva Especial · sin añada (NV o saca)
    ('a93997fc-7a24-44fa-856e-099a5a181901', 94, 2022),  -- Dominio de Es · 2022
    ('b550e328-7b1b-4e5b-8442-1d8b5161e771', 93, 2021),  -- Dominio de Calogía · 2021
    ('bee12e20-f39c-4941-bf06-3d41802d06c2', 95, 2019),  -- Vega Sicilia Valbuena 2019 · 2019
    ('bf7a0cc1-9eaa-46b5-8c32-4fa4bca55cf1', 94, 2021),  -- Carraovejas El Anejón · 2021
    ('c46d83de-a368-4378-877d-58606d1a8219', 93, 2019),  -- Dominio de Calogía Cuvée S · 2019
    ('c845e388-6954-4b1f-b5dc-36064f06043f', 93, 2021),  -- Dominio de Calogía (Magnum) · 2021
    ('c9903817-6d30-4d69-a96f-0cdc8bbf8495', 94, 2023),  -- PSI (Magnum) · 2023
    ('de338bf4-f6e9-47b0-b933-fd3ab0e33e92', 96, 2018),  -- Vega Sicilia Valbuena 2018 (Magnum) · 2018
    ('e59baae8-5310-4264-80f0-31bb3f1e7bfb', 94, 2023),  -- PSI · 2023
    ('068f7c8f-4402-45db-9423-cc60884f153c', 96, 2021),  -- Finca el Bosque 2021 · 2021
    ('0bf32fa1-51aa-45af-9882-a11fc391b509', 95, 2021),  -- Martelo · 2021
    ('1afe9a7d-c4c1-4dea-9d52-c6df8cd13f08', 93, 2017),  -- Viña Arana · 2017
    ('2564cf67-b7d9-4425-9ef5-cb2d39d5bc60', 94, 2022),  -- Marqués de Murrieta Reserva · 2022
    ('345729aa-0a2e-464a-bca8-05409784f668', 95, 2011),  -- La Rioja Alta Gran Reserva 890 · 2011
    ('465516c9-e18b-40d7-b94b-e0467d9931bf', 98, 2023),  -- La Nieta · 2023
    ('487db83a-c938-42d9-b91c-c94bd8045d3d', 95, 2018),  -- Remelluri Reserva · 2018
    ('4f2bdba3-9850-4a7d-aa56-fb406a2f3424', 93, 2022),  -- Sierra Cantabria Colección Privada · 2022
    ('b0d47317-673b-4cb2-a787-48081719ba9e', 96, 2016),  -- Gran Reserva 904 (La Rioja Alta) · 2016
    ('b0e1e435-ce02-4a0d-97f8-88ccaf480acc', 98, 2024),  -- Quiñón de Valmira · 2024
    ('b92c7303-2518-49d3-9d5c-c4a8c3035d0d', 94, 2020),  -- Macán 2020 · 2020
    ('bd089798-4d9a-4f4c-b9f0-6046e372a07e', 94, 2020),  -- Viña Ardanza · 2020
    ('db3a2a1c-861e-4ca2-aaf6-4dba66d3cdb6', 94, 2020),  -- Macán Clásico 2020 · 2020
    ('ec7978fd-a0e0-4168-86bc-4b80b46fd6cf', 97, 2012),  -- Castillo de Ygay Gran Reserva · 2012
    ('f6a51933-16bb-4056-bfe6-71ac2f6b92e7', 93, 2022),  -- San Vicente 2022 · 2022
    ('4763a3d1-6e66-4dc5-9101-649690958baf', 94, 2022),  -- Artadi Valdeginés · 2022
    ('ae2f2950-716b-469a-ad33-42cac0c9066e', 94, 2022),  -- El Titán del Bendito · 2022
    ('d9739ae1-244c-44d1-98e4-8c80fde44a5d', 95, 2023)   -- Victorino 2023 · 2023
  ) as d(id, puntos, anada)
 where v.id = d.id
   and v.puntuacion_parker = d.puntos
   and v.puntuacion_parker_anada is not distinct from d.anada;

commit;
