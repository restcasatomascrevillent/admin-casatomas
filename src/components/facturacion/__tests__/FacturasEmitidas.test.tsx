import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {FacturasEmitidas} from '../FacturasEmitidas';
import {nuevaFactura} from '../modelo';

const emitida={id:'e',numero:'R-2026-001',documento:{...nuevaFactura(),fecha:'2026-10-01',cliente:{nombre:'Empresa emitida',nif:'',direccion:'',email:''}},creado_en:'2026-10-01',actualizado_en:'2026-10-01'};
const borrador={...emitida,id:'b',numero:'R-2026-002',factura_id:null,documento:{...emitida.documento,fecha:'2026-10-03',tipo:'mensual' as const,mes:'2026-10',cliente:{...emitida.documento.cliente,nombre:'Cliente borrador'}}};
describe('listado de recibos y borradores',()=>{
 it('filtra por estado, búsqueda y fecha y permite limpiar los filtros',()=>{
  render(<FacturasEmitidas eliminar={vi.fn()} facturas={[emitida]} borradores={[borrador]} busy={false} editar={vi.fn()} editarBorrador={vi.fn()} duplicar={vi.fn()} descargar={vi.fn()} nueva={vi.fn()}/>);
  expect(screen.getAllByRole('article')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Estado'),{target:{value:'borrador'}});
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.queryByRole('button',{name:'PDF'})).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Buscar recibo o cliente'),{target:{value:'OCTUBRE'}});
  expect(screen.getByText('Cliente borrador')).toBeInTheDocument();
  expect(screen.getByText(/Pago mensual · octubre de 2026/)).toBeInTheDocument();
  expect(screen.queryByText(/NIF/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Hasta'),{target:{value:'2026-10-02'}});
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Limpiar filtros'}));
  expect(screen.getAllByRole('article')).toHaveLength(2);
 });
 it('filtra por tipo: licencias globales o pagos mensuales',()=>{
  render(<FacturasEmitidas eliminar={vi.fn()} facturas={[emitida]} borradores={[borrador]} busy={false} editar={vi.fn()} editarBorrador={vi.fn()} duplicar={vi.fn()} descargar={vi.fn()} nueva={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Tipo'),{target:{value:'mensual'}});
  expect(screen.getAllByRole('article')).toHaveLength(1);expect(screen.getByText('Cliente borrador')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tipo'),{target:{value:'licencia'}});
  expect(screen.getAllByRole('article')).toHaveLength(1);expect(screen.getByText('Empresa emitida')).toBeInTheDocument();
  expect(screen.getByText(/Licencia global/)).toBeInTheDocument();
 });
 it('continúa el borrador y descarga solo el recibo emitido',()=>{
  const continuar=vi.fn(),descargar=vi.fn();
  render(<FacturasEmitidas eliminar={vi.fn()} facturas={[emitida]} borradores={[borrador]} busy={false} editar={vi.fn()} editarBorrador={continuar} duplicar={vi.fn()} descargar={descargar} nueva={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Continuar'}));expect(continuar.mock.calls[0][0].id).toBe('b');
  fireEvent.click(screen.getByRole('button',{name:'PDF'}));expect(descargar.mock.calls[0][0].id).toBe('e');
 });
 it('permite solicitar eliminar cada estado y bloquea acciones durante una operación',()=>{
  const eliminar=vi.fn();
  const props={facturas:[emitida],borradores:[borrador],busy:false,editar:vi.fn(),editarBorrador:vi.fn(),duplicar:vi.fn(),descargar:vi.fn(),nueva:vi.fn(),eliminar};
  const {rerender}=render(<FacturasEmitidas {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Eliminar recibo R-2026-001'}));
  expect(eliminar).toHaveBeenLastCalledWith(expect.objectContaining({id:'e'}),'emitida');
  fireEvent.click(screen.getByRole('button',{name:'Eliminar borrador R-2026-002'}));
  expect(eliminar).toHaveBeenLastCalledWith(expect.objectContaining({id:'b'}),'borrador');
  rerender(<FacturasEmitidas {...props} busy/>);
  expect(screen.getByRole('button',{name:'Eliminar recibo R-2026-001'})).toBeDisabled();
 });

 it('ofrece la vista previa del PDF en emitidos y borradores (solo si se le pasa)',()=>{
  const previsualizar=vi.fn();
  const props={facturas:[emitida],borradores:[borrador],busy:false,editar:vi.fn(),editarBorrador:vi.fn(),duplicar:vi.fn(),descargar:vi.fn(),nueva:vi.fn(),eliminar:vi.fn()};
  const {rerender}=render(<FacturasEmitidas {...props}/>);
  expect(screen.queryByRole('button',{name:/Vista previa/})).not.toBeInTheDocument();
  rerender(<FacturasEmitidas {...props} previsualizar={previsualizar}/>);
  fireEvent.click(screen.getByRole('button',{name:'Vista previa del PDF de R-2026-001'}));
  expect(previsualizar).toHaveBeenLastCalledWith(expect.objectContaining({id:'e'}),'emitida');
  fireEvent.click(screen.getByRole('button',{name:'Vista previa del PDF de R-2026-002'}));
  expect(previsualizar).toHaveBeenLastCalledWith(expect.objectContaining({id:'b'}),'borrador');
 });
});
