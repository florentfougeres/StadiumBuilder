# Spec — ce qui manque au builder d'après 3 documents de référence

Date : 2026-11-03
Sources :
- **[IESF]** IESF, comité génie civil, *Stades en France 1938-2017* (18 fiches de stades).
- **[MAH]** A. Mahovič, *Typology of retractable roof structures in stadiums and sports halls*, IU/CG n°3, 2015.
- **[UQAM]** L. Lauzier-Jobin, *L'effet de l'implantation des grands stades sur la forme urbaine*, UQAM, 2023 (générations de stades selon Magne, Stade olympique de Montréal, Rogers Centre, Gillette Stadium).

Périmètre : formes de stade, toitures, structures porteuses, enveloppes, matériaux et équipements
mobiles qui figurent dans ces documents et qu'on ne peut pas reproduire aujourd'hui.

## 0. Principes communs

- Tout nouveau champ du document est **optionnel**, avec un défaut qui reproduit le rendu actuel :
  les projets sauvegardés (IndexedDB, `src/state/db.ts`) doivent se rouvrir à l'identique.
- Chaque nouveau style apparaît dans l'Inspector avec un libellé et une description en français
  (même format que `ROOF_OPTIONS` dans `src/editor/Inspector.tsx`).
- Chaque nouveau style est compatible avec la coupe (`crossSectionClip`), le mode plan 2D,
  l'export GLB et le calcul de capacité / visibilité (`capacity.ts`, `sightlines.ts`).
- Chaque lot ajoute au moins un test dans `src/stadium/__tests__/` : la scène se construit sans
  erreur pour chaque forme compatible, et la géométrie attendue est présente (nombre de panneaux,
  de mâts, etc.).
- Un **preset** inspiré de chaque stade de référence est ajouté dans `presets.ts` (nom générique,
  pas de marque), pour servir de démonstration et de test de non-régression.

---

## Lot A — Toits déclarés mais non implémentés (dette existante)

Quatre valeurs de `RoofStyle` existent dans `schema.ts` sans générateur ni entrée dans l'Inspector :
`corner_pylons`, `wave_canopy`, `petal_iris` et `historic_gable`. Aujourd'hui un document qui les
utilise ne produit pas de toit. Chacune est implémentée par un lot ci-dessous :

| Style | Implémenté dans |
|---|---|
| `corner_pylons` | Lot C2 (méga-poteaux d'angle + treillis 3D) |
| `petal_iris` | Lot B (mouvement `iris`) |
| `wave_canopy` | Lot C5 (dentelle ondulante à hauteur variable) |
| `historic_gable` | Lot C6 (tribunes historiques à pignon) |

**Critère d'acceptation :** aucune valeur de `RoofStyle` n'est sans générateur, et un test parcourt
toute l'union pour le vérifier.

---

## Lot B — Toits rétractables complets [MAH] [IESF Lille] [UQAM Montréal, Rogers Centre]

### B1. Modèle

Remplacer le booléen `retractableClosed` par une configuration complète (le booléen reste lu
pour migrer : `true` → `openRatio = 0`, `false` → `openRatio = 1`) :

```ts
export type RetractableMotion =
  | 'slide_longitudinal'  // actuel (défaut) : panneaux glissent dans l'axe du terrain et s'empilent au-dessus d'un virage ou des deux
  | 'slide_transverse'    // panneaux qui s'écartent vers les tribunes latérales
  | 'slide_off'           // toit entier qui glisse hors de l'emprise, sur des rails prolongés
  | 'rotate_vertical'     // segments qui pivotent autour d'un axe vertical et s'empilent (Civic Arena)
  | 'rotate_horizontal'   // volets à charnière qui se relèvent ou se rabattent
  | 'iris'                // pétales qui glissent les uns sur les autres vers la couronne (Iris Dome)
  | 'fold_central'        // membrane qui se replie vers un point central suspendu (Montréal)
  | 'fold_edge'           // membrane plissée en accordéon vers un petit côté (Toyota, Rothenbaum)
  | 'combined_stack';     // glissement + rotation, panneaux qui s'emboîtent (Rogers Centre)

export type RetractablePanelKind = 'rigid' | 'membrane' | 'mixed';

export interface RetractableConfig {
  motion: RetractableMotion;
  /** 0 = fermé, 1 = ouvert au maximum. */
  openRatio: number;
  /** Nombre de panneaux / segments / pétales mobiles. */
  panelCount: number;
  panelKind: RetractablePanelKind;
  /** Matériau des panneaux mobiles (parmi RoofMaterialId). */
  panelMaterial: RoofMaterialId;
  /** Pour slide_longitudinal : empilement sur un virage ou réparti sur les deux. */
  parkEnd: 'east' | 'west' | 'both';
  /** Pour fold_central : un mât incliné porte le point de suspension (voir Lot C7). */
  suspensionMast?: boolean;
}
```

`RoofConfig.retractable?: RetractableConfig`. Défauts : `slide_longitudinal`, `openRatio` déduit de
`retractableClosed`, `panelCount` selon `RETRACTABLE_PANEL_LIMITS`, `panelKind = 'rigid'` (`'membrane'` pour les replis), `panelMaterial = 'polycarbonate_glass'` (`'ptfe_membrane'` pour une membrane).

### B2. Comportement par mouvement

| Mouvement | Géométrie | Défaut `panelCount` | Contrainte |
|---|---|---|---|
| `slide_transverse` | Bandes perpendiculaires à la ligne de touche, rangées au-dessus des tribunes latérales | 4 (2 à 6) | — |
| `slide_longitudinal` | Panneaux rectangulaires portés par 2 méga-poutres longitudinales parallèles à la ligne de touche, qui dépassent du bol. Ouverts, ils s'empilent en gradins au-dessus du virage choisi | 4 (2 à 6, Lille : 4) | Les méga-poutres sont toujours visibles, même toit fermé |
| `slide_off` | Un ou deux grands panneaux qui roulent sur des rails prolongés à l'extérieur de la façade | 2 | Les rails extérieurs sont dessinés jusqu'à la position ouverte |
| `rotate_vertical` | Segments en couronne qui pivotent autour du centre du bol et s'empilent sur un secteur | 6 | Formes à bol continu uniquement |
| `rotate_horizontal` | Volets attachés au bord intérieur de la couronne fixe, qui se relèvent (angle = `openRatio × 90°`) | 4 à 16 | Toutes formes |
| `iris` | Pétales qui tournent légèrement tout en reculant le long de leur bissectrice jusqu'à la couronne, comme un diaphragme d'appareil photo | 8 (6 à 16) | Formes à bol continu ; implémente `petal_iris` |
| `fold_central` | Membrane tendue par des câbles rayonnants depuis la couronne vers un anneau central suspendu ; ouverte, la membrane est repliée en paquet sous le point de suspension | 1 membrane, 16 à 32 câbles | Si `suspensionMast`, le point est porté par le mât incliné du Lot C7 |
| `fold_edge` | Membrane plissée en accordéon sur des fermes mobiles qui se regroupent vers un petit côté | 6 à 12 fermes | Toutes formes |
| `combined_stack` | 4 panneaux : 1 fixe, 2 qui glissent en ligne, 1 qui tourne pour se loger sous les autres | 4 (fixe) | Bol ovale ou circulaire |

`panelKind` :
- `rigid` : panneaux épais (≈ 1,5 m) avec cadre en treillis, matériau `panelMaterial`.
- `membrane` : film tendu sur des cadres légers ; le pli est visible en position ouverte.
- `mixed` : cadre rigide + remplissage membrane (ETFE ou PTFE).

### B3. Inspector

Section « Toit rétractable » visible si `style === 'retractable'` (ou `petal_iris`) :
- liste « Mouvement » (9 entrées, avec un schéma ou une description courte) ;
- curseur « Ouverture » 0–100 % ;
- curseur « Nombre de panneaux » borné selon le mouvement ;
- choix « Type de panneaux » et « Matériau des panneaux » ;
- options conditionnelles (`parkEnd`, `suspensionMast`).

Le bouton actuel ouvert/fermé devient deux raccourcis 0 % / 100 %.

### B4. Critères d'acceptation

- Les 9 mouvements se construisent sur `modern_bowl`, `olympic_oval` et `four_stands` (ou affichent
  une raison claire dans l'Inspector quand la forme est incompatible).
- À `openRatio = 0`, l'ouverture centrale est entièrement couverte ; à `openRatio = 1`, plus aucun
  panneau ne se trouve au-dessus de l'aire de jeu (sauf `fold_central`, dont le paquet de membrane
  reste suspendu au centre).
- Le calcul « stade couvert / intérieur » de `capacity.ts` dépend de `openRatio === 0`.
- Un projet sauvegardé avec `retractableClosed: true` se rouvre fermé, et avec `false` ouvert.

---

## Lot C — Structures porteuses de toiture [IESF]

### C1. Porte-à-faux avec contre-poids et tirants arrière (Groupama Stadium)

Nouveau `RoofStyle` : `'counterweighted_cantilever'`.
- Fermes rayonnantes en acier posées sur le haut des tribunes : bras côté terrain (fléau) et
  bras arrière plus court (contre-fléau) ancré par des tirants à des poteaux plantés à l'arrière
  du stade.
- Paramètres : `roof.trussCount` (12 à 48, défaut 32), `roof.backspanRatio` (0,3 à 0,7 du fléau,
  défaut 0,53, soit 32 m / 60 m).
- La couverture peut être découpée en panneaux longitudinaux (bandes de membrane) entre les fermes.
- Compatible bol continu et quatre tribunes.

### C2. Méga-poteaux d'angle + méga-poutres + treillis 3D (Lens, Vélodrome) → `corner_pylons`

- Quatre méga-poteaux d'angle (hauteur réglable, jusqu'à 72 m), reliés par quatre méga-poutres en
  treillis (longueurs = côtés du stade).
- Option `roof.spaceFrame: boolean` : résille tridimensionnelle de poutres treillis entre les
  méga-poutres et le haut des tribunes (60 poutres pour le Vélodrome), recouverte d'une membrane
  translucide.
- Option `roof.crownHeight` : la couverture peut monter au-dessus des méga-poutres (Vélodrome,
  68 m) avec un profil courbe.
- Différence avec `goalpost_truss` : les poutres ne sont pas posées sur les tribunes ; le toit est
  porté en 4 points et les tribunes restent indépendantes en dessous.

### C3. Portiques en béton précontraint visibles (Parc des Princes)

Nouveau `EnvelopeStyle` : `'concrete_portal_ribs'`.
- Nervures en béton (50 par défaut) qui montent de l'extérieur du stade, passent au-dessus du
  bol et portent la couverture en porte-à-faux. La nervure est à la fois la façade et la
  structure du toit.
- Paramètres : `materials.portalCount` (24 à 72), profil de nervure ondulé (alternance de hauteur
  sur le bord supérieur, comme le Parc des Princes).
- Matériau imposé : `reinforced_concrete` (structure) ; la couverture garde le `roofMaterial`.
- Utilisable avec `roof.style = 'cantilever'` ; d'autres combinaisons sont désactivées dans l'Inspector.

### C4. Structure mixte bois lamellé-collé + acier + membrane transparente (Allianz Riviera)

Nouveau `EnvelopeStyle` : `'timber_lattice'`.
- Résille de poutres en bois lamellé-collé en losanges qui enveloppe le stade et se prolonge en
  toiture ; consoles acier de 46 m en tête, tirants au-dessus, membrane transparente tendue.
- Matériaux : bois = `glulam_timber`, consoles = `structureMaterial`, membrane = `etfe_cushions`
  ou `ptfe_membrane`.
- Option `materials.solarRoof: boolean` : bandes de `solar_pv_panels` sur la couverture.

### C5. Dentelle en BFUP à hauteur variable (Jean Bouin) → `wave_canopy`

- `wave_canopy` : la couverture et la façade forment une seule peau, dont la hauteur varie le long
  du périmètre (« inflexions altimétriques », jusqu'à 31 m). Profil défini par 2 à 6 points de
  contrôle (`roof.waveProfile: number[]`, hauteurs relatives).
- La peau est faite d'éléments triangulaires ajourés (voir matériau D1) ; sur la toiture, une
  partie des triangles est vitrée (`roof.glazedCellRatio`, 0 à 1).
- Charpente acier en fléaux sous la peau (74 par défaut, 25 à 45 m).

### C6. Tribunes historiques à pignon (stades à l'anglaise d'avant-guerre) → `historic_gable`

- Toit à deux pans par tribune, avec un pignon décoratif au centre de la tribune principale,
  poteaux en acier riveté dans les gradins et ferme apparente (Lens 1933, Gerland 1926 en photo).
- Utilisable par tribune via `roofStyleOverride`, pour mélanger historique et moderne.

### C7. Mât incliné porteur (Stade olympique de Montréal) [UQAM]

Nouveau type d'objet placé : `'inclined_mast'`.
- Tour inclinée (angle 30 à 60°, hauteur jusqu'à 175 m) posée à l'extérieur du bol, avec des
  câbles vers le centre du toit.
- Combiné avec `retractable.motion = 'fold_central'` et `suspensionMast = true`, la membrane est
  suspendue sous la tête du mât.
- Peut aussi exister seul, comme repère architectural ou porte-caméras.

### C8. Toit fermé sur méga-poutres transversales (Paris La Défense Arena)

Nouveau `RoofStyle` : `'spanning_girders'`.
- Toit plat ou légèrement bombé, entièrement fermé, porté par 2 à 6 méga-poutres transversales de
  grande portée (80 m) posées sur les murs.
- Différence avec `fixed_dome` : pas de coupole ; l'intérieur reste une boîte (arène).
- Le stade est considéré comme intérieur (éclairage, capacité concerts).

### C9. Toit à haubans sur mâts : vérification (Stade de France)

`suspended_masts` existe. Vérifier et compléter pour pouvoir reproduire : 18 mâts de 60 m espacés
de 40 m, toit à 46 m, groupes de haubans. Ajouter si besoin `roof.mastCount` et `roof.mastHeight`.

### C10. Forêt de poteaux fins : vérification (Matmut Atlantique)

`colonnade_forest` existe. Permettre une densité allant jusqu'à ≈ 640 poteaux de 37 m
(`materials.colonnadeDensity`), avec un toit plat rectangulaire qui dépasse au-dessus.

---

## Lot D — Enveloppes et matériaux [IESF]

### D1. Nouveaux matériaux de façade (`FacadeMaterialId`)

| Id | Description | Référence |
|---|---|---|
| `uhpc_lace_panels` | Panneaux triangulaires en BFUP blanc cassé, ajourés en motif organique | Jean Bouin |
| `precast_concrete_scales` | Écailles de béton blanc préfabriquées, en 3 rangées qui se recouvrent | La Défense Arena |
| `polycarbonate_facade` | Polycarbonate alvéolaire translucide, rétroéclairé la nuit | Lille |
| `glulam_lattice` | Résille en bois lamellé-collé en losanges (utilisée par C4) | Nice |

Chaque matériau a un aperçu réel dans le sélecteur (comme ceux ajoutés au commit 746e148) et
utilise le mapping triplanaire monde pour les bétons.

### D2. Nouveau motif paramétrique (`FacadePatternId`)

- `triangulated_lace` : maillage de triangles dont la taille et l'ouverture varient sur la façade
  (`facadeDensity` = densité, `facadeDepth` = relief).
- `scales` : écailles qui se recouvrent, en rangées décalées (`facadeDensity` = nombre de rangées, 1 à 5).

### D3. Façade bombée

`materials.facadeBulge` (0 à 1) : la façade se bombe vers l'extérieur à mi-hauteur au lieu d'être
verticale (La Défense Arena). Compatible avec tous les `EnvelopeStyle` qui ont une peau.

### D4. Matériau de structure par tribune

`StandConfig.structureMaterialOverride?: StructureMaterialId | 'inherit'` : une tribune en béton
et une autre en acier dans le même stade (Matmut Atlantique : 2 tribunes béton, 2 tribunes acier).
Une tribune en acier a un dessous ajouré avec des poutres crémaillères visibles.

---

## Lot E — Formes et aménagements du terrain [IESF] [UQAM]

### E1. Piste cycliste relevée (vélodrome)

`PitchConfig.trackType?: 'athletics' | 'cycling' | 'both'` (défaut `'athletics'`, appliqué si `hasTrack`).
- Piste cycliste en béton, longueur 333 m, 400 m ou 500 m (`cyclingTrackLength`), virages relevés
  (inclinaison réglable 25 à 45°), lignes droites légèrement inclinées.
- `'both'` : piste d'athlétisme à l'intérieur, piste cycliste à l'extérieur.
- Les tribunes reculent pour rester derrière la piste ; les virages relevés comptent dans la
  distance au terrain (`sightlines.ts`).
- Références : Parc des Princes 1897-1967, Chaban-Delmas avant 1986, Stadium de Toulouse avant
  1998, Gerland avant 1969.

### E2. Pelouse mobile / modulable (Lille)

`PitchConfig.movablePitch?: 'none' | 'half_lift' | 'slide_out'`, avec `movablePitchState` (0 à 1).
- `half_lift` : la moitié nord de la pelouse monte et glisse sur la moitié sud ; un plancher (arène)
  apparaît en dessous, et des tribunes télescopiques avancent sur la moitié libérée.
- `slide_out` : la pelouse entière sort du stade sur des rails (comme pour un concert).
- L'état « arène » réduit la capacité de foot et ajoute une capacité « salle ».

### E3. Tribunes entièrement mobiles (Stade de France, Nice)

`StandConfig.movable?: boolean`, avec `movableState` (0 = avancée sur le terrain, 1 = reculée).
- Toute la tribune basse recule sur des rails (environ 15 m), découvrant une piste d'athlétisme.
- Si `hasTrack` et `movable`, la position avancée est interdite (elle chevaucherait la piste).
- Différent de `seatingType = 'telescopic'`, qui ne replie que quelques rangs.

### E4. Arche d'entrée monumentale et portes (Chaban-Delmas, Gerland, Toulouse)

Nouveaux types d'objet placé :
- `'monumental_arch'` : grande arche en béton armé au-dessus d'une entrée (portée et hauteur réglables).
- `'monumental_gate'` : porte d'entrée classique à pilastres (style années 1920-1930).
Les deux se placent sur le périmètre du site, avec `mount = 'free'`.

### E5. Forme « Art déco / années 30 » (troisième génération, Magne) [UQAM]

Nouveau `StadiumShape` : `'heritage_bowl'`.
- Bol ovale peu pentu, autour d'une piste ; tribune principale couverte en porte-à-faux béton
  (Chaban-Delmas, 1938, sans aucun poteau), les autres côtés découverts.
- Preset associé qui combine E1 + E4 + C6.

---

## Lot F — Presets de référence

Un preset par stade, nommé de façon générique, qui sert de démo et de test de non-régression :

| Preset | Combine |
|---|---|
| Arène à toit coulissant (Lille) | B `slide_longitudinal` + E2 `half_lift` + D1 `polycarbonate_facade` |
| Toit sur mâts (Stade de France) | C9 + E3 |
| Portiques béton (Parc des Princes) | C3 |
| Résille bois (Nice) | C4 |
| Dentelle BFUP (Jean Bouin) | C5 + D1 `uhpc_lace_panels` |
| Quatre tribunes et méga-poutres (Lens) | `english_rectangular` + C2 sans treillis |
| Treillis 3D (Vélodrome) | C2 + treillis + couverture qui monte |
| Fermes à contre-poids (Lyon) | C1 |
| Forêt de poteaux (Bordeaux) | C10 + D4 |
| Arène fermée (La Défense) | C8 + D1 `precast_concrete_scales` + D3 |
| Vélodrome années 30 (Bordeaux 1938) | E5 |
| Mât incliné (Montréal) | C7 + B `fold_central` |
| Toit empilable (Rogers Centre) | B `combined_stack` |

---

## Ordre d'implémentation proposé

1. **Lot A + B** : toits rétractables (implémente aussi `petal_iris`) ; c'est le plus gros manque.
2. **Lot C2, C1, C8, C3** : les structures porteuses du toit (`corner_pylons` en premier).
3. **Lot D** : matériaux et motifs (nécessaires à C4 et C5).
4. **Lot C4, C5, C6, C7, C9, C10**.
5. **Lot E** : piste cycliste, pelouse et tribunes mobiles, entrées monumentales, `heritage_bowl`.
6. **Lot F** : presets, en dernier, une fois toutes les briques en place.

Chaque étape se termine par `tsc`, les tests vitest et une vérification visuelle dans le navigateur
avant le commit.

## Hors périmètre

- Le mémoire UQAM porte surtout sur l'urbanisme autour du stade (îlots, voirie, régénération
  du quartier). Le réseau de rues et le bâti voisin ne sont pas couverts par cette spec ;
  `site.setting` (`urban`, `esplanade`, `park`, `parking`) reste la seule option de quartier.
- Les stades de baseball nord-américains (forme en diamant) : géométrie de terrain différente,
  hors du périmètre football/rugby de l'app.
