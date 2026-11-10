# Añadas en el nombre y puntuaciones Parker aplicadas — 10/11/2026

Petición del dueño: «En los vinos revisar las puntuaciones Parker y que las aplique, así como las añadas de los vinos en el nombre según las fotos que hay subidas».

Datos: `cambios.json` (de aquí salen los scripts `supabase/seeds/20261110_vinos_anadas_parker_*.sql` con `node scripts/parker/generar-sql-anadas.mjs`). Prueba: `npm run test:vinos-anadas:db`.

## Qué se ha hecho

- Se han abierto las **208 fotos** de etiqueta subidas (copia de la demo del 10/11/2026) y se ha leído la añada solo cuando se ve con claridad.
- **113 vinos** ganan la añada en el nombre (y en «Añada que se sirve»): 79 activos y 34 desactivados. Las traducciones (EN/FR) se cambian igual.
- **8 vinos** se marcan «Sin añada (NV)» (champagnes y un fino sin año en la etiqueta); su nombre no cambia.
- Ningún nombre que ya llevaba año contradice la foto.
- Puntuación Parker de la **añada de la foto** buscada en 95 vinos activos: 9 verificadas (página abierta), 39 en revisión (vistas solo en el buscador), 47 no localizadas. Solo las verificadas salen en la web.
- 75 cambios en `vinos_puntuacion_parker` (66 filas nuevas, 9 corregidas).

**Por qué antes casi no salían puntuaciones:** la regla de la web (08/11) solo enseña la puntuación verificada **de la añada que se sirve**, y casi ningún vino tenía puesta esa añada. Al ponerla desde la foto se aplican las que ya estaban verificadas para esa añada. Además, la foto demuestra que muchas puntuaciones guardadas eran de **otra añada** (p. ej. El Nido: 94 de 2021, pero se sirve 2023): esas no se aplican, y se ha buscado la de la añada buena.

**Iconos Parker en la carta pública (vinos activos de la demo):** antes **6** → después **19**. Las «en revisión» pasarían a la web en cuanto se confirmen en el panel (botón «Confirmar» en la ficha, con la fuente abierta).

## Vinos activos: añada y puntuación

| Vino (antes → después) | Añada antes → después | Fuente de la añada | Parker en la web antes → después | Puntuación guardada para esa añada | Fuente de la puntuación |
|---|---|---|---|---|---|
| 912 de Altitud → **912 de Altitud 2023** | — → 2023 | foto: «[912 de altitud]² 2023» | — → — | 🟡 en revisión 93+ | [Vino Vintana (tienda suiza, fragmento Firecrawl)](https://www.vinovintana.ch/912-de-Altitud-9-Months-2023-0.75l/9208) |
| Aalto PS → **Aalto PS 2022** | — → 2022 | foto: «AALTO 2022 PS Ribera del Duero» | — → 94 | ✅ verificada 94 | [JJ Buckley Fine Wines (tienda)](https://www.jjbuckley.com/wine/2022-aalto-ps/2022-1717-750/) |
| Aaltos Blanco → **Aaltos Blanco 2023** | — → 2023 | foto: «AALTO Blanco de Parcela Fuente de las Hontanillas » | — → 93 | ✅ verificada 93 | [Ideavinos (tienda)](https://www.ideavinos.com/vino-aalto-blanco-de-parcela.html) |
| Abadía Retuerta Selección Especial → **Abadía Retuerta Selección Especial 2019** | — → 2019 | foto: «Abadía Retuerta Selección Especial -2019-» | — → 92 | ✅ verificada 92 | [Woodland Hills Wine Company](https://whwc.com/abadia-retuerta-sardon-de-duero-seleccion-especial-2019) |
| Alión → **Alión 2020** | — → 2020 | foto: «ALION 2020 Ribera del Duero» | — → 95 | ✅ verificada 95 | [JJ Buckley Fine Wines (tienda)](https://www.jjbuckley.com/wine/2020-vega-sicilia-alion/2020-7733-750/) |
| Artadi Valdeginés → **Artadi Valdeginés 2022** | — → 2022 | foto: «Artadi Valdeginés Paraje de Valparaíso 2022» | — → 94 | ✅ verificada 94 | [Grand Cru Wijnen](https://www.grandcruwijnen.nl/en/2022-artadi-valdegines) |
| Arzuaga → **Arzuaga 2022** | — → 2022 | foto: «Tinto Arzuaga Crianza 2022» | — → — | 🟡 en revisión 89 | [Licorea (tienda), fragmento de búsqueda](https://www.licorea.com/arzuaga-crianza-2022-en-p-2451.html) |
| Arzuaga Gran Reserva → **Arzuaga Gran Reserva 2018** | — → 2018 | foto: «Gran Reserva 2018 Tinto Arzuaga» | — → — | — no localizada |  |
| Ausàs Interpretación → **Ausàs Interpretación 2018** | — → 2018 | foto: «Ausàs Interpretación -2018-» | — → 95 | ✅ verificada 95 | [Vinissimus](https://www.vinissimus.com/en/wine/ausas-interpretacion/) |
| Bahía de Dénia → **Bahía de Dénia 2024** | — → 2024 | foto: «Bahía de Dénia Vino Blanco de la Marina Alta 2024» | — → — | — no localizada |  |
| Balbás Ancestral → **Balbás Ancestral 2020** | — → 2020 | foto: «Collarín: 2020 Tempranillo, 2755 de 15237» | — → — | — no localizada |  |
| Bermejos (Lanzarote) → **Bermejos (Lanzarote) 2025** | — → 2025 | foto: «Bermejo Malvasía Volcánica Seco 2025 Lanzarote» | — → — | — no localizada |  |
| Bosque de Matasnos → **Bosque de Matasnos 2022** | — → 2022 | foto: «Bosque de Matasnos 2022 Ribera del Duero» | — → — | — no localizada |  |
| Bosque de Matasnos (Magnum) → **Bosque de Matasnos 2022 (Magnum)** | — → 2022 | foto: «Bosque de Matasnos 2022 Ribera del Duero» | — → — | — no localizada |  |
| Carraovejas (Magnum) → **Carraovejas 2023 (Magnum)** | — → 2023 | foto: «Pago de Carraovejas Finca y Bodega 2023» | — → 92 | ✅ verificada 92 | [Grandcruwijnen.nl](https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas) |
| Carraovejas Cuesta de las Liebres → **Carraovejas Cuesta de las Liebres 2019** | — → 2019 | foto: «Cuesta de las Liebres Grandes Añadas 2019» | — → — | 🟡 en revisión 95 | [Vinissimus (fragmento de buscador)](https://vinissimus.com/es/vino/pago-de-carraovejas-cuesta-de-las-liebres) |
| Carraovejas El Anejón → **Carraovejas El Anejón 2018** | — → 2018 | foto: «El Anejón Añadas Excepcionales 2018» | — → 93 | ✅ verificada 93 | [Wine.com](https://www.wine.com/product/pago-de-carraovejas-el-anejon-2018/1308340) |
| Carraovejas El Anejón (Magnum) → **Carraovejas El Anejón 2018 (Magnum)** | — → 2018 | foto: «El Anejón Añadas Excepcionales 2018» | — → 93 | ✅ verificada 93 | [Wine.com](https://www.wine.com/product/pago-de-carraovejas-el-anejon-2018/1308340) |
| Castillo de Ygay Gran Reserva → **Castillo de Ygay Gran Reserva 2012** | — → 2012 | foto: «Castillo Ygay Gran Reserva Especial Cosecha 2012» | — → 97 | ✅ verificada 97 | [Maisons Marques & Domaines (importador de la bodega en EE. UU.)](https://mmdusa.net/reviews/P35?children%3Acf_review_vintage%3Acf_vintages_wine%3Awine_brand=marques-de-murrieta) |
| Clio → **Clio 2023** | — → 2023 | foto: «CLIO 2023» | — → — | 🟡 en revisión 93 | [Fragmentos de búsqueda (Winehouse, Gourmet Hunters, Woods Wholesale Wine, Marketview Liquor)](https://www.winehouse.com/product/2023-bodegas-el-nido-clio-jumilla-8z5iimotsbj8j) |
| Collet Rosé | — → NV | foto: «Champagne Collet Brut Rosé; collarín 'Depuis 1921'» | — → — | — sin buscar |  |
| Conde de los Andes → **Conde de los Andes 2019** | — → 2019 | foto: «Conde de los Andes Bodegas Ollauri Vino Blanco 201» | — → — | — no localizada |  |
| Dominio de Calogía → **Dominio de Calogía 2020** | — → 2020 | foto: «Dominio de Calogía Ribera del Duero 2020» | — → — | 🟡 en revisión 93 | [WineBid (subasta), fragmento de búsqueda](https://www.winebid.com/BuyWine/Item/Auction/1788148) |
| Dominio de Calogía (Magnum) → **Dominio de Calogía 2020 (Magnum)** | — → 2020 | foto: «Dominio de Calogía Ribera del Duero 2020» | — → — | 🟡 en revisión 93 | [WineBid (fragmento de búsqueda)](https://www.winebid.com/BuyWine/Item/Auction/1788148) |
| Dominio de Calogía Doble M → **Dominio de Calogía Doble M 2020** | — → 2020 | foto: «Dominio de Calogía Doble M 2020» | — → — | — no localizada |  |
| Dominio del Pidio → **Dominio del Pidio 2021** | — → 2021 | foto: «2021 Dominio del Pidio» | — → — | 🟡 en revisión 94 | [MRD Wine (tienda), fragmento de búsqueda](https://www.mrdwine.com/collections/all/products/dominio-del-pidio-ribera-del-duero-spain-2021) |
| Dominio del Águila Reserva → **Dominio del Águila Reserva 2020** | — → 2020 | foto: «Dominio del Águila Reserva 2020» | — → — | 🟡 en revisión 97 | [Varias tiendas (Zachys, Gourmet Hunters, IPO Wines… resumen de WebSearch)](https://www.ipowines.com/wine/2020-dominio-del-aguila-ribera-del-duero-reserva) |
| El Canto de la Alondra → **El Canto de la Alondra 2022** | — → 2022 | foto: «20 / 22 (vertical, esquina superior derecha)» | — → — | — no localizada |  |
| El Corral de Taruguín → **El Corral de Taruguín 2018** | — → 2018 | foto: «El Corral de Taruguín 2018, Botella nº 620 de ...» | — → — | — no localizada |  |
| El Nido → **El Nido 2023** | — → 2023 | foto: «2023 EL NIDO» | — → — | 🟡 en revisión 93 | [Grand Cru Wijnen / Gourmet Hunters (resumen de WebSearch)](https://www.grandcruwijnen.nl/en/2023-bodegas-el-nido-nido) |
| El Sequé → **El Sequé 2022** | — → 2022 | foto: «El Sequé Monastrell 2022 Alicante» | — → 92+ | ✅ verificada 92+ | [Vinissimus](https://www.vinissimus.co.uk/en/wine/el-seque/) |
| Fefiñanes → **Fefiñanes 2024** | — → 2024 | foto: «Escudo: 2024; 'Marca registrada en 1928'» | — → — | — no localizada |  |
| Fefiñanes (Magnum) → **Fefiñanes 2024 (Magnum)** | — → 2024 | foto: «Escudo: 2024; 'Marca registrada en 1928'» | — → — | — no localizada |  |
| Flor de Pingus → **Flor de Pingus 2023** | — → 2023 | foto: «Flor de Pingus 2023» | — → — | 🟡 en revisión 93-94 (provisional) | [K&L Wines / 67Wine (fragmentos de búsqueda)](https://shop.klwines.com/products/details/1954671) |
| G.H. Martel Prestige Brut | — → NV | foto: «Champagne G.H. Martel & Co Prestige Brut; 'Fondé e» | — → — | — sin buscar |  |
| Gran Reserva 904 (La Rioja Alta) → **Gran Reserva 904 (La Rioja Alta) 2015** | — → 2015 | foto: «La Rioja Alta Selección Especial 2015 Gran Reserva» | — → — | 🟡 en revisión 95 | [Fragmentos de buscador (Bottle Barn y otros distribuidores EE. UU.)](https://bottlebarn.com/products/2015-la-rioja-alta-904-gran-reserva-rioja) |
| José Pariente Sauvignon Blanc → **José Pariente Sauvignon Blanc 2024** | — → 2024 | foto: «José Pariente · 2024 · Sauvignon Blanc» | — → — | — no localizada |  |
| L. Beyer Gewurz Comtes d'Eguisheim → **L. Beyer Gewurz Comtes d'Eguisheim 2009** | — → 2009 | foto: «Comtes d'Eguisheim · Gewurztraminer 2009 · Léon Be» | — → — | — no localizada |  |
| La Nieta → **La Nieta 2024** | — → 2024 | foto: «Medallón del hombro: 20 / 24» | — → — | — no localizada |  |
| La Rioja Alta Gran Reserva 890 → **La Rioja Alta Gran Reserva 890 2010** | — → 2010 | foto: «2010 · Gran Reserva 890 · Bodegas fundadas en 1890» | — → — | 🟡 en revisión 97 | [Fragmentos de buscador (Bottle Barn, varios distribuidores)](https://bottlebarn.com/products/2010-la-rioja-alta-rioja-gran-reserva-890) |
| Ladoucette Pouilly‑Fumé → **Ladoucette Pouilly‑Fumé 2022** | — → 2022 | foto: «Collarín: 2022 · Mise en bouteille dans nos chais» | — → — | — no localizada |  |
| Lagar de Cervera → **Lagar de Cervera 2024** | — → 2024 | foto: «Lagar de Cervera · Albariño · 2024» | — → — | — no localizada |  |
| Lagar de Cervera (Magnum) → **Lagar de Cervera 2024 (Magnum)** | — → 2024 | foto: «Lagar de Cervera · Albariño · 2024» | — → — | — no localizada |  |
| Laurent‑Perrier Alexandra Rosé → **Laurent‑Perrier Alexandra Rosé 2004** | — → 2004 | foto: «2004 · Champagne Alexandra · Grande Cuvée Rosé · M» | — → — | 🟡 en revisión 95 | [Vinfolio / JJ Buckley / otras tiendas (resumen de WebSearch)](https://www.vinfolio.com/product/67f9463668f9c0f62e013cbd/2004-laurent-perrier-grand-siecle-cuvee-alexandra-rose-laurent-perrier) |
| Laurent‑Perrier Millésimé → **Laurent‑Perrier Millésimé 2015** | — → 2015 | foto: «Millésimé 2015 · Maison fondée 1812 · Brut» | — → — | 🟡 en revisión 93 | [Zachys](https://www.zachys.com/products/laurent-perrier-brut-millesime-2015-750ml) |
| Louis Latour Chablis La Chanfleure → **Louis Latour Chablis La Chanfleure 2024** | — → 2024 | foto: «Medallón: Maison Louis Latour · 2024» | — → — | — no localizada |  |
| Marqués de Murrieta Reserva → **Marqués de Murrieta Reserva 2021** | — → 2021 | foto: «Marqués de Murrieta · 2021 · Desde 1852» | — → — | 🟡 en revisión 95 | [Marqués de Murrieta (blog de la bodega) / MMD USA (fragmentos de búsqueda)](https://marquesdemurrieta.com/blogs/news/marques-de-murrieta-sets-a-new-benchmark-with-its-latest-vintages) |
| Marqués de Riscal 150 Aniversario → **Marqués de Riscal 150 Aniversario 2017** | — → 2017 | foto: «Marqués de Riscal · Rioja · 15% vol · 2017 · 75cl » | — → — | — no localizada |  |
| Marqués de Riscal Barón de Chirel → **Marqués de Riscal Barón de Chirel 2020** | — → 2020 | foto: «Baron de Chirel · Rioja · 2020» | — → — | — no localizada |  |
| Martelo → **Martelo 2019** | — → 2019 | foto: «Finca Martelo · 2019 · Rioja» | — → — | 🟡 en revisión 94 | [Vino Fino NZ (tienda), fragmento de búsqueda](https://vinofino.co.nz/product/torre-de-ona-martelo-rioja-reserva-2019) |
| Mauro → **Mauro 2023** | — → 2023 | foto: «Mauro · Cosecha 2023» | — → — | 🟡 en revisión 94+ | [WHWC / Gourmet Hunters (fragmentos vía WebSearch)](https://whwc.com/mauro-mauro-vino-tinto-de-la-tierra-de-castilla-y-leon-2023/) |
| Moët & Chandon Grand Vintage → **Moët & Chandon Grand Vintage 2015** | — → 2015 | foto: «Moët & Chandon · 2015 · Grand Vintage · Extra Brut» | — → — | 🟡 en revisión 91 | [Chapel Hill Wine Company (resumen de WebSearch)](https://www.chapelhillwinecompany.com/wines/Moet-and-Chandon-Brut-Grand-Vintage-2015-w5650371x5) |
| Moët Grand Vintage Rosé → **Moët Grand Vintage Rosé 2015** | — → 2015 | foto: «Moët & Chandon · 2015 · Grand Vintage Rosé · Extra» | — → — | 🟡 en revisión 91 | [WineScout (tienda), fragmento de búsqueda](https://winescout.com/2015-moet-grand-vintage-brut) |
| Otazu (Chardonnay) → **Otazu (Chardonnay) 2024** | — → 2024 | foto: «OZU by Otazu · Chardonnay · 2024» | — → — | — no localizada |  |
| Otazu Altar → **Otazu Altar 2013** | — → 2013 | foto: «Bodega Otazu · Altar · 2013 · D.O.P. Pago de Otazu» | — → — | — no localizada |  |
| Otazu Premium Cuvée → **Otazu Premium Cuvée 2021** | — → 2021 | foto: «OZU by Otazu · Premium Cuvée · 2021» | — → — | — no localizada |  |
| Otazu Rosado → **Otazu Rosado 2024** | — → 2024 | foto: «OZU by Otazu · Rosé Tempranillo · 2024» | — → — | — no localizada |  |
| Ou Steen → **Ou Steen 2022** | — → 2022 | foto: «Longridge · Ou Steen · 2022 · Chenin Blanc; cápsul» | — → — | — no localizada |  |
| PSI (Magnum) → **PSI 2021 (Magnum)** | — → 2021 | foto: «Ψ Psi 2021» | — → — | 🟡 en revisión 93+ | [Comerciante citado en resumen de búsqueda (whwc.com u otro)](https://whwc.com/pingus-psi-ribera-del-duero-2021) |
| PSI → **PSI 2023** | — → 2023 | foto: «Ψ Psi 2023» | — → — | 🟡 en revisión 94 | [Cream Wine (resumen de WebSearch)](https://www.creamwine.com/product.php?id=22763) |
| Pago Santa Cruz → **Pago Santa Cruz 2021** | — → 2021 | foto: «Viña Sastre · Pago de Santa Cruz · 2021» | — → — | — no localizada |  |
| Pago de Carraovejas → **Pago de Carraovejas 2023** | — → 2023 | foto: «Pago de Carraovejas · Finca y Bodega · 2023» | — → — | 🟡 en revisión 92 | [Grand Cru Wijnen (fragmento de buscador)](https://www.grandcruwijnen.nl/en/2023-pago-de-carraovejas-magnum) |
| Pago de los Capellanes Crianza → **Pago de los Capellanes Crianza 2022** | — → 2022 | foto: «Pago de los Capellanes · Tinto Crianza · 2022» | — → — | 🟡 en revisión 91 | [Spainflavor (resumen de WebSearch)](https://en.spainflavor.com/wine/pago-capellanes-red-wine-2167450) |
| Pago de los Capellanes Crianza (Magnum) → **Pago de los Capellanes Crianza 2022 (Magnum)** | — → 2022 | foto: «Pago de los Capellanes · Tinto Crianza · 2022» | — → — | — no localizada |  |
| Pagos de Anguix → **Pagos de Anguix 2018** | — → 2018 | foto: «Pagos de Anguix · Barrueco · 2018» | — → — | — no localizada |  |
| Pazo Barrantes → **Pazo Barrantes 2020** | — → 2020 | foto: «Gran Vino Pazo Barrantes · Albariño · 2020» | — → — | 🟡 en revisión 94 | [MMD USA (importador, resumen de WebSearch)](https://mmdusa.net/portfolio/pazo-barrantes/gran-vino-albarino/2020) |
| Pingus → **Pingus 2023** | — → 2023 | foto: «Pingus · 2023» | — → — | 🟡 en revisión 98-100 (provisional) | [Grand Cru Wijnen (fragmento de buscador)](https://www.grandcruwijnen.nl/en/2023-dominio-de-pingus-pingus-1) |
| Piper‑Heidsieck | — → NV | foto: «Piper-Heidsieck · Champagne · Cuvée Brut · Maison » | — → — | — sin buscar |  |
| Pícaro del Águila → **Pícaro del Águila 2022** | — → 2022 | foto: «Tirilla: Cosecha 2022 · DCTV 644794; etiqueta: Vin» | — → — | 🟡 en revisión 94 | [Zachys / IPO Wines (fragmentos de búsqueda)](https://www.zachys.com/products/ribera-del-duero-picaro-tinto-dominio-del-aguila-2022-750ml) |
| Pícaro del Águila (Magnum) → **Pícaro del Águila 2022 (Magnum)** | — → 2022 | foto: «Tirilla: Cosecha 2022; etiqueta: Vino ecológico 20» | — → — | 🟡 en revisión 94 | [J.J. Buckley / PJ Wine / Zachys / Vinissimus (fragmentos de búsqueda)](https://www.jjbuckley.com/wine/2022-dominio-del-aguila-picaro-del-aguila-vinas-viejas/2022-1464890-750/) |
| Riscal XR → **Riscal XR 2021** | — → 2021 | foto: «Marqués de Riscal · Reserva 2021 · XR» | — → — | — no localizada |  |
| Ritus → **Ritus 2020** | — → 2020 | foto: «Ritus Balbás · 940 · viñedo en altitud; lateral: 2» | — → — | — no localizada |  |
| Sierra Cantabria Colección Privada → **Sierra Cantabria Colección Privada 2021** | — → 2021 | foto: «Sierra Cantabria · Colección Privada 2021» | — → — | 🟡 en revisión 94 | [Grand Cru Wijnen / Gourmet Hunters (fragmentos de búsqueda)](https://www.grandcruwijnen.nl/en/2021-sierra-cantabria-colleccion-privada) |
| Terras Gauda → **Terras Gauda 2023** | — → 2023 | foto: «Terras Gauda · 2023 · Rías Baixas · Botella Nº 367» | — → — | — no localizada |  |
| Terreus → **Terreus 2019** | — → 2019 | foto: «Terreus · 2019 · Paraje de Cueva Baja» | — → — | — no localizada |  |
| Tomás Postigo → **Tomás Postigo 2022** | — → 2022 | foto: «Tomás Postigo · 3er Año · Tinto 2022 · 750 ml» | — → — | — no localizada |  |
| Tomás Postigo (Magnum) → **Tomás Postigo 2022 (Magnum)** | — → 2022 | foto: «Tomás Postigo · 3er Año · Tinto 2022 · 1500 ml» | — → — | — no localizada |  |
| Tomás Postigo 5º Año → **Tomás Postigo 5º Año 2020** | — → 2020 | foto: «TOMÁS POSTIGO 5º AÑO – TINTO 2020» | — → — | — no localizada |  |
| Viña Arana → **Viña Arana 2017** | — → 2017 | foto: «VIÑA ARANA – GRAN RESERVA 2017» | — → 93 | ✅ verificada 93 | [Wine.com (ficha La Rioja Alta Vina Arana Rioja Gran Reserva 2017)](https://www.wine.com/product/la-rioja-alta-vina-arana-rioja-gran-reserva-2017/3613716) |
| Áster El Espino → **Áster El Espino 2020** | — → 2020 | foto: «áster El Espino Estate Bottled 2020» | — → — | — no localizada |  |
| Áster El Otero → **Áster El Otero 2018** | — → 2018 | foto: «áster Finca El Otero 2018» | — → — | 🟡 en revisión 95 | [Timeless Wines (fragmento Firecrawl)](https://www.timelesswines.com/bodegas-aster-finca-el-otero-2018/) |
| Áster Otero (Magnum) → **Áster Otero 2018 (Magnum)** | — → 2018 | foto: «áster Finca El Otero 2018» | — → — | — no localizada |  |

### Activos que ya tenían la añada en el nombre (puntuación revisada)

| Vino | Añada | Parker en la web antes → después | Puntuación guardada | Fuente |
|---|---|---|---|---|
| Brédif Vouvray 2022 | 2022 | — → — | — no localizada |  |
| Calados de Puntido Tempranillo 2015 | 2015 | — → — | — no localizada |  |
| Conde de los Andes Histórico 2004 | 2004 | — → — | — no localizada |  |
| Conde de los Andes Histórico 2005 | 2005 | — → — | — no localizada |  |
| Dom Pérignon Plénitude 2 (2002) | 2002 | — → — | 🟡 en revisión 95 | [Fragmentos de búsqueda (tiendas: FRW, Zachys, Pogo's)](https://www.frw.co.uk/product/612ec280010000000004817c/2002-dom-perignon-p2-dom-perignon) |
| Dom Pérignon Rosé Vintage 2005 | 2005 | — → 93 | ✅ verificada 93 | [JJ Buckley Fine Wines (tienda)](https://www.jjbuckley.com/wine/2005-moet-chandon-dom-perignon-rose/2005-862-750/) |
| Dom Pérignon Vintage 2013 | 2013 | — → — | 🟡 en revisión 95 | [Farr Vintners / Berry Bros. & Rudd / Vinofino (resumen de WebSearch)](https://www.farrvintners.com/wine.php?wine=87999) |
| Finca Dofí 2017 | 2017 | — → — | 🟡 en revisión 95 | [Dial A Bottle (fragmento de búsqueda)](https://dialabottle.com/shop/wine/red-wine/alvaro-palacios-finca-dofi-2017-750-ml-bottle) |
| Finca Monteviejo 2016 | 2016 | — → — | — no localizada |  |
| Finca el Bosque 2021 | 2021 | — → — | 🟡 en revisión 96 | [Total Wine (fragmento de búsqueda)](https://concierge.totalwine.com/product/2021-sierra-cantabria-rioja-finca-el-bosque) |
| Ladoucette Baron de L 2019 | 2019 | — → — | — no localizada |  |
| Léon Beyer Gewurztraminer 2021 | 2021 | — → — | — no localizada |  |
| Macán 2020 | 2020 | — → — | 🟡 en revisión 94+ | [Vinatis (fragmento de búsqueda)](https://www.vinatis.co.uk/74766-macan-2020-benjamin-de-rothschild-vega-sicilia) |
| Macán Clásico 2020 | 2020 | — → — | 🟡 en revisión 94 | [Gourmet Hunters / Vinissimus (fragmentos vía WebSearch)](https://www.gourmethunters.com/es/Macán+Clásico+2020) |
| Mein (Castes Brancas) 2024 | 2024 | — → — | — no localizada |  |
| San Vicente 2022 | 2022 | — → — | 🟡 en revisión 93 | [Grand Cru Wijnen / Gourmet Hunters / Decántalo (vistos solo en el resumen del buscador)](https://www.grandcruwijnen.nl/en/2022-senorio-san-vicente) |
| Vega Sicilia Valbuena 2018 | 2018 | — → — | 🟡 en revisión 96 | [vinello.eu (fragmento del buscador Firecrawl)](https://www.vinello.eu/vega-sicilia-valbuena-5-ribera-del-duero-vega-sicilia) |
| Vega Sicilia Valbuena 2018 (Magnum) | 2018 | — → — | 🟡 en revisión 96 | [vinello.eu (fragmento del buscador Firecrawl)](https://www.vinello.eu/vega-sicilia-valbuena-5-ribera-del-duero-vega-sicilia) |
| Victoire Vintage 2012 | 2012 | — → — | — no localizada | [Wine-Searcher](https://www.wine-searcher.com/find/g+h+martell+co+cuvee+victoire+brut+millesime+champagne+france/2012) |
| Victorino 2023 | 2023 | — → — | 🟡 en revisión 95 | [Wine.com (ficha Teso la Monja Victorino 2023), vista solo a través del buscador](https://www.wine.com/product/teso-la-monja-victorino-2023/4129342) |

## Vinos desactivados: añada desde la foto

Puntuación no buscada (no salen en la carta). Al reactivarlos, «Buscar puntuación» en la ficha.

| Vino (antes → después) | Añada | Texto leído en la foto |
|---|---|---|
| 200 Monges Reserva → **200 Monges Reserva 2014** | 2014 | 200 MONGES – RESERVA 2014 |
| Abadía Retuerta Le Domaine → **Abadía Retuerta Le Domaine 2022** | 2022 | ABADIA RETUERTA – Le Domaine blanco de guarda – 2022 – |
| Abadía Retuerta Pago Garduña → **Abadía Retuerta Pago Garduña 2019** | 2019 | ABADIA RETUERTA – PAGO Garduña – 2019 – syrah |
| Abadía Retuerta Pago Negralada → **Abadía Retuerta Pago Negralada 2018** | 2018 | ABADIA RETUERTA – PAGO Negralada – 2018 – tempranillo |
| Almirez → **Almirez 2023** | 2023 | ALMIREZ – TORO 2023 |
| Artadi Viñas de Gaín → **Artadi Viñas de Gaín 2021** | 2021 | ARTADI VIÑAS DE GAIN – Vineyard Selection – 2021 |
| Belondrade y Lurton → **Belondrade y Lurton 2022** | 2022 | BELONDRADE Y LURTON 2022 |
| Bollinger Special Cuvée Brut → **Bollinger Special Cuvée Brut** | NV | CHAMPAGNE BOLLINGER SPECIAL CUVÉE BRUT; collarín 'Maison fondée en 182 |
| Casar de Burbia Hombros Mencía → **Casar de Burbia Hombros Mencía 2020** | 2020 | CASAR DE BURBIA – HOMBROS MENCIA – COSECHA 2020 MANUAL |
| Castro do Coto Caíño Blanco → **Castro do Coto Caíño Blanco 2024** | 2024 | CASTRO DO COTO – CAÍÑO BLANCO – COLLEITA 2024 |
| Château Pindefleurs → **Château Pindefleurs 2022** | 2022 | CHÂTEAU PINDEFLEURS – Saint-Émilion Grand Cru – 2022 |
| Comando G Las Umbrías → **Comando G Las Umbrías 2023** | 2023 | LAS UMBRÍAS – Rozas de Puerto Real – 2023 |
| Comando G Rumbo al Norte → **Comando G Rumbo al Norte 2022** | 2022 | RUMBO AL NORTE – Villanueva de Ávila – 2022 |
| Contino Reserva → **Contino Reserva 2020** | 2020 | CONTINO – RESERVA 2020 |
| Corullón → **Corullón 2023** | 2023 | 2023 Corullón – Vino de Villa |
| Domaine Combe Queyzaire Côtes du Rhône → **Domaine Combe Queyzaire Côtes du Rhône 2019** | 2019 | DOMAINE COMBE QUEYZAIRE – 2019 – Côtes du Rhône |
| Dominio de Calogía Cuvée S → **Dominio de Calogía Cuvée S 2020** | 2020 | 2020 – Cuvée S – DOMINIO de CALOGÍA |
| El Confidente Godello → **El Confidente Godello 2024** | 2024 | El Confidente – GODELLO – 2024 – D.O. Valdeorras |
| El Puntido → **El Puntido 2022** | 2022 | Medallón del hombro '20 [árbol] 22'; etiqueta EL PUNTIDO – RIOJA |
| Fenomenal Verdejo → **Fenomenal Verdejo 2024** | 2024 | Fenomenal – VERDEJO 2024 – RUEDA |
| Gramona Brut Imperial Gran Reserva → **Gramona Brut Imperial Gran Reserva 2019** | 2019 | Gramona Imperial 2019 – CORPINNAT; collarín 'des de 1881' |
| Gramona Tres Lustros Gran Reserva → **Gramona Tres Lustros Gran Reserva 2017** | 2017 | Gramona III LUSTROS 2017 – FONT DE JUI – CORPINNAT |
| José Pariente Sauvignon Blanc (Magnum) → **José Pariente Sauvignon Blanc 2022 (Magnum)** | 2022 | JOSÉ PARIENTE 2022 – SAUVIGNON BLANC – RUEDA |
| Juvé & Camps Gran Juvé → **Juvé & Camps Gran Juvé 2017** | 2017 | Collarín: GRAN Juvé & Camps GRAN RESERVA ... BRUT 2017 |
| La Cueva del Contador → **La Cueva del Contador 2019** | 2019 | LA CUEVA DEL CONTADOR 2019 RIOJA |
| La Rioja Alta Gran Reserva 890 (Magnum) → **La Rioja Alta Gran Reserva 890 2010 (Magnum)** | 2010 | La Rioja Alta S.A. 2010 GRAN RESERVA 890 RIOJA |
| Laurent-Perrier Blanc de Blancs Brut Nature → **Laurent-Perrier Blanc de Blancs Brut Nature** | NV | CHAMPAGNE Laurent-Perrier MAISON FONDÉE 1812 BLANC DE BLANCS BRUT NATU |
| Laurent-Perrier Héritage Brut → **Laurent-Perrier Héritage Brut** | NV | CHAMPAGNE Laurent-Perrier MAISON FONDÉE 1812 HÉRITAGE BRUT |
| Marqués de Murrieta Reserva (Magnum) → **Marqués de Murrieta Reserva 2020 (Magnum)** | 2020 | MARQUÉS DE MURRIETA 2020 Desde 1852 RIOJA |
| Marqués de Vargas Reserva → **Marqués de Vargas Reserva 2017** | 2017 | MARQUÉS DE VARGAS RESERVA 2017 RIOJA |
| Oremus Mandolás Furmint → **Oremus Mandolás Furmint 2022** | 2022 | OREMUS FURMINT 2022 Mandolás Nº 012678 |
| Pago de Otazu Chardonnay → **Pago de Otazu Chardonnay 2020** | 2020 | PAGO DE OTAZU ·2020· CHARDONNAY CON CRIANZA |
| Pandora Verdejo → **Pandora Verdejo 2023** | 2023 | Pandora VERDEJO ECOLÓGICO Criado sobre Lías 2023 |
| Petra de Valpiedra Garnacha → **Petra de Valpiedra Garnacha 2017** | 2017 | PETRA de VALPIEDRA [3.3 ha] GARNACHA RIOJA 2017 |
| Pintia → **Pintia 2019** | 2019 | TORO PINTIA 2019 TEMPOS Vega Sicilia |
| Qué Bonito Cacareaba → **Qué Bonito Cacareaba 2021** | 2021 | Qué bonito Cacareaba 2021 RIOJA |
| Riscal XR (Magnum) → **Riscal XR 2019 (Magnum)** | 2019 | HEREDEROS DEL MARQUÉS DE RISCAL Reserva 2019 XR RIOJA |
| Veuve Clicquot Brut (Carte Jaune) → **Veuve Clicquot Brut (Carte Jaune)** | NV | CHAMPAGNE Veuve Clicquot BRUT; collarín 250 ANS |
| Viña Corrales Fino → **Viña Corrales Fino** | NV | VIÑA CORRALES BALBAÍNA FINO JEREZ DE LA FRONTERA; BOTTLED 20.. |

## Vinos sin añada aplicada (no se ha inventado)

| Vino | Activo | Motivo | Detalle |
|---|---|---|---|
| Balbás La Retama | sí | sin año legible | El año queda en el lateral de la etiqueta y no se ve completo. |
| Bobal Rosado Dulce | sí | sin año legible | No se ve ningún año en la etiqueta frontal ni en la tira del cuello. |
| Briego Tempranillo Roble | sí | sin año legible | No se ve año en la etiqueta frontal ni en el collarín visible. |
| Briego Tempranillo Roble (Magnum) | sí | sin año legible | Botella Magnum; no se ve año en la etiqueta frontal ni en el collarín visible. |
| Briego Tiempo Crianza | sí | sin año legible | No se ve año en la etiqueta frontal ni en el collarín visible. |
| Cerro del Buey | sí | sin año legible | Año partido en los laterales de la etiqueta; solo se leen los dos primeros dígitos. |
| Clos du Ciel | sí | sin año legible | No se ve ningún año en la etiqueta frontal. |
| Díaz Bayo 4U | sí | sin año legible | No se ve año en la etiqueta frontal. |
| Eduardo Peña | sí | sin año legible | No se ve año en la etiqueta frontal. |
| Figuero Noble | sí | sin año legible | No se ve año en la etiqueta frontal ni en el collarín. |
| Figuero Tinus | sí | sin año legible | No se ve año en la etiqueta frontal. |
| Finca Dofí | sí | usa la misma foto que «Finca Dofí 2017» (no es la suya) | La foto es idéntica a la de 'Finca Dofí 2017'. |
| Finca Villacreces Specimen Nº1 | sí | sin año legible | No se ve año de cosecha; 1102 en la tira del cuello es un número, no un año. |
| Godeval (Magnum) | sí | sin año legible | No se ve año en la etiqueta frontal ni en el collarín visible. |
| Milsetentayseis La Peña Rosado (Magnum) | sí | sin año legible | La etiqueta no muestra año. En el corcho asoma un año que empieza por '201' pero el último dígito es ilegible: no se pone. |
| Milsetentayseis Tinto | sí | sin año legible | No se ve ningún año en la etiqueta ni la cápsula. |
| Pazo Vedoira Camelia | sí | sin año legible | No se ve ningún año en la etiqueta visible. |
| Pazo de Rubianes | sí | sin año legible | No se ve ningún año en la serigrafía ni la cápsula. |
| Philippe Gonet Signature | sí | nv dudoso | Champagne sin año visible en etiqueta ni collarín. |
| Pousada | sí | sin año legible | No se ve ningún año en la etiqueta visible. |
| Quiñón de Valmira | sí | en producción ya existe «Quiñón de Valmira 2023»: renombrarlo lo duplicaría | Año pequeño en el lateral izquierdo de la etiqueta, se lee 2023 pero algo borroso al ampliar. El 'Nº' de la derecha es número de botella. |
| Vila do Corpus | sí | sin año legible | No se ve ningún año en la etiqueta frontal. |
| Brión Cepas Vellas | no | sin año legible | No se ve año en la etiqueta frontal. |
| Casal de Armán | no | sin año legible | No se ve año en la etiqueta frontal. |
| Castillo de Peñafiel Vendimia Seleccionada | no | sin año legible | No se ve año en la etiqueta frontal. |
| Château Sainte Marguerite Rosé | no | sin año legible | Botella serigrafiada sin etiqueta con año visible; no se ve añada. |
| Donna Gloria Prosecco Extra Dry | no | nv dudoso | No aparece año en etiqueta ni collarín; parece prosecco sin añada. |
| El Perro Verde Selección Especial | no | sin año legible | No se ve año en la parte visible de la botella. |
| Juan Gil Nácar | no | año poco nítido | Año en letra pequeña bajo el árbol; legible al ampliar. 'Desde 1916' es fundación, no añada. |
| L'ombre | no | sin año legible | No se ve ningún año en la etiqueta frontal visible. |
| Louro do Bolo | no | sin año legible | El año está impreso en vertical en el borde derecho de la etiqueta y queda cortado por la curvatura; solo se intuye '20' y no se pueden leer |
| Louro do Bolo (Magnum) | no | año poco nítido | Año impreso en vertical dentro de un círculo en el borde derecho; se lee 2024 pero pequeño y girado. |
| M de Alejandría (Dulce) | no | sin año legible | No hay año visible en la etiqueta. |
| Maior de Mendoza Sobre Lías Albariño | no | sin año legible | No se ve ningún año en la etiqueta visible. |
| Mikado Road Nº8 | no | sin año legible | No se ve año; 'Nº8' no es añada. |
| Montecillo Blanco Fermentado en Barrica | no | año poco nítido | Año en dorado sobre fondo verde, poco contraste; al ampliar se lee 2023. 'Desde 1870' es fundación. |
| Unzu Rosé Garnacha | no | sin año legible | No se ve año ni en etiqueta ni en collarín. '5 meses' no es añada. |

Además, **57 vinos sin foto subida** (47 activos) no tienen añada: hay que subir la foto o ponerla a mano.

## Avisos para revisar

- **Magnum con la misma foto que la botella de 75 cl** (la añada se ha tomado de esa foto; si el magnum es de otra añada, cámbiala en su ficha): Áster Otero, Bosque de Matasnos, Carraovejas El Anejón, Fefiñanes, Lagar de Cervera, Pícaro del Águila. La foto de «Carraovejas (Magnum)» parece una botella de 75 cl y la de «Dominio de Calogía» (75 cl) parece grande.
- **PSI** (2023) y **PSI (Magnum)** (2021) son añadas distintas según sus fotos.
- **Quiñón de Valmira**: la foto dice 2023, pero en producción ya existe «Quiñón de Valmira 2023» (otro vino). No se ha renombrado: decidir si son el mismo vino o si la foto es la equivocada.
- **Finca Dofí**: usa la misma foto que «Finca Dofí 2017». No se ha tocado.
- **Pazo la Cuesta** aparece dos veces activo con el mismo nombre (ya estaba así).
- **Conde de los Andes 2019**: una tienda atribuía 91 a Parker, pero al abrirla era de la Guía Peñín: queda no localizada.
- La regla del nombre: si ya lleva año se cambia el último; si no, se añade al final, delante de «(Magnum)».

## Límites

- Las fotos y los datos se han leído de la **demo** (copia de producción); la consulta de solo lectura a producción no estaba permitida en esta sesión. Los scripts solo cambian filas que siguen como en la demo: si en producción alguna es distinta, se salta y lo lista al final («saltados»). Los 6 vinos que solo están en producción ya llevan el año en el nombre.
- Durante la búsqueda se agotaron los créditos diarios de Firecrawl y la red de la sesión bloquea robertparker.com y la mayoría de tiendas: por eso muchas puntuaciones se quedan «en revisión» con su fuente (abrir el enlace y pulsar «Confirmar» en la ficha).
