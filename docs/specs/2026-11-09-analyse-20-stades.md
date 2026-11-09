# Analyse — 20 stades réels face au builder

Date : 2026-11-09
Base de comparaison : `main` @ `ab9845a` (43 toits dans `roofCatalog.ts`, 15 formes dans `shapeCatalog.ts`,
8 enveloppes + 3 profils, 23 matériaux de façade, 12 de toit, 13 de structure, 6 modes de coin).

Légende : ✅ reproductible tel quel · 🟡 approchant (silhouette juste, signature manquante) · ❌ pas reproductible.
Les caractéristiques viennent des fiches Wikipédia fournies et de connaissances générales ; les
chiffres (capacité, dates) sont indicatifs.

---

## 1. Fiches

| # | Stade | Forme / tribunes | Toit | Façade / matériaux | Signature | Verdict | Ce qui manque |
|---|---|---|---|---|---|---|---|
| 1 | **Stade national, Varsovie** (58 k, 2012) | Bol ovale 2 anneaux, posé sur l'ancien talus du stade de 1955 | Couronne fixe en porte-à-faux + toit rétractable en membrane qui se replie vers une **flèche centrale suspendue au-dessus de la pelouse** (roue de vélo) | Résille de **panneaux tressés rouges et blancs** (couleurs nationales), effet panier | Aiguille centrale, peau bicolore tressée | 🟡 | Mât central suspendu (on n'a que le mât incliné *hors* du bol, `suspensionMast`) ; motif tressé bicolore |
| 2 | **Gazprom Arena, Saint-Pétersbourg** (68 k, 2017) | Bol circulaire sur une butte artificielle au bord de l'eau | Toit fixe avec **panneaux coulissants**, porté par **8 pylônes inclinés** disposés autour du bol | Mur-rideau vitré **incliné vers l'intérieur** (soucoupe), pylônes blancs | Pelouse amovible, silhouette de vaisseau | 🟡 | Rétractable combiné à des pylônes périphériques ; profil d'enveloppe en cône inversé ; butte paysagère ; bord de l'eau |
| 3 | **Puskás Aréna, Budapest** (67 k, 2019) | Bol ovale 3 niveaux | Couronne en porte-à-faux sur anneau de compression, membrane translucide côté pelouse | **Lames verticales métalliques** argentées qui enveloppent façade *et* toit d'un seul geste ; socle vitré en retrait avec colonnade | Continuité façade → toit | ✅/🟡 | Façade qui remonte sur le toit (la peau s'arrête au bord) ; socle en retrait sous la peau |
| 4 | **Geórgios-Karaïskákis, Le Pirée** (33 k, 2004) | Rectangulaire, 1 niveau, coins fermés | Porte-à-faux sur fermes apparentes | Bardage **rouge** à nervures blanches, sièges rouges | Compact, très proche de la pelouse | ✅ | — (`compact_urban` + `cantilever` + `perforated_red_metal`) |
| 5 | **Basra Sports City** (65 k, 2013) | Bol ovale 2 niveaux, entouré d'un **plan d'eau** | Couronne en porte-à-faux | **Colonnade en palmiers** : poteaux qui s'ouvrent en palmes et portent la toiture | Palmiers dattiers stylisés, douves | 🟡 | Colonne en palmier (la `colonnade_forest` fait des fûts droits) ; plan d'eau autour du site |
| 6 | **RCDE Stadium, Cornellà** (40 k, 2009) | Rectangulaire, coins fermés, 2 niveaux | Porte-à-faux, panneaux photovoltaïques | **Panneaux polycarbonate multicolores** (bleus, blancs, translucides) dispersés au hasard, rétroéclairés | Façade « pixels » | 🟡 | Mosaïque de panneaux multicolores aléatoires (le polycarbonate est monochrome) |
| 7 | **El Sadar, Pampelune** (23 k, rénové 2021) | Rectangulaire, 4 tribunes raides, coins fermés | Porte-à-faux continu | **Lames rouges ondulées / perforées** posées devant l'ancien béton | Rouge Osasuna, façade-écran neuve devant l'existant | ✅ | — (`louver_curtain` + `perforated_red_metal`) |
| 8 | **Groupama Stadium, Décines** (59 k, 2016) | Rectangle aux angles arrondis fermés, 2 niveaux | Toit sur poutres, bande de **polycarbonate** côté pelouse, PV | **Structure apparente** : poteaux inclinés noirs, coursives ouvertes, toit en débord | Toit qui déborde loin au-dessus du parvis | ✅ | — (`rounded_rectangle` + `exposed_structure` + `anthracite_steel`) |
| 9 | **De Kuip (Feyenoord), Rotterdam** (51 k, 1937) | Ovale arrondi 2 niveaux, **anneau supérieur en encorbellement sans poteaux** (la « cuve ») | Toit ajouté en 1994 sur poteaux | **Ossature acier apparente** avec **escaliers extérieurs en zigzag** sur toute la façade | Escaliers extérieurs, rivets, années 1930 | 🟡 | Escaliers extérieurs en zigzag / tours d'escaliers ; façades par tribune d'époques différentes |
| 10 | **3Arena (ex-Tele2), Stockholm** (30-40 k, 2013) | Rectangulaire compact, coins fermés | Toit fixe + **panneau central coulissant** | Boîte sombre, **façade LED** | Toit rétractable de salle | ✅ | — (`retractable` slide + `media_mesh`) |
| 11 | **Etihad Stadium, Manchester** (53 k, 2002) | Bol rectangle arrondi, 3 niveaux (anneau ajouté au nord et au sud) | Toit **haubané sur 12 mâts extérieurs** avec câbles | **Tours à rampes hélicoïdales** dans les coins et le long des façades, verre et acier | Mâts + rampes | ✅ | — (`suspended_masts` + coins `spiral_tower`) ; à vérifier : hauteurs de toit différentes selon les tribunes |
| 12 | **Amex (Falmer), Brighton** (31 k, 2011) | 2 tribunes latérales hautes, virages plus bas, **crête en arc** | Une **arche tubulaire** par tribune latérale, toit en croissant vu de côté | Verre et bardage gris, arches blanches | Silhouette en croissant | ✅/🟡 | Vérifier le couplage `twin_arch` + `crestProfile: arch_crest` sur des virages plus bas |
| 13 | **San Siro, Milan** (75 k, 1926/1990) | Rectangle arrondi 3 niveaux | **Poutres rouges** en treillis portées par **4 tours cylindriques d'angle** | **11 tours à rampes hélicoïdales** en béton autour du stade | Rampes + poutres rouges | ✅ | — (`helical_ramps` + `girder_grid` / `corner_pylons` + `red_lacquer_steel`) ; vérifier des pylônes cylindriques en béton |
| 14 | **Lumen Field, Seattle** (68 k, 2002) | **Fer à cheval** : bout nord ouvert vers la ville, gradins bas + écran | **2 toits latéraux** portés par des arches en treillis, ~70 % des sièges couverts | Acier apparent, brique | Bout ouvert, toits sur arches | 🟡 | Toit par tribune limité aux latérales sur un fer à cheval ; arche porteuse par tribune (et pas une arche commune) |
| 15 | **NRG Stadium, Houston** (72 k, 2002) | Rectangulaire, coins fermés | **Toit rétractable** en 2 panneaux de membrane qui glissent vers les bouts sur des méga-poutres | Boîte vitrée et bardage | Premier toit rétractable de la NFL | ✅ | — (`retractable` `slide_longitudinal` + membrane + `spanning_girders`) |
| 16 | **New Highmark Stadium, Orchard Park** (62 k, 2026) | Bol rectangulaire très raide, gradins au plus près | **Auvent partiel** (~65 % des sièges) sur portiques acier, ciel ouvert au centre | Brique, pierre et acier apparent, esprit « heritage » | Raideur, froid et vent | ✅/🟡 | Façade brique sur une ossature acier apparente (enveloppe unique : soit l'une soit l'autre) |
| 17 | **Mané Garrincha, Brasília** (72 k, 2013) | Bol circulaire 3 niveaux | **Roue de vélo** tendue, membrane, anneau PV | **Forêt de 288 poteaux** en béton élancés | Colonnade monumentale | ✅ | — (`colonnade_forest` + `bicycle_wheel` + `solar_pv_panels`) |
| 18 | **Sky Stadium (« Cake Tin »), Wellington** (34 k, 2000) | **Ovale de cricket** (terrain bien plus grand qu'un rectangle de foot), bol bas | Couronne en porte-à-faux | **Bardage tôle argentée** ondulée, forme de boîte à gâteau | Terrain de cricket + rugby | 🟡 | Terrain de cricket ovale (carré central, pas de piste) ; bol qui suit l'ovale sans piste d'athlétisme |
| 19 | **Prince Moulay Abdellah, Rabat** (69 k, 2025) | Rectangulaire foot, très raide, 2 niveaux, coins fermés | Toit membrane blanc qui **descend jusqu'au sol** et devient façade | **Résille blanche plissée** (lames verticales pliées), lumière tamisée | Toit et façade d'un seul geste | 🟡 | Peau plissée continue toit → façade sur un plan rectangulaire |
| 20 | **FNB Stadium (Soccer City), Johannesburg** (94 k, 2009) | Bol ovale en **calebasse** bombée, 3 niveaux | Couronne sur anneau | **Mosaïque calebasse** en panneaux de béton fibré tons terre, **bandes noires** verticales, « feu » lumineux à la base | Calebasse | ✅ | — (`calabash_mosaic` + profil `bulging`) ; bandes noires et anneau lumineux en pied absents |

**Bilan** : 9 ✅, 3 ✅/🟡, 8 🟡, 0 ❌. Plus aucun des 20 n'est hors de portée. Les écarts sont des
**signatures** : mâts, colonnes ou escaliers particuliers, panneaux multicolores, continuité toit-façade.

---

## 2. Manques classés par catégorie

Classement par nombre de stades concernés, puis par impact visuel.

### A. Sièges — couleurs et motifs (demande directe)

Aujourd'hui (`seatPattern.ts` → `resolveSeatTierStyle`) :
- **global** : seulement `colors.seatsPrimary` / `seatsSecondary`, qui alternent par niveau, sans motif ;
- **niveau × tribune** : `stand.seatTiers[t]` (motif, couleur, accent, part, texte) ✅ ;
- **tribune entière** et **niveau entier sur tout le stade** : rien.

À faire : une cascade de styles à 4 échelles, du plus général au plus précis.
1. `doc.seatStyle` : style **global** (motif + couleurs) ;
2. `doc.seatTierStyles[t]` : **niveau t sur toutes les tribunes** ;
3. `stand.seatStyle` : **tribune entière** ;
4. `stand.seatTiers[t]` : **niveau × tribune** (existe).

`resolveSeatTierStyle` fusionne ces quatre échelles champ par champ (4 > 3 > 2 > 1). En l'absence des
nouveaux champs, on retombe sur l'alternance primaire/secondaire, donc les anciens projets restent
identiques. Dans l'Inspector, un sélecteur « Appliquer à : tout le stade / cette tribune / ce niveau
partout / ce niveau de cette tribune », avec un badge « personnalisé » et un bouton « hériter ».
Exemples : sièges rouges partout + « CITY » écrit sur la tribune nord (Etihad), niveau supérieur
d'une autre couleur sur tout le stade (San Siro).

### B. Toits (5 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Mât central suspendu au-dessus de la pelouse** pour le repli `fold_central` (aiguille tenue par des câbles depuis la couronne) | Varsovie | Option `suspensionMast: 'outside' \| 'central'` dans `retractablePanels.ts` |
| **Rétractable porté par des pylônes périphériques** : séparer la structure porteuse (pylônes, mâts, poutres) de la partie mobile | Gazprom (+ Amsterdam déjà en dur) | Ajouter `retractable` comme couche sur `corner_pylons` / `suspended_masts` plutôt que comme style à part |
| **Arche porteuse par tribune** sur des toits partiels (et non une arche commune au stade) | Lumen, Amex | Arche dans `standRoofs.ts` pilotée par `roofStyleOverride` |
| **Toit qui descend jusqu'au sol en devenant façade** sur plan rectangulaire | Rabat, Puskás | Prolonger `enveloping_shell` / `folded_plate` aux formes rectangulaires |
| Hauteurs de toit différentes par tribune dans un bol continu (anneau ajouté) | Etihad | À vérifier ; sinon `heightOffset` par tribune |

### C. Façades et enveloppes (8 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Enveloppe par tribune** (époques différentes, brique d'un côté, acier de l'autre) | Feyenoord, Highmark, El Sadar | `stand.envelopeStyleOverride` / `facadeMaterialOverride`, même modèle que `structureMaterialOverride` |
| **Escaliers extérieurs en zigzag / tours d'escaliers** | Feyenoord | Nouvelle enveloppe `external_stairs` dans `envelopes/` (même rail que `helicalRamps.ts`) |
| **Colonne en palmier** (fût qui s'ouvre en palmes sous la toiture) | Basra | Variante de fût dans `colonnadeForest.ts` (`columnShape: 'straight' \| 'palm' \| 'tree'`) |
| **Mosaïque multicolore aléatoire** de panneaux (palette de 2 à 4 teintes, rétroéclairage) | RCDE | `facadePalette: string[]` + motif `pixel_mosaic` dans `FacadePatternId` |
| **Motif tressé bicolore** (panier) | Varsovie | Motif `woven_basket` avec deux couleurs |
| **Profil incliné vers l'intérieur** (cône inversé, soucoupe) | Gazprom | `EnvelopeProfile: 'leaning_in'` |
| **Peau qui remonte sur le dessus du toit** | Puskás, Rabat | Voir B |
| **Socle vitré en retrait** sous la peau | Puskás | Option `plinthRecess` (m) sur l'enveloppe |
| Bandes verticales contrastées / anneau lumineux en pied | FNB | Option `accentStripes` + `baseGlow` |

### D. Formes et terrains (2 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Terrain de cricket ovale** (≈ 150 × 130 m, carré central, pas de piste) avec bol qui suit l'ovale | Wellington | Nouveau `PitchConfig.kind: 'cricket'` + forme `cricket_oval` dans `shapeCatalog.ts` |
| Bout ouvert du fer à cheval avec gradins bas + écran | Lumen | Vérifier que `horseshoe` accepte une tribune basse au bout ouvert |

### E. Site et abords (3 stades)

| Manque | Stades | Piste |
|---|---|---|
| **Plan d'eau** : douves, lac, bord de mer | Basra, Gazprom | `SiteSetting: 'waterfront' \| 'moat'` dans `generateSite.ts` |
| **Butte / talus paysager** autour du bol (pas le podium à murs droits) | Gazprom, Varsovie | `site.mound` (hauteur, pente) |

### F. Matériaux (peu de manques)

- Panneaux **rouges et blancs anodisés** (Varsovie) : couvert par le motif bicolore de C.
- **Lames argent** à reflets métalliques (Puskás) : `brushed_steel_mesh` approche ; une teinte
  « aluminium satiné » serait plus juste.
- Tout le reste est déjà couvert : polycarbonate, rouge perforé, tôle ondulée, calebasse, brique, verre.

---

## 3. Ordre proposé

1. **Sièges à 4 échelles** (A) : demandé, petit, sert à tous les stades.
2. **Enveloppe et matériau par tribune** (C1) : débloque Feyenoord, Highmark, El Sadar.
3. **Mosaïque multicolore + motif tressé** (C4, C5) : RCDE, Varsovie, peu de géométrie.
4. **Mât central suspendu + rétractable sur pylônes** (B1, B2) : Varsovie, Gazprom.
5. **Colonne palmier, escaliers zigzag, profil `leaning_in`** (C2, C3, C6).
6. **Terrain de cricket** (D1), **plan d'eau et butte** (E).
7. **Peau continue toit → façade sur rectangle** (B4) : la plus lourde, à faire en dernier.

Chaque lot ajoute un preset générique inspiré du stade (sans nom de marque) et un test de
construction de scène, comme dans la spec du 2026-11-03.

---

## 4. Statut (2026-11-09, fin de journée)

Fait :
- **A** Sièges à 4 échelles (stade, étage partout, tribune, étage d'une tribune).
- **B1** Aiguille centrale pour le toit replié au centre · **B2** pylônes porteurs autour des toits rétractables ·
  **B3** toit « Arche par tribune » (arche tubulaire, toit en croissant suspendu) ·
  **B4** déjà possible : coque intégrale, coque à facettes et coque en proue descendent jusqu'au sol sur les
  formes rectangulaires (`compact_urban`, `rounded_rectangle`) ; seule la couronne plissée s'arrête au toit.
- **C** Façade et revêtement par tribune · escaliers extérieurs · colonnes palmier · profil « soucoupe » ·
  mosaïque de pixels et tressage avec palette · socle vitré en retrait · bandes verticales sombres et anneau
  lumineux en pied (sur la façade ou sur la coursive extérieure).
- **D** Ovale de cricket (outfield, corde, carré, wicket, poteaux de rugby, gradins à pente progressive).
- **E** Douves, bord de l'eau, butte paysagère avec tranchées aux entrées.

Restes connus :
- Couronne plissée qui descendrait en façade (Rabat au plus juste) : pas faite.
- Le socle vitré ne s'applique pas quand une coursive extérieure forme la façade.
- Plusieurs presets ont des C-values négatives dans leurs étages supérieurs, indépendamment de ces ajouts.
