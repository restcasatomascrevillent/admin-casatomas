import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
export function ConceptoOrdenable({id,index,total,busy,mover,eliminar,children}:{
  id:string;index:number;total:number;busy:boolean;mover:(from:number,to:number)=>void;eliminar:()=>void;children:ReactNode;
}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id,disabled:busy});
  return <fieldset ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className={`relative min-w-0 space-y-3 rounded-lg border bg-background p-3 ${isDragging ? "z-20 shadow-lg ring-2 ring-primary/30" : ""}`}>
    <legend className="px-2 text-xs font-semibold">Concepto {index+1}</legend>
    <div className="flex items-center gap-2">
      <Button type="button" variant="ghost" size="icon" disabled={busy} {...attributes} {...listeners} aria-label={"Arrastrar concepto "+(index+1)} className="touch-none cursor-grab active:cursor-grabbing"><GripVertical className="h-4 w-4"/></Button>
      <span className="flex-1 text-xs text-muted-foreground">Mover concepto</span>
      <Button type="button" variant="outline" size="icon" disabled={busy || index===0} aria-label={"Subir concepto "+(index+1)} onClick={()=>mover(index,index-1)}><ArrowUp className="h-4 w-4"/></Button>
      <Button type="button" variant="outline" size="icon" disabled={busy || index===total-1} aria-label={"Bajar concepto "+(index+1)} onClick={()=>mover(index,index+1)}><ArrowDown className="h-4 w-4"/></Button>
      <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={"Eliminar concepto "+(index+1)} className="text-destructive hover:text-destructive" onClick={eliminar}><Trash2 className="h-4 w-4"/></Button>
    </div>
    {children}
  </fieldset>;
}
