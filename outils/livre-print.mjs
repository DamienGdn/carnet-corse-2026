#!/usr/bin/env node
// Reconstruit livre-print.html (livre photo A4 paysage) à partir de :
//   livre/print-template.html  : <head>, CSS, barre de navigation, script de zoom
//   livre/print-pages.json     : ordre des pages et choix des photos (+ légendes)
//   livre/recit.json           : textes (titres et récits des jours, chiffres, goûts, mot de la fin)
//   photos/album.json          : dimensions des photos (attribut data-r)
//   logo.svg, livre/print-carte.html : logo et carte du trajet, insérés tels quels
//
// Le rendu des pages est dans livre/rendu.mjs (partagé avec l'éditeur editeur.html).
//
// Usage : node outils/livre-print.mjs              -> écrit livre-print.html
//         ... --pdf          -> imprime aussi livre.pdf (écran : photos réduites, léger)
//         ... --imprimerie   -> imprime aussi livre-imprimerie.pdf : photos d'origine, 3 mm de
//                               fond perdu, TrimBox/BleedBox renseignées (python3 + pypdf)
//         ... --traits       -> avec --imprimerie : ajoute livre-imprimerie-traits.pdf (traits de coupe)
// Options PDF écran : --ppi=200 (résolution visée), --qualite=80 (JPEG), --originaux (sans réduction)

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => fs.readFileSync(path.join(RACINE, p), 'utf8');
const lireJSON = (p) => JSON.parse(lire(p));

const args = process.argv.slice(2);
const opt = (nom, def) => {
  const a = args.find((x) => x.startsWith(`--${nom}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const AVEC_PDF = args.includes('--pdf');
const IMPRIMERIE = args.includes('--imprimerie');
const TRAITS = args.includes('--traits');
const ORIGINAUX = args.includes('--originaux');
const PPI = opt('ppi', 200);
const QUALITE = opt('qualite', 80);

// ---------- rendu ----------
const { rendreLivre, stylesImpression, FORMAT } = await import(new URL('../livre/rendu.mjs', import.meta.url));
const mise = lireJSON('livre/print-pages.json');
const donnees = {
  mise,
  recit: lireJSON('livre/recit.json'),
  album: lireJSON('photos/album.json'),
  logo: lire('logo.svg'),
  cartes: Object.fromEntries(mise.pages.filter((p) => p.carte).map((p) => [p.carte, lire(p.carte)])),
};
const gabarit = lire('livre/print-template.html');

function construire(o = {}) {
  const r = rendreLivre(donnees, o);
  for (const f of r.photos) if (!fs.existsSync(path.join(RACINE, 'photos/album', f))) r.erreurs.push(`photos/album/${f} : fichier absent`);
  if (r.erreurs.length) {
    console.error('Erreurs :\n  ' + [...new Set(r.erreurs)].join('\n  '));
    process.exit(1);
  }
  let html = gabarit.replace('{{styles}}', () => stylesImpression(o)).replace('{{pages}}', () => r.html + '\n');
  if (o.imprimerie) html = html.replace('<html lang="fr">', `<html lang="fr" class="imprimerie${o.traits ? ' traits' : ''}">`);
  return { html, n: r.sections.length, photos: r.photos, avert: r.avert };
}

const ecran = construire();
[...new Set(ecran.avert)].forEach((a) => console.warn('Attention : ' + a));
fs.writeFileSync(path.join(RACINE, 'livre-print.html'), ecran.html);
const nbPages = ecran.n;
console.log(`livre-print.html écrit : ${nbPages} pages, ${ecran.photos.size} photos.`);

// ---------- PDF ----------
function chargerPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' });
  const g = r.stdout && r.stdout.trim();
  if (g) try { return req(path.join(g, 'playwright')); } catch {}
  console.error('playwright introuvable (npm i -g playwright && npx playwright install chromium)');
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// Petit serveur statique du dépôt ; les photos réduites (si présentes) remplacent les originaux.
function serveur(reduites) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const nom = p.startsWith('/photos/album/') ? path.basename(p) : null;
    const fichier = nom && reduites.has(nom) ? reduites.get(nom) : path.join(RACINE, path.normalize(p));
    if (!fichier.startsWith(RACINE) && !(nom && reduites.has(nom))) { res.writeHead(403); return res.end(); }
    fs.readFile(fichier, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

async function ouvrir(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  await pg.emulateMedia({ media: 'print' });
  await pg.goto(url, { waitUntil: 'networkidle' });
  await pg.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((im) => (im.complete ? null
      : new Promise((ok) => { im.onload = im.onerror = ok; }))));
  });
  const ko = await pg.evaluate(() => [...document.images].filter((im) => !im.naturalWidth).map((im) => im.getAttribute('src')));
  if (ko.length) throw new Error('images non chargées : ' + ko.join(', '));
  const polices = await pg.evaluate(() => ['700 16px Caveat', '600 16px Fredoka', '800 16px Nunito'].filter((f) => !document.fonts.check(f)));
  if (polices.length) console.warn('Attention : polices non chargées (réseau ?) : ' + polices.join(', '));
  return { ctx, pg };
}

// Taille utile de chaque photo : boîte affichée (object-fit: cover) à PPI points par pouce, sans dépasser l'original.
async function mesurer(pg) {
  const boites = await pg.evaluate(() => [...document.querySelectorAll('.page img')].map((im) => ({
    f: decodeURIComponent(im.getAttribute('src').split('/').pop()), bw: im.clientWidth, bh: im.clientHeight,
    nw: im.naturalWidth, nh: im.naturalHeight })));
  const besoin = new Map();
  for (const b of boites) {
    const s = Math.max(b.bw / b.nw, b.bh / b.nh) * (PPI / 96); // 96 px CSS par pouce
    const w = Math.min(b.nw, Math.ceil(b.nw * s)), h = Math.min(b.nh, Math.ceil(b.nh * s));
    const prev = besoin.get(b.f);
    if (!prev || w > prev.w) besoin.set(b.f, { w, h, nw: b.nw, nh: b.nh });
  }
  return besoin;
}

const PY_REDUIRE = `
import json, sys
from PIL import Image, ImageOps
for t in json.load(sys.stdin):
    im = ImageOps.exif_transpose(Image.open(t['src']))
    icc = im.info.get('icc_profile')
    im = im.convert('RGB')
    if (t['w'], t['h']) != im.size:
        im = im.resize((t['w'], t['h']), Image.LANCZOS)
    kw = dict(quality=t['q'], optimize=True, progressive=True)
    if icc: kw['icc_profile'] = icc
    im.save(t['dst'], 'JPEG', **kw)
`;

function reduire(besoin, dossier) {
  const taches = [...besoin].map(([f, b]) => ({ src: path.join(RACINE, 'photos/album', f), dst: path.join(dossier, f), w: b.w, h: b.h, q: QUALITE }));
  const r = spawnSync('python3', ['-c', PY_REDUIRE], { input: JSON.stringify(taches), encoding: 'utf8' });
  if (r.status !== 0) {
    console.warn('Attention : réduction des photos impossible (python3 + Pillow ?), photos d\'origine utilisées.\n' + (r.stderr || r.error || ''));
    return new Map();
  }
  const reduites = new Map();
  for (const t of taches) {
    const orig = fs.statSync(t.src).size, red = fs.statSync(t.dst).size;
    if (red < orig) reduites.set(path.basename(t.src), t.dst); // sinon on garde l'original
  }
  return reduites;
}

async function faireLePDF(nbAttendu) {
  const { chromium } = chargerPlaywright();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'livre-print-'));
  const reduites = new Map();
  const srv = await serveur(reduites);
  const url = `http://127.0.0.1:${srv.address().port}/livre-print.html`;
  const browser = await chromium.launch();
  try {
    if (!ORIGINAUX) {
      const { ctx, pg } = await ouvrir(browser, url);
      const besoin = await mesurer(pg);
      await ctx.close();
      for (const [f, d] of reduire(besoin, tmp)) reduites.set(f, d);
      console.log(`Photos réduites pour le PDF : ${reduites.size}/${besoin.size} (${PPI} ppi, JPEG q${QUALITE}).`);
    }
    const { ctx, pg } = await ouvrir(browser, url);
    const sortie = path.join(RACINE, 'livre.pdf');
    await pg.pdf({ path: sortie, preferCSSPageSize: true, printBackground: true, tagged: true });
    await ctx.close();
    const ko = (fs.readFileSync(sortie, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(`livre.pdf écrit : ${(fs.statSync(sortie).size / 1048576).toFixed(1)} Mo, ${ko} pages.`);
    if (ko !== nbAttendu) console.warn(`Attention : ${ko} pages dans le PDF, ${nbAttendu} attendues.`);
  } finally {
    await browser.close();
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- PDF imprimerie : photos d'origine, fond perdu, boîtes PDF ----------
// MediaBox = page complète ; BleedBox = format fini + 3 mm ; TrimBox = format fini (297 × 210 mm).
const PY_BOITES = `
import sys
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
src, perdu_mm, marge_mm, titre = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
pt = lambda mm: mm * 72 / 25.4
r = PdfReader(src); w = PdfWriter(clone_from=r)
for page in w.pages:
    W, H = float(page.mediabox.width), float(page.mediabox.height)
    m, b = pt(marge_mm), pt(marge_mm + perdu_mm)
    page.bleedbox = RectangleObject([m, m, W - m, H - m])
    page.trimbox = RectangleObject([b, b, W - b, H - b])
    page.cropbox = RectangleObject([0, 0, W, H])
w.add_metadata({'/Title': titre})
w.write(src)
`;

async function faireImprimerie(traits) {
  const { chromium } = chargerPlaywright();
  const nom = traits ? 'livre-imprimerie-traits.pdf' : 'livre-imprimerie.pdf';
  const temp = path.join(RACINE, `.livre-imprimerie-${process.pid}.html`);
  const { html, n } = construire({ imprimerie: true, traits });
  fs.writeFileSync(temp, html);
  const srv = await serveur(new Map());
  const browser = await chromium.launch();
  try {
    const { ctx, pg } = await ouvrir(browser, `http://127.0.0.1:${srv.address().port}/${path.basename(temp)}`);
    const sortie = path.join(RACINE, nom);
    await pg.pdf({ path: sortie, preferCSSPageSize: true, printBackground: true, tagged: true });
    await ctx.close();
    const r = spawnSync('python3', ['-c', PY_BOITES, sortie, String(FORMAT.perdu), String(traits ? FORMAT.marge : 0), 'Livre photo — Corse 2026 (imprimerie)'], { encoding: 'utf8' });
    if (r.status !== 0) console.warn('Attention : TrimBox/BleedBox non écrites (python3 + pypdf ?)\n' + (r.stderr || r.error || ''));
    const ko = (fs.readFileSync(sortie, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    const bord = FORMAT.perdu + (traits ? FORMAT.marge : 0);
    console.log(`${nom} écrit : ${(fs.statSync(sortie).size / 1048576).toFixed(1)} Mo, ${ko} pages, ${FORMAT.l + 2 * bord} × ${FORMAT.h + 2 * bord} mm (format fini ${FORMAT.l} × ${FORMAT.h} mm + ${FORMAT.perdu} mm de fond perdu${traits ? ' + traits de coupe' : ''}), photos d'origine.`);
    if (ko !== n) console.warn(`Attention : ${ko} pages dans le PDF, ${n} attendues.`);
  } finally {
    await browser.close();
    srv.close();
    fs.unlinkSync(temp);
  }
}

if (AVEC_PDF) await faireLePDF(nbPages);
if (IMPRIMERIE) {
  await faireImprimerie(false);
  if (TRAITS) await faireImprimerie(true);
}
