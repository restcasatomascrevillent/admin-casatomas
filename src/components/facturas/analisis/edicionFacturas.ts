import { createContext, useContext } from "react";

/**
 * ¿Tiene «Editar» en Facturas quien mira el tablero de Análisis? (06/11/2026)
 * Con solo «Ver» se consulta todo, pero los accesos a acciones que cambian datos
 * (p. ej. «Clasificar con IA», «Clasificarlas en Compras › Productos») se
 * ocultan. Lo da ChatFacturas a todo el tablero; sin él, no (se oculta).
 */
export const EdicionFacturasContext = createContext(false);

export const usePuedeEditarFacturas = (): boolean => useContext(EdicionFacturasContext);
