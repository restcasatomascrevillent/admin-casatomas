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

  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(search.toLowerCase())
  );

  const showCreateOption =
    search.trim() !== "" &&
    !options.some(
      (option) => option.toLowerCase() === search.toLowerCase()
    );

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          {value || <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filteredOptions.length === 0 && !showCreateOption && (
              <CommandEmpty>{emptyText}</CommandEmpty>
            )}
            {showCreateOption && (
              <CommandGroup>
                <CommandItem
                  value={search}
                  onSelect={() => handleSelect(search.trim())}
                  className="text-primary"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Crear: "{search.trim()}"
                </CommandItem>
              </CommandGroup>
            )}
            {filteredOptions.length > 0 && (
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => handleSelect(option)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
