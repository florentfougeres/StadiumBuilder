# Analyse : les 30 stades NFL face au builder

Date : 2026-11-09. Base : `main` @ `33f0d52`.
Sources : la liste Wikipédia (capacité, surface, toiture) et le dossier architectural fourni (structure,
façade, tribunes, particularités). Highmark a deux lignes : le stade de 1973 et celui qui l'a remplacé en 2026.

Légende : ✅ reproductible · 🟡 approchant (silhouette juste, détail manquant) · ❌ hors de portée.

## 1. Le manque commun aux 30 stades : le terrain

Jusqu'ici, l'app ne proposait qu'un terrain de football (105 × 68 m, buts, surface de réparation) ou un ovale
de cricket. **Aucun des 30 stades NFL ne pouvait avoir son vrai terrain.** C'est corrigé (voir § 3).

## 2. Fiches

| # | Stade | Forme / tribunes | Toit | Façade / matériaux | Réglages dans l'app | Verdict |
|---|---|---|---|---|---|---|
| 1 | Allegiant (Las Vegas, 2020) | Cuvette elliptique fermée, plusieurs niveaux, loges | Fixe, câbles + ETFE | Boîte noire monolithique, baies vitrées | `rounded_rectangle` · `fixed_dome` ETFE · `black_zinc_cladding` · pelouse `slide_out` | ✅ |
| 2 | SoFi (Inglewood, 2020) | Cuvette 3 niveaux, terrain ~30 m sous la rue | Canopée ETFE à câbles qui couvre aussi la place, côtés ouverts | Vitrage, métal | `modern_bowl` · **enfouissement 30 m** · `cable_dome` ETFE · **canopée sur le parvis** · espace sous toiture ouvert · écran halo (anneau double face) | ✅ |
| 3 | Mercedes-Benz (Atlanta, 2017) | Cuvette profonde à plusieurs niveaux, disposée en fer à cheval | Iris à 8 pétales ETFE | Vitrage, panneaux métalliques | `petal_iris` 8 · écran halo | ✅ |
| 4 | U.S. Bank (Minneapolis, 2016) | Cuvette fermée raide | Fixe, pente asymétrique, ~60 % ETFE, proue | Zinc, verre, 5 portes vitrées pivotantes | `prow_shell` · `black_zinc_cladding` · **mur vitré ouest à portes pivotantes** | ✅ |
| 5 | Levi's (Santa Clara, 2014) | Grande cuvette basse ; tour de loges côté ouest | Aucun sur le terrain ; toit végétal + PV sur la tour | Verre, béton, métal | Tribune ouest haute (`vipStoreys` 3) · toit par tribune en **`green_roof`** ou `solar_pv_panels` | ✅ |
| 6 | MetLife (East Rutherford, 2010) | Grande cuvette 3 niveaux | Aucun (auvents légers) | Lames aluminium verticales éclairées en LED | `rounded_rectangle` · `louver_curtain` · `brushed_steel_mesh` · **lames éclairées la nuit** aux couleurs du club | ✅ |
| 7 | AT&T (Arlington, 2009) | Grande cuvette, loges | Rétractable 2 panneaux sous **2 arches géantes** | Verre incliné vers l'extérieur, pignons vitrés | `arched_retractable` · profil `saucer` · **écran caisson** (≈ 50 × 22 m) · mur vitré d'en-but | ✅ |
| 8 | Lucas Oil (Indianapolis, 2008) | Plusieurs niveaux modulables | Rétractable 2 panneaux, pignon | Brique, grande baie vitrée mobile côté nord | `retractable` `slide_transverse` 2 panneaux **à deux pans** · `heritage_brick` · **mur vitré nord coulissant** | ✅ |
| 9 | State Farm (Glendale, 2006) | Cuvette fermée | Rétractable incliné, tissu translucide | Côtes métalliques verticales (cactus) | `retractable` membrane · motif `vertical_fins` · pelouse `slide_out` | ✅ |
| 10 | Lincoln Financial (Philadelphie, 2003) | 2 niveaux, coins ouverts | Auvents en porte-à-faux latéraux | Acier, verre | `four_stands` · `cantilever` par tribune | ✅ |
| 11 | Ford Field (Detroit, 2002) | Cuvette intérieure | Fixe, charpente acier | Brique ; ancien entrepôt intégré sur un côté, atrium vitré | `fixed_dome` · tribune sud en `heritage_brick` · coin `building` · écran caisson | 🟡 entrepôt approché |
| 12 | Gillette (Foxborough, 2002) | Cuvette, bout nord ouvert | Auvents partiels | Brique, métal, verre ; phare et passerelle | `horseshoe` · `cantilever` · équipement **phare** (avec passerelle) | ✅ |
| 13 | Lumen Field (Seattle, 2002) | Fer à cheval, bouts ouverts | 2 toits latéraux sur arches | Acier apparent | `horseshoe` · `stand_arch` par tribune | ✅ |
| 14 | NRG (Houston, 2002) | Rectangulaire fermé | Rétractable 2 panneaux PTFE sur supertrusses | Métal, verre | `retractable` `slide_longitudinal` · `spanning_girders` · écran caisson | ✅ |
| 15 | Acrisure (Pittsburgh, 2001) | Cuvette ouverte vers la rivière | Auvents partiels | Verre, béton, métal | `horseshoe` · site `waterfront` | ✅ |
| 16 | Empower Field (Denver, 2001) | Grande cuvette, crête ondulée | Auvents partiels | Béton, verre, métal | `saddle_bowl` · `cantilever` | ✅ |
| 17 | Paycor (Cincinnati, 2000) | 3 niveaux, asymétrique | Auvents partiels | Béton, verre, métal | `four_stands` (hauteurs par tribune) · `waterfront` | ✅ |
| 18 | Huntington Bank Field (Cleveland, 1999) | Cuvette ouverte | Aucun | Béton, métal | `rounded_rectangle` · `waterfront` | ✅ |
| 19 | Nissan (Nashville, 1999) | Cuvette, plusieurs niveaux | Auvents partiels | Béton, métal | `rounded_rectangle` · `cantilever` | ✅ |
| 20 | Raymond James (Tampa, 1998) | Cuvette | Auvents partiels | Béton, métal ; navire pirate au nord | `rounded_rectangle` · site `park` · équipement **galion** derrière l'en-but nord | ✅ |
| 21 | M&T Bank (Baltimore, 1998) | Cuvette | Auvents partiels | Brique, verre, métal | `rounded_rectangle` · `heritage_brick` | ✅ |
| 22 | Northwest (Landover, 1997) | Très grande cuvette | Aucun | Béton, métal | `modern_bowl` 3 niveaux | ✅ |
| 23 | Bank of America (Charlotte, 1996) | Cuvette | Auvents partiels | Béton, pierre ; grandes arches | `stacked_arcades` · `limestone_travertine` | ✅ |
| 24 | EverBank (Jacksonville, 1995) | Cuvette | Aucun | Béton, verre ; écrans géants d'en-but | `rounded_rectangle` · écrans montés sur tribune | ✅ (piscines non modélisées) |
| 25 | Hard Rock (Miami, 1987) | Cuvette | Canopée fixe sur 4 méga-pylônes, terrain ouvert | Béton, métal | `corner_pylons` | ✅ |
| 26 | Caesars Superdome (1975) | Cuvette circulaire | Dôme fixe monumental | Panneaux métalliques dorés | `circular_bowl` · `fixed_dome` · `gold_anodized_panels` · écran caisson | ✅ |
| 27a | Ancien Highmark (Orchard Park, 1973) | Grande cuvette elliptique en béton, raide | Aucun | Béton apparent | `modern_bowl` · enfouissement partiel · `architectural_concrete` · pas de toit | ✅ |
| 27b | Highmark (Orchard Park, 2026) | Cuvette raide | Canopée 360° (~64 % des places) | Préfabriqué, métal perforé | `rounded_rectangle` · `cantilever` couverture 0,64 · `brushed_steel_mesh` | ✅ |
| 28 | Arrowhead (Kansas City, 1972) | Cuvette profonde, raide | Auvents partiels | Béton brut ; rampes hélicoïdales | `rounded_rectangle` · `helical_ramps` · `architectural_concrete` | ✅ |
| 29 | Lambeau (Green Bay, 1957) | Grande cuvette | Aucun | Brique, verre, métal ; atrium | `rounded_rectangle` · `heritage_brick` · coin `building` | ✅ |
| 30 | Soldier Field (Chicago, 1924) | Cuvette moderne insérée dans l'ancien stade | Auvents partiels | Colonnade dorique + volumes verre et acier | façades par tribune : `colonnade_forest` **dorique** à l'est et à l'ouest, `glass_curtain` ailleurs | ✅ |

**Bilan** : 30 ✅ et 1 🟡 (Ford Field) sur 31 lignes, 0 ❌.

## 3. Ajouts faits

| Ajout | Stades | Où |
|---|---|---|
| **Terrain de football américain** : 120 × 53⅓ yards verrouillés ; en-buts colorés avec texte ; logo central ; lignes tous les 5 yards, repères d'un yard et hash marks ; chiffres fléchés ; marques de 2 points ; bordure blanche de 6 ft ; zones d'équipes jaunes ; poteaux en col de cygne jaunes avec rubans ; 8 pylônes orange ; tonte par bandes de 5 yards | les 30 | `gridiron.ts`, `generatePitch.ts`, `schema.ts` (`PitchConfig.sport`, `patchPitch`), panneau Terrain |
| **Écran central en caisson** : quatre faces au-dessus du milieu de terrain, suspendu par câbles comme le halo ; hauteur de l'écran jusqu'à 24 m | AT&T, NRG, Superdome, Ford Field | `generateLights.ts`, `PlacedObject.haloShape`, Équipements |
| **Enfouissement jusqu'à 30 m** (terrain sous la rue) | SoFi | `SUNKEN_MAX_DEPTH`, Forme › Enfouissement |

## 4. Seconde série d'ajouts (restes de la première analyse)

| Ajout | Stades | Où |
|---|---|---|
| **Canopée sur le parvis** : le toit se prolonge de 8 à 90 m sur un côté, ouvert, sur une grille de poteaux | SoFi | `roofs/forecourtCanopy.ts`, `RoofConfig.forecourtCanopy`, Toit › Avancé › Fermeture |
| **Mur vitré géant** sur un côté de la bande sous le toit : fixe, portes pivotantes ou panneaux qui coulissent et s'empilent, avec réglage d'ouverture | U.S. Bank, Lucas Oil, AT&T, Allegiant | `generateEnvelopeSkirt.ts`, `RoofConfig.glassWall` |
| **Toit rétractable à deux pans** : de 0 à 20°, les panneaux coulissants montent vers un faîtage, les rails suivent la pente | Lucas Oil | `retractablePanels.ts`, `RetractableConfig.pitchDeg` |
| **Lames éclairées la nuit** : projecteurs colorés derrière les lames de `louver_curtain` | MetLife | `envelopes/louverCurtain.ts`, `facadeGlowHex` |
| **Toiture végétalisée** (sedum et allées de gravier) | Levi's | `materials.ts`, `RoofMaterialId` |
| **Portique dorique** : colonnes cannelées, chapiteaux, entablement, triglyphes, emmarchements | Soldier Field | `envelopes/colonnadeForest.ts`, `colonnadeShape: 'doric'` |
| **Phare** et **galion** : équipements thématiques génériques | Gillette, Raymond James | `landmarkObjects.ts`, Équipements |
| **Préréglage « Stade de Football Américain à Arches »** (70 000 places) | — | `presets.ts`, `public/presets/gridiron_arches_70k.webp` |

## 5. Restes

- Ford Field : l'entrepôt historique intégré sur un côté est approché par un bâtiment d'angle en brique.
- Le portique dorique et les palmiers ne s'affichent que sans coursive extérieure ; avec une coursive, la façade
  extérieure reste en fûts droits.
- Le mur vitré occupe la bande entre le haut des gradins (ou de la coursive) et le toit : pour un grand pignon
  vitré, il faut une tribune d'en-but basse (c'est le cas dans le préréglage).
