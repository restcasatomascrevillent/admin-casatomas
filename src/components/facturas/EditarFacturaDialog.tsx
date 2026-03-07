import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Factura, useUpdateFactura } from "@/hooks/useFacturas";

const formSchema = z.object({
    proveedor: z.string().nullable(),
    cif: z.string().nullable(),
    numero_documento: z.string().nullable(),
    fecha: z.string().min(1, "La fecha es obligatoria"),
    subtotal: z.coerce.number().min(0, "Debe ser mayor o igual a 0").nullable(),
    iva: z.coerce.number().min(0, "Debe ser mayor o igual a 0").nullable(),
    total: z.coerce.number().min(0, "Debe ser mayor o igual a 0").nullable(),
    observaciones: z.string().nullable(),
    verificada: z.boolean().default(false),
});

interface EditarFacturaDialogProps {
    factura: Factura | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EditarFacturaDialog({ factura, open, onOpenChange }: EditarFacturaDialogProps) {
    const updateFacturaMutation = useUpdateFactura();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            proveedor: "",
            cif: "",
            numero_documento: "",
            fecha: "",
            subtotal: 0,
            iva: 0,
            total: 0,
            observaciones: "",
            verificada: false,
        },
    });

    // Update default values when factura changes
    useEffect(() => {
        if (factura) {
            form.reset({
                proveedor: factura.proveedor || "",
                cif: factura.cif || "",
                numero_documento: factura.numero_documento || "",
                fecha: factura.fecha || "",
                subtotal: factura.subtotal || 0,
                iva: factura.iva || 0,
                total: factura.total || 0,
                observaciones: factura.observaciones || "",
                verificada: factura.verificada || false,
            });
        }
    }, [factura, form]);

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        if (!factura) return;

        try {
            await updateFacturaMutation.mutateAsync({
                id: factura.id,
                proveedor: values.proveedor || null,
                cif: values.cif || null,
                numero_documento: values.numero_documento || null,
                fecha: values.fecha,
                subtotal: values.subtotal,
                iva: values.iva,
                total: values.total,
                observaciones: values.observaciones || null,
                verificada: values.verificada,
            });
            onOpenChange(false);
        } catch (err) {
            console.error("Error actualizando factura:", err);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Editar Factura {factura?.numero_documento}</DialogTitle>
                    <DialogDescription>
                        Modifica los detalles principales de la factura.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="proveedor"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Proveedor</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Nombre del proveedor" {...field} value={field.value || ""} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="cif"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>CIF/NIF</FormLabel>
                                        <FormControl>
                                            <Input placeholder="CIF del proveedor" {...field} value={field.value || ""} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="numero_documento"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nº Documento</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Número de factura" {...field} value={field.value || ""} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="fecha"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Fecha</FormLabel>
                                        <FormControl>
                                            <Input type="date" {...field} value={field.value || ""} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="subtotal"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Subtotal (€)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} value={field.value || 0} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="iva"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>IVA (€)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} value={field.value || 0} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="total"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Total (€)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} value={field.value || 0} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="observaciones"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Observaciones</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Comentarios u observaciones de la factura"
                                            className="resize-none"
                                            {...field}
                                            value={field.value || ""}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex bg-muted/50 p-4 rounded-lg items-center justify-between border">
                            <div className="space-y-0.5">
                                <FormLabel className="text-base text-foreground">Marcar como verificada</FormLabel>
                                <DialogDescription>
                                    Indica que los importes y datos de esta factura han sido revisados y son correctos.
                                </DialogDescription>
                            </div>
                            <FormField
                                control={form.control}
                                name="verificada"
                                render={({ field }) => (
                                    <FormItem className="flex items-center space-x-2">
                                        <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={updateFacturaMutation.isPending}>
                                {updateFacturaMutation.isPending ? "Guardando..." : "Guardar Factura"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
