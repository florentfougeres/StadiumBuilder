# StadiumForge

Éditeur paramétrique 3D de stades de football, entièrement dans le navigateur.
On règle la forme de l'enceinte, les tribunes, la toiture et les équipements ; la maquette 3D,
la capacité, les lignes de vue et une estimation de coût se recalculent en temps réel.

**Démo en ligne :** https://florentfougeres.github.io/StadiumBuilder/

## Fonctionnalités

- **11 morphologies d'enceinte** : bol moderne, bol circulaire, chaudron, ovale olympique avec piste,
  bol enterré, arène octogonale, stade urbain compact, rectangulaire à l'anglaise, 4 tribunes, fer à
  cheval, tribunes en arc de cercle (cintrées vers le centre, coins ouverts).
- **Tribunes paramétriques** (nord, sud, est, ouest) : rangs, 1 à 5 niveaux, pente, profondeur de
  rang, hauteur de contremarche, largeur de siège, allées, loges VIP, places debout ou modules
  télescopiques. Chaque rang porte de vrais sièges 3D, avec allées et couleurs alternées par niveau.
  Chaque tribune se règle seule, ou les quatre à la fois (onglet « Toutes »). Avec une piste, le
  recul se mesure depuis la piste et peut descendre à 0 m.
- **Hauteur du premier rang** par tribune : la tribune peut démarrer au-dessus du terrain, derrière
  un mur de front plus haut.
- **Gradins réalistes** par tribune : pente constante ou progressive (rangs bas plus plats, rangs
  hauts plus raides, même hauteur), coursive transversale dans le premier niveau (position et
  largeur réglables), bancs de touche encastrés dans le mur de front, tribune de presse avec
  pupitres et écrans.
- **Barrière de bord de terrain** : vitre basse, ou grillage anti-envahissement de hauteur réglable.
- **Accès véhicule dans les coins** : ouverture sous les gradins d'un coin fermé (rangs bas
  retirés, dalle-pont au-dessus, gabarit 4,6 m) ; la capacité retire les places perdues.
- **Coursive extérieure** réglable (profondeur et hauteur) : socle bas ou façade continue autour des
  gradins.
- **15 systèmes de toiture** : porte-à-faux, poteaux, poutre-portique, charpente treillis,
  haubané sur mâts, arche géante, arches jumelles, bi-poutres lenticulaires, roue de vélo, résille
  tendue, coque enveloppante, couronne voûtée, toiture plissée, toit rétractable (panneaux ouverts /
  fermés), dôme fixe. Les toitures globales suivent le contour du stade et peuvent ne couvrir que
  certaines tribunes ; les styles par tribune sont surchargeables.
- **Indicateurs en direct** : capacité, rangs moyens, emprise au sol, C-value (qualité des lignes
  de vue), hauteur maximale et coût estimé.
- **Équipements 3D** déplaçables : écrans, projecteurs, bancs de touche, vestiaires, boutiques,
  parkings, parvis, clôtures. Les écrans géants se fixent sous le toit ou en haut d'une tribune.
- **Caméras** : drone, bord terrain, vue siège, coupe 3D et plan 2D ; éclairage jour, crépuscule,
  nuit avec ciel physique (diffusion atmosphérique, nuages), occlusion ambiante et halo des
  projecteurs.
- **Détail architectural** : toitures à nervures et rives épaisses, façades en mur-rideau (montants,
  nez de dalle) et peau de lames fermant l'espace entre façade et toit.
- **Fenêtre d'exemples** au premier lancement (et via « Exemples ») : 16 stades types avec aperçu
  3D, annuler / rétablir, sauvegarde automatique locale (IndexedDB).
- **Exports** : PNG, image photoréaliste en lancer de rayons (three-gpu-pathtracer), plan PDF,
  projet JSON et maquette GLB.

## Stack

React 19, TypeScript, Vite, Three.js, Zustand, Dexie (IndexedDB), Tailwind CSS, jsPDF, Vitest.
L'application est 100 % statique : aucun serveur ni clé d'API n'est nécessaire.

## Lancer en local

Prérequis : [Node.js](https://nodejs.org/) 20 ou plus récent (npm est fourni avec).

```bash
git clone git@github.com:florentfougeres/StadiumBuilder.git
cd StadiumBuilder
npm install
npm run dev
```

L'éditeur est alors disponible sur http://localhost:3000.

Autres commandes :

| Commande          | Rôle                                           |
| ----------------- | ---------------------------------------------- |
| `npm run dev`     | Serveur de développement avec rechargement     |
| `npm run build`   | Build de production dans `dist/`               |
| `npm run preview` | Sert le build de production localement         |
| `npm run lint`    | Vérification des types TypeScript              |
| `npm test`        | Tests unitaires du moteur de génération        |

## Structure

```
src/
  stadium/   moteur paramétrique : schéma, préréglages, génération 3D (tribunes, toits,
             pelouse, éclairage), capacité, lignes de vue, matériaux
  editor/    interface : viewport 3D, inspecteur, barre d'outils, liste d'objets, exports
  export/    exports PNG, PDF et GLB
  state/     store Zustand, historique annuler/rétablir, persistance IndexedDB
```

## Déploiement

Chaque push sur `main` déclenche le workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) : vérification des types, tests,
build, puis publication sur GitHub Pages.

Configuration à faire une seule fois sur GitHub : **Settings → Pages → Build and deployment →
Source : GitHub Actions**.
