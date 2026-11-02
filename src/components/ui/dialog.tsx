import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Tablet táctil: columna flex con scroll interno (`max-h` + `overflow-y-auto`) para que quepa
        // en vertical/horizontal y con el teclado abierto. `--vv-h/--vv-top` (useVisualViewportVars)
        // son el viewport VISUAL (sin la zona que tapa el teclado): con dedo el diálogo se centra y
        // limita su alto ahí. Sin esas variables cae a 100dvh. Un `max-h-*` del llamador sigue
        // valiendo en escritorio; con dedo manda el límite del viewport visual.
        "fixed left-[50%] top-[50%] z-50 flex w-[calc(100%-1rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col gap-4 overflow-y-auto overscroll-contain border bg-background p-6 shadow-lg max-h-[90dvh] pointer-coarse:top-[calc(var(--vv-top,0px)+var(--vv-h,100dvh)/2)] pointer-coarse:max-h-[min(90dvh,calc(var(--vv-h,100dvh)-1rem))] pointer-coarse:scroll-pb-28 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex items-center justify-center rounded-sm opacity-70 pointer-coarse:right-2 pointer-coarse:top-2 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:opacity-100 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 pr-8 text-center sm:text-left pointer-coarse:pr-10", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Con dedo el pie se queda pegado abajo del diálogo con scroll: los botones de acción no
      // se pierden con el teclado abierto ni en un formulario largo.
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pointer-coarse:sticky pointer-coarse:bottom-0 pointer-coarse:z-10 pointer-coarse:gap-2 pointer-coarse:bg-background pointer-coarse:pb-1 pointer-coarse:pt-2 pointer-coarse:sm:gap-3 pointer-coarse:sm:space-x-0",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
