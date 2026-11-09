# Analyse : les 100 plus grands stades européens face au builder

Date : 2026-11-09. Base : `main` @ `2f9e1cc` (43 toits, 16 formes, 9 enveloppes + 4 profils, 23 façades,
13 toits, 13 structures, 6 modes de coin, terrains football / football américain / cricket).

Source : le dossier de 100 fiches fourni. Le paragraphe « Tribunes et toiture » y est identique pour
les 100 stades : seule la ligne « Architecture, structure et matériaux » distingue les stades. Le reste
vient de connaissances générales. La fiche 98 (« Hauptstadion », Aix-la-Chapelle) est signalée comme non
identifiée par la source elle-même : elle n'est pas analysée.

Légende : ✅ reproductible · 🟡 approchant (silhouette juste, signature manquante) · ❌ hors de portée.

## 1. Fiches

| # | Stade | Réglages dans l'app | Verdict | Ce qui manque |
|---|---|---|---|---|
| 1 | Camp Nou (projet Espai Barça) | `modern_bowl` 3 niveaux · `cantilever` · `horizontal_strata` · `architectural_concrete` | ✅ | — |
| 2 | Wembley | `rounded_rectangle` · `giant_arch` | 🟡 | Panneaux mobiles sous l'arche (le toit s'ouvre au-dessus de la pelouse) |
| 3 | Santiago Bernabéu | `rounded_rectangle` · `louver_curtain` + `brushed_steel_mesh` · `retractable` | 🟡 | Écran 360° en bord de toit (le halo plafonne à 80 m et pend au centre) ; pelouse rangée sous terre |
| 4 | Twickenham | `compact_urban` 3 niveaux · `cantilever` | 🟡 | Terrain de rugby |
| 5 | Signal Iduna Park | `english_rectangular` coins remplis · `suspended_masts` 8 mâts · `yellow_lacquer_steel` · Südtribüne `safe_standing` 1 niveau | ✅ | — |
| 6 | Stade de France | `modern_bowl` · piste · tribunes basses `retractShift` · `column_supported` | ✅ | (terrain de rugby pour la config rugby) |
| 7 | Loujniki | `olympic_oval` · colonnade `doric` · `cantilever` | ✅ | — |
| 8 | Atatürk | `olympic_oval` · `cantilever` limité à l'ouest (`coveredSides`) | ✅ | — |
| 9 | Olympiastadion Berlin | `sunken_bowl` · piste `mondo_blue` · `colonnade_forest` · `limestone_travertine` · `column_supported` | 🟡 | Piliers carrés (on a fûts ronds, palmier, dorique) ; porte de Marathon (brèche dans l'anneau) |
| 10 | Old Trafford | `english_rectangular` · hauteurs par tribune · `cantilever` | ✅ | — |
| 11 | Principality Stadium | `compact_urban` · `retractable` + 4 pylônes | ✅ | (terrain de rugby) |
| 12 | Metropolitano | `tilted_bowl` · `bicycle_wheel` membrane · tribune ouest d'origine en façade par tribune | ✅ | — |
| 13 | NSC Olimpiyskiy | `olympic_oval` · `suspended_masts` · `ptfe_membrane` | ✅ | — |
| 14 | San Siro | `rounded_rectangle` · `helical_ramps` · `corner_pylons` · `red_lacquer_steel` | ✅ | — |
| 15 | Allianz Arena | `modern_bowl` profil `bulging` · `etfe_cushions_facade` + `facadeGlowHex` · toit ETFE | ✅ | — |
| 16 | La Cartuja | `olympic_oval` · `cantilever` sur les latérales | ✅ | — |
| 17 | Stade olympique de Bakou | `olympic_oval` · `enveloping_skin` · `glass_curtain` | ✅ | — |
| 18 | OAKA Athènes | `olympic_oval` · `twin_arch` · `ptfe_membrane` | ✅ | — |
| 19 | Croke Park | `horseshoe` · Hill 16 en `embankment` · hauteurs par tribune | 🟡 | Terrain de sports gaéliques |
| 20 | London Stadium | `olympic_oval` · `bicycle_wheel` · éclairage sur le toit | ✅ | — |
| 21 | Stadio Olimpico | `olympic_oval` · `bicycle_wheel` | ✅ | — |
| 22 | Vélodrome | `rounded_rectangle` · `wave_canopy` · `ptfe_membrane` | ✅ | — |
| 23 | Puskás Aréna | `modern_bowl` · `louver_curtain` · socle vitré (`plinthHeight`) | ✅ | — |
| 24 | Murrayfield | `rounded_rectangle` · `cantilever` | 🟡 | Terrain de rugby |
| 25 | Estádio da Luz | `compact_urban` · `stand_arch` · `red_lacquer_steel` · `polycarbonate_glass` | ✅ | — |
| 26 | Saint-Pétersbourg | `circular_bowl` profil `saucer` · `retractable` + pylônes · butte · bord de l'eau | ✅ | — |
| 27 | Olympiastadion München | `olympic_oval` · `tensile_net` sur un côté · butte | ✅ | — |
| 28 | Tottenham Hotspur | `rounded_rectangle` · tribune sud 1 niveau · `slide_out` | 🟡 | Gazon NFL sous la pelouse (la pelouse mobile révèle un sol nu) |
| 29 | Anfield | `english_rectangular` · hauteurs par tribune | ✅ | — |
| 30 | Etihad | `rounded_rectangle` · `suspended_masts` · coins `spiral_tower` | ✅ | — |
| 31 | Emirates | `rounded_rectangle` · `girder_grid` · `glass_curtain` | ✅ | — |
| 32 | Celtic Park | `compact_urban` · `cantilever` | ✅ | — |
| 33 | Benito Villamarín | `rounded_rectangle` · `cantilever` | ✅ | — |
| 34 | Parc OL | `rounded_rectangle` · `exposed_structure` · `counterweighted_cantilever` | ✅ | — |
| 35 | Stade national de Varsovie | `modern_bowl` · `fold_central` + aiguille centrale · motif `woven_basket` | ✅ | — |
| 36 | San Nicola (Bari) | `modern_bowl` · anneau bas en `embankment` | ❌ | Anneau supérieur découpé en 26 « pétales » séparés par des vides, un auvent par pétale |
| 37 | Johan Cruijff ArenA | `compact_urban` · `retractable` · `spanning_girders` | ✅ | — |
| 38 | Śląski | `olympic_oval` · `bicycle_wheel` | ✅ | — |
| 39 | Dinamo Tbilissi | `modern_bowl` 2 niveaux · `cantilever` | ✅ | — |
| 40 | Arena Națională | `modern_bowl` · `fold_central` membrane | ✅ | — |
| 41 | Diego Armando Maradona | `olympic_oval` · `cantilever` sur treillis | ✅ | — |
| 42 | Lluís Companys | `olympic_oval` · `stacked_arcades` · `limestone_travertine` · toit partiel | ✅ | — |
| 43 | Ali Sami Yen | `compact_urban` · `cantilever` | ✅ | — |
| 44 | San Mamés | `rounded_rectangle` · `vertical_fins` · `etfe_cushions_facade` lumineux | ✅ | — |
| 45 | Étoile rouge (Marakana) | `sunken_bowl` 1 niveau · toit partiel | ✅ | — |
| 46 | Everton Stadium | `compact_urban` · socle brique + verre par tribune · `waterfront` | ✅ | — |
| 47 | St James' Park | `english_rectangular` asymétrique · toit par tribune | ✅ | — |
| 48 | Donbas Arena | `tilted_bowl` · `glass_curtain` | ✅ | — |
| 49 | Hampden Park | `rounded_rectangle` · `cantilever` | ✅ | — |
| 50 | Aviva Stadium | `rounded_rectangle` · tribune nord basse · `enveloping_shell` · motif `scales` | 🟡 | À vérifier : coque continue qui plonge sur une tribune basse |
| 51 | Ibrox | `english_rectangular` · tribune principale `heritage_brick` · fronton `criss_cross` | ✅ | — |
| 52 | MHPArena | `modern_bowl` · `bicycle_wheel` membrane | ✅ | — |
| 53 | Ernst-Happel | `olympic_oval` · `cantilever` | ✅ | — |
| 54 | Strawberry Arena | `compact_urban` · `retractable` · `media_mesh` | ✅ | — |
| 55 | Şükrü Saracoğlu | `compact_urban` · `cantilever` | ✅ | — |
| 56 | Pierre-Mauroy | `compact_urban` · `retractable` · pelouse `half_lift` | ✅ | — |
| 57 | José Alvalade | `compact_urban` · `pixel_mosaic` + palette · `ceramic_tile_mosaic` | ✅ | — |
| 58 | Dragão | `rounded_rectangle` · butte | ✅ | (terrain en pente, voir E) |
| 59 | Roi Baudouin | `olympic_oval` · `cantilever` | ✅ | — |
| 60 | Veltins-Arena | `compact_urban` · `retractable` · pelouse `slide_out` | ✅ | — |
| 61 | Mestalla | `english_rectangular` · tribunes à forte pente (`slopeAngleDeg` haut) | ✅ | — |
| 62 | Volksparkstadion | `rounded_rectangle` · `bicycle_wheel` | ✅ | — |
| 63 | Parc des Princes | `rounded_rectangle` · `concrete_portals` | ✅ | — |
| 64 | Stadium of Light | `compact_urban` · `cantilever` | ✅ | — |
| 65 | De Kuip | `rounded_rectangle` · `external_stairs` | ✅ | — |
| 66 | Fritz-Walter | `english_rectangular` · butte | 🟡 | Terrain en pente (stade à flanc de colline) |
| 67 | Deutsche Bank Park | `rounded_rectangle` · `fold_central` + aiguille · écran caisson | ✅ | — |
| 68 | Merkur Spiel-Arena | `compact_urban` · `retractable` | ✅ | — |
| 69 | Borussia-Park | `compact_urban` · `cantilever` | ✅ | — |
| 70 | Volgograd | `circular_bowl` profil `saucer` · `diagrid` · `bicycle_wheel` | ✅ | — |
| 71 | Lukoil Arena | `compact_urban` · `glass_curtain` | ✅ | — |
| 72 | Ak Bars Arena | `rounded_rectangle` · écran posé sur la façade | ✅ | — |
| 73 | Rostov Arena | `saddle_bowl` · toit plus haut sur les latérales | ✅ | — |
| 74 | Panathénaïque | `horseshoe` · `limestone_travertine` · sans toit | 🟡 | Arène très allongée (≈ 200 × 33 m) ; gradins de marbre sans sièges |
| 75 | Páirc Uí Chaoimh | `rounded_rectangle` · `cantilever` | 🟡 | Terrain de sports gaéliques |
| 76 | Nijni Novgorod | `modern_bowl` · `colonnade_forest` blanche | ✅ | — |
| 77 | Mordovia Arena | `modern_bowl` · `pixel_mosaic` orange/rouge/blanc | 🟡 | Dégradé de couleur du bas vers le haut (la palette est tirée au hasard) |
| 78 | Max-Morlock | `olympic_oval` sans piste · `cantilever` | ✅ | — |
| 79 | Vasil Levski | `olympic_oval` · toit partiel | ✅ | — |
| 80 | Villa Park | `english_rectangular` · `heritage_brick` · `historic_gable` | ✅ | — |
| 81 | RheinEnergieStadion | `english_rectangular` · `corner_pylons` | ✅ | — |
| 82 | Hanovre | `rounded_rectangle` · `cantilever` | ✅ | — |
| 83 | Ullevi | `saddle_bowl` · `suspended_masts` | ✅ | — |
| 84 | Poznań | `compact_urban` · `cantilever` | ✅ | — |
| 85 | Wrocław | `modern_bowl` · `woven_glassfibre_mesh` | ✅ | — |
| 86 | Sánchez-Pizjuán | `rounded_rectangle` · fresque `ceramic_tile_mosaic` | ✅ | — |
| 87 | Beşiktaş Park | `compact_urban` · `glass_curtain` | ✅ | — |
| 88 | Samara Arena | `circular_bowl` · `saucer_dome` | ✅ | — |
| 89 | Matmut Atlantique | `compact_urban` · `colonnade_forest` · toit carré | ✅ | — |
| 90 | Geoffroy-Guichard | `english_rectangular` coins remplis | ✅ | — |
| 91 | Gdańsk | `modern_bowl` profil `bulging` · `pixel_mosaic` ambre | ✅ | (dégradé, voir D) |
| 92 | Allianz Stadium (Turin) | `compact_urban` · `suspended_masts` | 🟡 | Deux pylônes seulement (le toit à mâts en demande au moins 6, répartis autour du bol) |
| 93 | Stamford Bridge | `english_rectangular` · hauteurs par tribune | ✅ | — |
| 94 | Metalist | `rounded_rectangle` · `cantilever` | ✅ | — |
| 95 | Red Bull Arena Leipzig | `modern_bowl` · butte | 🟡 | Passerelles qui franchissent l'ancien talus |
| 96 | Artemio Franchi | `english_rectangular` · `helical_ramps` · `architectural_concrete` | 🟡 | Tour de Marathon (tour isolée) ; auvent mince en béton en porte-à-faux |
| 97 | RCDE Stadium | `compact_urban` · `pixel_mosaic` | ✅ | — |
| 98 | Hauptstadion | — | — | Non identifié par la source |
| 99 | Reale Arena | `compact_urban` · `cantilever` | ✅ | — |
| 100 | Goodison Park | `english_rectangular` · `criss_cross` · coin `building` (église) | ✅ | — |

**Bilan** : 83 ✅, 15 🟡, 1 ❌, 1 non analysé. Les formes, toits et matériaux couvrent presque tout :
les analyses précédentes (20 stades, 30 stades NFL) ont déjà comblé l'essentiel. Les manques sont des
**terrains d'autres sports**, quelques **signatures** isolées et le **site**.

## 2. Manques par catégorie

Classés par nombre de stades concernés.

### A. Terrains (7 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Terrain de rugby** : 100 × 70 m, en-buts de 10 à 22 m, poteaux en H, lignes de 22 m et de 10 m | Twickenham, Murrayfield, Principality, Aviva, Stade de France | `PitchSport: 'rugby'` ; les poteaux en H existent déjà pour l'ovale de cricket (`generatePitch.ts`) |
| **Terrain de sports gaéliques** : ≈ 145 × 90 m, poteaux en H avec filet, lignes de 13, 20 et 45 m | Croke Park, Páirc Uí Chaoimh | `PitchSport: 'gaelic'`, même mécanisme |
| **Second terrain sous la pelouse mobile** (gazon NFL révélé quand la pelouse sort) | Tottenham | Dessiner le terrain de `gridiron.ts` sur le sol de `generateMovablePitch.ts` |

### B. Tribunes (3 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Anneau supérieur découpé en pétales** séparés par des vides réguliers, un auvent par pétale | San Nicola | Option `upperRingGaps` (nombre, largeur) sur les bols continus |
| **Brèche dans l'anneau** (porte de Marathon) | Berlin | Variante d'un coin `open` sur un bol continu, au milieu d'un virage |
| **Gradins sans sièges** (bancs de pierre ou de béton) | Panathénaïque (+ vieux stades) | `seatFinish: 'stone_bench'` |

### C. Toits (3 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Arche géante + panneaux mobiles** | Wembley | Couche `retractable` sur `giant_arch`, comme les pylônes ajoutés aux toits rétractables |
| **Mâts par côté** (2 pylônes sur les latérales) | Turin | Abaisser le minimum de `mastCount` à 2 et placer les mâts au milieu des latérales |
| **Écran 360° en bord de toit** | Bernabéu | `halo_screen` monté sur le bord intérieur du toit (`mount: 'roof'`) et non plus limité à 80 m |

### D. Façades (3 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Dégradé vertical** de la palette (du bas vers le haut) | Mordovia, Gdańsk | Option `facadePaletteMode: 'random' \| 'gradient'` pour `pixel_mosaic` |
| **Piliers carrés** | Berlin | `colonnadeShape: 'square'` |
| **Auvent mince en béton** en porte-à-faux sur une tribune | Franchi | Matériau `reinforced_concrete` sur `cantilever` (à vérifier) |

### E. Site et objets (4 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Terrain en pente** (un côté du stade adossé à la colline) | Fritz-Walter, Dragão | `site.slope` : butte d'un seul côté dans `generateSite.ts` |
| **Tour isolée** (tour de Marathon, clocher) | Franchi, Berlin | Équipement `tower` dans `landmarkObjects.ts` |
| **Passerelles** au-dessus d'un talus | Leipzig | Équipement `footbridge` |
| **Pelouse rangée sous terre** | Bernabéu | Mouvement `movablePitch: 'lower'` |

### F. Matériaux

Aucun manque bloquant. Le marbre blanc (Panathénaïque) est approché par `limestone_travertine`.

## 3. Ordre proposé

1. **Terrains de rugby et de sports gaéliques** (A1, A2) : 7 stades, même mécanisme que le football américain.
2. **Dégradé de palette + piliers carrés** (D1, D2) : petits, purement visuels.
3. **Mâts par côté + écran 360° en bord de toit** (C2, C3).
4. **Anneau en pétales** (B1) : le seul ❌, géométrie du bol à toucher.
5. **Arche + panneaux mobiles** (C1), **gazon NFL sous la pelouse** (A3).
6. **Site** : terrain en pente, tour, passerelles, bancs de pierre (E, B3).

## 4. Statut (2026-11-09, soir)

Décision : les terrains d'autres sports (rugby, sports gaéliques, gazon NFL sous la pelouse, pelouse
rangée sous terre) et le terrain en pente sont écartés. On se concentre sur le stade lui-même.

Fait :
- **B1** Anneau supérieur en pétales : nombre (8 à 40) et largeur des vides (2 à 12 m), avec murs de fermeture
  (`upperRingGaps`, panneau Forme).
- **B2** Brèche dans l'anneau, centrée sur une tribune, de 8 à 60 m (`ringBreach`, panneau Forme).
- **B3** Gradins de marbre sans sièges (`seatFinish: 'stone_bench'`).
- **C1** Panneaux coulissants sur les latérales du toit à arche géante, ouverture animée
  (`archMovablePanels`, réglages pris dans `retractable`).
- **C2** Toit à mâts de 2 à 4 pylônes avec haubans en éventail : 2 au milieu des latérales, 4 aux angles.
- **C3** Écran 360° sous le bord intérieur du toit (forme « Bord du toit » de l'écran central).
- **D1** Dégradé du bas vers le haut pour la mosaïque de pixels (`facadePaletteGradient`).
- **D2** Piliers carrés massifs dans le revêtement de façade (`colonnadeShape: 'square'`).
- **E** Équipements « Tour » et « Passerelle ».
- Miniatures de toutes les galeries (préréglages, formes, toits, façades) régénérées et contrôlées.

Restes :
- D3 (auvent mince en béton) : pas de matériau de toit « béton » ; approché par `concrete_portals`.
- La brèche coupe les gradins ; la façade et le toit continuent par-dessus.
- Les pétales gardent un toit continu (pas d'auvent séparé par pétale).
