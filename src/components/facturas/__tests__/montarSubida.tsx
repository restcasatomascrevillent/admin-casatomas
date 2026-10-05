// Monta la pestaña «Cargar» como en la app: QueryClient + router + el gestor
// global <ColaSubidaProvider> POR ENCIMA de las rutas, y una ruta /reservas con
// el indicador global para comprobar que la cola sigue al irse de Facturas.
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ColaSubidaProvider } from "../ColaSubidaProvider";
import { IndicadorSubidasFacturas } from "../IndicadorSubidasFacturas";
import { SubidaFacturas } from "../SubidaFacturas";
import type { DepsCola } from "@/lib/facturas/colaSubida";

function Ubicacion() {
  const l = useLocation();
  return <output data-testid="ubicacion">{l.pathname + l.search}</output>;
}

export function montarSubida({ ruta = "/facturas?tab=cargar", deps }: { ruta?: string; deps?: Partial<DepsCola> } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ruta]}>
        <ColaSubidaProvider deps={deps}>
          <nav>
            <Link to="/reservas">Ir a Reservas</Link>
            <Link to="/facturas?tab=cargar">Ir a Cargar</Link>
          </nav>
          <Routes>
            <Route path="/facturas" element={<SubidaFacturas />} />
            <Route path="/reservas" element={<IndicadorSubidasFacturas variante="cabecera" />} />
          </Routes>
          <Ubicacion />
        </ColaSubidaProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
