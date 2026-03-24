import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
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

interface MenuFormData {
  fecha: string;
  primero: string;
  segundo: string;
  postre: string;
}

interface TapasFormData {
  fecha: string;
  tapasTexto: string;
}

interface RegistroLista {
  id: string;
  titulo: string;
  detalle: string;
}

const getToday = () => new Date().toISOString().split("T")[0];

const initialMenuFormData = (): MenuFormData => ({
  fecha: getToday(),
  primero: "",
  segundo: "",
  postre: "",
});

const initialTapasFormData = (): TapasFormData => ({
  fecha: getToday(),
  tapasTexto: "",
});

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

const getTapasList = (text: string) =>
  text
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

interface EditorMenuTapasWebProps {
  seccionActiva: SeccionEspecial;
}

export function EditorMenuTapasWeb({ seccionActiva }: EditorMenuTapasWebProps) {
  const config = SECCION_CONFIG[seccionActiva];
  const [menuRows, setMenuRows] = useState<MenuDiarioRow[]>([]);
  const [tapasRows, setTapasRows] = useState<TapasRow[]>([]);
  const [menuForm, setMenuForm] = useState<MenuFormData>(initialMenuFormData());
  const [tapasForm, setTapasForm] = useState<TapasFormData>(initialTapasFormData());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

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

  const resetForm = () => {
    setMenuForm(initialMenuFormData());
    setTapasForm(initialTapasFormData());
  };

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
    resetForm();
    void cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccionActiva]);

  const enviarAlBackend = async () => {
    try {
      setIsSending(true);

      let contenido: Record<string, unknown> = {};

      if (seccionActiva === "menus_diarios") {
        if (!menuForm.primero.trim() || !menuForm.segundo.trim() || !menuForm.postre.trim()) {
          toast.error("Completa primero, segundo y postre");
          return;
        }
        contenido = {
          fecha: menuForm.fecha,
          descripcion: `Primero: ${menuForm.primero.trim()}. Segundo: ${menuForm.segundo.trim()}. Postre: ${menuForm.postre.trim()}`,
        };
      } else {
        const tapas = getTapasList(tapasForm.tapasTexto);
        if (tapas.length === 0) {
          toast.error("Escribe al menos una tapa");
          return;
        }
        contenido = {
          fecha: tapasForm.fecha,
          descripcion: tapas.join(", "),
        };
      }

      const { error } = await supabase.functions.invoke("traducir-carta-auto", {
        body: {
          tipo: "menu",
          nombre: seccionActiva === "menus_diarios" ? "Menú del día" : "Tapas del día",
          ...contenido,
        },
      });

      if (error) throw error;

      toast.success("Enviado al backend correctamente");
      resetForm();
    } catch (error) {
      console.error(error);
      toast.error("Error al enviar al backend");
    } finally {
      setIsSending(false);
    }
  };

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
      {/* Lista de registros existentes */}
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
        <CardContent className="space-y-2 max-h-56 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : registros.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay {config.plural.toLowerCase()}</p>
          ) : (
            registros.map((registro) => (
              <div
                key={registro.id}
                className="flex items-center justify-between p-2 rounded-lg border bg-card gap-2"
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

      {/* Formulario para enviar al backend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            Enviar {config.singular.toLowerCase()} al backend
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {seccionActiva === "menus_diarios" ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha</Label>
                <Input
                  type="date"
                  value={menuForm.fecha}
                  onChange={(e) => setMenuForm((prev) => ({ ...prev, fecha: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Primero</Label>
                <Textarea
                  value={menuForm.primero}
                  onChange={(e) => setMenuForm((prev) => ({ ...prev, primero: e.target.value }))}
                  placeholder="Ej: Ensalada templada de queso de cabra"
                  className="min-h-16 resize-y"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Segundo</Label>
                <Textarea
                  value={menuForm.segundo}
                  onChange={(e) => setMenuForm((prev) => ({ ...prev, segundo: e.target.value }))}
                  placeholder="Ej: Carrillera con puré de patata"
                  className="min-h-16 resize-y"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Postre o café</Label>
                <Textarea
                  value={menuForm.postre}
                  onChange={(e) => setMenuForm((prev) => ({ ...prev, postre: e.target.value }))}
                  placeholder="Ej: Tarta de queso o café"
                  className="min-h-16 resize-y"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha</Label>
                <Input
                  type="date"
                  value={tapasForm.fecha}
                  onChange={(e) => setTapasForm((prev) => ({ ...prev, fecha: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tapas del día (una por línea)</Label>
                <Textarea
                  value={tapasForm.tapasTexto}
                  onChange={(e) => setTapasForm((prev) => ({ ...prev, tapasTexto: e.target.value }))}
                  placeholder={"Ensaladilla rusa\nCroquetas de jamón\nPulpo a feira"}
                  className="min-h-40 resize-y"
                />
              </div>
            </>
          )}

          <Button onClick={enviarAlBackend} disabled={isSending} className="w-full">
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-1" />
                Enviar al backend
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        El backend guarda los datos en la base de datos. Pulsa «Recargar» para ver los últimos registros.
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
