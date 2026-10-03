import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer relative inline-flex h-6 w-11 shrink-0 pointer-coarse:h-8 pointer-coarse:w-14 pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-[''] cursor-pointer items-center rounded-full border-2 border-transparent transition-all duration-300 ease-in-out data-[state=checked]:bg-primary data-[state=unchecked]:bg-input hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 pointer-coarse:h-7 pointer-coarse:w-7 rounded-full bg-background shadow-lg ring-0 transition-all duration-300 ease-in-out data-[state=checked]:translate-x-5 pointer-coarse:data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-0 data-[state=checked]:scale-110 data-[state=unchecked]:scale-100",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
