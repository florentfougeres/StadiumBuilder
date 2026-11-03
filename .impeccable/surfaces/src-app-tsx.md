---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/editor/Inspector.tsx","src/editor/Toolbar.tsx","src/editor/ObjectList.tsx","src/editor/ExportProjectPanel.tsx"]
---

# Surface: StadiumForge editor

Scope: the whole single-page editor (top bar, structure tree, 3D viewport overlays, inspector, export). Visitor mode: Operate.

Audience and job: football/stadium enthusiasts on desktop shape a stadium, read live metrics, export and share. Simple first, every parameter reachable.

Constraints: French UI; 3D engine, store and calculations untouched; shortcuts kept (G/R/S, H, Delete, Ctrl+Z/Y); desktop 1280–1600 first, drawers under 1024px, mobile mostly view-only; dark only for now.

## Direction contract

THESIS: A design-tool editor at Figma's craft level: tree left, viewport centre, contextual inspector right. It refuses the incumbent arrangement of duplicated navigation, paragraph-card grids and emerald dashboard chrome.

OWN-WORLD: Near-black neutral ground #1E1E1E, panels #2C2C2C, 1px #383838 dividers, text #E6E6E6 / #9A9A9A, one blue #0D99FF for selection, focus and the primary action; red and amber only for warnings. Inter 11–13px, tabular numerals, 4px radii, no shadows beyond popovers, no gradients.

STORY: The visitor sees the stadium first, finds any part in the tree, changes it in the inspector, and watches the metric strip show the delta; then exports from one menu.

FIRST VIEWPORT: 44px top bar (wordmark, editable project name, camera segmented control and lighting, undo/redo, Export menu in blue at right). 240px structure tree left (Enceinte, Tribunes N/S/E/O, Toiture, Équipements, Préréglages). Viewport fills the centre with a compact metric strip bottom-left. 300px inspector right: essentials first, collapsed "Avancé".

FORM: category canon, chosen by the user over the roll (standing exit), seed: ea1b38156f4f6435. Signature interaction: metric deltas flash in the strip (e.g. "+1 240 places") after each change, then settle.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
