# Medidas de las stories originales de Casa Tomás (calco, 13/11/2026)

Medidas sobre las originales a tamaño real (`instagram-studio/propuesta/referencias-actuales/alta/`),
normalizadas a 1080 × 1920. Las tomé por detección de píxeles (texto blanco, oro y oscuro) y con el
cuentagotas. Cada plantilla se renderizó con el mismo texto y se superpuso a la original
(`instagram-studio/propuesta/evaluacion/estilos-ct/calco-*.jpg`) hasta que casaron letra, logo y líneas.

«cap» = parte de arriba de las mayúsculas; «h» = alto de la línea de tinta; «w» = ancho de tinta.

## Logo (todas)

- PNG del panel `casa-tomas-logo-blanco.png` (800 × 550; medallón en las filas 29–287).
- En las originales el medallón mide 122 px, a escala 0,473 → logo de **378 px** de ancho, que empieza
  14 px por encima del medallón.
- Medallón en y = 234 (reseña), 265 (celebración), 1511 (titular y póster) y 1526 (reserva).
- En Descubre Touza el logo es más pequeño (medallón de 102 px): **315 px**, arriba en y = 118.
- En la lista del jueves: 315 px, medallón en y = 119.

## Fuentes identificadas

Comparadas renderizando las candidatas encima de la original. Todas son OFL y salen de
`@fontsource` 5.3.0, autoalojadas en `public/instagram/fuentes/`.

| Estilo | Original | Fuente |
|---|---|---|
| Hilo, recuadro, «CON HELADO» | mayúsculas espaciadas | IBM Plex Sans 300 (la J no baja de la línea, como en la original) |
| Subtítulo del recuadro | serif espaciada | Spectral 500 |
| «Tarta de queso» | manuscrita fina monolínea | Sacramento |
| «ENSALADILLA», «TATAKI DE CHULETA» | condensada gruesa | Anton estrechada al 78,5 % (`scaleX`). Bebas Neue y League Gothic se quedaban finas; Anton sin estrechar, ancha |
| Título y nombre de la reseña | Poppins | Poppins 400 / 500 |
| Cuerpo de la reseña | Montserrat | Montserrat 300 |
| Subtítulos del titular grande | Montserrat | 400 («de marisco») / 300 cursiva («con salsa de…») |
| Celebración | sans humanista redondeada | Amaranth 400 (solo trae latin) |
| «Gracias por visitarnos» | serif de alto contraste | Old Standard TT |
| @ del cliente | etiqueta de mención de Instagram | IBM Plex Sans 500, blanca con sombra (es la de la app) |
| «RESERVA MESA», «DESCUBRE TOUZA», «RESERVA TU MESA» | geométrica fina | DM Sans 300 |
| «JUEVES DE», «¡TE ESPERAMOS!» | Montserrat | Montserrat 600 / 400 |
| «Tapas y cóctel» | manuscrita con rasgos | Great Vibes |

## Rótulo con hilo (`platos-hilo-1`, `-2` y `-3`)

- **Nombre:**
  - IBM Plex 300 de 47 px, cap de 33 px, blanco #fff, interletrado 0,122 em;
  - «EL MEJOR PRODUCTO FRESCO» mide w 768, centrado en x = 540;
  - en story, cap en y = 473.
- **Si el nombre va en dos líneas** (`platos-hilo-3`): 60 px, una línea cada 71 px.
- **Raya horizontal (forma de T):**
  - 4 px de grueso y 7,3 em de largo (345 px a 47; 434 a 60);
  - 25 px por debajo del cap; en story, en y = 530.
- **Hilo:** vertical de 4 px de ancho; acaba en un **punto de 17 px** (centro en y = 869, el 45,3 %).
- **Velo:** en la original no hay; aquí, uno al 22 % solo detrás del texto, para fotos claras.

## Recuadro (`platos-marco`)

- **Rectángulo:** blanco de **16 px** de grueso, a 108 px de los cuatro bordes (x 108–971, y 108–1811).
- **Nombre:** «CROQUETAS» en Plex 300 de 58 px, interletrado 0,11 em, cap en y = 346, w 370.
- **Subtítulo:**
  - Spectral 500 de 36 px, interletrado 0,09 em, una línea cada 48 px, desde y = 413;
  - corta como la original: «Disfruta de los mejores sabores / en Casa Tomás».

## Manuscrita + caja (`platos-manuscrita`)

- **Caja:** de x 240 a 840 (600 px) y de y 465 a 596 (131 px), con borde de 3 px.
- **Texto de la caja:** «CON HELADO» en Plex 300 de 76 px (cap 54), interletrado 0,07 em, centrado.
- **Filetes:** dos de 58 × 3 px a los lados de la manuscrita (y ≈ 420), alineados con los bordes de la caja.
- **Manuscrita:** Sacramento de hasta 92 px, interletrado 0,04 em; la tinta va de x 300 a 761 e y 339 a 459.

## Titular grande (`platos-titular-1` y `-2`)

- **Color:** crema #fffff3.
- **En una línea** («ENSALADILLA»):
  - cap de 185 px (Anton de 213), alineado a la derecha en x = 963;
  - «de marisco» en Montserrat 400 de 70 px, alineado a la derecha, 31 px por debajo;
  - la original no lleva logo.
- **En dos líneas** («TATAKI DE / CHULETA»):
  - cap de 145 px (Anton de 167), una línea cada 174 px, a la izquierda en x = 110, cap en y = 309;
  - subtítulo en Montserrat 300 cursiva de 47 px, una línea cada 45 px, x = 122, desde y = 680;
  - logo abajo, con el medallón en y = 1525.

## Reseña (`opinais-1` y `-2`)

- **Fondo:** #363f46 liso.
- **Título:** Poppins 400 de 94 px, una línea cada 104 px, x = 120, cap en y = 608; «nuestros clientes» mide w 797.
- **Comillas «99»:**
  - dos marcas de 190 × 300 px (círculo con rabito);
  - oro #b3aa7b al 21 %, por ENCIMA del título;
  - la primera en x = 556, y = 550; la segunda, 216 px a la derecha.
- **Nombre:** Poppins 500 de 55,5 px, cap en y = 911, centrado (w 503 en «Jose Fco. Martinez»).
- **Regla:** 228 × 3 px en y = 995, blanca.
- **Cuerpo:**
  - Montserrat 300 de 38 px, una línea cada 56 px, desde y = 1032 (cap), en una caja de 740 px;
  - respeta los saltos de línea del texto (`pre-line`), como «…de 10.⏎Seguro que…»;
  - en `opinais-2` también son 38 px; solo baja de cuerpo si la reseña no cabe.
- **Bocadillo:**
  - cápsula de 292 × 106 px (radio 52) con borde de 2,6 px y rabito abajo a la derecha (hasta y = 1691);
  - borde oro #b3aa7b, arriba en y = 1560 como mínimo (`opinais-1`), 1592 si la reseña es larga;
  - 5 estrellas oro de 37 px (radio 18,5, interior al 50 %), con centros cada 47 px desde x = 443, en y = 1610.

## Celebración (`vosotros-celebracion`)

- **Fondo:** la misma foto, ampliada a todo el lienzo, desenfocada 3 px y oscurecida al 50 %.
- **Foto:** en una tarjeta de esquinas redondas (radio 24, sin borde), x 148–932 (784 px), desde y = 680; caja máxima de 784 × 555.
- **Nombres:**
  - Amaranth 400 de 63 px, una línea cada 69 px, cap de la primera en y = 1406, centrados;
  - en blanco, con la «y» en oro #bcb791.
- **Motivo:** «celebrando su» en oro y «75 cumpleaños» en blanco, en dos líneas.

## Gracias por visitarnos (`vosotros-gracias`)

- **Fondo:** #e0e0e0.
- **Título:** Old Standard TT de 69 px, negro, centrado (w 674), arriba en y ≈ 455.
- **Foto:** x 125–954 (829 px), y 555–1385.
- **@ del cliente:** en x = 156 y ≈ 1416, blanca con sombra oscura (la etiqueta de mención de Instagram).

## Reserva mesa (`vosotros-reserva`)

- **«RESERVA MESA»:** DM Sans 300 de 58 px, interletrado 0,14 em (w 490).
- **«en tu restaurante favorito»:** 57 px, interletrado 0,13 em (w 843).
- **Filete:** 692 × 3 px.
- **Hueco del sticker «HAZ AQUÍ TU RESERVA»:** de 70 px, debajo del filete.
- **Logo:** abajo, con el medallón en y = 1526.
- **Diferencia con la original:** allí el titular empieza en y = 222, dentro de los 250 px de arriba que tapa Instagram (el motor no lo deja). Aquí todo baja 40 px: titular en 262, filete en 419.

## Descubre Touza (`touza-descubre`, `touza-reserva`)

- **Logo:** 315 px, arriba (medallón en y = 129).
- **«DESCUBRE»:** DM Sans 300 de 118 px (cap 83), interletrado 0,10 em, w 648.
- **«TOUZA»:** 103 px (cap 72), interletrado 0,123 em, w 363.
- **Alineación:** las dos a la derecha (x = 907); cap en y = 446 y 583.
- **Pie opcional (`touza-reserva`):**
  - «RESERVA TU MESA» en DM Sans 300 de 58 px y un filete de 228 × 3 px debajo;
  - en la original el filete está en y = 1755. Aquí, 67 px más arriba, en 1688: allí se mete en la zona segura de abajo.

## Jueves de tapas

- **Póster (`jueves-4`):**
  - foto oscurecida entera al 55 %;
  - «JUEVES DE» en Montserrat 600 de 70 px, interletrado 0,345 em, cap en y = 802 (w 594);
  - «Tapas y cóctel» en Great Vibes oro #c2bd9d de 168 px (menos si el texto es más largo);
  - «¡TE ESPERAMOS!» en Montserrat 400 de 38 px, interletrado 0,38 em, cap en y = 1045 (w 504);
  - logo abajo, con el medallón en y = 1511.
- **Lista (`jueves-3`, `ct-tapas-clasica` en `../ct-tapas`):**
  - logo de 315 px;
  - «Jueves» en Montserrat 400 de 101 px (interletrado −0,045 em), cap en y = 396, w 315;
  - «DE TAPAS» de 33 px (interletrado 0,10 em), cap en y = 495;
  - filete de 167 × 2 px en y = 585;
  - lista desde y = 698: 76 px entre líneas y 58 px entre tapas, sin equilibrar las líneas.
  - **Diferencia con la original:** las 7 tapas de `jueves-3` van a 40 px en lugar de 43; con 43 la lista se mete 22 px en la zona segura de abajo.

## Lo que no es calco

- **Velo:** uno muy suave (22 %) detrás del texto de los rótulos, para que se lea en fotos claras.
- **Zona segura:** el texto nunca entra en los 250 px de arriba y abajo de la story. Por eso «ENSALADILLA» baja de y = 165 a 266, la reserva baja 40 px y el pie de Touza sube 67 px.
- **Textos largos:** la reseña, la manuscrita, el titular grande y el póster bajan de cuerpo si el texto es más largo que el de la original. Si ni así cabe, el motor da error (no se recorta).
