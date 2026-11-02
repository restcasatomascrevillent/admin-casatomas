import * as React from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ComboboxCreatableProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
}

/** Valor interno de la fila «Crear “X”» (no choca con ninguna opción real). */
const CREAR = "\u0000crear";

/** Minúsculas, sin acentos y con los espacios recogidos: «  Tínto » = «tinto». */
export function normalizarOpcion(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Desplegable con búsqueda que permite elegir una opción o crear una nueva.
 *
 * Enter elige la opción que coincide (primero la idéntica, luego las que la
 * contienen). Crear una nueva nunca pasa con un Enter suelto (QA F-43): o se
 * toca «Crear “X”», o se pulsa Enter dos veces sobre esa fila (la primera
 * pide confirmación).
 */
export function ComboboxCreatable({
  value,
  onChange,
  options,
  placeholder = "Seleccionar...",
  emptyText = "No hay opciones",
  className,
}: ComboboxCreatableProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [seleccion, setSeleccion] = React.useState("");
  const [confirmando, setConfirmando] = React.useState(false);

  const busqueda = normalizarOpcion(search);
  const textoNuevo = search.trim().replace(/\s+/g, " ");

  // Coincidencias: la idéntica primero, después las que empiezan por lo
  // escrito y al final las que lo contienen.
  const filteredOptions = React.useMemo(() => {
    if (!busqueda) return options;
    const rango = (o: string) => {
      const n = normalizarOpcion(o);
      if (n === busqueda) return 0;
      if (n.startsWith(busqueda)) return 1;
      if (n.includes(busqueda)) return 2;
      return -1;
    };
    return options
      .map((o, i) => ({ o, i, r: rango(o) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.o);
  }, [options, busqueda]);

  const showCreateOption =
    busqueda !== "" && !options.some((o) => normalizarOpcion(o) === busqueda);

  // Al escribir, queda resaltada la primera coincidencia (o «Crear» si no hay
  // ninguna) y se anula una confirmación pendiente.
  React.useEffect(() => {
    setSeleccion(filteredOptions[0] ?? (showCreateOption ? CREAR : ""));
    setConfirmando(false);
  }, [busqueda]); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = () => {
    setOpen(false);
    setSearch("");
    setConfirmando(false);
  };

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    cerrar();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || seleccion !== CREAR) return;
    if (!confirmando) {
      // Primer Enter sobre «Crear»: no crea, pide confirmación.
      e.preventDefault();
      setConfirmando(true);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(abierto) => (abierto ? setOpen(true) : cerrar())}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full min-w-0 justify-between font-normal", className)}
        >
          <span className="truncate">
            {value || <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          shouldFilter={false}
          value={seleccion}
          onValueChange={(v) => {
            setSeleccion(v);
            if (v !== CREAR) setConfirmando(false);
          }}
          onKeyDown={onKeyDown}
        >
          <CommandInput
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filteredOptions.length === 0 && !showCreateOption && (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            {filteredOptions.length > 0 && (
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => handleSelect(option)}
                    className="whitespace-normal break-words"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === option ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCreateOption && (
              <CommandGroup>
                <CommandItem
                  value={CREAR}
                  onSelect={() => handleSelect(textoNuevo)}
                  className="items-start whitespace-normal break-words text-primary"
                >
                  <Plus className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    Crear «{textoNuevo}»
                    {confirmando && (
                      <span className="block text-xs text-muted-foreground" role="status">
                        Pulsa Enter otra vez o toca aquí para crearla.
                      </span>
                    )}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
