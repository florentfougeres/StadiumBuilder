---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/editor/Inspector.tsx","src/editor/Toolbar.tsx","src/editor/ObjectList.tsx","src/editor/ProjectsPanel.tsx","src/editor/ui.tsx"]
---

# Surface: StadiumForge editor

Scope: the whole single-page editor (top bar, tab rail, settings panel, 3D viewport overlays, export). Visitor mode: Operate.

Audience and job: football/stadium enthusiasts on desktop shape a stadium, read live metrics, export and share. Simple first, every parameter reachable.

Constraints: French UI; 3D engine, store and calculations untouched; shortcuts kept (G/R/S, H, Delete, Ctrl+Z/Y); desktop 1280–1600 first, drawers under 1024px, mobile mostly view-only; dark only for now.

## Direction contract

THESIS: A design-tool editor at Figma's craft level: labelled tab rail left, one settings panel beside it, viewport filling the rest (reorganised 2026-11-04: the tree + inspector two-column split was dropped as confusing). It refuses the incumbent arrangement of duplicated navigation, paragraph-card grids and emerald dashboard chrome.

OWN-WORLD: Near-black neutral ground #1E1E1E, panels #2C2C2C, 1px #383838 dividers, text #E6E6E6 / #9A9A9A, one blue #0D99FF for selection, focus and the primary action; red and amber only for warnings. Inter 11–13px, tabular numerals, 4px radii, no shadows beyond popovers, no gradients.

STORY: The visitor sees the stadium first, picks the part in the tab rail, changes it in the one settings panel (opening a picture gallery for the big choices), and watches the metric strip show the delta; then exports from one menu.

FIRST VIEWPORT: 44px top bar (project name and Projets menu, camera and lighting segmented controls named from 1280px, undo/redo, Export menu in blue at right). 72px tab rail left (Forme, Terrain, Tribunes, Toit, Façade, Abords, Équipements). One 340px settings panel: essentials first, big choices as picture galleries, expert settings in a collapsed "Avancé" per tab. Viewport fills the rest with a compact metric strip bottom-left. No label ever ends in an ellipsis.

FORM: category canon, chosen by the user over the roll (standing exit), seed: ea1b38156f4f6435. Signature interaction: metric deltas flash in the strip (e.g. "+1 240 places") after each change, then settle.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
