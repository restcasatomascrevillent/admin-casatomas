import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useHistorialAjustes } from "@/hooks/useHistorialAjustes";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { TrendingUp } from "lucide-react";
import { useState } from "react";

export function GraficoEvolucionPrecios() {
  const { historial } = useHistorialAjustes();
  const [tipoCartaSeleccionado, setTipoCartaSeleccionado] = useState<"platos" | "bebidas" | "vinos">("platos");

  const datosGrafico = useMemo(() => {
    if (!historial || historial.length === 0) return [];

    // Filtrar por tipo de carta
    const historialFiltrado = historial.filter(h => h.tipo_carta === tipoCartaSeleccionado);

    // Agrupar por fecha y categoría
    const datosPorFecha = new Map<string, Map<string, { total: number; count: number }>>();

    historialFiltrado.forEach(ajuste => {
      const fecha = format(new Date(ajuste.fecha), "dd/MM/yyyy", { locale: es });
      
      ajuste.snapshot.forEach((item: any) => {
        const categoria = ajuste.categoria === "todas" ? "Todas" : ajuste.categoria;
        
        if (!datosPorFecha.has(fecha)) {
          datosPorFecha.set(fecha, new Map());
        }
        
        const categoriasEnFecha = datosPorFecha.get(fecha)!;
        if (!categoriasEnFecha.has(categoria)) {
          categoriasEnFecha.set(categoria, { total: 0, count: 0 });
        }
        
        const stats = categoriasEnFecha.get(categoria)!;
        stats.total += item.precio_nuevo;
        stats.count += 1;
      });
    });

    // Convertir a formato para el gráfico
    const resultado = Array.from(datosPorFecha.entries())
      .map(([fecha, categorias]) => {
        const punto: any = { fecha };
        
        categorias.forEach((stats, categoria) => {
          punto[categoria] = Number((stats.total / stats.count).toFixed(2));
        });
        
        return punto;
      })
      .reverse(); // Más antiguo primero

    return resultado;
  }, [historial, tipoCartaSeleccionado]);

  const categorias = useMemo(() => {
    if (datosGrafico.length === 0) return [];
    const cats = new Set<string>();
    datosGrafico.forEach(punto => {
      Object.keys(punto).forEach(key => {
        if (key !== "fecha") cats.add(key);
      });
    });
    return Array.from(cats);
  }, [datosGrafico]);

  const colores = [
    "hsl(var(--primary))",
    "hsl(var(--accent))",
    "hsl(var(--secondary))",
    "#8b5cf6",
    "#ec4899",
    "#10b981",
    "#f59e0b",
  ];

  const getTipoCartaLabel = (tipo: string) => {
    const labels: Record<string, string> = {
      platos: "Platos",
      bebidas: "Bebidas",
      vinos: "Vinos",
    };
    return labels[tipo] || tipo;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Evolución de Precios Promedio
            </CardTitle>
            <CardDescription>
              Histórico de precios promedio por categoría
            </CardDescription>
          </div>
          <Select value={tipoCartaSeleccionado} onValueChange={(v: any) => setTipoCartaSeleccionado(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="platos">Platos</SelectItem>
              <SelectItem value="bebidas">Bebidas</SelectItem>
              <SelectItem value="vinos">Vinos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {datosGrafico.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            No hay datos de historial para {getTipoCartaLabel(tipoCartaSeleccionado).toLowerCase()}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={datosGrafico}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="fecha" 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                label={{ value: 'Precio Promedio (€)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                }}
              />
              <Legend />
              {categorias.map((categoria, index) => (
                <Line
                  key={categoria}
                  type="monotone"
                  dataKey={categoria}
                  stroke={colores[index % colores.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
