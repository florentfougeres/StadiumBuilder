---
name: StadiumForge
description: Parametric 3D football stadium editor in the browser; a dark, Figma-grade tool chrome that serves the viewport.
colors:
  canvas: "#1e1e1e"
  panel: "#2c2c2c"
  raised: "#383838"
  hover: "#333333"
  line: "#3a3a3a"
  line-strong: "#4a4a4a"
  ink: "#e6e6e6"
  ink-muted: "#b8b8b8"
  ink-faint: "#9a9a9a"
  accent: "#0d99ff"
  accent-strong: "#0a6fcc"
  accent-strong-hover: "#0b7ee6"
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
  tree-width: "240px"
  inspector-width: "300px"
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
  tree-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.DEFAULT}"
    height: "28px"
  tree-row-active:
    backgroundColor: "{colors.accent-soft}"
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

StadiumForge's chrome is a category-standard design-tool editor executed without irony, with Figma's craft level as the bar. A near-black neutral ground, three tonal grey steps, hairline dividers and one blue do all the work, so the 3D stadium in the centre is the only thing on screen with colour and spectacle. The interface is a workbench around the model: a structure tree on the left, the viewport filling the centre, a contextual inspector on the right, a slim top bar above.

Density is high and calm. Type sits at 11 to 13px, controls sit on 28px rows, and numbers are always tabular and French-formatted (fr-FR: narrow-space thousands, comma decimals). Feedback is carried by value, not by colour: when a parameter changes, the metric strip flashes a signed delta in blue, holds it, then lets it fade.

The world is dark only. Depth comes from tonal layering, not shadow; shadows exist only where something genuinely floats above the work (popovers, the mobile inspector drawer).

**Key Characteristics:**
- Dark-only neutral greys; one blue family for selection, focus, sliders and the primary action.
- Inter at 11/12/13px, weights 400/500/600, tabular numerals, `cv11` and `ss01` on.
- 28px control rows, 4px radii, 1px dividers, no gradients.
- Flat surfaces; shadow only on floating layers.
- Signed blue deltas as the signature feedback; red and amber stay out of ordinary feedback.

## Colors

A neutral charcoal ramp with a single electric blue split into four jobs, plus two state colours held in reserve.

### Primary
- **Selection Blue** (accent): marks on dark ground: slider fill, focus rings (2px outline, 1px offset), focused field borders, text caret. Bright enough to read as a mark; never used as a fill behind white text.
- **Deep Action Blue** (accent-strong): every filled control that carries white text: the Exporter button, the switch "on" track, hovered export-menu rows, text selection. Chosen for contrast with white; hover lifts to **Lifted Action Blue** (accent-strong-hover).
- **Selection Wash** (accent-soft, 15% blue): background of the selected tree row and selected option-list row.
- **Signal Blue Ink** (accent-ink): blue as text or icon on dark: metric deltas, the check on a chosen option, the icon of the active tree row.

### Neutral
- **Workbench Black** (canvas): app ground behind the viewport, and the recessed fill of inputs, selects and segmented-control tracks.
- **Panel Charcoal** (panel): top bar, tree, inspector, metric strip, popovers.
- **Raised Graphite** (raised): active segmented option, secondary button, active icon button.
- **Hover Graphite** (hover): row and ghost-control hover.
- **Hairline** (line): 1px dividers between zones, sections and metric cells.
- **Strong Hairline** (line-strong): hover border on fields, slider track, switch "off", vertical separators in the top bar, scrollbar thumb.
- **Ink** (ink): primary text and values.
- **Muted Ink** (ink-muted): field labels, ghost controls at rest, units.
- **Faint Ink** (ink-faint): metadata (counts, capacities, save time), tree group labels, chevrons, metric labels. Raised to its current value for contrast; do not go darker.

### State
- **Danger Coral** (danger): destructive affordances only, shown on hover of delete controls.
- **Warning Amber** (warn): reserved for warnings. Defined but not yet used by any surface.

### Named Rules
**The One Blue Rule.** Blue is the only hue in the chrome. Bright blue marks; deep blue fills under white text; the wash selects; the ink speaks. Never swap their jobs.

**The No Scoreboard Rule.** Metric changes are never green or red. A delta is Signal Blue Ink with an explicit sign (+ or the true minus −); red and amber are kept for warnings and destruction.

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

A three-zone editor: 44px top bar; 240px structure tree left; viewport fills the centre; 300px inspector right. The top bar is a three-column grid at lg (identity and project name left, camera and lighting segmented controls centred, undo/redo, panel toggle and Exporter right). Panel headers are 48px, collapsible section title rows 40px, field rows 28px. Panel bodies use 16px side padding and 12px vertical gaps between fields.

Spacing runs on a 4px grid (2, 4, 8, 12, 16). The metric strip floats 12px from the viewport's bottom-left corner as a single row of cells divided by hairlines; non-essential cells hide below sm.

Below lg the tree is hidden and the inspector becomes a right-hand drawer (up to 300px, full width when narrower) over the viewport, with a node selector at its head; camera modes collapse to icons.

## Elevation & Depth

Flat by default. Depth is tonal: canvas recedes, panels sit level, raised greys mark the active control. Zones are separated by 1px hairlines, never by shadow.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.45)`): menus that float over the work (export menu).
- **Drawer** (`box-shadow: -8px 0 24px rgb(0 0 0 / 0.4)`): the inspector when it overlays the viewport below lg.
- **Thumb contact** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.5)`): the white slider thumb only, so it reads against the track.

### Named Rules
**The Floating-Only Rule.** A shadow means "this sits above the work". Panels, cards, buttons and the metric strip get none.

## Shapes

Small, consistent corners: 4px on controls, rows and fields; 6px on containers that group controls (segmented track, metric strip, popover); 2px on material swatch previews; full round only for switches, slider thumbs and colour-pair dots. Borders are 1px; fields carry a transparent border that turns Strong Hairline on hover and Selection Blue on focus. No gradients anywhere in the chrome (the slider's two-colour fill is a hard stop, not a blend).

## Components

### Buttons
Compact and quiet; only one filled button per view.
- **Shape:** gently squared (4px), 28px tall, 10px side padding, 12px medium text.
- **Primary:** Deep Action Blue with white text; hover to Lifted Action Blue. Reserved for the main action (Exporter).
- **Secondary:** Raised Graphite with Ink text; hover to Strong Hairline grey.
- **Ghost:** Muted Ink, no fill; hover adds Hover Graphite and Ink text.
- **Icon button:** 28px square, Muted Ink; active state uses Raised Graphite. Destructive icon buttons turn Danger Coral on hover.
- **Focus / disabled:** global 2px Selection Blue outline; disabled at 40% opacity.

### Segmented control
A recessed canvas track (6px radius, 2px inset) holding equal options; the active option rises to Raised Graphite with Ink medium text. 28px (md) or 24px with 11px text (sm). Used for camera modes, lighting, transform tools.

### Inputs / Fields
- **Style:** canvas fill, transparent 1px border, 4px radius, 28px tall, 12px text; numeric values right-aligned and tabular. Number fields carry an inline 11px Faint Ink prefix label.
- **Hover / Focus:** border to Strong Hairline on hover, Selection Blue on focus.
- **Selects:** same shell with a drawn chevron at right.
- **Inline-editable text:** project name and slider values read as plain text and show the field shell only on hover/focus.

### Slider field
Label left, formatted value right (click to type an exact value, Enter commits, Escape cancels). Below: a 2px track filled with Selection Blue up to the value over Strong Hairline, and a 12px white round thumb that scales to 1.2 on hover/focus with a soft blue focus halo.

### Switch
28 by 16px pill; Deep Action Blue when on, Strong Hairline when off; white 12px knob slides with a 150ms transition.

### Option list
Single-choice list of compact 32px rows replacing paragraph cards. Selected row: Selection Wash, medium text, a Signal Blue Ink check at right, and its one-line detail revealed in 11px Muted Ink.

### Navigation (structure tree)
28px rows, 4px radius, icon in Faint Ink, optional right-aligned tabular metadata. Children indent to 32px. Selected row: Selection Wash with a Signal Blue Ink icon. Group labels (Stade, Abords, Fichier) are 11px medium Faint Ink, sentence case.

### Inspector panel
48px header (13px semibold title, 11px tabular metadata), then collapsible sections with a rotating chevron; essentials open, expert settings in a collapsed "Avancé" section.

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
- **Don't** use gradients, a light theme, or text larger than 13px in the chrome.
- **Don't** put white text on Selection Blue; it fails contrast.
- **Don't** lighten Faint or Muted Ink back below their current values.
