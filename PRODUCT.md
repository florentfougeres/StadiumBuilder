# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Football and stadium enthusiasts who imagine, build and share the stadium of their dreams, for fun. They arrive curious, often from a shared link, on desktop first; some come back to refine a project over several sessions.

## Product Purpose

StadiumForge is a parametric 3D football stadium editor that runs entirely in the browser. The user shapes the bowl, stands, roof and surrounding equipment, and sees the 3D model, capacity, sightlines and an estimated cost update live. Success means a newcomer gets a striking stadium within minutes, and an enthusiast can keep refining details until it matches what they have in mind, then export and share it.

## Positioning

Real stadium engineering logic (capacity, C-value sightlines, structural roof typologies, budget) behind a playful creative tool: the stadiums are believable because the parameters are architectural, not decorative.

## Operating Context

- Desktop browser, single-page editor around a full-bleed 3D viewport; mobile is secondary.
- Work is saved automatically in the browser (IndexedDB); undo/redo; keyboard shortcuts (G/R/S gizmo, H hide panel, Delete, Ctrl+Z / Ctrl+Y).
- Outputs that leave the app: PNG render, PDF plan, JSON project, GLB model.
- UI language is French.

## Capabilities and Constraints

- 9 bowl shapes, 4 parametric stands (rows, 1–5 tiers, slope, seat geometry, aisles, VIP boxes, seating type), 13 roof systems with per-stand overrides, materials and colours, facade envelopes, placeable 3D objects (screens, floodlights, dugouts, locker rooms, shops, parking, esplanade, fences), 15 presets.
- Camera modes: drone, touchline, seat view, 3D cross-section, 2D plan; day / dusk / night lighting.
- Live metrics: capacity, average rows, footprint, C-value, max height, estimated budget.
- Fully static app (React, Vite, Three.js, Zustand, Tailwind), deployed on GitHub Pages; no backend, no account.
- Progressive depth is a product requirement: simple on the surface, expert settings reachable but tucked away.

## Brand Commitments

- Name: StadiumForge.
- Presets use generic names; real stadium names are deliberately stripped from saved projects and must not be reintroduced.
- Interface direction (chosen 2026-11-03): the category-standard design/3D editor, executed without irony; Figma's craft level is the quality bar.

## Evidence on Hand

No testimonials, users, gallery or press exist. The 3D renders produced by the app are the only visual evidence; do not fabricate community content or usage figures.

## Product Principles

1. The stadium is the hero: the viewport gets the space, the interface serves it.
2. Spectacle first, precision on demand: a good result in a few choices, every parameter still reachable.
3. Numbers are feedback, not decoration: metrics react visibly to each change so users learn cause and effect.
4. Believable over fanciful: options map to real stadium architecture.
