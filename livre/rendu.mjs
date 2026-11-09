// Rendu du livre photo imprimable, partagé par :
//   - outils/livre-print.mjs (Node) : livre-print.html, livre.pdf, livre-imprimerie.pdf
//   - editeur.html (navigateur)     : aperçu en direct pendant l'édition
// Aucune dépendance : ni fs, ni DOM. Tout arrive en paramètres.
//
// Données (livre/print-pages.json) :
//   pages[] : {type:'couverture'|'trajet'|'jour'|'gouts'|'chiffres'|'dos', fond?, ...}
//   jour.pages[] (sous-pages) : {type:'ouverture'|'une'|'g2'|'g3'|'g4'|'g6'|'polaroids'|'texte', fond?, titre?, texte?, photo?, photos?}
//   photo : {f, c, rot?:0|90|180|270, z?:1..3, pos?:'50% 40%', inc?:degrés (polaroïds)}
//   fond  : clé de FONDS ou couleur '#rrggbb'

export const TYPES_SOUS_PAGE = {
  ouverture: { nom: 'Ouverture du jour', photos: 1 },
  une: { nom: '1 grande photo', photos: 1 },
  g2: { nom: '2 photos', photos: 2 },
  g3: { nom: '3 photos (1 grande)', photos: 3 },
  g4: { nom: '4 photos', photos: 4 },
  g6: { nom: '6 photos', photos: 6 },
  polaroids: { nom: '3 polaroïds', photos: 3 },
  texte: { nom: 'Texte (+ photo)', photos: 1 },
};

export const FONDS = {
  creme: { nom: 'Crème', c: '#f7efdc' },
  sable: { nom: 'Sable', c: '#f6e7c3' },
  blanc: { nom: 'Blanc', c: '#ffffff' },
  ciel: { nom: 'Ciel', c: '#dcebee' },
  maquis: { nom: 'Maquis', c: '#dfe8cc' },
  corail: { nom: 'Corail', c: '#f6d9cc' },
  mer: { nom: 'Mer', c: '#14566f' },
  nuit: { nom: 'Nuit', c: '#172228' },
};

// Taille finie A4 paysage, fond perdu, zone des traits de coupe (mm)
export const FORMAT = { l: 297, h: 210, perdu: 3, marge: 7 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const escT = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ROT = ['-3deg', '2deg', '-2deg'];
const MOTS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };

const couleurFond = (fond) => (fond && FONDS[fond] ? FONDS[fond].c : (/^#[0-9a-f]{6}$/i.test(fond || '') ? fond : null));
export function estSombre(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

// « Près de 81 km à pied, 580 km en Fiat 500c, 8 baignades, un pique-nique chaque midi. »
export function lireChiffres(phrase, erreurs = []) {
  return String(phrase || '').trim().replace(/\.$/, '').split(/\s*,\s*/).filter(Boolean).map((txt) => {
    const sansApprox = txt.replace(/^(près de|presque|environ|plus de|au moins)\s+/i, '');
    const m = sansApprox.match(/^(\d+(?:[.,]\d+)?|[a-zà-ü]+)\s+(.+)$/i);
    const n = m && (/^\d/.test(m[1]) ? m[1] : MOTS[m[1].toLowerCase()]);
    if (!n) erreurs.push(`recit.json « chiffres » : pas de nombre dans « ${txt} »`);
    return { txt, nombre: String(n ?? ''), libelle: m ? m[2] : txt };
  });
}

// Styles propres au mode imprimerie (taille de page avec fond perdu, et zone de traits)
export function stylesImpression({ imprimerie = false, traits = false } = {}) {
  if (!imprimerie) return '';
  const bord = FORMAT.perdu + (traits ? FORMAT.marge : 0);
  return `<style>@page{size:${FORMAT.l + 2 * bord}mm ${FORMAT.h + 2 * bord}mm;margin:0}</style>`;
}

/**
 * @param {object} d  {mise, recit, album:[...], logo:'<svg…>', cartes:{chemin: html}}
 * @param {object} o  {imprimerie, traits, editeur}
 * @returns {{html:string, sections:{cle:string, html:string, titre:string}[], erreurs:string[], avert:string[], photos:Set<string>}}
 */
export function rendreLivre(d, o = {}) {
  const { mise, recit } = d;
  const album = new Map(d.album.map((p) => [p.f, p]));
  const erreurs = [], avert = [], photos = new Set();
  const LOGO = String(d.logo).replace(/^<\?xml[^>]*>\s*/, '').replace(/<style>[\s\S]*?<\/style>/, '').replace(/^<svg /, '<svg class="logo" ');
  const chiffres = lireChiffres(recit.chiffres, erreurs);
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
    const r = Math.round((p.w / p.h) * 100) / 100;
    return Number.isInteger(r) ? `${r}.0` : String(r);
  }
  // <img> + boîte .im avec les réglages de l'éditeur (rien d'ajouté si réglages par défaut)
  function image(ph, alt) {
    const rot = ((+ph.rot || 0) % 360 + 360) % 360, z = +ph.z || 1, pos = ph.pos || '';
    const st = [];
    if (pos) st.push(`object-position:${pos}`, `transform-origin:${pos}`);
    if (rot === 90 || rot === 270) {
      return `<div class="im rot" style="--rot:${rot}deg;--z:${z}"><img src="photos/album/${ph.f}" alt="${alt}"${pos ? ` style="object-position:${pos}"` : ''}></div>`;
    }
    const tr = [rot === 180 ? 'rotate(180deg)' : '', z !== 1 ? `scale(${z})` : ''].filter(Boolean).join(' ');
    if (tr) st.push(`transform:${tr}`);
    return `<div class="im"><img src="photos/album/${ph.f}" alt="${alt}"${st.length ? ` style="${st.join(';')}"` : ''}></div>`;
  }
  let slot = 0;
  function figure(ph, cls = '', style = '') {
    const n = slot++;
    if (!ph || !ph.f) {
      if (!o.editeur) avert.push('emplacement photo vide');
      return `<figure class="${cls} vide" style="${style}" data-slot="${n}"><div class="im"><span>Choisir une photo</span></div><figcaption>&nbsp;</figcaption></figure>`;
    }
    photos.add(ph.f);
    const c = ph.c || '';
    return `<figure class="${cls}" style="${style}" data-r="${ratio(ph.f)}"${o.editeur ? ` data-slot="${n}"` : ''}>${image(ph, esc(c))}<figcaption>${c ? esc(c) : '&nbsp;'}</figcaption></figure>`;
  }
  const traits = o.imprimerie && o.traits ? '<i class="tc" aria-hidden="true"></i>' : '';
  function page(cls, contenu, p, cle) {
    const coul = couleurFond(p && p.fond);
    const sombre = coul && estSombre(coul) ? ' sombre' : '';
    const st = coul ? ` style="background-color:${coul};background-image:radial-gradient(rgba(168,64,31,.05) 1px,transparent 1.5px)"` : '';
    const k = o.editeur ? ` data-k="${cle}"` : '';
    return `<section class="page ${cls}${sombre}"${st}${k}>${traits}${contenu}</section>`;
  }

  const rendus = {
    couverture(p, cle) {
      slot = 0;
      if (p.photo?.f) { photos.add(p.photo.f); ratio(p.photo.f); }
      const h1 = recit.titre.replace(/\s+d['’].*$/, '');
      const pol = p.photo?.f
        ? `<figure class="pol1"${o.editeur ? ' data-slot="0"' : ''}>${image(p.photo, '')}<figcaption>${escT(p.photo.c || '')}</figcaption></figure>`
        : figure(null, 'pol1');
      return page('cover', `<div class="cvr"><div class="cl"><div class="kick">${escT(p.surtitre || '')}</div><h1>${escT(h1)}</h1><div class="auth">d'${escT(recit.auteurs)}</div><div class="sub">${escT(recit.sousTitre)}</div>${LOGO}</div><div class="cr">${pol}</div></div>`, p, cle);
    },
    trajet(p, cle) {
      const chips = (p.chips || []).map((mot) => {
        const c = chiffres.find((x) => x.txt.toLowerCase().includes(mot.toLowerCase()));
        if (!c) { erreurs.push(`trajet : aucun élément de « chiffres » ne contient « ${mot} »`); return ''; }
        return `<div class="chip">${escT(minus1(c.txt))}</div>`;
      }).join('');
      const carte = String(d.cartes?.[p.carte] || '').replace(/\s+$/, '');
      return page('', `<div class="trj"><div class="tl"><h2>${escT(p.titre)}</h2><p>${escT(p.texte)}</p>${chips}</div><div class="tr">${carte}</div></div>`, p, cle);
    },
    jour(p, cle) {
      const j = jour(p.jour);
      const sous = p.pages || [];
      if (!sous.length) {
        if (d.album.some((x) => x.jour === p.jour)) avert.push(`${p.jour} : l'album contient des photos mais print-pages.json n'a pas de mise en page -> page « à suivre »`);
        return page('soonp', `<div class="soon"><div class="dn">${esc(j.dn)}</div><h2>${esc(j.h2)}</h2><div class="hand">à suivre…</div><p class="recit">${esc(j.texte)}</p><div class="blank">Les photos de ce jour arrivent bientôt.</div></div>`, p, cle);
      }
      return sous.map((s, i) => {
        slot = 0;
        const k = `${cle}.${i}`;
        const ph = `<div class="ph">${esc(s.titre || j.titre)}</div>`;
        const lst = (n) => Array.from({ length: n }, (_, x) => (s.photos || [])[x]);
        switch (s.type) {
          case 'ouverture':
            return page('op', `<div class="open"><div class="ot"><div class="dn">${esc(j.dn)}</div><h2>${esc(j.h2)}</h2><p class="recit">${esc(j.texte)}</p>${LOGO}</div><div class="oi">${figure(s.photo, 'big')}</div></div>`, s, k);
          case 'une':
            return page('pp', `${ph}<div class="une">${figure(s.photo, 'big')}</div>`, s, k);
          case 'g2': case 'g3': case 'g4': case 'g6':
            return page('pp', `${ph}<div class="grid ${s.type}">${lst(TYPES_SOUS_PAGE[s.type].photos).map((x) => figure(x)).join('')}</div>`, s, k);
          case 'polaroids':
            return page('pp', `${ph}<div class="pol">${lst(3).map((x, n) => figure(x, 'polc', `--r:${x && x.inc != null ? x.inc + 'deg' : ROT[n % ROT.length]}`)).join('')}</div>`, s, k);
          case 'texte':
            return page('pp', `${ph}<div class="txt"><div class="tt">${s.titreTexte ? `<h2>${escT(s.titreTexte)}</h2>` : ''}<p class="recit">${escT(s.texte || '')}</p></div>${s.photo === null ? '' : figure(s.photo, 'big')}</div>`, s, k);
          default:
            erreurs.push(`${p.jour} : type de page inconnu « ${s.type} »`);
            return '';
        }
      });
    },
    gouts(p, cle) {
      return page('', `<div class="gts"><h2>${escT(p.titre)}</h2><ul>${(recit.gouts || []).map((g) => `<li>${escT(g)}</li>`).join('')}</ul></div>`, p, cle);
    },
    chiffres(p, cle) {
      const boites = chiffres.map((c) => `<div><b>${escT(c.nombre)}</b><span>${escT(c.libelle)}</span></div>`).join('');
      return page('', `<div class="chf"><h2>${escT(p.titre)}</h2><div class="nums">${boites}</div><p class="recit">${escT(recit.chiffres)}</p></div>`, p, cle);
    },
    dos(p, cle) {
      return page('bcv', `<div class="bk">${LOGO}<div class="hand big">${escT(recit.fin)}</div><div class="small">${esc(recit.titre)}<br>${esc(recit.sousTitre)}</div></div>`, p, cle);
    },
  };

  const sections = [];
  mise.pages.forEach((p, i) => {
    const f = rendus[p.type];
    if (!f) { erreurs.push(`print-pages.json : type de page inconnu « ${p.type} »`); return; }
    slot = 0;
    const r = f(p, String(i));
    const liste = Array.isArray(r) ? r : [r];
    liste.forEach((html, n) => {
      if (!html) return;
      const cle = Array.isArray(r) ? `${i}.${n}` : String(i);
      const titre = p.type === 'jour' ? (recit.jours?.[p.jour]?.titre || p.jour) : ({ couverture: 'Couverture', trajet: 'Notre trajet', gouts: 'Ce qu’on a goûté', chiffres: 'En chiffres', dos: 'Dos' }[p.type]);
      sections.push({ cle, html, titre, type: Array.isArray(r) ? p.pages[n].type : p.type });
    });
  });
  return { html: sections.map((s) => s.html).join('\n'), sections, erreurs, avert, photos };
}
