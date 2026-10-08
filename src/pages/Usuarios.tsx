import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListaUsuarios } from "@/components/usuarios/ListaUsuarios";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado abierto en el
 * móvil) deja de encoger y vuelve el scroll de página. El mismo que Newsletter.
 */
const ALTURA_MINIMA_USUARIOS = 360;

export default function Usuarios() {
  // Alto de la pantalla, sin scroll de página (petición del dueño, 2026-10-07): mismo patrón que
  // Newsletter (`useAlturaDisponible`). La cabecera de la tarjeta queda fija y la
  // tabla hace scroll por dentro con la cabecera de columnas pegada (ListaUsuarios). Sin medida
  // (jsdom, primer pintado) cae al layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_USUARIOS);

  return (
    <DashboardLayout>
      <div ref={setRaiz} className="flex flex-col gap-6" style={alto ? { height: alto } : undefined}>
        {/* Sin título de página (2026-09-25): la pestaña "Usuarios" activa en
            el menú lateral ya dice dónde estás; el subtítulo era relleno. */}

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Lista de Usuarios</CardTitle>
            <CardDescription>
              Consulta los accesos de cada usuario. Toda la gestión se realiza desde el superadmin.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            <ListaUsuarios />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
