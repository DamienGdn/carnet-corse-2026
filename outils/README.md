# Outils du livre photo

Le livre imprimable est décrit par deux fichiers, qui sont la seule « base de données » du livre :

- `livre/print-pages.json` : les pages, leur mise en page, leurs photos et leurs réglages
  (fond, rotation, zoom, cadrage, légendes) ;
- `livre/recit.json` : les textes (titres et récits des jours, chiffres, goûts, mot de la fin).

Tout le reste est fabriqué à partir de ces deux fichiers : `livre-print.html` (version écran),
`livre.pdf` (PDF léger) et les PDF pour l'imprimeur.

## Modifier le livre : l'éditeur

Ouvrir `editeur.html` sur le site (bouton « ✏️ Éditer » du livre imprimable). On peut :

- ajouter, dupliquer, réordonner et supprimer des pages dans chaque jour ;
- changer la mise en page d'une page (ouverture, 1, 2, 3, 4 ou 6 photos, polaroïds, texte) ;
- choisir le fond de chaque page (palette ou couleur libre), pour une page, un jour ou tout le livre ;
- changer une photo, la tourner d'un quart de tour, zoomer, recadrer en la faisant glisser,
  incliner les polaroïds, modifier la légende ;
- modifier les textes (titres et récits des jours, couverture, trajet, goûts, chiffres, fin).

L'éditeur indique pour chaque photo sa résolution d'impression : au-dessus de 220 ppi c'est
parfait, sous 150 ppi elle sera floue une fois imprimée (photo trop agrandie). Les photos du dépôt
font 1 600 px de large : une photo pleine page (297 mm) ne dépasse pas ~137 ppi.

Le brouillon est enregistré automatiquement dans le navigateur (« ⋯ Fichier » pour l'exporter,
l'importer ou revenir à la version publiée). « ⬆ Publier » envoie les deux fichiers JSON sur GitHub
en un seul commit ; GitHub Actions reconstruit alors le site et les PDF (2 à 4 minutes).

### À faire une seule fois

1. **Publication du site par GitHub Actions** : sur GitHub, *Settings › Pages › Build and
   deployment › Source* = **GitHub Actions**. Sans ce réglage, le site reste servi tel quel depuis la
   branche `main` et les PDF ne sont pas reconstruits après une publication depuis l'éditeur.
2. **Clé pour publier depuis l'éditeur** (sur chaque appareil qui publie) : *github.com › Settings ›
   Developer settings › Fine-grained tokens › Generate new token*, accès au seul dépôt
   `carnet-corse-2026`, permission **Contents : Read and write**. L'éditeur la demande au premier
   « Publier » et la garde uniquement dans ce navigateur.

## PDF pour l'imprimeur

| Fichier | Contenu |
| --- | --- |
| `livre.pdf` | version écran, photos réduites (~11 Mo) |
| `livre-imprimerie.pdf` | photos d'origine, A4 paysage 297 × 210 mm + **3 mm de fond perdu** (303 × 216 mm), TrimBox et BleedBox renseignées |
| `livre-imprimerie-traits.pdf` | idem avec **traits de coupe** dans une marge de 7 mm (317 × 230 mm) |

Les PDF imprimerie sont fabriqués par GitHub Actions et publiés sur le site (bouton « 🖨️ PDF
imprimerie » du livre imprimable) ; ils ne sont pas versionnés dans le dépôt. L'éditeur sait aussi
produire le PDF imprimerie depuis le navigateur (« 🖨️ PDF imprimerie » : *Enregistrer au format
PDF*, marges *Aucune*, *Graphiques d'arrière-plan* cochés).

Couleurs : les PDF sont en RVB (sRGB). La plupart des services d'impression photo les acceptent ;
un imprimeur offset qui exige du CMJN fera la conversion avec son profil (ou la demander).

## En ligne de commande

```sh
node outils/livre-print.mjs                          # livre-print.html
node outils/livre-print.mjs --pdf                    # + livre.pdf (léger)
node outils/livre-print.mjs --imprimerie --traits    # + les deux PDF imprimerie
```

Prérequis : Node, Playwright avec Chromium (`require('playwright')`), python3 avec Pillow (réduction
des photos du PDF léger) et pypdf (boîtes TrimBox/BleedBox), accès réseau à Google Fonts.
Options du PDF léger : `--ppi=200`, `--qualite=80`, `--originaux`.

## Fichiers

- `livre/rendu.mjs` : moteur de rendu des pages, partagé par la commande et par l'éditeur.
- `livre/livre.css` : styles du livre (écran, impression, fond perdu, traits de coupe).
- `livre/print-template.html` : squelette de `livre-print.html` (`{{styles}}`, `{{pages}}`).
- `livre/print-carte.html` : carte SVG de la page « Notre trajet ».
- `livre/editeur.mjs` et `editeur.html` : l'éditeur.
- `.github/workflows/site.yml` : construction et publication du site sur GitHub Pages.
