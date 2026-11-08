# Outils

## Livre photo imprimable (`livre-print.html` et `livre.pdf`)

`livre/recit.json` est la seule source des textes : titres et récits des jours,
phrase « chiffres », goûts, mot de la fin. Les cases « En chiffres » et les
pastilles du trajet (« 580 km en Fiat 500c », « près de 81 km à pied ») sont
recalculées à partir de la phrase `chiffres`.

Pour mettre le livre à jour :

1. modifier `livre/recit.json` ;
2. lancer depuis la racine du dépôt :

   ```sh
   node outils/livre-print.mjs --pdf
   ```

La commande réécrit `livre-print.html`, puis imprime `livre.pdf` (33 pages A4
paysage) avec Chromium. Sans `--pdf`, seul le HTML est régénéré.

Pour le PDF, les photos sont réduites à la volée (200 ppi à la taille affichée,
JPEG qualité 80) dans un dossier temporaire, effacé à la fin. Aucune image n'est
ajoutée au dépôt. Options : `--ppi=250`, `--qualite=85`, ou `--originaux` pour
garder les photos d'origine.

Prérequis : Node, Playwright avec Chromium (`require('playwright')`), python3 et
Pillow pour la réduction des photos (sans eux, les originaux sont utilisés), et
un accès réseau aux polices Google Fonts.

### Fichiers

- `livre/print-pages.json` : ordre des pages et choix des photos (fichier de
  `photos/album/` + légende). Types de pages : `couverture`, `trajet`, `jour`
  (sous-pages `ouverture`, `g3`, `g4`, `g6`, `polaroids`), `gouts`, `chiffres`,
  `dos`. Un jour sans sous-pages devient une page « à suivre… » construite avec
  son récit.
- `livre/print-template.html` : `<head>`, CSS, barre de navigation et script de
  zoom. Les pages sont insérées à la place de `{{pages}}`.
- `livre/print-carte.html` : carte SVG de la page « Notre trajet ».
- `logo.svg` : logo repris tel quel, sans son animation.
