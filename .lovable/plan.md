

## Analysis

After reviewing the code, here's the current state:

1. **Image upload in edit modals** -- Already works correctly for both Platos and Vinos. Images upload to Supabase storage buckets (`platos`, `vinos`) and the public URL is saved to `imagen_url`.

2. **Expanded/collapsed toggle** -- Already exists on each card as a Switch labeled "Foto expandida en carta web". This controls how the image displays on the public website.

3. **Eye icon behavior** -- Currently the Eye icon opens a full-screen preview dialog. The user wants it to act as a **toggle to show/hide the photo on the card itself** within the Gestor de Carta view.

## Plan

### Changes to `ListaPlatos.tsx`

- Add local state `fotosOcultas` (a `Set<string>` of plato IDs) to track which cards have their photo hidden.
- Change the Eye button from opening a preview to toggling the photo visibility on the card. Use `Eye` when visible, `EyeOff` when hidden.
- When a photo is hidden, the image section of the card is not rendered.
- Keep the existing preview functionality accessible by clicking directly on the image itself (when visible).

### Changes to `ListaVinos.tsx`

- Same pattern: add `fotosOcultas` local state, toggle Eye/EyeOff icon, hide/show the image section.
- Image click opens the preview dialog (existing behavior moved to the image element).

### No backend changes needed

The eye toggle is purely a local UI control for the gestor view -- it does not need to persist to the database. The `expanded` toggle (already working) handles the web-facing behavior.

### Summary of files to edit
- `src/components/carta/ListaPlatos.tsx` -- Eye toggle + click-on-image preview
- `src/components/carta/ListaVinos.tsx` -- Same changes

