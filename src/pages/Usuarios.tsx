import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ListaUsuarios } from "@/components/usuarios/ListaUsuarios";
import { InvitarUsuario } from "@/components/usuarios/InvitarUsuario";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { UserPlus } from "lucide-react";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado abierto en el
 * móvil) deja de encoger y vuelve el scroll de página. El mismo que Newsletter.
 */
const ALTURA_MINIMA_USUARIOS = 360;

export default function Usuarios() {
  const [addUserOpen, setAddUserOpen] = useState(false);
  // Alto de la pantalla, sin scroll de página (petición del dueño, 2026-10-07): mismo patrón que
  // Newsletter (`useAlturaDisponible`). El botón y la cabecera de la tarjeta quedan fijos y la
  // tabla hace scroll por dentro con la cabecera de columnas pegada (ListaUsuarios). Sin medida
  // (jsdom, primer pintado) cae al layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_USUARIOS);

  return (
    <DashboardLayout>
      <div ref={setRaiz} className="flex flex-col gap-6" style={alto ? { height: alto } : undefined}>
        {/* Sin título de página (2026-09-25): la pestaña "Usuarios" activa en
            el menú lateral ya dice dónde estás; el subtítulo era relleno. */}

        <div className="flex justify-end">
          <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
            <DialogTrigger asChild>
              <Button className="flex h-11 items-center gap-2 px-5">
                <UserPlus className="h-4 w-4" />
                Añadir Usuario
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Añadir Nuevo Usuario</DialogTitle>
                <DialogDescription>
                  Registra un nuevo usuario y configura sus permisos iniciales
                </DialogDescription>
              </DialogHeader>
              <InvitarUsuario onSuccess={() => setAddUserOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Lista de Usuarios</CardTitle>
            <CardDescription>
              Gestiona los permisos de cada usuario del sistema
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
