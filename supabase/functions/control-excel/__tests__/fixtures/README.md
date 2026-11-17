# control-minimo.xlsx

Copia **reducida y con importes ficticios** del Excel de control de OficiosOsIA
(`Control_OFICIOSOSIA.xlsm`), para las pruebas de `control-excel` y de
`_shared/xlsx-celdas.ts`. Conserva la estructura real del fichero (exportado por
Google: zip con «data descriptors», textos compartidos, fórmulas compartidas,
validaciones de lista, formato condicional y estilos), pero:

- Solo tiene las hojas `CLIENTES`, `COBROS` y `GASTOS CLIENTES`, hasta la fila 30
  (el real llega a la 506). No lleva `INICIO`, `GASTOS NEGOCIO`, `SOCIOS`,
  `MES A MES`, `AJUSTES` ni `GUIA`, ni sus textos ni sus gráficos.
- De los otros clientes solo queda el nombre.
- Los importes y las notas de Casa Tomás están cambiados por valores de prueba.
- Los valores guardados de algunas fórmulas están viejos **a propósito**
  (`COBROS!H7` = 999, `CLIENTES!K7` = 99,99): las pruebas comprueban que no nos
  fiamos de ellos.

No sustituir por el Excel real.
