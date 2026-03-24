import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type SeccionEspecial = "menus_diarios" | "tapas";

const SECCION_CONFIG: Record<
  SeccionEspecial,
  { table: "menus_diarios" | "tapas"; singular: string; plural: string }
> = {
  menus_diarios: {
    table: "menus_diarios",
    singular: "Menú diario",
    plural: "Menús diarios",
  },
  tapas: {
    table: "tapas",
    singular: "Tapa",
    plural: "Tapas",
  },
};

interface MenuJson {
  primero: string;
  segundo: string;
  postre: string;
}

interface MenuDiarioRow {
  id: string;
  fecha: string;
  menu: unknown;
}

interface TapasRow {
  id: string;
  fecha: string;
  tapas: unknown;
}

interface RegistroLista {
  id: string;
  titulo: string;
  detalle: string;
}

const parseMenuJson = (value: unknown): MenuJson => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { primero: "", segundo: "", postre: "" };
  }
  const obj = value as Record<string, unknown>;
  return {
    primero: typeof obj.primero === "string" ? obj.primero : "",
    segundo: typeof obj.segundo === "string" ? obj.segundo : "",
    postre: typeof obj.postre === "string" ? obj.postre : "",
  };
};

const parseTapasJson = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

interface EditorMenuTapasWebProps {
  seccionActiva: SeccionEspecial;
}

export function EditorMenuTapasWeb({ seccionActiva }: EditorMenuTapasWebProps) {
  const config = SECCION_CONFIG[seccionActiva];
  const [menuRows, setMenuRows] = useState<MenuDiarioRow[]>([]);
  const [tapasRows, setTapasRows] = useState<TapasRow[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const registros = useMemo<RegistroLista[]>(() => {
    if (seccionActiva === "menus_diarios") {
      return menuRows.map((row) => {
        const menu = parseMenuJson(row.menu);
        return {
          id: row.id,
          titulo: `Menú del día ${row.fecha}`,
          detalle: `Primero: ${menu.primero} | Segundo: ${menu.segundo} | Postre: ${menu.postre}`,
        };
      });
    }

    return tapasRows.map((row) => {
      const tapas = parseTapasJson(row.tapas);
      return {
        id: row.id,
        titulo: `Tapas del día ${row.fecha}`,
        detalle: tapas.join(", "),
      };
    });
  }, [seccionActiva, menuRows, tapasRows]);

  const cargarDatos = async () => {
    setIsLoading(true);
    try {
      const sb = supabase as any;

      if (seccionActiva === "menus_diarios") {
        const { data, error } = await sb
          .from("menus_diarios")
          .select("id, fecha, menu")
          .eq("idiom", "es")
          .order("fecha", { ascending: false });
        if (error) throw error;
        setMenuRows((data ?? []) as MenuDiarioRow[]);
        return;
      }

      const { data, error } = await sb
        .from("tapas")
        .select("id, fecha, tapas")
        .eq("idiom", "es")
        .order("fecha", { ascending: false });
      if (error) throw error;
      setTapasRows((data ?? []) as TapasRow[]);
    } catch (error) {
      console.error(error);
      toast.error(`Error al cargar ${config.plural.toLowerCase()}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccionActiva]);

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const sb = supabase as any;
      const { error } = await sb.from(config.table).delete().eq("id", deleteId);
      if (error) throw error;

      setDeleteId(null);
      toast.success(`${config.singular} eliminado`);
      await cargarDatos();
    } catch (error) {
      console.error(error);
      toast.error("Error al eliminar");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">
            {config.plural} ({registros.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => cargarDatos()}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="ml-1.5">Recargar</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : registros.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay {config.plural.toLowerCase()}</p>
          ) : (
            registros.map((registro) => (
              <div
                key={registro.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{registro.titulo}</p>
                  <p className="text-xs text-muted-foreground truncate">{registro.detalle || "Sin detalle"}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setDeleteId(registro.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Los menús y tapas se crean automáticamente desde el backend. Pulsa «Recargar» para ver los últimos datos.
      </p>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {config.singular.toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El registro se eliminará permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
