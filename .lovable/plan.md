

## Problem

All four list components (`ListaPlatos`, `ListaVinos`, `ListaBebidas`, `ListaCocteles`) initialize `fotosOcultas` with `new Set(items.map(i => i.id))` inside `useState`. But `useState`'s initializer only runs **once on mount**. Since data loads asynchronously via React Query, the items array is empty at mount time, resulting in an empty Set — meaning all photos appear visible by default.

## Solution

Add a `useEffect` in each component that watches the items array and adds any new IDs to `fotosOcultas`. This ensures that when data loads (or when items change due to filtering/adding), all new items start with hidden photos.

## Files to Edit (4)

1. **`src/components/carta/ListaPlatos.tsx`** — Add `useEffect` watching `platos` to populate `fotosOcultas` with all IDs.

2. **`src/components/carta/ListaVinos.tsx`** — Same pattern watching `vinos`.

3. **`src/components/carta/ListaBebidas.tsx`** — Same pattern watching `bebidas`.

4. **`src/components/carta/ListaCocteles.tsx`** — Same pattern watching `cocteles`.

### Code Pattern (applied to all four)

```tsx
useEffect(() => {
  setFotosOcultas(prev => {
    const next = new Set(prev);
    items.forEach(item => next.add(item.id));
    return next;
  });
}, [items]);
```

This preserves any manual toggle the user made (items already in the set stay) while ensuring newly loaded items default to hidden.

