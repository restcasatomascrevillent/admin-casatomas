# Añada en el nombre de los vinos con foto: revisión del 11/11/2026

Petición del dueño: «Revisar toda la carta de vinos (los que tengan foto) y revisar si el nombre tiene la añada puesta».

Datos: consultas de solo lectura (SELECT) a **producción** (`haqmmdfdzzatdnrrcgez`: tablas `"Vinos"`, `vinos_puntuacion_parker` y `audit_log`) el 11/11/2026. No se ha cambiado ningún dato.

## Resumen

- **El repaso del 10/11 sí está aplicado en producción.** El script `supabase/seeds/20261110_vinos_anadas_parker_produccion.sql` se aplicó el 10/11/2026 hacia las 18:00 (hora peninsular), según el registro de auditoría. De los **121 vinos** de `docs/anadas-parker-2026-11-10/cambios.json`, **120** tienen el nombre y la añada del cambio. Las **75 filas** de puntuación Parker están tal cual.
- **La excepción es Mauro.** Esa mañana alguien puso a mano la añada 2023 desde el panel, sin tocar el nombre. El script solo cambia las filas que siguen como estaban al preparar el cambio, así que se saltó Mauro: sirve la añada 2023, pero el nombre no lleva el año.
- **Carta en producción:** 290 vinos, **214 con foto**. De esos 214:
  - 164 llevan el año en el nombre;
  - 12 están marcados «Sin añada (NV)»;
  - **38 no llevan año en el nombre ni están marcados NV**: 24 activos y 14 desactivados (tabla de abajo).
- **Ninguno de los 164** sirve una añada distinta del año de su nombre.
- **37 de los 38** ya salían en el informe del 10/11, en «sin añada aplicada»: el año no se lee en la foto, la foto es de otro vino o el vino estaría repetido. Solo Mauro es nuevo. «Castillo de Peñafiel Vendimia Seleccionada» aparecía desactivado en la demo, pero en producción está activo.
- **Vinos repetidos** (mismo nombre y misma añada, regla nueva de `src/components/carta/vinoDuplicado.ts`): solo hay uno en producción, «Pazo la Cuesta». Tiene dos fichas activas, sin foto y sin añada.
- Esta revisión no cuenta los 76 vinos sin foto (73 de ellos activos).

## Vinos con foto sin año en el nombre (y sin marcar NV)

«Añada que se sirve» es el campo de la ficha (columna `anada`). Las notas sobre la foto salen del informe del 10/11.

| Vino | Activo | Añada que se sirve | ¿Año en el nombre? | Nota |
|---|---|---|---|---|
| **Mauro** | sí | **2023** | no | El script del 10/11 se lo saltó: la añada ya estaba puesta a mano. Arreglo: abrir la ficha y pulsar «Añadir 2023 al nombre». |
| Balbás La Retama | sí | — | no | El año está en el lateral de la etiqueta y no se ve entero. |
| Bobal Rosado Dulce | sí | — | no | No se ve año ni en la etiqueta ni en la tira del cuello. |
| Briego Tempranillo Roble | sí | — | no | No se ve año ni en la etiqueta ni en el collarín. |
| Briego Tempranillo Roble (Magnum) | sí | — | no | No se ve año ni en la etiqueta ni en el collarín. |
| Briego Tiempo Crianza | sí | — | no | No se ve año ni en la etiqueta ni en el collarín. |
| Castillo de Peñafiel Vendimia Seleccionada | sí | — | no | No se ve año en la etiqueta. El 10/11 figuraba desactivado (demo); en producción está activo. |
| Cerro del Buey | sí | — | no | El año queda partido en los laterales: solo se leen las dos primeras cifras. |
| Clos du Ciel | sí | — | no | No se ve año en la etiqueta. |
| Díaz Bayo 4U | sí | — | no | No se ve año en la etiqueta. |
| Eduardo Peña | sí | — | no | No se ve año en la etiqueta. |
| Figuero Noble | sí | — | no | No se ve año ni en la etiqueta ni en el collarín. |
| Figuero Tinus | sí | — | no | No se ve año en la etiqueta. |
| Finca Dofí | sí | — | no | Tiene la misma foto que «Finca Dofí 2017». Hay que decidir si es el mismo vino o falta su foto. |
| Finca Villacreces Specimen Nº1 | sí | — | no | No hay año de cosecha: el 1102 del cuello es un número de botella. |
| Godeval (Magnum) | sí | — | no | No se ve año ni en la etiqueta ni en el collarín. |
| Milsetentayseis La Peña Rosado (Magnum) | sí | — | no | La etiqueta no lleva año. En el corcho asoma «201…», pero la última cifra no se lee. |
| Milsetentayseis Tinto | sí | — | no | No se ve año ni en la etiqueta ni en la cápsula. |
| Pazo de Rubianes | sí | — | no | No se ve año ni en la serigrafía ni en la cápsula. |
| Pazo Vedoira Camelia | sí | — | no | No se ve año en la etiqueta. |
| Philippe Gonet Signature | sí | — | no | Champagne sin año visible: seguramente es NV. Si se confirma, marcar «Sin añada (NV)». |
| Pousada | sí | — | no | No se ve año en la etiqueta. |
| Quiñón de Valmira | sí | — | no | La foto dice 2023, pero ya existe «Quiñón de Valmira 2023» (activo). Decidir si es el mismo vino y quitar uno, o si la foto es la equivocada. |
| Vila do Corpus | sí | — | no | No se ve año en la etiqueta. |
| Brión Cepas Vellas | no | — | no | No se ve año en la etiqueta. |
| Casal de Armán | no | — | no | No se ve año en la etiqueta. |
| Château Sainte Marguerite Rosé | no | — | no | La botella es serigrafiada y no se ve el año. |
| Donna Gloria Prosecco Extra Dry | no | — | no | Sin año en la etiqueta ni en el collarín: parece un prosecco NV. |
| El Perro Verde Selección Especial | no | — | no | No se ve año en la parte visible de la botella. |
| Juan Gil Nácar | no | — | no | Año en letra pequeña bajo el árbol: se lee al ampliar, pero no está nítido. |
| L'ombre | no | — | no | No se ve año en la etiqueta. |
| Louro do Bolo | no | — | no | El año va en vertical y lo corta la curva de la botella (solo se lee «20…»). |
| Louro do Bolo (Magnum) | no | — | no | Parece 2024, pero es pequeño y está girado: no se aplicó. |
| M de Alejandría (Dulce) | no | — | no | No se ve año en la etiqueta. |
| Maior de Mendoza Sobre Lías Albariño | no | — | no | No se ve año en la etiqueta. |
| Mikado Road Nº8 | no | — | no | No se ve año («Nº8» no es la añada). |
| Montecillo Blanco Fermentado en Barrica | no | — | no | Al ampliar se lee 2023, pero con poco contraste: no se aplicó. |
| Unzu Rosé Garnacha | no | — | no | No se ve año ni en la etiqueta ni en el collarín. |

## Cómo se ha comprobado

- **Aplicado:** se cruzan los 121 vinos de `cambios.json` (nombre, añada y NV después del cambio) con `"Vinos"`, y las 75 filas Parker (vino, añada, estado y puntos) con `vinos_puntuacion_parker`. Para Mauro y para la hora de aplicación se ha mirado `audit_log`.
- **Año en el nombre:** cuenta un número de cuatro cifras 19xx o 20xx suelto en el nombre, por ejemplo «Pingus 2023» o «Dom Pérignon Plénitude 2 (2002)».
- **Repetidos:** mismo nombre sin el año (sin tildes, mayúsculas ni signos) y misma añada (la de la ficha o, si no la tiene, la del nombre).
