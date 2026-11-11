import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePlatos } from "@/hooks/usePlatos";
import { useBebidas } from "@/hooks/useBebidas";
import { useVinos } from "@/hooks/useVinos";
import { useHistorialAjustes } from "@/hooks/useHistorialAjustes";
import { HistorialAjustesDialog } from "./HistorialAjustesDialog";
import { AlertaCambioExtremoDialog } from "./AlertaCambioExtremoDialog";
import { toast } from "sonner";
import { History, Percent } from "lucide-react";

interface AjustePreciosModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AjustePreciosModal({ open, onOpenChange }: AjustePreciosModalProps) {
  const [tipoCarta, setTipoCarta] = useState<"platos" | "bebidas" | "vinos">("platos");
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string>("todas");
  const [itemSeleccionado, setItemSeleccionado] = useState<string>("todos");
  const [porcentaje, setPorcentaje] = useState<string>("");
  const [precioExacto, setPrecioExacto] = useState<string>("");
  const [historialOpen, setHistorialOpen] = useState(false);
  const [alertaExtremaOpen, setAlertaExtremaOpen] = useState(false);
  const [datosAjustePendiente, setDatosAjustePendiente] = useState<any>(null);

  const UMBRAL_ALERTA = 10; // Porcentaje para alertar

  const { platos, categorias: categoriasPlatos, actualizarPlato } = usePlatos();
  const { bebidas, categorias: categoriasBebidas, actualizarBebida } = useBebidas();
  const { vinos, categorias: categoriasVinos, actualizarVino } = useVinos();
  const { guardarAjuste } = useHistorialAjustes();

  const categoriasActuales = 
    tipoCarta === "platos" ? categoriasPlatos :
    tipoCarta === "bebidas" ? categoriasBebidas :
    categoriasVinos;

  // Obtener items de la categoría seleccionada
  const itemsCategoria = (() => {
    if (categoriaSeleccionada === "todas") return [];
    
    if (tipoCarta === "platos") {
      return platos?.filter(p => p.categoria === categoriaSeleccionada) || [];
    } else if (tipoCarta === "bebidas") {
      return bebidas?.filter(b => b.categoria === categoriaSeleccionada) || [];
    } else {
      return vinos?.filter(v => v.categoria === categoriaSeleccionada) || [];
    }
  })();

  const esEdicionIndividual = itemSeleccionado !== "todos";

  // Función para redondear a .00 o .50
  const redondearPrecioBonito = (precio: number): number => {
    // Redondear al .50 más cercano
    return Math.round(precio * 2) / 2;
  };

  const aplicarAjuste = async (porcentajeNum: number, itemsAActualizar: any[]) => {
    try {
      // Preparar snapshot para historial
      const snapshot = itemsAActualizar.map((item) => {
        const precioActual = item.precio_eur || 0;
        const nuevoPrecio = precioActual * (1 + porcentajeNum / 100);
        // Redondear a .00 o .50
        const precioRedondeado = redondearPrecioBonito(nuevoPrecio);
        
        return {
          id: item.id,
          nombre: item.nombre || "Sin nombre",
          precio_anterior: precioActual,
          precio_nuevo: precioRedondeado,
        };
      });

      // Aplicar ajuste a cada item
      const actualizaciones = snapshot.map(async (item) => {
        if (tipoCarta === "platos") {
          return actualizarPlato.mutateAsync({ id: item.id, precio_eur: item.precio_nuevo });
        } else if (tipoCarta === "bebidas") {
          return actualizarBebida.mutateAsync({ id: item.id, precio_eur: item.precio_nuevo });
        } else {
          return actualizarVino.mutateAsync({ id: item.id, precio_eur: item.precio_nuevo });
        }
      });

      await Promise.all(actualizaciones);

      // Guardar en historial
      await guardarAjuste.mutateAsync({
        tipo_carta: tipoCarta,
        categoria: categoriaSeleccionada,
        porcentaje: porcentajeNum,
        items_afectados: itemsAActualizar.length,
        snapshot,
      });

      toast.success(
        `Precios actualizados: ${itemsAActualizar.length} item(s) ajustados ${porcentajeNum > 0 ? '+' : ''}${porcentajeNum}%`
      );
      
      // Resetear formulario
      setPorcentaje("");
      setCategoriaSeleccionada("todas");
      setDatosAjustePendiente(null);
      onOpenChange(false);
    } catch (error) {
      toast.error("Error al actualizar los precios");
      console.error(error);
    }
  };

  const handleAplicar = async () => {
    // Validar según el modo (individual o masivo)
    if (esEdicionIndividual) {
      // Modo individual: cambiar precio exacto
      const precioNum = parseFloat(precioExacto);
      
      if (isNaN(precioNum) || precioNum < 0) {
        toast.error("Introduce un precio válido");
        return;
      }

      const itemAActualizar = itemsCategoria.find(i => i.id === itemSeleccionado);
      if (!itemAActualizar) {
        toast.error("Item no encontrado");
        return;
      }

      try {
        // Actualizar directamente el item con el precio exacto
        if (tipoCarta === "platos") {
          await actualizarPlato.mutateAsync({ id: itemAActualizar.id, precio_eur: precioNum });
        } else if (tipoCarta === "bebidas") {
          await actualizarBebida.mutateAsync({ id: itemAActualizar.id, precio_eur: precioNum });
        } else {
          await actualizarVino.mutateAsync({ id: itemAActualizar.id, precio_eur: precioNum });
        }

        // Guardar en historial
        const precioAnterior = itemAActualizar.precio_eur || 0;
        const porcentajeCambio = precioAnterior !== 0 
          ? ((precioNum - precioAnterior) / precioAnterior) * 100 
          : 0;

        await guardarAjuste.mutateAsync({
          tipo_carta: tipoCarta,
          categoria: categoriaSeleccionada,
          porcentaje: Number(porcentajeCambio.toFixed(2)),
          items_afectados: 1,
          snapshot: [{
            id: itemAActualizar.id,
            nombre: itemAActualizar.nombre || "Sin nombre",
            precio_anterior: precioAnterior,
            precio_nuevo: precioNum,
          }],
        });

        toast.success(`Precio actualizado: ${itemAActualizar.nombre} → ${precioNum.toFixed(2)}€`);
        
        // Resetear formulario
        setPrecioExacto("");
        setItemSeleccionado("todos");
        onOpenChange(false);
      } catch (error) {
        toast.error("Error al actualizar el precio");
        console.error(error);
      }
    } else {
      // Modo masivo: cambiar por porcentaje
      const porcentajeNum = parseFloat(porcentaje);
      
      if (isNaN(porcentajeNum)) {
        toast.error("Introduce un porcentaje válido");
        return;
      }

      // Filtrar items según tipo y categoría
      let itemsAActualizar: any[] = [];
      if (tipoCarta === "platos") {
        itemsAActualizar = categoriaSeleccionada === "todas" 
          ? platos || []
          : platos?.filter(p => p.categoria === categoriaSeleccionada) || [];
      } else if (tipoCarta === "bebidas") {
        itemsAActualizar = categoriaSeleccionada === "todas"
          ? bebidas || []
          : bebidas?.filter(b => b.categoria === categoriaSeleccionada) || [];
      } else {
        itemsAActualizar = categoriaSeleccionada === "todas"
          ? vinos || []
          : vinos?.filter(v => v.categoria === categoriaSeleccionada) || [];
      }

      if (itemsAActualizar.length === 0) {
        toast.error("No hay items para ajustar en esta categoría");
        return;
      }

      // Siempre pedir confirmación antes de aplicar
      setDatosAjustePendiente({
        porcentajeNum,
        itemsAActualizar,
      });
      setAlertaExtremaOpen(true);
    }
  };

  const confirmarAjusteExtremo = async () => {
    if (!datosAjustePendiente) return;
    await aplicarAjuste(datosAjustePendiente.porcentajeNum, datosAjustePendiente.itemsAActualizar);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="carta-contraste max-h-[92dvh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajuste Masivo de Precios</DialogTitle>
          <DialogDescription>
            Modifica los precios de toda la carta o de una categoría específica
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="tipo-carta">Tipo de Carta</Label>
            <Select value={tipoCarta} onValueChange={(value: any) => {
              setTipoCarta(value);
              setCategoriaSeleccionada("todas");
              setItemSeleccionado("todos");
            }}>
              <SelectTrigger id="tipo-carta" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="platos">Platos</SelectItem>
                <SelectItem value="bebidas">Bebidas</SelectItem>
                <SelectItem value="vinos">Vinos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="categoria">Categoría</Label>
            <Select value={categoriaSeleccionada} onValueChange={(value) => {
              setCategoriaSeleccionada(value);
              setItemSeleccionado("todos");
            }}>
              <SelectTrigger id="categoria" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las categorías</SelectItem>
                {categoriasActuales.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {categoriaSeleccionada !== "todas" && itemsCategoria.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="item">Item a Modificar</Label>
              <Select value={itemSeleccionado} onValueChange={setItemSeleccionado}>
                <SelectTrigger id="item" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los items de esta categoría</SelectItem>
                  {itemsCategoria.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.nombre} - {item.precio_eur?.toFixed(2) || "0.00"}€
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {esEdicionIndividual ? (
            <div className="space-y-2">
              <Label htmlFor="precio-exacto">Nuevo Precio (€)</Label>
              <div className="relative">
                <Input
                  id="precio-exacto"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="Ej: 12.50"
                  value={precioExacto}
                  onChange={(e) => setPrecioExacto(e.target.value)}
                  className="h-11 pr-8 text-base md:text-base"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  €
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Introduce el precio exacto que quieres asignar a este item
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="porcentaje">Porcentaje de Ajuste</Label>
              <div className="relative">
                <Input
                  id="porcentaje"
                  type="number"
                  step="0.1"
                  placeholder="Ej: 5 sube un 5 %, -10 baja un 10 %"
                  value={porcentaje}
                  onChange={(e) => setPorcentaje(e.target.value)}
                  className="h-11 pr-10 text-base md:text-base"
                />
                <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                Valores positivos aumentan el precio, negativos lo reducen
              </p>
            </div>
          )}
        </div>

        {/* 11/11/2026 (dueño: móvil perfecto): en móvil los botones van apilados a todo el ancho (acción principal arriba); desde sm, en una fila. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <Button 
            variant="outline" 
            onClick={() => setHistorialOpen(true)}
            className="h-11 w-full gap-2 px-4 sm:w-auto"
          >
            <History className="h-4 w-4" />
            Ver Historial
          </Button>
          
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button variant="outline" className="h-11 px-4" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button 
              className="h-11 px-4"
              onClick={handleAplicar} 
              disabled={esEdicionIndividual ? !precioExacto : !porcentaje}
            >
              {esEdicionIndividual ? "Actualizar Precio" : "Aplicar Ajuste"}
            </Button>
          </div>
        </div>
      </DialogContent>
      
      <HistorialAjustesDialog open={historialOpen} onOpenChange={setHistorialOpen} />
      
      <AlertaCambioExtremoDialog
        open={alertaExtremaOpen}
        onOpenChange={setAlertaExtremaOpen}
        porcentaje={parseFloat(porcentaje) || 0}
        tipoCarta={tipoCarta}
        categoria={categoriaSeleccionada}
        itemsAfectados={datosAjustePendiente?.itemsAActualizar?.length || 0}
        onConfirmar={confirmarAjusteExtremo}
      />
    </Dialog>
  );
}
