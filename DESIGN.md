---
name: StadiumForge
description: Parametric 3D football stadium editor in the browser; a Figma-grade tool chrome, dark or light, that serves the viewport.
colors:
  canvas: "#1e1e1e"
  panel: "#2c2c2c"
  raised: "#383838"
  hover: "#333333"
  line: "#3a3a3a"
  line-strong: "#4a4a4a"
  edge: "#4f4f4f"
  edge-hover: "#6e6e6e"
  field: "#1e1e1e"
  ink: "#e6e6e6"
  ink-muted: "#b8b8b8"
  ink-faint: "#9a9a9a"
  accent: "#0d99ff"
  accent-strong: "#0a6fcc"
  accent-strong-hover: "#085aa6"
  accent-soft: "#0d99ff26"
  accent-ink: "#5cb8ff"
  warn: "#f2b44c"
  danger: "#f26b5b"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.43
    fontFeature: "\"cv11\", \"ss01\""
  section-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.33
  metric:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.43
    fontFeature: "\"cv11\", \"ss01\", \"tnum\""
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.33
    fontFeature: "\"cv11\", \"ss01\""
  body-strong:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.33
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "2px"
  DEFAULT: "4px"
  md: "6px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  row: "28px"
  section-title: "40px"
  topbar: "44px"
  panel-header: "48px"
  rail-width: "72px"
  panel-width: "340px"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "#ffffff"
    typography: "{typography.body-strong}"
    rounded: "{rounded.DEFAULT}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong-hover}"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.DEFAULT}"
    padding: "0 10px"
    height: "28px"
  button-secondary-hover:
    backgroundColor: "{colors.line-strong}"
  button-ghost:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.DEFAULT}"
    padding: "0 10px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  icon-button:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.DEFAULT}"
    size: "28px"
  icon-button-active:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
  field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.DEFAULT}"
    padding: "0 8px"
    height: "28px"
  segmented:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-option-active:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.DEFAULT}"
    height: "28px"
  rail-tab:
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.DEFAULT}"
    width: "72px"
    height: "56px"
  rail-tab-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
  gallery-tile:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.DEFAULT}"
    padding: "6px"
  switch-on:
    backgroundColor: "{colors.accent-strong}"
    rounded: "{rounded.full}"
    width: "28px"
    height: "16px"
  switch-off:
    backgroundColor: "{colors.line-strong}"
    rounded: "{rounded.full}"
    width: "28px"
    height: "16px"
  metric-strip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.metric}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  popover:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "4px"
---

# Design System: StadiumForge

## Overview

**Creative North Star: "The Quiet Workbench"**

StadiumForge's chrome is a category-standard design-tool editor executed without irony, with Figma's craft level as the bar. A near-black neutral ground, three tonal grey steps, hairline dividers and one blue do all the work, so the 3D stadium in the centre is the only thing on screen with colour and spectacle. The interface is a workbench around the model: a column of labelled tabs on the left, one settings panel beside it, the viewport filling the rest, a slim top bar above.

Density is high and calm. Type sits at 11 to 13px, controls sit on 28px rows, and numbers are always tabular and French-formatted (fr-FR: narrow-space thousands, comma decimals). Feedback is carried by value, not by colour: when a parameter changes, the metric strip flashes a signed delta in blue, holds it, then lets it fade.

The world is dark by default, with a light theme mapping the same roles onto a white workbench (see Light theme). Depth comes from tonal layering, not shadow; shadows exist only where something genuinely floats above the work (popovers, the mobile inspector drawer), plus the light theme's contact shadow under the active segmented option.

**Key Characteristics:**
- Neutral greys in a dark and a light theme; every clickable choice outlined at rest; one blue family for selection, focus, sliders and the primary action.
- Inter at 11/12/13px, weights 400/500/600, tabular numerals, `cv11` and `ss01` on.
- 28px control rows, 4px radii, 1px dividers, no gradients.
- Flat surfaces; shadow only on floating layers.
- Signed blue deltas as the signature feedback; red and amber stay out of ordinary feedback.

## Colors

A neutral charcoal ramp with a single electric blue split into four jobs, plus two state colours held in reserve.

### Primary
- **Selection Blue** (accent): marks on dark ground: slider fill, focus rings (2px outline, 1px offset), focused field borders, text caret. Bright enough to read as a mark; never used as a fill behind white text.
- **Deep Action Blue** (accent-strong): every filled control that carries white text: the Exporter button, the switch "on" track, hovered export-menu rows, text selection. Chosen for contrast with white; hover deepens to **Pressed Action Blue** (accent-strong-hover, the same value in both themes) so white text keeps 7:1; a lighter hover fell below 4.5:1.
- **Selection Wash** (accent-soft, 15% blue): background of the selected tree row and selected option-list row.
- **Signal Blue Ink** (accent-ink): blue as text or icon on dark: metric deltas, the check on a chosen option, the icon of the active tree row.

### Neutral
- **Workbench Black** (canvas): app ground behind the viewport, and the recessed fill of inputs, selects and segmented-control tracks.
- **Panel Charcoal** (panel): top bar, tree, inspector, metric strip, popovers.
- **Raised Graphite** (raised): active segmented option, secondary button, active icon button.
- **Hover Graphite** (hover): row and ghost-control hover.
- **Hairline** (line): 1px dividers between zones, sections and metric cells.
- **Strong Hairline** (line-strong): slider track, switch "off", vertical separators in the top bar, scrollbar thumb.
- **Edge** (edge) and **Edge Hover** (edge-hover): the 1px outline every clickable choice and field carries at rest, and its hover strength. Edge Hover also draws the empty radio ring.
- **Field** (field): fill of text-entry fields and selects (Workbench Black on dark, white on light).
- **Ink** (ink): primary text and values.
- **Muted Ink** (ink-muted): field labels, ghost controls at rest, units.
- **Faint Ink** (ink-faint): metadata (counts, capacities, save time), tree group labels, chevrons, metric labels. Raised to its current value for contrast; do not go darker.

### State
- **Danger Coral** (danger): destructive affordances only, shown on hover of delete controls.
- **Warning Amber** (warn): reserved for warnings. Defined but not yet used by any surface.

### Named Rules
**The One Blue Rule.** Blue is the only hue in the chrome. Bright blue marks; deep blue fills under white text; the wash selects; the ink speaks. Never swap their jobs.

**The No Scoreboard Rule.** Metric changes are never green or red. A delta is Signal Blue Ink with an explicit sign (+ or the true minus −); red and amber are kept for warnings and destruction.

**The No Ellipsis Rule.** Labels, names, options and metadata never end in "…": they wrap to a second line, or the layout yields room (the wordmark hides before the project name clips). An important command never relies on an icon alone at desktop widths.

**The Visible Choice Rule.** Anything the user picks is outlined at rest (Edge), strengthens on hover (Edge Hover + Hover fill) and turns blue when chosen (Selection Blue border + Selection Wash). Single choices also carry a radio mark. A choice that only reveals itself on hover is a bug. The shared `choiceClass()` in `src/editor/ui.tsx` owns this shell.

### Light theme
Same roles, white workbench, set by `data-theme="light"` on `<html>` (`src/index.css`). The top-bar contrast button toggles it and stores the choice (`stadiumforge.theme`); with no stored choice the system preference wins, applied before first paint by `index.html`.
- canvas #ededed, panel and raised #ffffff, hover #f2f2f2, line #e3e3e3, line-strong #c4c4c4, edge #cfcfcf, edge-hover #8f8f8f, field #ffffff.
- ink #1c1c1c, ink-muted #4a4a4a, ink-faint #6b6b6b.
- accent #0b8ae8 (marks reach 3:1 on white), accent-strong #0a6fcc with hover #085aa6, accent-soft 10% blue, accent-ink #0a62b5; warn #a96a0a, danger #d03a28.
- The active segmented option is white on the grey track, lifted by the `thumb` contact shadow (none on dark).

## Typography

**Body Font:** Inter (with ui-sans-serif, system-ui, sans-serif), weights 400/500/600 loaded from Google Fonts.
**Mono Font:** ui-monospace, "SF Mono", Menlo (declared, not used by current surfaces).

**Character:** One family, small sizes, weight and colour doing the hierarchy. Inter's `cv11` (single-storey a) and `ss01` (open digits) are on globally; numerals are tabular wherever a value is shown.

### Hierarchy
- **Title** (600, 13px): wordmark, inspector panel header titles (Enceinte et terrain, Équipements).
- **Section title** (600, 12px): collapsible inspector section rows.
- **Metric** (500, 13px, tabular): metric-strip values.
- **Body** (400, 12px): default UI text, labels, field values, tree rows; 500 for selected options and buttons.
- **Label** (400 or 500, 11px): metadata, metric labels, units, tree group labels, option detail lines, small segmented controls. Sentence case, no tracking.

### Named Rules
**The Tabular Rule.** Every displayed number uses tabular numerals and `toLocaleString('fr-FR')`: "69 892", "75,1 m", "~416,8 M€". Typed entries accept comma decimals.

**The Three Sizes Rule.** Chrome text is 11, 12 or 13px. Nothing larger appears in the editor chrome.

## Layout

One panel, never two: 44px top bar; a 72px tab rail on the left (Forme, Terrain, Tribunes, Toit, Façade, Abords, Équipements); a single 340px settings panel beside it; the viewport fills the rest. Clicking the open tab again folds the panel away (as does H); any tab reopens it. Materials live in the tab of the part they dress (roof covering and structure under Toit, seats under Tribunes, turf and track under Terrain, plaza under Abords), never in a materials catch-all.

Each tab shows its essentials first and keeps expert settings in one collapsed "Avancé" section at the bottom, grouped by 11px sub-headings rather than nested collapsibles; its open state is remembered per tab for the session. Saved projects and the example gallery sit in the top bar's Projets menu, not in the panel.

The top bar is a three-column grid at lg (project name and Projets menu left, camera and lighting segmented controls centred, undo/redo, panel toggle, theme and Exporter right). Camera modes and lighting carry their written names from xl (1280px); below, icons with a tooltip. The StadiumForge wordmark appears from 2xl so the project name never gets cut. Panel headers are at least 48px, collapsible section title rows 40px, field rows 28px. Panel bodies use 16px side padding and 12px vertical gaps between fields.

Spacing runs on a 4px grid (2, 4, 8, 12, 16). The metric strip floats 12px from the viewport's bottom-left corner as a single row of cells divided by hairlines; non-essential cells hide below sm.

Below lg the rail becomes a bottom tab bar (scrolling sideways when needed) and the panel a left-hand drawer over the viewport (up to 380px, full width when narrower), with the lighting switch at its head below md; it starts closed on small screens.

## Elevation & Depth

Flat by default. Depth is tonal: canvas recedes, panels sit level, raised greys mark the active control. Zones are separated by 1px hairlines, never by shadow.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.45)`): menus that float over the work (export menu).
- **Drawer** (`box-shadow: 8px 0 24px rgb(0 0 0 / 0.4)`): the settings panel when it overlays the viewport below lg.
- **Thumb contact** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.5)`): the white slider thumb only, so it reads against the track.

### Named Rules
**The Floating-Only Rule.** A shadow means "this sits above the work". Panels, cards, buttons and the metric strip get none.

## Shapes

Small, consistent corners: 4px on controls, rows and fields; 6px on containers that group controls (segmented track, metric strip, popover); 2px on material swatch previews; full round only for switches, slider thumbs and colour-pair dots. Borders are 1px; fields carry a transparent border that turns Strong Hairline on hover and Selection Blue on focus. No gradients anywhere in the chrome (the slider's two-colour fill is a hard stop, not a blend).

## Components

### Buttons
Compact and quiet; only one filled button per view.
- **Shape:** gently squared (4px), 28px tall, 10px side padding, 12px medium text.
- **Primary:** Deep Action Blue with white text; hover to Pressed Action Blue. Reserved for the main action (Exporter).
- **Secondary:** Raised Graphite with Ink text and a 1px Edge outline; hover to Edge Hover and Hover Graphite.
- **Ghost:** Muted Ink, no fill; hover adds Hover Graphite and Ink text.
- **Icon button:** 28px square, Muted Ink; active (toggled) state uses Selection Wash with Signal Blue Ink. Destructive icon buttons turn Danger Coral on hover.
- **Focus / disabled:** global 2px Selection Blue outline; disabled at 40% opacity.

### Segmented control
A recessed canvas track with a 1px Hairline outline (6px radius, 2px inset) holding equal options; inactive options take Hover Graphite on hover; the active option rises to Raised Graphite with Ink medium text (and the thumb shadow on light). 28px (md) or 24px with 11px text (sm). Used for camera modes, lighting, transform tools.

### Inputs / Fields
- **Style:** Field fill, 1px Edge border, 4px radius, 28px tall, 12px text; numeric values right-aligned and tabular. Number fields carry an inline 11px Faint Ink prefix label.
- **Hover / Focus:** border to Edge Hover on hover, Selection Blue on focus.
- **Selects:** same shell with a drawn chevron at right.
- **Slider values:** a compact 24px field shell, always visible so the exact value reads as editable.
- **Inline-editable text:** the project name reads as plain text and shows the field shell only on hover/focus.

### Slider field
Label left, formatted value right (click to type an exact value, Enter commits, Escape cancels). Below: a 2px track filled with Selection Blue up to the value over Strong Hairline, and a 12px white round thumb that scales to 1.2 on hover/focus; keyboard focus rings the thumb with a 2px panel-coloured gap and a solid 2px Selection Blue ring.

### Switch
28 by 16px pill; Deep Action Blue when on, Strong Hairline when off; white 12px knob slides with a 150ms transition.

### Option list
Single-choice list of compact outlined rows (min 32px, 4px gap) replacing paragraph cards, each led by a 14px radio mark. At rest: Panel fill, Edge outline, empty ring. Hover: Edge Hover outline and Hover fill. Selected: Selection Blue outline, Selection Wash, filled blue dot, medium text, and its one-line detail revealed in 11px Muted Ink. Toggle groups (covered stands), club palettes and the add-equipment grid use the same `choiceClass()` tile.

### Navigation (tab rail)
72 by 56px tabs, 4px radius: an 18px icon over its 11px name, both always shown. At rest Muted Ink; hover Hover Graphite and Ink; the open tab takes Selection Wash with a Signal Blue Ink icon and a medium Ink name. Below lg the same tabs run along the bottom.

### Settings panel
A header of at least 48px (13px semibold title, 11px tabular metadata that wraps rather than clips), then collapsible sections with a rotating chevron; essentials open, expert settings in the collapsed "Avancé" section, grouped under 11px medium Faint Ink sub-headings.

### Gallery picker
For the big visual choices (bowl shape, roof system, envelope, every material). In the panel: one outlined row with a 72 by 44px picture, the current name, its one-line detail and "Changer ›". Clicking opens a Panel Charcoal sheet beside the panel, over the viewport (over the drawer itself when there is no room), with the Popover shadow: a 44px title row with the count and a close button, then a grid of tiles (3 columns from 600px wide, else 2). Each tile is a `choiceClass()` shell holding a 36:22 picture, a radio mark, the full name and its detail. Choosing closes the sheet and returns focus to the row; Escape and outside clicks close it. Pictures are pre-rendered WebP files in `public/shapes`, `public/roofs`, `public/envelopes` and `public/patterns` (facade relief) (regenerated in dev with `__generateThumbnails()`), or the material's own rendered texture.

### Metric strip (signature)
A row of hairline-divided cells on 95% Panel Charcoal floating bottom-left of the viewport. Each cell: 11px Faint Ink label, 13px medium tabular value with 11px Muted Ink unit. After each change a signed delta in Signal Blue Ink appears beside the label, rises 3px into place, holds, and fades over 1800ms (expo-out); under reduced motion it appears and disappears without movement.

### Popover menu
Panel Charcoal, 1px Hairline, 6px radius, 4px inset, Popover shadow. 36px rows with icon, label and right-aligned 11px detail; hovered row fills Deep Action Blue and turns all its text white.

## Do's and Don'ts

### Do:
- **Do** use Selection Blue for marks and Deep Action Blue for any fill carrying white text.
- **Do** format every number with fr-FR and tabular numerals, and sign every delta.
- **Do** keep controls on 28px rows with 4px corners and 1px borders.
- **Do** separate zones and sections with Hairline dividers and tonal steps.
- **Do** tuck expert parameters into a collapsed "Avancé" section.

### Don't:
- **Don't** colour metric changes green or red; deltas are Signal Blue Ink.
- **Don't** use Warning Amber or Danger Coral outside warnings and destructive actions.
- **Don't** add shadows to panels, buttons, cards or the metric strip; shadow is for popovers and the overlay drawer only.
- **Don't** use gradients or text larger than 13px in the chrome.
- **Don't** leave a clickable choice without an outline at rest, or hard-code a colour that skips the theme tokens.
- **Don't** put white text on Selection Blue; it fails contrast.
- **Don't** lighten Faint or Muted Ink back below their current values.
