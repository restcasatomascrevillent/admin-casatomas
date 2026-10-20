import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditarCatalogo } from "../SelectorServicios";
import type { CatalogoFacturacion } from "../modelo";
const inicial:CatalogoFacturacion = {productos:[
  {id:"a",nombre:"Carta",precio:10,categoria:"Módulo",periodicidad:"Mensual"},
  {id:"b",nombre:"Reservas",precio:25,categoria:"Módulo",periodicidad:"Mensual"},
  {id:"c",nombre:"Cheques",precio:15,categoria:"Módulo",periodicidad:"Mensual"}
],paquetes:[{id:"pack",nombre:"Todo",productoIds:["a","b","c"]}]};
function Harness({busy=false}:{busy?:boolean}) {
  const [catalogo,setCatalogo]=useState(inicial);
  return <><EditarCatalogo catalogo={catalogo} cambiar={setCatalogo} busy={busy}/><output data-testid="catalogo">{JSON.stringify(catalogo)}</output></>;
}
describe("Orden de módulos",()=>{
  it("mueve un módulo y conserva sus precios, cambios y relaciones con paquetes",()=>{
    render(<Harness/>);
    fireEvent.change(screen.getByLabelText("Precio de Reservas"),{target:{value:"40"}});
    fireEvent.click(screen.getByRole("button",{name:"Subir Reservas"}));
    expect(screen.getAllByRole("button",{name:/Arrastrar /}).map(b=>b.getAttribute("aria-label"))).toEqual(["Arrastrar Reservas","Arrastrar Carta","Arrastrar Cheques"]);
    const data=JSON.parse(screen.getByTestId("catalogo").textContent!);
    expect(data.productos[0]).toMatchObject({id:"b",precio:40});
    expect(data.paquetes[0].productoIds).toEqual(["a","b","c"]);
    expect(screen.getByRole("button",{name:"Subir Reservas"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Bajar Reservas"}));
    expect(screen.getAllByRole("button",{name:/Arrastrar /}).map(b=>b.getAttribute("aria-label"))).toEqual(["Arrastrar Carta","Arrastrar Reservas","Arrastrar Cheques"]);
  });
  it("confirma la eliminación y retira el módulo de los paquetes",()=>{
    render(<Harness/>);
    fireEvent.click(screen.getByRole("button",{name:"Eliminar Reservas"}));
    fireEvent.click(screen.getByRole("button",{name:"Cancelar"}));
    expect(screen.getByLabelText("Precio de Reservas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Eliminar Reservas"}));
    fireEvent.click(screen.getByRole("button",{name:"Eliminar módulo"}));
    expect(screen.queryByLabelText("Precio de Reservas")).toBeNull();
    const data=JSON.parse(screen.getByTestId("catalogo").textContent!);
    expect(data.productos.map((p:{id:string})=>p.id)).toEqual(["a","c"]);
    expect(data.paquetes[0].productoIds).toEqual(["a","c"]);
    expect(data.productos.map((p:{precio:number})=>p.precio)).toEqual([10,15]);
  });
  it("bloquea los controles mientras se guarda",()=>{
    render(<Harness busy/>);
    expect(screen.getByRole("button",{name:"Arrastrar Reservas"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Subir Reservas"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Subir Reservas"}));
    expect(JSON.parse(screen.getByTestId("catalogo").textContent!).productos.map((p:{id:string})=>p.id)).toEqual(["a","b","c"]);
  });
});
