# Repaso final de la clasificación de líneas de factura

Fecha: 05/11/2026. Scripts en `repaso/` (`s07_final.py` aplica `reglas.py`; `s09_informe.py` genera este documento).

## Recuentos

| | Entrada (16 salidas) | Final (`items_final.json`) |
|---|---|---|
| Textos `t` | 3.780 | 3780 (cada uno exactamente una vez) |
| Items | 2514 | 2103 (un item por producto) |
| Productos del catálogo usados (`producto_id`) | 169 items | 115 productos |
| Nombres nuevos distintos | 2109 | 1988 |
| **Productos finales** | | **2103** |
| Items con `duda` | 64 | 21 |

Validación superada: JSON válido; los 3.780 `t` de los lotes aparecen una sola vez; `categoria_id` siempre en {4…20}; todos los `producto_id` existen en `catalogo_actual.json`; nombres de 1-200 caracteres; ningún nombre (normalizado sin tildes ni mayúsculas) tiene dos familias ni aparece en dos items; ningún nombre nuevo coincide con uno del catálogo.

## Criterios aplicados

- Se une solo lo que es el mismo producto para comparar precios: plurales, orden de palabras, marca en alimentos y limpieza genéricos, calibre o peso de caja, añada en vinos.
- La marca sigue separando en vinos, licores, cervezas, refrescos y aguas; también se respeta en AOVE premium, quesos curados de marca propia (trufado), caviar, ostras de marca y cecinas de wagyu (cambian mucho el precio).
- Se mantienen separados fresco / congelado / cocido / en conserva / ahumado / salazón, y crianza / salvaje cuando cambia el precio.
- Formatos distintos de bebida (33 cl, lata, barril, 75 cl, magnum, 3 l…) siguen separados.
- No se meten textos de otro formato en un producto del catálogo cuyo nombre lleva formato (p. ej. «Leche condensada desnatada Prosalud 2,5 kg», «Salsa de tomate pouch 3,4 kg», «Limpiacristales Help LQ 80 5 L» no absorben otros tamaños).
- Conservas: de marisco en Marisco (18, como el ejemplo de las instrucciones) y de pescado en Pescado (17). Las que ya existían en el catálogo en Despensa (#251 atún, #298 ventresca de bonito, #281 mújol) se usan por `producto_id` (ver recomendaciones).
- Verdura y fruta congelada sin elaborar va en Frutas y verduras (5); en Congelados (8) solo quedan preparados.
- Siropes y purés para coctelería (Monin, Teisseire, granadina) en Despensa (6); bebidas «sin alcohol» (Drols, Tanqueray 0,0) en Refrescos (15).
- Carbón y material de encendido de la brasa: Servicios (11) como energía/combustible.
- Líneas genéricas de lonja sin especie: «Perciformes», «Pleuronectiformes», «Gadiformes» → **Pescado variado de lonja** (17); «Macruros», «Cefalópodos» y «Varios» (Narejos, 75 €/kg) → **Marisco variado de lonja** (18). Un único producto de cada, la línea conserva su proveedor.

## Unificaciones (99 productos destino que juntan 224 nombres de partida)

| Producto final | Fam. | Junta | Textos | Gasto |
|---|---|---|---|---|
| Huevo líquido pasteurizado | 4 | «Huevo entero líquido pasteurizado Ovopak» + «Huevo líquido pasteurizado 1 l» | 2 | 69,42 € |
| Leche de hostelería 1,5 l | 4 | «Leche Asturiana hostelería 1,5 l» + «Leche Puleva hostelería 1,5 l» | 3 | 1.524,97 € |
| Leche entera | 4 | «Leche entera 1 l» + «Leche entera Covap 1,5 l» | 3 | 71,48 € |
| Leche semidesnatada | 4 | «Leche Puleva semidesnatada 1 l» + «Leche semidesnatada Asturiana 1 l» | 2 | 485,28 € |
| #327 Leche semidesnatada sin lactosa Asturiana 1 L | 4 | «#327 Leche semidesnatada sin lactosa Asturiana 1 L» + «Leche semidesnatada sin lactosa Puleva 1 l» | 5 | 196,37 € |
| Mantequilla | 4 | «Mantequilla» + «Mantequilla Albiero 1 kg» + «Mantequilla Pont Morin 1 kg» + «Mantequilla Soresina 1 kg» | 7 | 646,75 € |
| Mantequilla en monodosis | 4 | «Mantequilla en porciones 10 g» + «Mantequilla en tarrina 10 g Reny Picot» | 2 | 29,30 € |
| Queso crema | 4 | «Queso Philadelphia original» + «Queso crema» + «Queso cremoso de untar cubo 3 kg» | 6 | 1.241,44 € |
| #330 Queso de rulo mezcla 1 kg | 4 | «#330 Queso de rulo mezcla 1 kg» + «Queso de rulo Mont de France» | 3 | 612,78 € |
| Queso feta | 4 | «Queso feta» + «Queso feta DOP Dodoni» + «Queso feta en salmuera» | 4 | 58,10 € |
| Queso manchego curado | 4 | «Queso de oveja curado manchego artesano El Pesebre» + «Queso manchego curado Adiano» | 2 | 1.929,97 € |
| Queso manchego semicurado | 4 | «Queso de oveja semicurado manchego artesano El Pesebre» + «Queso manchego semicurado Adiano» + «Queso manchego semicurado Arquero» | 3 | 385,95 € |
| Queso mezcla semicurado | 4 | «Queso mezcla semicurado» + «Queso semicurado mezcla Dialse» | 2 | 73,04 € |
| Queso provolone | 4 | «Queso provolone» + «Queso provolone Albiero» | 4 | 288,27 € |
| #324 Ajo blanco 1 kg | 5 | «#324 Ajo blanco 1 kg» + «Ajo pelado» | 4 | 666,63 € |
| Kiwi Sungold | 5 | «Kiwi Gold» + «Kiwi Sungold» | 8 | 231,18 € |
| Pimiento rojo | 5 | «Pimiento rojo» + «Pimiento rojo italiano» | 5 | 123,00 € |
| Setas variadas congeladas | 5 | «Mezcla de setas» + «Salteado de setas congelado» + «Setas variadas congeladas» | 4 | 212,19 € |
| Trufa de verano fresca | 5 | «Trufa de verano (Tuber aestivum)» + «Trufa de verano fresca» | 2 | 773,43 € |
| Trufa negra de invierno fresca | 5 | «Trufa negra (Tuber melanosporum)» + «Trufa negra de invierno fresca» | 3 | 1.772,38 € |
| Altramuces | 6 | «Altramuces» + «Altramuces Juferna 2 kg» | 3 | 50,00 € |
| Alubia cocida | 6 | «Alubia cocida» + «Alubias cocidas Luengo 2,6 kg» | 3 | 165,51 € |
| Arroz de grano medio | 6 | «Arroz de grano medio» + «Arroz extra 5 kg» | 3 | 63,01 € |
| #251 Atún claro en aceite Diamir | 6 | «Atún claro en aceite Claramar 1 kg» + «Atún claro en aceite Montey 900 g» + «Atún claro en aceite de girasol Navegante 900 g» + «Atún claro en aceite vegetal Arroyabe 900 g» + «Atún en aceite RO-1000 Cortizo» + «Atún en aceite de girasol Bachi 650 g» | 6 | 2.180,06 € |
| #321 Azúcar Alteza 1 kg | 6 | «Azúcar Azucarera 1 kg» + «Azúcar blanco 1 kg» + «Azúcar blanco Sucrebo 1 kg» | 6 | 373,33 € |
| Azúcar en sobres | 6 | «Azúcar Salzillo sobres 6 g» + «Azúcar en sobres corazón San Valentín» | 2 | 232,89 € |
| Colorante alimentario | 6 | «Colorante alimentario 900 g» + «Colorante alimentario BT-1 Sheros» + «Colorante alimentario Primera 900 g» | 3 | 13,08 € |
| Fideo chino | 6 | «Fideo chino» + «Fideos chinos Soubry 250 g» | 2 | 22,38 € |
| Gilda de anchoa | 6 | «Gilda de anchoa 25 ud» + «Gilda tradicional» | 2 | 2.944,52 € |
| Guacamole | 6 | «Guacamole 1 kg» + «Guacamole 500 g» | 3 | 118,79 € |
| Harina para freír | 6 | «Harina para freír» + «Harina para fritura 5 kg» | 9 | 179,87 € |
| Hierbas provenzales | 6 | «Hierbas provenzales» + «Hierbas provenzales Juferna 250 g» | 2 | 8,86 € |
| Mayonesa japonesa | 6 | «Mayonesa japonesa Allgroo 520 ml» + «Mayonesa japonesa Kewpie 2,4 l» | 2 | 29,33 € |
| Mermelada de arándanos | 6 | «Mermelada de arándanos» + «Mermelada de arándanos La Vieja Fábrica 800 g» | 5 | 238,42 € |
| Miel de caña | 6 | «Concentrado de caña Carmen 920 g» + «Miel de caña» | 3 | 43,97 € |
| Pasta de wasabi | 6 | «Pasta de wasabi» + «Wasabi en pasta Neri 43 g» | 2 | 56,94 € |
| Pimentón dulce | 6 | «Pimentón dulce DOP» + «Pimentón dulce La Dalia 800 g» | 3 | 40,60 € |
| Pimienta negra molida | 6 | «Pimienta negra molida 800 g» + «Pimienta negra molida BT-1 Sheros» | 2 | 22,84 € |
| #325 Pimiento del piquillo en tiras Don Molinico 1,9 kg | 6 | «#325 Pimiento del piquillo en tiras Don Molinico 1,9 kg» + «Pimiento del piquillo en tiras 1,9 kg» | 3 | 422,86 € |
| Pimiento del piquillo entero | 6 | «Pimiento del piquillo entero» + «Pimiento del piquillo entero Don Molinico 1,9 kg» | 2 | 202,39 € |
| Piparra en conserva | 6 | «Piparra en conserva» + «Piparras picantes sabor dulce A. Sádaba 370 ml» | 3 | 506,15 € |
| Preparado para rebozar sin gluten | 6 | «Preparado para rebozados sin gluten» + «Preparado para rebozar sin gluten Dani 3 kg» + «Preparado para rebozar sin gluten Dani 470 g» | 4 | 311,47 € |
| Salmorreta | 6 | «Salmorreta» + «Salmorreta Paellalia 140 g» + «Salmorreta Paellalia 380 g» | 3 | 2.194,98 € |
| Salsa barbacoa | 6 | «Salsa barbacoa» + «Salsa barbacoa Chovi 1,9 kg» + «Salsa barbacoa Millás 1,85 L» | 3 | 32,45 € |
| Salsa de soja sin gluten | 6 | «Salsa de soja Kikkoman sin gluten 1 l» + «Salsa de soja sin gluten 1 l» | 2 | 101,12 € |
| Salsa romesco | 6 | «Salsa romesco» + «Salsa romesco Ferrer 645 g» | 3 | 230,70 € |
| Tomate frito | 6 | «Salsa de tomate frito pouch 2,5 kg» + «Tomate frito» | 2 | 63,90 € |
| Tomate pelado en lata | 6 | «Tomate entero pelado 1,6 kg» + «Tomate pelado en lata» | 6 | 181,34 € |
| Tomate rallado | 6 | «Tomate rallado» + «Tomate rallado El Labrador 720 ml» | 2 | 30,51 € |
| Tomate seco en aceite | 6 | «Tomate seco El Labrador 370 ml» + «Tomate seco en tiras en aceite» | 2 | 281,70 € |
| Tomate troceado en conserva | 6 | «Tomate troceado 2,65 kg» + «Tomate troceado Éxito 3 kg» | 2 | 435,52 € |
| #298 Ventresca de bonito Ortiz 1/4 | 6 | «Ventresca de bonito en aceite de oliva 1/4» + «Ventresca de bonito en conserva» | 4 | 3.315,68 € |
| Gominolas | 7 | «Golosinas Fini mix goma pica» + «Golosinas Jake mini max azúcar» + «Gominolas» | 4 | 692,52 € |
| Pan bao | 7 | «Pan bao» + «Pan bao blanco 60 g» | 2 | 106,75 € |
| Pan de molde sin gluten | 7 | «Pan de molde sin gluten» + «Pan de molde sin gluten Dr. Schär» | 3 | 100,27 € |
| Virutas de chocolate con leche | 7 | «Viruta pequeña de chocolate con leche» + «Virutas de chocolate con leche» | 4 | 469,15 € |
| Patatas fritas congeladas | 8 | «Patatas fritas congeladas 3/8» + «Patatas prefritas 7/7» | 2 | 97,37 € |
| #230 Bobina mecha grada Muro 800 g | 9 | «#230 Bobina mecha grada Muro 800 g» + «Bobina de mecha gofrada Karme 800 g» | 2 | 422,90 € |
| Lavavajillas a mano 5 l | 9 | «Lavavajillas a mano 5 l» + «Lavavajillas a mano Fairy 5 l» | 2 | 30,76 € |
| Lejía 2 l | 9 | «Lejía Caprichosa 2 l» + «Lejía amarilla Kiriko 2 L» | 2 | 166,82 € |
| Papel antigrasa | 9 | «Papel antigrasa» + «Papel antigrasa blanco 500 ud» | 3 | 39,18 € |
| Papel vegetal 40x60 cm | 9 | «Papel vegetal» + «Papel vegetal 40x60 cm» | 2 | 88,44 € |
| Gorro alto negro | 10 | «Gorro alto de popelín negro» + «Gorro alto negro» | 2 | 24,40 € |
| Descuento comercial | 11 | «#341 Aceite de girasol alto oleico» + «Descuento 20 %» + «Descuento comercial» + «Descuento por promoción (caja completa)» + «Promoción especial» + «Venta por volumen» | 40 | -43.036,48 € |
| Balbás Ancestral 75 cl | 12 | «Ancestral» + «Balbás Ancestral 75 cl» | 2 | 965,46 € |
| Château Giscours 75 cl | 12 | «Château Giscours» + «Château Giscours 75 cl» | 3 | 6.855,99 € |
| Vino blanco Cerro de la Cruz brik 1 l | 12 | «Vino blanco Cerro Cruz brick 1 l» + «Vino blanco Cerro de la Cruz brik 1 l» | 2 | 60,22 € |
| Whisky J&B 70 cl | 14 | «J&B 70 cl» + «Whisky J&B 70 cl» | 2 | 94,20 € |
| Agua San Pellegrino con gas 50 cl | 15 | «Agua San Pellegrino 50 cl» + «Agua San Pellegrino con gas 50 cl» | 4 | 1.052,29 € |
| Bitter Kas 20 cl | 15 | «Bitter Kas» + «Bitter Kas 20 cl» | 2 | 182,87 € |
| Anchoa del Cantábrico en aceite | 17 | «Anchoa del Cantábrico en aceite de girasol» + «Anchoa en aceite Hansa 14/16 filetes» + «Anchoas XL alta restauración» | 3 | 7.621,13 € |
| Anchoa en aceite de oliva | 17 | «Anchoa en aceite de oliva» + «Anchoas en conserva 500 g» | 2 | 258,13 € |
| #219 Bonito entero en lomos | 17 | «#219 Bonito entero en lomos» + «Bonito» | 2 | 4.169,28 € |
| Boquerón en vinagre | 17 | «Boquerones en vinagre» + «Boquerón en vinagre alineado» | 5 | 401,56 € |
| Boquerón fresco | 17 | «Boquerón» + «Boquerón fresco» | 3 | 150,00 € |
| Lomo de atún limpio | 17 | «Atún lomo central» + «Lomo de atún limpio» | 2 | 82,72 € |
| Lomo de salmón fresco | 17 | «Filete de salmón» + «Lomo de salmón fresco» | 4 | 657,52 € |
| Pescado variado de lonja | 17 | «Gadiformes» + «Perciformes» + «Pleuronectiformes» | 18 | 12.308,59 € |
| Salmón fresco entero | 17 | «Salmón fresco» + «Salmón fresco entero» | 7 | 999,26 € |
| Sardinillas en aceite de oliva | 17 | «Sardinillas en aceite de oliva 14/18» + «Sardinillas en aceite extra especial» | 2 | 247,60 € |
| Ventresca de atún claro en conserva | 17 | «Ventresca de atún El Capricho 115 g» + «Ventresca de atún claro en conserva» | 2 | 1.048,16 € |
| #218 Bogavante | 18 | «#218 Bogavante» + «Bogavante azul» | 3 | 4.386,75 € |
| #107 Buey de mar gallego hembra 1-1,5 kg | 18 | «#107 Buey de mar gallego hembra 1-1,5 kg» + «Buey de mar hembra» | 17 | 5.293,79 € |
| Calamar limpio | 18 | «#221 Calamar» + «Calamar limpio» | 2 | 274,50 € |
| #303 Centolla | 18 | «#106 Centolla hembra 1-1,5 kg» + «#303 Centolla» | 13 | 2.714,98 € |
| Langostino | 18 | «Langostino» + «Langostino nacional» | 2 | 548,00 € |
| Marisco variado de lonja | 18 | «Cefalópodos» + «Macruros» + «Varios (pescado y marisco)» | 14 | 32.624,60 € |
| Mejillón en escabeche | 18 | «Mejillón en escabeche Ramón Franco 8/12» + «Mejillón en escabeche Real Conservera» | 3 | 1.128,48 € |
| Aguja de cerdo sin hueso | 19 | «Aguja de cerdo deshuesada» + «Aguja de cerdo sin hueso» | 2 | 154,10 € |
| Costilla de cerdo barbacoa | 19 | «Costilla de cerdo barbacoa» + «Costillar de cerdo troceado BBQ» | 2 | 281,63 € |
| Costilla de cerdo en tiras | 19 | «Costilla de cerdo» + «Costillas de cerdo en tiras» | 2 | 283,71 € |
| Escalope de foie gras de pato congelado | 19 | «Escalopa de foie gras congelada 50 g» + «Escalopa de foie gras de pato» + «Escalope de foie gras» | 4 | 2.610,96 € |
| Lomo alto de vaca | 19 | «Entrecot de vaca» + «Lomo alto de vaca» + «Lomo de vaca» | 3 | 9.296,71 € |
| Lomo bajo de vaca | 19 | «Lomo bajo de vaca» + «Lomo de vaca» | 2 | 823,72 € |
| Lomo de cerdo adobado | 19 | «Lomo adobado» + «Lomo de cerdo adobado» | 4 | 173,48 € |
| Bacon entero | 20 | «Bacon entero» + «Bacón ahumado» | 3 | 147,22 € |
| Chistorra | 20 | «Chistorra» + «Chistorra extra» | 3 | 227,50 € |
| Jamón serrano deshuesado | 20 | «Jamón deshuesado Castillo de Magaña» + «Jamón deshuesado gran reserva Altos de Iberia» + «Jamón serrano reserva deshuesado» | 3 | 264,44 € |
| Morcilla de Burgos | 20 | «Morcilla de Burgos» + «Morcilla de arroz de Burgos» | 2 | 7,87 € |

## Renombres y separaciones sin unión (50)

Nombre nuevo ← nombre de partida (las separaciones sacan algunos textos de un producto que mezclaba cosas distintas).

- Mantequilla con sal [4] ← «Mantequilla Kerrygold con sal 200 g» (3 textos, 113,68 €)
- Brócoli congelado [5] ← «Brócoli congelado 2,25 kg» (1 textos, 7,44 €)
- Cebolla en cubos congelada [5] ← «Cebolla en cubos» (3 textos, 59,59 €)
- Cebolla en tiras congelada [5] ← «Cebolla en tiras» (1 textos, 15,77 €)
- Rebozuelo [5] ← «Rosiñol» (1 textos, 39,30 €)
- Agua de azahar 1 l [6] ← «Agua de azahar 1 L» (1 textos, 8,60 €)
- Arroz de grano largo [6] ← «Arroz de grano largo 5 kg» (1 textos, 6,05 €)
- Azúcar moreno en sobres [6] ← «Azúcar moreno Salzillo stick 6 g» (1 textos, 46,02 €)
- Mermelada de higos [6] ← «Mermelada de higos La Vieja Fábrica 800 g» (1 textos, 21,21 €)
- Monin puré de fruta de la pasión 1 l [6] ← «Monin puré de fruta de la pasión 1 L» (1 textos, 613,20 €)
- Monin puré de mango 1 l [6] ← «Monin puré de mango 1 L» (1 textos, 317,52 €)
- #226 Trufa de chocolate Anedilco [7] ← «Trufas de chocolate 50 ud» (1 textos, 38,97 €)
- Bolsa de basura 55x60 cm 30 l [9] ← «Bolsa de basura 55x60 cm 30 L» (4 textos, 199,79 €)
- Bolsa de basura negra 85x105 cm 100 l [9] ← «Bolsa de basura negra 85x105 cm 100 L» (1 textos, 174,40 €)
- Saco de basura negro 85x105 cm 120 l [9] ← «Saco de basura negro 85x105 cm 120 L» (3 textos, 298,78 €)
- #246 Cuchara moka Paladium [10] ← «Cuchara de café Paladium» (1 textos, 41,86 €)
- Carbón vegetal en saco [11] ← «Sacos de carbón» (1 textos, 2.040,00 €)
- #339 Gestión de residuos [11] ← «Gestión de residuos RGA por albarán» (1 textos, 56,89 €)
- El Puntido 3 l [12] ← «El Puntido 3 L» (1 textos, 0,00 €)
- Mistela La Manchega Extra 1 l [12] ← «Mistela La Manchega Extra 1 L» (1 textos, 26,40 €)
- Vermut Martini Blanco 1 l [12] ← «Vermut Martini Blanco 1 L» (1 textos, 325,20 €)
- Vermut Martini Rojo 1 l [12] ← «Vermut Martini Rojo 1 L» (1 textos, 370,50 €)
- Anís Marie Brizard 1 l [14] ← «Anís Marie Brizard 1 L» (1 textos, 42,00 €)
- Anís Tenis seco 1 l [14] ← «Anís Tenis seco 1 L» (1 textos, 61,50 €)
- Aperol 1 l [14] ← «Aperol 1 L» (2 textos, 184,32 €)
- Baileys 1 l [14] ← «Baileys 1 L» (1 textos, 260,40 €)
- Bebida espirituosa 1715 1 l [14] ← «Bebida espirituosa 1715 1 L» (1 textos, 13,50 €)
- Campari 1 l [14] ← «Campari 1 L» (1 textos, 142,20 €)
- Ponche Caballero 1 l [14] ← «Ponche Caballero 1 L» (1 textos, 135,00 €)
- Ron Bacardi 1 l [14] ← «Ron Bacardi 1 L» (1 textos, 392,40 €)
- Ron Capitán Morgan Dark 1 l [14] ← «Ron Capitán Morgan Dark 1 L» (1 textos, -267,24 €)
- Licor de manzana sin alcohol Drols 1 l [15] ← «Licor de manzana sin alcohol Drols 1 L» (1 textos, 16,92 €)
- Licor de mora sin alcohol Drols 1 l [15] ← «Licor de mora sin alcohol Drols 1 L» (1 textos, 16,92 €)
- Anchoa en salazón [17] ← «Anchoa en salazón 200 g» (1 textos, 57,70 €)
- Cocochas de merluza congeladas [17] ← «Cocochas de merluza» (1 textos, 576,00 €)
- Cocochas de merluza frescas [17] ← «Cocochas de merluza» (1 textos, 612,00 €)
- Lubina de crianza [17] ← «#228 Lubina» (1 textos, 392,62 €)
- Migas de atún en aceite [17] ← «Migas de atún en aceite vegetal 650 g» (1 textos, 30,57 €)
- Palometa [17] ← «Palometa roja» (1 textos, 142,80 €)
- Coquina congelada [18] ← «Coquina» (1 textos, 330,90 €)
- Gamba blanca congelada [18] ← «Gamba blanca» (1 textos, 16,00 €)
- Langostino cocido [18] ← «Langostino cocido 30/40» (1 textos, 37,50 €)
- Mejillón media concha congelado [18] ← «Mejillón media concha» (1 textos, 16,00 €)
- Molla de mejillón congelada [18] ← «Carne de mejillón» (1 textos, 22,50 €)
- #291 Quisquilla extra Loreto [18] ← «Quisquilla extra» (2 textos, 2.437,88 €)
- Callos de vacuno congelados [19] ← «Callo de vacuno» (1 textos, 19,32 €)
- Lomo de cerdo [19] ← «Lomo de cerdo extra tierno ElPozo» (1 textos, 16,16 €)
- Lomo de vaca con hueso [19] ← «Lomo de vaca» (1 textos, 18.642,75 €)
- Paletilla de cordero lechal congelada [19] ← «Paletilla de cordero lechal» (1 textos, 10.005,13 €)
- Salado de cerdo para cocido [19] ← «Salados de cerdo» (1 textos, 21,15 €)

Separaciones hechas (textos que estaban mal agrupados):

- «#228 Lubina»: la lubina de crianza Aquanaria (14,90 €/kg) pasa a **Lubina de crianza**; la salvaje/gallega sigue en #228 (25-40 €/kg).
- «Palometa roja»: la línea «PALOMETA» a 24 €/kg (palometa negra) pasa a **Palometa**.
- «Cocochas de merluza»: congeladas chilenas (36 €/kg) ≠ frescas (68 €/kg).
- «Coquina»: la de Congelados Pinto 12×250 g pasa a **Coquina congelada**.
- «Gamba blanca»: la de Once de Enero 105/110 piezas (congelada, 2 €/kg) pasa a **Gamba blanca congelada**.
- «#221 Calamar»: «CAL.LIMPIO 10/20» pasa a **Calamar limpio**.
- «Lomo de vaca» mezclaba tres cortes: «TROZO LOMO ALTO» → **Lomo alto de vaca** (con «Entrecot vaca lomo alto»), «LOMO VACA BAJO» → **Lomo bajo de vaca**, y el resto queda como **Lomo de vaca con hueso** (c/h c/solomillo, 34,5 €/kg).
- «Paletilla de cordero lechal»: la congelada (23,5 €/kg, 10.005 €) → **Paletilla de cordero lechal congelada**.
- «Callo/Callos de vacuno»: no se unen porque uno es congelado (6,45 €/kg) y otro fresco (9,8 €/kg): quedan **Callos de vacuno** y **Callos de vacuno congelados**.
- Dos líneas «Oferta calendario adviento» (−0,95 €) que estaban en «#341 Aceite de girasol alto oleico» pasan a **Descuento comercial** para no falsear el precio del aceite.

## Correcciones de familia

| Antes | Familia antes → después | Ahora | Textos | Gasto |
|---|---|---|---|---|
| Twist green | Despensa → Panadería y repostería | Twist green | 1 | 17,13 € |
| Sacos de carbón | Despensa → Servicios | Carbón vegetal en saco | 1 | 2.040,00 € |
| #341 Aceite de girasol alto oleico | Despensa → Servicios | Descuento comercial | 2 | -1,90 € |
| Ventresca de atún claro en conserva | Despensa → Pescado | Ventresca de atún claro en conserva | 1 | 912,16 € |
| Ventresca de atún El Capricho 115 g | Despensa → Pescado | Ventresca de atún claro en conserva | 1 | 136,00 € |
| Migas de atún en aceite vegetal 650 g | Despensa → Pescado | Migas de atún en aceite | 1 | 30,57 € |
| Sucedáneo de caviar de mújol | Despensa → Pescado | Sucedáneo de caviar de mújol | 1 | 45,44 € |
| Alcachofa cortada congelada | Congelados → Frutas y verduras | Alcachofa cortada congelada | 1 | 5,19 € |
| Brócoli congelado 2,25 kg | Congelados → Frutas y verduras | Brócoli congelado | 1 | 7,44 € |
| Edamame congelado | Congelados → Frutas y verduras | Edamame congelado | 2 | 72,43 € |
| Mango en cubos congelado | Congelados → Frutas y verduras | Mango en cubos congelado | 2 | 18,43 € |
| Guisantes congelados | Congelados → Frutas y verduras | Guisantes congelados | 1 | 4,14 € |
| Mezcla de frutas del bosque congelada | Congelados → Frutas y verduras | Mezcla de frutas del bosque congelada | 1 | 5,85 € |
| Cono suplemento porta chemi coreless | Limpieza y desechables → Menaje y equipamiento | Cono suplemento porta chemi coreless | 1 | 0,00 € |
| Dispensador de ambientador a pilas | Limpieza y desechables → Menaje y equipamiento | Dispensador de ambientador a pilas | 1 | 0,00 € |
| Portarrollos Chemi blanco serie Dynamic | Limpieza y desechables → Menaje y equipamiento | Portarrollos Chemi blanco serie Dynamic | 1 | 0,00 € |
| Lana de madera para encendido 1 kg | Limpieza y desechables → Servicios | Lana de madera para encendido 1 kg | 1 | 33,75 € |
| Pastillas de encendido | Limpieza y desechables → Servicios | Pastillas de encendido | 2 | 18,50 € |
| Tanqueray 0,0 70 cl | Licores → Refrescos y aguas | Tanqueray 0,0 70 cl | 1 | 0,00 € |
| Licor de manzana sin alcohol Drols 1 L | Licores → Refrescos y aguas | Licor de manzana sin alcohol Drols 1 l | 1 | 16,92 € |
| Licor de mora sin alcohol Drols 1 L | Licores → Refrescos y aguas | Licor de mora sin alcohol Drols 1 l | 1 | 16,92 € |
| Monin puré de fruta de la pasión 1 L | Refrescos y aguas → Despensa | Monin puré de fruta de la pasión 1 l | 1 | 613,20 € |
| Monin puré de mango 1 L | Refrescos y aguas → Despensa | Monin puré de mango 1 l | 1 | 317,52 € |
| Sirope Monin manzana verde 70 cl | Refrescos y aguas → Despensa | Sirope Monin manzana verde 70 cl | 1 | 63,00 € |
| Sirope Monin melocotón 70 cl | Refrescos y aguas → Despensa | Sirope Monin melocotón 70 cl | 1 | 19,70 € |
| Sirope Monin spicy mango 70 cl | Refrescos y aguas → Despensa | Sirope Monin spicy mango 70 cl | 1 | 63,00 € |
| Granadina Rives sin alcohol | Refrescos y aguas → Despensa | Granadina Rives sin alcohol | 1 | 11,13 € |
| Macruros | Pescado → Marisco | Marisco variado de lonja | 11 | 31.073,47 € |
| Cola de alistado | Pescado → Marisco | Cola de alistado | 4 | 781,90 € |
| Cabezas de alistado | Pescado → Marisco | Cabezas de alistado | 2 | 201,59 € |
| Lomo adobado | Embutidos e ibéricos → Carne | Lomo de cerdo adobado | 2 | 100,88 € |

Comprobado además: en Limpieza (9), Menaje (10) y Servicios (11) no queda comida; Servicios solo tiene servicios, suministros (luz, agua, gas, CO₂, gasóleo, carbón), envases retornables y fianzas, alquileres/renting, gestoría, mantenimiento, comisiones y descuentos/rappels. Los dispensadores en préstamo (portarrollos, ambientador) pasan a Menaje.

## Dudas

Resueltas (se quita `duda`): lonja genérica (Perciformes, Pleuronectiformes, Macruros, Cefalópodos, Varios); «BUEY» de Casimiro → #107 Buey de mar; «SAN PEDRO» = San Martín (Zeus faber); «Ancestral» de J. L. Flores a 32,35 € = Balbás Ancestral 75 cl (32,10 €); «Rosiñol Laumont» = rossinyol, **Rebozuelo** (seta); «Concentrado de caña Carmen» = **Miel de caña**; «Salados» de Farruquiño = **Salado de cerdo para cocido**; «ESPARRAGO G» a 4 €/kg = espárrago verde; cebolla en cubos/tiras de Makro 2,5 kg = congelada; alcachofa cortada MC 1 kg = congelada (pasa a 5); «Genuine coconut» = coco; «Twist green» de Dobla = decoración de chocolate (7); «Venta por volumen» y «Promoción especial» = descuentos; «BDO camisa» = bordado; Tower = equipo de conservación de vino; cartucho de gas 227 g, pepinillos, aceitunas Sarasa/Mare Nostrum, Pizza-Pop, bao de cerdo, hamburguesa de tofu, cremoso de chipirón, cuello de cordero, panceta curada, tomate rojo, cookie Triticum, hoja de bambú, granadina: nombre y familia correctos.

Quedan 21 con `duda`:

- **Aceite de oliva virgen extra 280 g** (132,00 €): formato pequeño Triticum, tipo de aceite no confirmado
- **Aceituna partida** (27,80 €): lectura dudosa en la factura
- **Bj** (1,86 €): texto ilegible
- **Bo** (17,77 €): texto ilegible
- **Cantonales Garre 500 g** (89,51 €): no se sabe qué es "cantonales"
- **Lote de Navidad** (-276,21 €): cesta de Navidad, familia incierta
- **Pomodoraccino** (1.912,60 €): producto desconocido, 35 € la unidad
- **Boquillas** (8,67 €): no se sabe qué son las boquillas (bollería o utensilio)
- **Crema pastelera** (0,00 €): texto solo «crema», precio 0
- **Gilda de salmón y queso** (254,22 €): no está claro si es congelado o fresco
- **Rollo Floor 3 m fucsia** (10,44 €): texto poco claro (rollo Floor fucsia)
- **Anticipo de cliente (aplicación)** (-1.224,00 €): aplicación de anticipo de cliente, no es un producto
- **Mercancía en depósito** (0,00 €): línea sin importe
- **Visita comercial** (0,00 €): línea sin importe
- **QS** (139,50 €): abreviatura «QS», probablemente vino (Quinta Sardonia) sin confirmar
- **Sierra Cantabria (obsequio)** (0,00 €): obsequio sin precio, producto no identificado
- **Curuxo** (554,00 €): no se identifica con certeza el pescado 'curuxo'
- **Hueva** (60,00 €): hueva sin especificar
- **Rey** (262,80 €): pescado «rey», no identificado con seguridad
- **Brillante** (5.842,50 €): Marisco sin identificar («brillante», Pescados y Mariscos Colorao); los precios (2,4-4,6) parecen por pieza, no por kg
- **#314 Pechuga de pollo** (587,44 €): pechuga 'gran cuk' a 9,95 €/kg, mucho más cara que la normal

## Recomendaciones sobre el catálogo existente (no se tocan desde este fichero)

- **#260 «Choco 300/500 g»** está en Pescado (17); es sepia → Marisco (18).
- **#231 «Orujo Beneolive 5 L»** está en Licores (14) pero sus líneas son «OLIBEN ORUJO 5L» de la misma marca que el #253 aceite Beneolive: es **aceite de orujo de oliva** → Despensa (6), renombrar «Aceite de orujo de oliva Beneolive 5 L».
- **#251 atún claro en aceite**, **#298 ventresca de bonito** y **#281 mújol en tarro** están en Despensa; si se adopta el criterio «conservas de pescado en Pescado (17)», moverlos. Hoy suman 5.930,29 € del gasto de Despensa.
- **#220 «Brócoli Anedilco 2,5 kg»** está en Congelados (8); con el criterio aplicado (verdura congelada en 5) debería ir a 5.
- **#106 «Centolla hembra 1-1,5 kg»** duplica a **#303 «Centolla»**: su único texto nuevo se ha llevado a #303; conviene fusionarlos.
- **#211 «Mejillones»** y **#222 «Mejillón en malla Batemar»** parecen el mismo mejillón fresco (en saco o malla); los textos nuevos van a #211, valorar fusionarlos.

## Gasto por familia (suma de `gasto` de los lotes, sin IVA)

Familia según el fichero final (para `producto_id`, la del catálogo).

| Familia | Productos | Textos | Gasto |
|---|---|---|---|
| Vinos (12) | 198 | 243 | 166.971,69 € |
| Carne (19) | 115 | 180 | 156.405,38 € |
| Marisco (18) | 61 | 170 | 138.900,80 € |
| Cervezas (13) | 20 | 21 | 94.579,58 € |
| Pescado (17) | 90 | 203 | 90.863,69 € |
| Servicios (11) | 167 | 917 | 76.774,74 € |
| Despensa (6) | 301 | 488 | 49.287,62 € |
| Menaje y equipamiento (10) | 345 | 372 | 48.249,67 € |
| Embutidos e ibéricos (20) | 62 | 89 | 37.823,78 € |
| Licores (14) | 121 | 142 | 33.307,56 € |
| Frutas y verduras (5) | 174 | 388 | 32.486,43 € |
| Refrescos y aguas (15) | 56 | 61 | 30.770,92 € |
| Panadería y repostería (7) | 123 | 149 | 27.154,62 € |
| Limpieza y desechables (9) | 129 | 165 | 16.411,91 € |
| Lácteos y huevos (4) | 62 | 108 | 16.143,76 € |
| Congelados (8) | 59 | 64 | 12.330,65 € |
| Café e infusiones (16) | 20 | 20 | 8.044,92 € |
| **Total** | 2103 | 3780 | **1.036.507,72 €** |

Servicios incluye descuentos y rappels en negativo (−69.915,89 €), por eso su neto es menor que la suma de facturas de servicios.
