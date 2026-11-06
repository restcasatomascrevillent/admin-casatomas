# Reglas del repaso final. Clave: nombre actual (o '#id' para productos de catálogo).
# Valor: (destino, familia) -> destino = int (producto_id) o str (nombre nuevo); familia None = la que tenga.
R = {}
def to(dest, cat, *olds):
    for o in olds:
        R[o] = (dest, cat)

# ---------- Lonja genérica ----------
to('Pescado variado de lonja', 17, 'Perciformes', 'Pleuronectiformes', 'Gadiformes')
to('Marisco variado de lonja', 18, 'Macruros', 'Cefalópodos', 'Varios (pescado y marisco)')
# ---------- Marisco ----------
to(107, None, 'Buey de mar hembra')
to(303, None, '#106')
to(218, None, 'Bogavante azul')
to('Langostino', 18, 'Langostino nacional')
to('Langostino cocido', 18, 'Langostino cocido 30/40')
to('Molla de mejillón congelada', 18, 'Carne de mejillón')
to('Mejillón media concha congelado', 18, 'Mejillón media concha')
to('Mejillón en escabeche', 18, 'Mejillón en escabeche Ramón Franco 8/12', 'Mejillón en escabeche Real Conservera')
to(291, None, 'Quisquilla extra')
to('Cola de alistado', 18, 'Cola de alistado')
to('Cabezas de alistado', 18, 'Cabezas de alistado')
# ---------- Pescado ----------
to('Salmón fresco entero', 17, 'Salmón fresco')
to('Lomo de salmón fresco', 17, 'Filete de salmón')
to('Lomo de atún limpio', 17, 'Atún lomo central')
to('Boquerón fresco', 17, 'Boquerón')
to('Boquerón en vinagre', 17, 'Boquerón en vinagre alineado', 'Boquerones en vinagre')
to('Sardinillas en aceite de oliva', 17, 'Sardinillas en aceite de oliva 14/18', 'Sardinillas en aceite extra especial')
to('Anchoa del Cantábrico en aceite', 17, 'Anchoa en aceite Hansa 14/16 filetes', 'Anchoas XL alta restauración',
   'Anchoa del Cantábrico en aceite de girasol')
to('Anchoa en aceite de oliva', 17, 'Anchoa en aceite de oliva', 'Anchoas en conserva 500 g')
to('Anchoa en salazón', 17, 'Anchoa en salazón 200 g')
to(251, None, 'Atún claro en aceite Claramar 1 kg', 'Atún claro en aceite de girasol Navegante 900 g',
   'Atún claro en aceite Montey 900 g', 'Atún claro en aceite vegetal Arroyabe 900 g',
   'Atún en aceite de girasol Bachi 650 g', 'Atún en aceite RO-1000 Cortizo')
to(298, None, 'Ventresca de bonito en aceite de oliva 1/4', 'Ventresca de bonito en conserva')
to('Ventresca de atún claro en conserva', 17, 'Ventresca de atún claro en conserva', 'Ventresca de atún El Capricho 115 g')
to('Migas de atún en aceite', 17, 'Migas de atún en aceite vegetal 650 g')
to('Sucedáneo de caviar de mújol', 17, 'Sucedáneo de caviar de mújol')
to('Cocochas de merluza frescas', 17, 'Cocochas de merluza')
# ---------- Frutas y verduras ----------
to(324, None, 'Ajo pelado')
to('Trufa de verano fresca', 5, 'Trufa de verano (Tuber aestivum)')
to('Trufa negra de invierno fresca', 5, 'Trufa negra (Tuber melanosporum)')
to('Kiwi Sungold', 5, 'Kiwi Gold')
to('Pimiento rojo', 5, 'Pimiento rojo italiano')
to('Setas variadas congeladas', 5, 'Mezcla de setas', 'Salteado de setas congelado')
to('Rebozuelo', 5, 'Rosiñol')
to('Cebolla en cubos congelada', 5, 'Cebolla en cubos')
to('Cebolla en tiras congelada', 5, 'Cebolla en tiras')
to('Alcachofa cortada congelada', 5, 'Alcachofa cortada congelada')
to('Brócoli congelado', 5, 'Brócoli congelado 2,25 kg')
to('Edamame congelado', 5, 'Edamame congelado')
to('Guisantes congelados', 5, 'Guisantes congelados')
to('Mango en cubos congelado', 5, 'Mango en cubos congelado')
to('Mezcla de frutas del bosque congelada', 5, 'Mezcla de frutas del bosque congelada')
# ---------- Despensa ----------
to('Altramuces', 6, 'Altramuces Juferna 2 kg')
to('Alubia cocida', 6, 'Alubias cocidas Luengo 2,6 kg')
to('Arroz de grano medio', 6, 'Arroz extra 5 kg')
to('Arroz de grano largo', 6, 'Arroz de grano largo 5 kg')
to(321, None, 'Azúcar Azucarera 1 kg', 'Azúcar blanco 1 kg', 'Azúcar blanco Sucrebo 1 kg')
to('Azúcar en sobres', 6, 'Azúcar Salzillo sobres 6 g', 'Azúcar en sobres corazón San Valentín')
to('Azúcar moreno en sobres', 6, 'Azúcar moreno Salzillo stick 6 g')
to('Colorante alimentario', 6, 'Colorante alimentario 900 g', 'Colorante alimentario BT-1 Sheros', 'Colorante alimentario Primera 900 g')
to('Fideo chino', 6, 'Fideos chinos Soubry 250 g')
to('Harina para freír', 6, 'Harina para fritura 5 kg')
to('Hierbas provenzales', 6, 'Hierbas provenzales Juferna 250 g')
to('Mermelada de arándanos', 6, 'Mermelada de arándanos La Vieja Fábrica 800 g')
to('Mermelada de higos', 6, 'Mermelada de higos La Vieja Fábrica 800 g')
to('Mayonesa japonesa', 6, 'Mayonesa japonesa Allgroo 520 ml', 'Mayonesa japonesa Kewpie 2,4 l')
to('Pimentón dulce', 6, 'Pimentón dulce DOP', 'Pimentón dulce La Dalia 800 g')
to('Pimienta negra molida', 6, 'Pimienta negra molida 800 g', 'Pimienta negra molida BT-1 Sheros')
to(325, None, 'Pimiento del piquillo en tiras 1,9 kg')
to('Pimiento del piquillo entero', 6, 'Pimiento del piquillo entero Don Molinico 1,9 kg')
to('Piparra en conserva', 6, 'Piparras picantes sabor dulce A. Sádaba 370 ml')
to('Preparado para rebozar sin gluten', 6, 'Preparado para rebozados sin gluten',
   'Preparado para rebozar sin gluten Dani 3 kg', 'Preparado para rebozar sin gluten Dani 470 g')
to('Salmorreta', 6, 'Salmorreta Paellalia 140 g', 'Salmorreta Paellalia 380 g')
to('Salsa barbacoa', 6, 'Salsa barbacoa Chovi 1,9 kg', 'Salsa barbacoa Millás 1,85 L')
to('Salsa de soja sin gluten', 6, 'Salsa de soja Kikkoman sin gluten 1 l', 'Salsa de soja sin gluten 1 l')
to('Salsa romesco', 6, 'Salsa romesco Ferrer 645 g')
to('Tomate pelado en lata', 6, 'Tomate entero pelado 1,6 kg')
to('Tomate troceado en conserva', 6, 'Tomate troceado 2,65 kg', 'Tomate troceado Éxito 3 kg')
to('Tomate rallado', 6, 'Tomate rallado El Labrador 720 ml')
to('Tomate seco en aceite', 6, 'Tomate seco El Labrador 370 ml', 'Tomate seco en tiras en aceite')
to('Pasta de wasabi', 6, 'Wasabi en pasta Neri 43 g')
to('Guacamole', 6, 'Guacamole 1 kg', 'Guacamole 500 g')
to('Gilda de anchoa', 6, 'Gilda tradicional', 'Gilda de anchoa 25 ud')
to('Miel de caña', 6, 'Concentrado de caña Carmen 920 g')
to('Carbón vegetal en saco', 11, 'Sacos de carbón')
to('Lana de madera para encendido 1 kg', 11, 'Lana de madera para encendido 1 kg')
to('Pastillas de encendido', 11, 'Pastillas de encendido')
to('Twist green', 7, 'Twist green')
for _n in ['Monin puré de fruta de la pasión 1 L', 'Monin puré de mango 1 L', 'Sirope Monin manzana verde 70 cl',
           'Sirope Monin melocotón 70 cl', 'Sirope Monin spicy mango 70 cl', 'Granadina Rives sin alcohol']:
    to(_n, 6, _n)
# ---------- Lácteos ----------
to('Leche entera', 4, 'Leche entera 1 l', 'Leche entera Covap 1,5 l')
to('Leche de hostelería 1,5 l', 4, 'Leche Asturiana hostelería 1,5 l', 'Leche Puleva hostelería 1,5 l')
to('Leche semidesnatada', 4, 'Leche Puleva semidesnatada 1 l', 'Leche semidesnatada Asturiana 1 l')
to(327, None, 'Leche semidesnatada sin lactosa Puleva 1 l')
to('Mantequilla', 4, 'Mantequilla Albiero 1 kg', 'Mantequilla Pont Morin 1 kg', 'Mantequilla Soresina 1 kg')
to('Mantequilla con sal', 4, 'Mantequilla Kerrygold con sal 200 g')
to('Mantequilla en monodosis', 4, 'Mantequilla en porciones 10 g', 'Mantequilla en tarrina 10 g Reny Picot')
to('Huevo líquido pasteurizado', 4, 'Huevo entero líquido pasteurizado Ovopak', 'Huevo líquido pasteurizado 1 l')
to('Queso feta', 4, 'Queso feta DOP Dodoni', 'Queso feta en salmuera')
to(330, None, 'Queso de rulo Mont de France')
to('Queso provolone', 4, 'Queso provolone Albiero')
to('Queso crema', 4, 'Queso cremoso de untar cubo 3 kg', 'Queso Philadelphia original')
to('Queso manchego curado', 4, 'Queso de oveja curado manchego artesano El Pesebre', 'Queso manchego curado Adiano')
to('Queso manchego semicurado', 4, 'Queso de oveja semicurado manchego artesano El Pesebre',
   'Queso manchego semicurado Adiano', 'Queso manchego semicurado Arquero')
to('Queso mezcla semicurado', 4, 'Queso semicurado mezcla Dialse')
# ---------- Panadería ----------
to('Pan de molde sin gluten', 7, 'Pan de molde sin gluten Dr. Schär')
to('Pan bao', 7, 'Pan bao blanco 60 g')
to('Gominolas', 7, 'Golosinas Fini mix goma pica', 'Golosinas Jake mini max azúcar')
to('Virutas de chocolate con leche', 7, 'Viruta pequeña de chocolate con leche')
to(226, None, 'Trufas de chocolate 50 ud')
# ---------- Congelados ----------
to('Patatas fritas congeladas', 8, 'Patatas fritas congeladas 3/8', 'Patatas prefritas 7/7')
# ---------- Bebidas ----------
to('Agua San Pellegrino con gas 50 cl', 15, 'Agua San Pellegrino 50 cl')
to('Bitter Kas 20 cl', 15, 'Bitter Kas')
to('Whisky J&B 70 cl', 14, 'J&B 70 cl')
to('Château Giscours 75 cl', 12, 'Château Giscours')
to('Vino blanco Cerro de la Cruz brik 1 l', 12, 'Vino blanco Cerro Cruz brick 1 l')
to('Balbás Ancestral 75 cl', 12, 'Ancestral')
for _n in ['Licor de manzana sin alcohol Drols 1 L', 'Licor de mora sin alcohol Drols 1 L', 'Tanqueray 0,0 70 cl']:
    to(_n, 15, _n)
# ---------- Carne y embutidos ----------
to('Aguja de cerdo sin hueso', 19, 'Aguja de cerdo deshuesada')
to('Callos de vacuno congelados', 19, 'Callo de vacuno')
to('Costilla de cerdo en tiras', 19, 'Costilla de cerdo', 'Costillas de cerdo en tiras')
to('Costilla de cerdo barbacoa', 19, 'Costillar de cerdo troceado BBQ')
to('Lomo alto de vaca', 19, 'Entrecot de vaca')
to('Escalope de foie gras de pato congelado', 19, 'Escalopa de foie gras congelada 50 g',
   'Escalopa de foie gras de pato', 'Escalope de foie gras')
to('Lomo de cerdo adobado', 19, 'Lomo adobado')
to('Lomo de cerdo', 19, 'Lomo de cerdo extra tierno ElPozo')
to('Salado de cerdo para cocido', 19, 'Salados de cerdo')
to('Lomo de vaca con hueso', 19, 'Lomo de vaca')
to('Bacon entero', 20, 'Bacón ahumado')
to('Chistorra', 20, 'Chistorra extra')
to('Jamón serrano deshuesado', 20, 'Jamón deshuesado Castillo de Magaña',
   'Jamón deshuesado gran reserva Altos de Iberia', 'Jamón serrano reserva deshuesado')
to('Morcilla de Burgos', 20, 'Morcilla de arroz de Burgos')
# ---------- Limpieza, menaje, servicios ----------
to('Papel vegetal 40x60 cm', 9, 'Papel vegetal')
to('Papel antigrasa', 9, 'Papel antigrasa blanco 500 ud')
to('Lavavajillas a mano 5 l', 9, 'Lavavajillas a mano Fairy 5 l')
to('Lejía 2 l', 9, 'Lejía amarilla Kiriko 2 L', 'Lejía Caprichosa 2 l')
to(230, None, 'Bobina de mecha gofrada Karme 800 g')
for _n in ['Dispensador de ambientador a pilas', 'Portarrollos Chemi blanco serie Dynamic', 'Cono suplemento porta chemi coreless']:
    to(_n, 10, _n)
to('Gorro alto negro', 10, 'Gorro alto de popelín negro')
to(246, None, 'Cuchara de café Paladium')
to(339, None, 'Gestión de residuos RGA por albarán')
to('Descuento comercial', 11, 'Descuento 20 %', 'Descuento por promoción (caja completa)', 'Venta por volumen', 'Promoción especial')

# ---------- Movimientos de textos concretos (se aplican ANTES de los renombres) ----------
# (nombre_actual, ejemplo impreso exacto o prefijo con '*') -> destino, familia, unidad
MOVER = [
    ('#221', 'CAL.LIMPIO 10/20 X1', 'Calamar limpio', 18, None),
    ('#228', 'ENTERA (K) AQUANARIA-LUBINA 11 (1100-1300)', 'Lubina de crianza', 17, 'kg'),
    ('Palometa roja', 'PALOMETA', 'Palometa', 17, 'kg'),
    ('Cocochas de merluza', 'MERLUZA COCOCHAS 16X250 CHILENA', 'Cocochas de merluza congeladas', 17, 'kg'),
    ('Coquina', 'COQUINA 12X250 ALTA', 'Coquina congelada', 18, 'kg'),
    ('Gamba blanca', 'GAMBA BLANCA 4 105/110 PZAS.', 'Gamba blanca congelada', 18, 'kg'),
    ('Lomo de vaca', 'TROZO LOMO ALTO VACIO', 'Lomo alto de vaca', 19, 'kg'),
    ('Lomo de vaca', 'LOMO VACA BAJO VACIO 5+', 'Lomo bajo de vaca', 19, 'kg'),
    ('Paletilla de cordero lechal', 'CORDERO LECHAL PALETILLA 450-595 GR CONG.', 'Paletilla de cordero lechal congelada', 19, 'kg'),
    ('#341', 'Oferta*', 'Descuento comercial', 11, None),
]

# ---------- Dudas ----------
QUITAR_DUDA = {
    'Pescado variado de lonja', 'Marisco variado de lonja', 'San Martín', 'Granadina Rives sin alcohol', 'Cookie deluxe 280 g',
    'Hoja de bambú para chimaki Zasa', 'Salado de cerdo para cocido', 'Espárrago verde', 'Rebozuelo',
    'Sistema de conservación de vino Tower portable edition dual', 'Balbás Ancestral 75 cl', 'Twist green',
    'Alcachofa cortada congelada', 'Cebolla en cubos congelada', 'Cebolla en tiras congelada', 'Aceituna cortada Sarasa 750 g',
    'Aceituna Mare Nostrum Maestrazgo 700 g', 'Cartucho de gas 227 g', 'Miel de caña', 'Cuello de cordero', 'Coco',
    'Hamburguesa de tofu y calabaza 150 g', 'Pepinillos en vinagre', 'Panceta curada', 'Preparado de queso fundido y mozzarella',
    'Preparado para pizza en grano', 'Bao de cerdo', 'Tomate rojo', 'Descuento comercial', 'Bordado de camisa',
    'Cremoso de chipirón 2 kg', '#107', '#341',
}
NUEVA_DUDA = {
    'Brillante': 'Marisco sin identificar («brillante», Pescados y Mariscos Colorao); los precios (2,4-4,6) parecen por pieza, no por kg',
}

# ---------- Añadidos tras revisar el resultado ----------
to(219, None, 'Bonito')
to('Tomate frito', 6, 'Salsa de tomate frito pouch 2,5 kg')
