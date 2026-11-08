#!/usr/bin/env node
// Reconstruit livre-print.html (livre photo A4 paysage) à partir de :
//   livre/print-template.html  : <head>, CSS, barre de navigation, script de zoom
//   livre/print-pages.json     : ordre des pages et choix des photos (+ légendes)
//   livre/recit.json           : textes (titres et récits des jours, chiffres, goûts, mot de la fin)
//   photos/album.json          : dimensions des photos (attribut data-r)
//   logo.svg, livre/print-carte.html : logo et carte du trajet, insérés tels quels
//
// Usage : node outils/livre-print.mjs           -> écrit livre-print.html
//         node outils/livre-print.mjs --pdf     -> idem, puis imprime livre.pdf avec Chromium
// Options PDF : --ppi=200 (résolution visée pour les photos), --qualite=80 (JPEG)
//               --originaux (embarque les photos d'origine, sans réduction)

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
const ORIGINAUX = args.includes('--originaux');
const PPI = opt('ppi', 200);
const QUALITE = opt('qualite', 80);

// ---------- échappement (identique à html.escape de Python) ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const escT = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- données ----------
const recit = lireJSON('livre/recit.json');
const mise = lireJSON('livre/print-pages.json');
const album = new Map(lireJSON('photos/album.json').map((p) => [p.f, p]));
const erreurs = [];
const avert = [];

// Logo : logo.svg sans son <style> d'animation, avec la classe "logo".
const LOGO = lire('logo.svg').replace(/^<\?xml[^>]*>\s*/, '').replace(/<style>[\s\S]*?<\/style>/, '')
  .replace(/^<svg /, '<svg class="logo" ');

// « Près de 81 km à pied, 580 km en Fiat 500c, 8 baignades, un pique-nique chaque midi. »
const MOTS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };
const chiffres = String(recit.chiffres || '').trim().replace(/\.$/, '').split(/\s*,\s*/).filter(Boolean)
  .map((txt) => {
    const sansApprox = txt.replace(/^(près de|presque|environ|plus de|au moins)\s+/i, '');
    const m = sansApprox.match(/^(\d+(?:[.,]\d+)?|[a-zà-ü]+)\s+(.+)$/i);
    const n = m && (/^\d/.test(m[1]) ? m[1] : MOTS[m[1].toLowerCase()]);
    if (!n) erreurs.push(`recit.json « chiffres » : pas de nombre dans « ${txt} »`);
    return { txt, nombre: String(n ?? ''), libelle: m ? m[2] : txt };
  });
const minus1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

function jour(cle) {
  const j = recit.jours?.[cle];
  if (!j) { erreurs.push(`recit.json : jour « ${cle} » introuvable`); return { titre: cle, texte: '', dn: cle, h2: cle }; }
  const [dn, ...reste] = j.titre.split(' · ');
  return { ...j, dn, h2: reste.length ? reste.join(' · ') : j.titre };
}

function ratio(f) {
  const p = album.get(f);
  if (!p) { erreurs.push(`photos/album.json : photo « ${f} » absente`); return '1.0'; }
  if (!fs.existsSync(path.join(RACINE, 'photos/album', f))) erreurs.push(`photos/album/${f} : fichier absent`);
  const r = Math.round((p.w / p.h) * 100) / 100; // comme round(w/h, 2) en Python
  return Number.isInteger(r) ? `${r}.0` : String(r);
}

const photosUtilisees = new Set();
function figure({ f, c }, cls = '', style = '') {
  photosUtilisees.add(f);
  return `<figure class="${cls}" style="${style}" data-r="${ratio(f)}"><div class="im"><img src="photos/album/${f}" alt="${esc(c || '')}"></div><figcaption>${c ? esc(c) : '&nbsp;'}</figcaption></figure>`;
}
const ROT = ['-3deg', '2deg', '-2deg'];
const page = (cls, contenu) => `<section class="page ${cls}">${contenu}</section>`;

// ---------- pages ----------
const rendus = {
  couverture(p) {
    photosUtilisees.add(p.photo.f);
    ratio(p.photo.f);
    const h1 = recit.titre.replace(/\s+d['’].*$/, '');
    return page('cover', `<div class="cvr"><div class="cl"><div class="kick">${escT(p.surtitre)}</div><h1>${escT(h1)}</h1><div class="auth">d'${escT(recit.auteurs)}</div><div class="sub">${escT(recit.sousTitre)}</div>${LOGO}</div><div class="cr"><figure class="pol1"><div class="im"><img src="photos/album/${p.photo.f}" alt=""></div><figcaption>${escT(p.photo.c)}</figcaption></figure></div></div>`);
  },
  trajet(p) {
    const chips = (p.chips || []).map((mot) => {
      const c = chiffres.find((x) => x.txt.toLowerCase().includes(mot.toLowerCase()));
      if (!c) { erreurs.push(`trajet : aucun élément de « chiffres » ne contient « ${mot} »`); return ''; }
      return `<div class="chip">${escT(minus1(c.txt))}</div>`;
    }).join('');
    const carte = lire(p.carte).replace(/\s+$/, '');
    return page('', `<div class="trj"><div class="tl"><h2>${escT(p.titre)}</h2><p>${escT(p.texte)}</p>${chips}</div><div class="tr">${carte}</div></div>`);
  },
  jour(p) {
    const j = jour(p.jour);
    const sous = p.pages || [];
    const avecPhotos = [...album.values()].some((x) => x.jour === p.jour);
    if (!sous.length) {
      if (avecPhotos) avert.push(`${p.jour} : l'album contient des photos mais print-pages.json n'a pas de mise en page -> page « à suivre »`);
      return page('soonp', `<div class="soon"><div class="dn">${esc(j.dn)}</div><h2>${esc(j.h2)}</h2><div class="hand">à suivre…</div><p class="recit">${esc(j.texte)}</p><div class="blank">Les photos de ce jour arrivent bientôt.</div></div>`);
    }
    return sous.map((s) => {
      const ph = `<div class="ph">${esc(j.titre)}</div>`;
      switch (s.type) {
        case 'ouverture':
          return page('op', `<div class="open"><div class="ot"><div class="dn">${esc(j.dn)}</div><h2>${esc(j.h2)}</h2><p class="recit">${esc(j.texte)}</p>${LOGO}</div><div class="oi">${figure(s.photo, 'big')}</div></div>`);
        case 'g3': case 'g4': case 'g6':
          return page('pp', `${ph}<div class="grid ${s.type}">${s.photos.map((x) => figure(x)).join('')}</div>`);
        case 'polaroids':
          return page('pp', `${ph}<div class="pol">${s.photos.map((x, i) => figure(x, 'polc', `--r:${ROT[i % ROT.length]}`)).join('')}</div>`);
        default:
          erreurs.push(`${p.jour} : type de page inconnu « ${s.type} »`);
          return '';
      }
    }).join('\n');
  },
  gouts(p) {
    return page('', `<div class="gts"><h2>${escT(p.titre)}</h2><ul>${(recit.gouts || []).map((g) => `<li>${escT(g)}</li>`).join('')}</ul></div>`);
  },
  chiffres(p) {
    const boites = chiffres.map((c) => `<div><b>${escT(c.nombre)}</b><span>${escT(c.libelle)}</span></div>`).join('');
    return page('', `<div class="chf"><h2>${escT(p.titre)}</h2><div class="nums">${boites}</div><p class="recit">${escT(recit.chiffres)}</p></div>`);
  },
  dos() {
    return page('bcv', `<div class="bk">${LOGO}<div class="hand big">${escT(recit.fin)}</div><div class="small">${esc(recit.titre)}<br>${esc(recit.sousTitre)}</div></div>`);
  },
};

const sections = mise.pages.map((p) => {
  const f = rendus[p.type];
  if (!f) { erreurs.push(`print-pages.json : type de page inconnu « ${p.type} »`); return ''; }
  return f(p);
}).filter(Boolean).join('\n');

if (erreurs.length) {
  console.error('Erreurs :\n  ' + erreurs.join('\n  '));
  process.exit(1);
}
avert.forEach((a) => console.warn('Attention : ' + a));

const htmlFinal = lire('livre/print-template.html').replace('{{pages}}', () => sections + '\n');
fs.writeFileSync(path.join(RACINE, 'livre-print.html'), htmlFinal);
const nbPages = (htmlFinal.match(/<section class="page/g) || []).length;
console.log(`livre-print.html écrit : ${nbPages} pages, ${photosUtilisees.size} photos.`);

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

if (AVEC_PDF) await faireLePDF(nbPages);
