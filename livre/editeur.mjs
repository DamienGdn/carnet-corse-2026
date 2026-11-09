// Éditeur du livre photo imprimable.
// Modifie livre/print-pages.json (mise en page) et livre/recit.json (textes), avec aperçu en direct
// grâce au même moteur de rendu que la génération (livre/rendu.mjs).
// Brouillon : localStorage. Publication : API GitHub (un commit), puis GitHub Actions reconstruit le site et les PDF.
import { rendreLivre, stylesImpression, TYPES_SOUS_PAGE, FONDS } from './rendu.mjs';

const DEPOT = { owner: 'DamienGdn', repo: 'carnet-corse-2026', branche: 'main' };
const FICHIERS = { mise: 'livre/print-pages.json', recit: 'livre/recit.json' };
const CLE_BROUILLON = 'livre-brouillon-v1', CLE_JETON = 'livre-gh-jeton';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };

// ---------- JSON lisible : les petits objets (photos) tiennent sur une ligne ----------
function jolie(v, ind = '') {
  const simple = (x) => x === null || typeof x !== 'object' || (Array.isArray(x) ? x.every((y) => y === null || typeof y !== 'object') && JSON.stringify(x).length < 90 : Object.values(x).every((y) => y === null || typeof y !== 'object'));
  if (simple(v)) return JSON.stringify(v).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "');
  const i2 = ind + ' ';
  if (Array.isArray(v)) return '[\n' + v.map((x) => i2 + jolie(x, i2)).join(',\n') + '\n' + ind + ']';
  return '{\n' + Object.entries(v).map(([k, x]) => `${i2}${JSON.stringify(k)}: ${jolie(x, i2)}`).join(',\n') + '\n' + ind + '}';
}
const texteJSON = (v) => jolie(v) + '\n';

// ---------- état ----------
const S = {
  publie: null,          // {mise, recit} tels que publiés (au chargement)
  publieTexte: null,     // textes JSON publiés (détection de conflit)
  mise: null, recit: null,
  album: [], logo: '', cartes: {},
  cle: '0', slot: null,  // page et emplacement photo sélectionnés
  histo: [], futur: [],
  filtre: null, coeur: false,
};
const snapshot = () => JSON.stringify({ mise: S.mise, recit: S.recit });

function enregistrer() {
  ls.set(CLE_BROUILLON, JSON.stringify({ t: Date.now(), mise: S.mise, recit: S.recit }));
  majEtat();
}
function modifier(fn, { rendre = true } = {}) {
  S.histo.push(snapshot()); if (S.histo.length > 80) S.histo.shift();
  S.futur = [];
  fn();
  enregistrer();
  if (rendre) toutRendre();
}
function restaurer(json) { const o = JSON.parse(json); S.mise = o.mise; S.recit = o.recit; enregistrer(); toutRendre(); }
function annuler() { if (!S.histo.length) return; S.futur.push(snapshot()); restaurer(S.histo.pop()); }
function refaire() { if (!S.futur.length) return; S.histo.push(snapshot()); restaurer(S.futur.pop()); }
const modifie = () => texteJSON(S.mise) !== S.publieTexte.mise || texteJSON(S.recit) !== S.publieTexte.recit;
function majEtat() {
  const m = modifie();
  $('etat').textContent = m ? 'brouillon non publié' : 'à jour avec la version publiée';
  $('etat').classList.toggle('mod', m);
  $('annuler').disabled = !S.histo.length; $('refaire').disabled = !S.futur.length;
}
function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

// ---------- accès aux pages ----------
const parCle = (cle) => {
  const [i, k] = cle.split('.').map(Number);
  const p = S.mise.pages[i];
  return k == null || Number.isNaN(k) ? { p, haut: p, i } : { p: p.pages[k], haut: p, i, k };
};
const donnees = () => ({ mise: S.mise, recit: S.recit, album: S.album, logo: S.logo, cartes: S.cartes });
let sections = [];
function rendu() {
  const r = rendreLivre(donnees(), { editeur: true });
  sections = r.sections;
  return r;
}
// emplacements photo d'une page : [{get, set}]
function emplacements(cle) {
  const { p, k } = parCle(cle);
  if (k == null && p.type === 'couverture') return [{ get: () => p.photo, set: (v) => { p.photo = v; } }];
  if (k == null) return [];
  const t = TYPES_SOUS_PAGE[p.type];
  if (!t) return [];
  if (['ouverture', 'une', 'texte'].includes(p.type)) return [{ get: () => p.photo, set: (v) => { p.photo = v; } }];
  p.photos = p.photos || [];
  return Array.from({ length: t.photos }, (_, n) => ({ get: () => p.photos[n], set: (v) => { p.photos[n] = v; } }));
}

// ---------- aperçu (iframe isolée avec le CSS du livre) ----------
const base = new URL('.', location.href).href;
const ifr = $('apercu');
let doc = null;
function preparerApercu() {
  return new Promise((ok) => {
    ifr.addEventListener('load', () => { doc = ifr.contentDocument; brancherApercu(); ok(); }, { once: true });
    ifr.srcdoc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><base href="${base}">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Fredoka:wght@500;600&family=Nunito:wght@500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="livre/livre.css">
<style>html,body{background:#cfc6b0!important;margin:0}body{padding:14px}.page{margin:0 auto!important;box-shadow:0 2px 12px #0005}
figure[data-slot]{cursor:pointer}figure[data-slot]:hover{outline:.8mm dashed #14566f;outline-offset:1mm}
figure.sel{outline:1.2mm solid #14566f!important;outline-offset:1mm}figure.sel img{cursor:grab}
figure.ppi-moy .im{box-shadow:inset 0 0 0 1.2mm #e69b00}figure.ppi-bas .im{box-shadow:inset 0 0 0 1.2mm #d93025}</style></head><body><div id="p"></div></body></html>`;
  });
}
function ajusterZoom() {
  if (!doc) return;
  const pg = doc.querySelector('.page'); if (!pg) return;
  const z = Math.min((ifr.clientWidth - 28) / 1123, (ifr.clientHeight - 28) / 794);
  pg.style.zoom = Math.max(.2, z);
}
function majApercu() {
  if (!doc) return;
  const s = sections.find((x) => x.cle === S.cle) || sections[0];
  if (!s) return;
  S.cle = s.cle;
  doc.getElementById('p').innerHTML = s.html;
  ajusterZoom();
  marquerSelection();
  // qualité d'impression : quand les images sont chargées
  doc.querySelectorAll('figure[data-slot] img').forEach((im) => { if (im.complete) noterPPI(im); else im.addEventListener('load', () => { noterPPI(im); if (S.slot != null) majInspecteur(); }, { once: true }); });
  const i = sections.indexOf(s);
  $('titrePage').textContent = `${i + 1} / ${sections.length} · ${s.titre}`;
  $('prec').disabled = i === 0; $('suiv').disabled = i === sections.length - 1;
}
const ppiDe = {};
function noterPPI(im) {
  const fig = im.closest('figure'), box = im.parentElement, n = fig.dataset.slot;
  const zoom = parseFloat(doc.querySelector('.page').style.zoom) || 1;
  const r = box.getBoundingClientRect(); // px à l'écran (zoom compris)
  const bw = r.width / zoom, bh = r.height / zoom; // px CSS de la page (96 px par pouce)
  const ph = emplacements(S.cle)[n]?.get(); if (!ph) return;
  const tourne = [90, 270].includes(((+ph.rot || 0) % 360 + 360) % 360);
  const nw = tourne ? im.naturalHeight : im.naturalWidth, nh = tourne ? im.naturalWidth : im.naturalHeight;
  const s = Math.max(bw / nw, bh / nh) * (+ph.z || 1);
  const ppi = Math.round(96 / s);
  ppiDe[`${S.cle}#${n}`] = ppi;
  fig.classList.toggle('ppi-moy', ppi < 220 && ppi >= 150);
  fig.classList.toggle('ppi-bas', ppi < 150);
}
function marquerSelection() {
  doc.querySelectorAll('figure.sel').forEach((f) => f.classList.remove('sel'));
  if (S.slot != null) doc.querySelector(`figure[data-slot="${S.slot}"]`)?.classList.add('sel');
}
function brancherApercu() {
  // clic sur une photo : sélection
  doc.addEventListener('click', (e) => {
    const f = e.target.closest('figure[data-slot]');
    S.slot = f ? +f.dataset.slot : null;
    if (f && !emplacements(S.cle)[S.slot]?.get()?.f) ouvrirPhotos();
    marquerSelection(); majInspecteur();
  });
  // glisser pour recadrer la photo sélectionnée
  let glisse = null;
  doc.addEventListener('pointerdown', (e) => {
    const im = e.target.closest('figure.sel img'); if (!im) return;
    const ph = emplacements(S.cle)[S.slot]?.get(); if (!ph) return;
    e.preventDefault();
    const [x, y] = (ph.pos || '50% 40%').split(' ').map(parseFloat);
    const r = im.parentElement.getBoundingClientRect();
    glisse = { x0: e.clientX, y0: e.clientY, x, y, w: r.width, h: r.height, avant: snapshot() };
    im.setPointerCapture(e.pointerId);
  });
  doc.addEventListener('pointermove', (e) => {
    if (!glisse) return;
    const ph = emplacements(S.cle)[S.slot].get();
    const nx = Math.min(100, Math.max(0, glisse.x - (e.clientX - glisse.x0) / glisse.w * 120));
    const ny = Math.min(100, Math.max(0, glisse.y - (e.clientY - glisse.y0) / glisse.h * 120));
    ph.pos = `${Math.round(nx)}% ${Math.round(ny)}%`;
    const im = doc.querySelector('figure.sel img');
    if (im) { im.style.objectPosition = ph.pos; if (!im.closest('.rot')) im.style.transformOrigin = ph.pos; }
  });
  doc.addEventListener('pointerup', () => {
    if (!glisse) return;
    const av = glisse.avant; glisse = null;
    if (av !== snapshot()) { S.histo.push(av); S.futur = []; enregistrer(); toutRendre(); }
  });
}

// ---------- liste des pages ----------
function majListe() {
  const L = $('liste');
  let h = '', n = 0;
  const it = (cle, label, acts = '') => `<div class="it${cle === S.cle ? ' on' : ''}" data-cle="${cle}" role="button" tabindex="0" aria-current="${cle === S.cle}"><span class="n">${++n}</span><span class="l">${esc(label)}</span><span class="acts">${acts}</span></div>`;
  const NOMS = { couverture: 'Couverture', trajet: 'Notre trajet', gouts: 'Ce qu’on a goûté', chiffres: 'En chiffres', dos: 'Dos du livre' };
  const options = Object.entries(TYPES_SOUS_PAGE).map(([k, t]) => `<option value="${k}">${t.nom}</option>`).join('');
  S.mise.pages.forEach((p, i) => {
    if (p.type !== 'jour') { h += it(String(i), NOMS[p.type] || p.type); return; }
    const titre = S.recit.jours?.[p.jour]?.titre || p.jour;
    h += `<div class="grp"><h2><span>${esc(titre)}</span></h2>`;
    if (!p.pages?.length) h += it(String(i), 'Page « à suivre » (pas encore de photos)');
    (p.pages || []).forEach((s, k) => {
      const nb = (s.photos || []).filter((x) => x?.f).length + (s.photo?.f ? 1 : 0);
      h += it(`${i}.${k}`, `${TYPES_SOUS_PAGE[s.type]?.nom || s.type}${nb ? ` · ${nb} 📷` : ''}`,
        `<button data-act="haut" title="Monter" aria-label="Monter la page">↑</button><button data-act="bas" title="Descendre" aria-label="Descendre la page">↓</button><button data-act="dup" title="Dupliquer" aria-label="Dupliquer la page">⧉</button><button data-act="suppr" title="Supprimer" aria-label="Supprimer la page">🗑</button>`);
    });
    h += `<div class="ajout"><select aria-label="Type de la nouvelle page" data-ajout="${i}">${options}</select><button class="btn sm" data-ajouter="${i}">＋ Page</button></div></div>`;
  });
  L.innerHTML = h;
  L.querySelector('.it.on')?.scrollIntoView({ block: 'nearest' });
}
$('liste').addEventListener('click', (e) => {
  const aj = e.target.closest('[data-ajouter]');
  if (aj) {
    const i = +aj.dataset.ajouter, type = $('liste').querySelector(`[data-ajout="${i}"]`).value;
    const k0 = S.cle.startsWith(i + '.') ? +S.cle.split('.')[1] + 1 : (S.mise.pages[i].pages || []).length;
    modifier(() => {
      const p = S.mise.pages[i]; p.pages = p.pages || [];
      p.pages.splice(k0, 0, ['ouverture', 'une', 'texte'].includes(type) ? { type, ...(type === 'texte' ? { texte: '' } : {}) } : { type, photos: [] });
      S.cle = `${i}.${k0}`; S.slot = null;
    });
    return;
  }
  const it = e.target.closest('.it'); if (!it) return;
  const act = e.target.closest('[data-act]')?.dataset.act, cle = it.dataset.cle;
  if (!act) { allerA(cle); return; }
  const [i, k] = cle.split('.').map(Number), arr = S.mise.pages[i].pages;
  if (act === 'suppr' && !confirm('Supprimer cette page ?')) return;
  modifier(() => {
    if (act === 'haut' && k > 0) { [arr[k - 1], arr[k]] = [arr[k], arr[k - 1]]; S.cle = `${i}.${k - 1}`; }
    if (act === 'bas' && k < arr.length - 1) { [arr[k + 1], arr[k]] = [arr[k], arr[k + 1]]; S.cle = `${i}.${k + 1}`; }
    if (act === 'dup') { arr.splice(k + 1, 0, JSON.parse(JSON.stringify(arr[k]))); S.cle = `${i}.${k + 1}`; }
    if (act === 'suppr') { arr.splice(k, 1); S.cle = arr.length ? `${i}.${Math.max(0, k - 1)}` : String(i); }
    S.slot = null;
  });
});
$('liste').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('it')) { e.preventDefault(); allerA(e.target.dataset.cle); } });
function allerA(cle) { S.cle = cle; S.slot = null; majListe(); majApercu(); majInspecteur(); }

// ---------- inspecteur ----------
const champ = (id, label, val, { zone = false, aide = '' } = {}) => `<label for="${id}">${label}</label>${zone ? `<textarea id="${id}">${esc(val)}</textarea>` : `<input type="text" id="${id}" value="${esc(val)}">`}${aide ? `<p class="aide">${aide}</p>` : ''}`;
function majInspecteur() {
  const I = $('insp');
  const { p, haut, k } = parCle(S.cle);
  let h = '';
  // --- photo sélectionnée
  const emp = S.slot != null ? emplacements(S.cle)[S.slot] : null;
  const ph = emp?.get();
  if (emp) {
    if (ph?.f) {
      const ppi = ppiDe[`${S.cle}#${S.slot}`];
      const cls = ppi == null ? '' : ppi >= 220 ? 'ok' : ppi >= 150 ? 'moy' : 'bas';
      const rot = ((+ph.rot || 0) % 360 + 360) % 360;
      const [px, py] = (ph.pos || '50% 40%').split(' ').map(parseFloat);
      h += `<section><h3>Photo</h3>
        <div class="vign"><img src="photos/album/thumbs/${esc(S.album.find((a) => a.f === ph.f)?.th || ph.f)}" alt=""><div>
          <button class="btn sm" id="changer">🔁 Changer</button>
          ${ppi != null ? `<p class="aide"><span class="ppi ${cls}">${ppi} ppi</span> ${cls === 'ok' ? 'parfait pour l’impression' : cls === 'moy' ? 'correct, un peu juste' : 'trop agrandie pour une impression nette'}</p>` : ''}
        </div></div>
        ${champ('legende', 'Légende', ph.c || '')}
        <label>Orientation</label><div class="row"><button class="btn sm" id="rotG" aria-label="Tourner à gauche">⟲ 90°</button><button class="btn sm" id="rotD" aria-label="Tourner à droite">⟳ 90°</button><span class="aide">${rot}°</span></div>
        <label for="zoom">Zoom (${(+ph.z || 1).toFixed(2)}×)</label><input type="range" id="zoom" min="1" max="3" step="0.05" value="${+ph.z || 1}">
        <label>Cadrage</label><p class="aide" style="margin-top:0">Glisse la photo dans l’aperçu, ou règle :</p>
        <label for="posX" style="font-weight:700">Horizontal</label><input type="range" id="posX" min="0" max="100" value="${px}">
        <label for="posY" style="font-weight:700">Vertical</label><input type="range" id="posY" min="0" max="100" value="${py}">
        ${p.type === 'polaroids' ? `<label for="inc">Inclinaison (${ph.inc ?? ['-3', '2', '-2'][S.slot % 3]}°)</label><input type="range" id="inc" min="-8" max="8" step="0.5" value="${ph.inc ?? [-3, 2, -2][S.slot % 3]}">` : ''}
        <div class="row" style="margin-top:10px"><button class="btn sm" id="recentrer">Recentrer</button><button class="btn sm" id="retirer">Retirer la photo</button></div>
      </section>`;
    } else {
      h += `<section><h3>Emplacement vide</h3><button class="btn hot" id="changer">📷 Choisir une photo</button>${p.type === 'texte' ? '<p class="aide">Ou laisse la page sans photo :</p><button class="btn sm" id="sansPhoto">Page texte seule</button>' : ''}</section>`;
    }
  } else if (emplacements(S.cle).length) {
    h += `<section><p class="aide" style="margin:0">👆 Touche une photo dans l’aperçu pour la changer, la tourner ou la recadrer.</p></section>`;
  }
  // --- page
  h += `<section><h3>Page</h3>`;
  if (k != null) {
    h += `<label for="typePage">Mise en page</label><select id="typePage">${Object.entries(TYPES_SOUS_PAGE).map(([t, d]) => `<option value="${t}"${t === p.type ? ' selected' : ''}>${d.nom}</option>`).join('')}</select>`;
    if (p.type !== 'ouverture') h += champ('titrePg', 'Titre en haut de page', p.titre || '', { aide: `Vide = titre du jour (« ${esc(S.recit.jours?.[haut.jour]?.titre || '')} »).` });
    if (p.type === 'texte') h += champ('titreTexte', 'Titre du texte', p.titreTexte || '') + champ('textePg', 'Texte', p.texte || '', { zone: true });
  }
  if (p.type === 'couverture') h += champ('surtitre', 'Surtitre', p.surtitre || '');
  if (p.type === 'trajet') h += champ('trajTitre', 'Titre', p.titre || '') + champ('trajTexte', 'Texte', p.texte || '', { zone: true });
  if (p.type === 'gouts') h += champ('gouts', 'Ce qu’on a goûté (une ligne par élément)', (S.recit.gouts || []).join('\n'), { zone: true });
  if (p.type === 'chiffres') h += champ('chiffres', 'Phrase des chiffres', S.recit.chiffres || '', { zone: true, aide: 'Les cases sont calculées depuis cette phrase : éléments séparés par des virgules, chacun commençant par un nombre (« 580 km en Fiat 500c »).' });
  if (p.type === 'dos') h += champ('fin', 'Mot de la fin', S.recit.fin || '');
  // fond
  const f = p.fond || '';
  h += `<label>Fond de page</label><div class="fonds">${Object.entries(FONDS).map(([cle, d]) => `<button data-fond="${cle}" style="background:${d.c}" aria-pressed="${f === cle}" title="${d.nom}" aria-label="Fond ${d.nom}"></button>`).join('')}<input type="color" id="fondPerso" value="${/^#/.test(f) ? f : '#f7efdc'}" title="Autre couleur" aria-label="Autre couleur de fond"></div>
    <div class="row" style="margin-top:8px"><button class="btn sm" id="fondDefaut">Fond d’origine</button>${k != null ? '<button class="btn sm" id="fondJour">Appliquer à tout le jour</button>' : ''}<button class="btn sm" id="fondTout">À tout le livre</button></div>`;
  h += `</section>`;
  // --- jour
  if (haut.type === 'jour') {
    const j = S.recit.jours?.[haut.jour] || {};
    h += `<section><h3>Texte du jour</h3>${champ('jourTitre', 'Titre', j.titre || '', { aide: 'Forme « Jour · Titre », par ex. « Mardi 6 · Bonifacio ».' })}${champ('jourTexte', 'Récit', j.texte || '', { zone: true })}</section>`;
  }
  I.innerHTML = h || '<p class="vide">Aucun réglage pour cette page.</p>';
  brancherInspecteur(p, haut, k, emp, ph);
}
function brancherInspecteur(p, haut, k, emp, ph) {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  // champs texte : modification à la saisie (aperçu rafraîchi, sans reconstruire l'inspecteur)
  // une étape d'annulation par champ édité (pas une par frappe)
  const texte = (id, set) => {
    const el = $(id); if (!el) return;
    let av = null;
    el.addEventListener('focus', () => { av = snapshot(); });
    el.addEventListener('input', () => { if (!av) av = snapshot(); set(el.value); enregistrer(); rafraichir(); });
    el.addEventListener('change', () => { if (av && av !== snapshot()) { S.histo.push(av); S.futur = []; majEtat(); } av = snapshot(); });
  };
  texte('legende', (v) => { ph.c = v; });
  texte('titrePg', (v) => { if (v) p.titre = v; else delete p.titre; });
  texte('titreTexte', (v) => { if (v) p.titreTexte = v; else delete p.titreTexte; });
  texte('textePg', (v) => { p.texte = v; });
  texte('surtitre', (v) => { p.surtitre = v; });
  texte('trajTitre', (v) => { p.titre = v; });
  texte('trajTexte', (v) => { p.texte = v; });
  texte('gouts', (v) => { S.recit.gouts = v.split('\n').map((x) => x.trim()).filter(Boolean); });
  texte('chiffres', (v) => { S.recit.chiffres = v; });
  texte('fin', (v) => { S.recit.fin = v; });
  texte('jourTitre', (v) => { S.recit.jours[haut.jour].titre = v; majListe(); });
  texte('jourTexte', (v) => { S.recit.jours[haut.jour].texte = v; });
  on('changer', 'click', ouvrirPhotos);
  on('sansPhoto', 'click', () => modifier(() => { p.photo = null; S.slot = null; }));
  on('retirer', 'click', () => modifier(() => { emp.set(undefined); if (Array.isArray(p.photos)) { while (p.photos.length && !p.photos[p.photos.length - 1]) p.photos.pop(); } }));
  on('rotG', 'click', () => modifier(() => { ph.rot = (((+ph.rot || 0) - 90) % 360 + 360) % 360; if (!ph.rot) delete ph.rot; }));
  on('rotD', 'click', () => modifier(() => { ph.rot = ((+ph.rot || 0) + 90) % 360; if (!ph.rot) delete ph.rot; }));
  const curseur = (id, set) => {
    const el = $(id); if (!el) return;
    let av = null;
    el.addEventListener('pointerdown', () => { av = snapshot(); });
    el.addEventListener('input', () => { if (!av) av = snapshot(); set(+el.value); rafraichir(); });
    el.addEventListener('change', () => { if (av && av !== snapshot()) { S.histo.push(av); S.futur = []; } av = null; enregistrer(); majInspecteur(); });
  };
  curseur('zoom', (v) => { if (v === 1) delete ph.z; else ph.z = v; });
  curseur('posX', (v) => { const y = (ph.pos || '50% 40%').split(' ')[1]; ph.pos = `${v}% ${y}`; });
  curseur('posY', (v) => { const x = (ph.pos || '50% 40%').split(' ')[0]; ph.pos = `${x} ${v}%`; });
  curseur('inc', (v) => { ph.inc = v; });
  on('recentrer', 'click', () => modifier(() => { delete ph.pos; delete ph.z; }));
  on('typePage', 'change', (e) => modifier(() => changerType(p, e.target.value)));
  document.querySelectorAll('[data-fond]').forEach((b) => b.addEventListener('click', () => modifier(() => { p.fond = b.dataset.fond; })));
  on('fondPerso', 'change', (e) => modifier(() => { p.fond = e.target.value; }));
  on('fondDefaut', 'click', () => modifier(() => { delete p.fond; }));
  on('fondJour', 'click', () => modifier(() => { const f = p.fond; (haut.pages || []).forEach((s) => { if (f) s.fond = f; else delete s.fond; }); }));
  on('fondTout', 'click', () => { if (!confirm('Appliquer ce fond à toutes les pages du livre ?')) return; modifier(() => { const f = p.fond; S.mise.pages.forEach((x) => { if (x.type === 'jour') { (x.pages || []).forEach((s) => { if (f) s.fond = f; else delete s.fond; }); if (!x.pages?.length) { if (f) x.fond = f; else delete x.fond; } } else if (x.type !== 'dos') { if (f) x.fond = f; else delete x.fond; } }); }); });
}
function changerType(p, type) {
  const toutes = [p.photo, ...(p.photos || [])].filter((x) => x && x.f);
  delete p.photo; delete p.photos;
  p.type = type;
  if (['ouverture', 'une', 'texte'].includes(type)) { if (toutes[0]) p.photo = toutes[0]; if (type === 'texte' && p.texte == null) p.texte = ''; }
  else p.photos = toutes.slice(0, TYPES_SOUS_PAGE[type].photos);
  S.slot = null;
}
let rafr = 0;
function rafraichir() { cancelAnimationFrame(rafr); rafr = requestAnimationFrame(() => { rendu(); majApercu(); }); }
function toutRendre() { rendu(); majListe(); majApercu(); majInspecteur(); }

// ---------- choix d'une photo ----------
const JOURS = [['avant', 'Avant'], ['j1', 'J1'], ['j2', 'J2'], ['j3', 'J3'], ['j4', 'J4'], ['j5', 'J5'], ['j6', 'J6'], ['j7', 'J7']];
function ouvrirPhotos() {
  const { haut } = parCle(S.cle);
  if (S.filtre == null || !S.album.some((a) => a.jour === S.filtre)) S.filtre = haut.type === 'jour' && S.album.some((a) => a.jour === haut.jour) ? haut.jour : 'tout';
  dessinerPhotos();
  $('dlgPhotos').showModal();
}
function dessinerPhotos() {
  const utilisees = new Set();
  JSON.stringify(S.mise, (k, v) => { if (k === 'f') utilisees.add(v); return v; });
  const photos = S.album.filter((a) => !a.video);
  $('filtres').innerHTML = [['tout', 'Toutes'], ...JOURS].map(([k, n]) => {
    const nb = k === 'tout' ? photos.length : photos.filter((a) => a.jour === k).length;
    return nb ? `<button data-filtre="${k}" aria-pressed="${S.filtre === k}">${n} <small>(${nb})</small></button>` : '';
  }).join('');
  if (photos.some((a) => a.top)) $('filtres').insertAdjacentHTML('beforeend', `<button data-coeur aria-pressed="${S.coeur}">❤ Coups de cœur</button>`);
  const liste = photos.filter((a) => (S.filtre === 'tout' || a.jour === S.filtre) && (!S.coeur || a.top));
  $('grille').innerHTML = liste.map((a) => `<button data-f="${esc(a.f)}" aria-label="Photo ${esc(a.heure || a.f)}${utilisees.has(a.f) ? ' (déjà dans le livre)' : ''}"><img src="photos/album/thumbs/${esc(a.th)}" alt="" loading="lazy"><span>${a.top ? '❤ ' : ''}${esc(a.heure || '')}</span>${utilisees.has(a.f) ? '<b class="deja">déjà</b>' : ''}</button>`).join('');
}
$('filtres').addEventListener('click', (e) => {
  if (e.target.closest('[data-coeur]')) { S.coeur = !S.coeur; dessinerPhotos(); return; }
  const b = e.target.closest('[data-filtre]'); if (b) { S.filtre = b.dataset.filtre; dessinerPhotos(); }
});
$('grille').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  const a = S.album.find((x) => x.f === b.dataset.f), emp = emplacements(S.cle)[S.slot ?? 0];
  if (!emp) return;
  modifier(() => { const av = emp.get(); emp.set({ f: a.f, c: av?.c && av.f ? av.c : (a.heure || '') }); if (S.slot == null) S.slot = 0; });
  $('dlgPhotos').close();
});

// ---------- livre complet, PDF imprimerie (navigateur) ----------
async function fenetreLivre({ imprimerie = false } = {}) {
  const r = rendreLivre(donnees(), { imprimerie });
  const w = window.open('', '_blank');
  if (!w) { toast('Autorise les fenêtres pop-up pour ce site.'); return; }
  const gab = await (await fetch('livre/print-template.html', { cache: 'no-store' })).text();
  let html = gab.replace('{{styles}}', stylesImpression({ imprimerie })).replace('{{pages}}', r.html)
    .replace('<head>', `<head><base href="${base}">`).replace(/<nav class="bar">[\s\S]*?<\/nav>/, '');
  if (imprimerie) html = html.replace('<html lang="fr">', '<html lang="fr" class="imprimerie">')
    .replace('</body>', `<script>Promise.all([document.fonts.ready,...[...document.images].map(i=>i.complete?0:new Promise(o=>{i.onload=o;i.onerror=o}))]).then(()=>setTimeout(()=>print(),300))<\/script></body>`);
  w.document.open(); w.document.write(html); w.document.close();
}
$('toutVoir').addEventListener('click', () => fenetreLivre());
$('pdf').addEventListener('click', () => {
  toast('Dans la fenêtre d’impression : Destination « Enregistrer au format PDF », Marges « Aucune », Graphiques d’arrière-plan cochés.', 7000);
  fenetreLivre({ imprimerie: true });
});

// ---------- fichier : export, import, retour à la version publiée ----------
$('plus').addEventListener('click', () => { majCle(); $('dlgFichier').showModal(); });
$('exporter').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ mise: S.mise, recit: S.recit }, null, 1)], { type: 'application/json' }));
  a.download = `livre-brouillon-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('importer').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (!o.mise?.pages || !o.recit?.jours) throw new Error('format inconnu');
    modifier(() => { S.mise = o.mise; S.recit = o.recit; S.cle = '0'; S.slot = null; });
    $('dlgFichier').close(); toast('Brouillon importé.');
  } catch (err) { toast('Fichier illisible : ' + err.message); }
  e.target.value = '';
});
$('revenir').addEventListener('click', () => {
  if (!confirm('Abandonner le brouillon et revenir à la version publiée ?')) return;
  modifier(() => { S.mise = structuredClone(S.publie.mise); S.recit = structuredClone(S.publie.recit); S.slot = null; });
  $('dlgFichier').close();
});
function majCle() { $('cleEtat').textContent = ls.get(CLE_JETON) ? 'Une clé est enregistrée sur cet appareil.' : 'Aucune clé enregistrée sur cet appareil.'; }
$('oublierCle').addEventListener('click', () => { ls.del(CLE_JETON); majCle(); toast('Clé oubliée.'); });

// ---------- publication sur GitHub (un seul commit pour les deux fichiers) ----------
const API = `https://api.github.com/repos/${DEPOT.owner}/${DEPOT.repo}`;
async function gh(jeton, chemin, opts = {}) {
  const r = await fetch(API + chemin, { ...opts, headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) {
    const m = await r.json().catch(() => ({}));
    const e = new Error(`${r.status} ${m.message || r.statusText}`); e.status = r.status; throw e;
  }
  return r.status === 204 ? null : r.json();
}
const b64utf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
function ecranPublier() {
  const jeton = ls.get(CLE_JETON);
  const C = $('publierCorps');
  if (!modifie()) { C.innerHTML = '<p>Rien à publier : le brouillon est identique à la version publiée.</p>'; return; }
  C.innerHTML = `
    ${jeton ? '' : `<p>Pour publier depuis cet appareil, il faut une <b>clé GitHub</b> limitée à ce seul dépôt (à faire une fois) :</p>
    <ol class="etapes">
      <li>Ouvre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com › Settings › Fine-grained tokens › Generate new token</a>.</li>
      <li>Nom : <code>Éditeur du livre</code> · Expiration : au choix (par ex. 1 an).</li>
      <li>Repository access : <b>Only select repositories</b> › <code>${DEPOT.repo}</code>.</li>
      <li>Permissions › Repository permissions › <b>Contents : Read and write</b> (rien d’autre).</li>
      <li>Generate token, copie-le et colle-le ici :</li>
    </ol>
    <label for="jeton" style="font-weight:800">Clé GitHub</label>
    <input type="password" id="jeton" autocomplete="off" spellcheck="false" style="width:100%;padding:8px;border:2px solid var(--hairline);border-radius:8px" placeholder="github_pat_…">
    <p class="aide" style="color:var(--muted);font-size:13px">Elle reste uniquement dans ce navigateur (jamais dans le site ni dans le dépôt). « ⋯ Fichier › Oublier la clé » pour l’effacer.</p>`}
    <label for="message" style="font-weight:800;display:block;margin-top:10px">Description de la modification</label>
    <input type="text" id="message" value="Livre photo : modifications depuis l’éditeur" style="width:100%;padding:8px;border:2px solid var(--hairline);border-radius:8px">
    <p style="margin:14px 0 0"><button class="btn hot" id="go">⬆ Publier maintenant</button></p>
    <p id="pubEtat" role="status" style="font-weight:700;margin-top:10px"></p>`;
  $('go').addEventListener('click', publier);
}
async function publier() {
  const etat = (t) => { $('pubEtat').innerHTML = t; };
  const saisie = $('jeton')?.value.trim();
  const jeton = saisie || ls.get(CLE_JETON);
  if (!jeton) { etat('Colle d’abord la clé GitHub.'); return; }
  $('go').disabled = true;
  try {
    etat('Connexion à GitHub…');
    const ref = await gh(jeton, `/git/ref/heads/${DEPOT.branche}`);
    if (saisie) ls.set(CLE_JETON, saisie);
    const tete = ref.object.sha;
    // conflit : les fichiers ont-ils changé sur GitHub depuis l'ouverture de l'éditeur ?
    const [cm, cr] = await Promise.all([FICHIERS.mise, FICHIERS.recit].map((f) => gh(jeton, `/contents/${f}?ref=${tete}`)));
    const changes = [[cm, 'mise'], [cr, 'recit']].filter(([c, k]) => b64utf8(c.content) !== S.publieTexte[k]);
    if (changes.length && !confirm('Le livre a été modifié sur GitHub depuis l’ouverture de l’éditeur (autre appareil ?). Publier quand même écrasera ces changements. Continuer ?')) { etat('Publication annulée.'); return; }
    etat('Envoi des fichiers…');
    const commit = await gh(jeton, `/git/commits/${tete}`);
    const textes = { mise: texteJSON(S.mise), recit: texteJSON(S.recit) };
    const blobs = await Promise.all(['mise', 'recit'].map((k) => gh(jeton, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: textes[k], encoding: 'utf-8' }) })));
    const arbre = await gh(jeton, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: ['mise', 'recit'].map((k, n) => ({ path: FICHIERS[k], mode: '100644', type: 'blob', sha: blobs[n].sha })) }) });
    const msg = ($('message').value.trim() || 'Livre photo : modifications depuis l’éditeur') + '\n\nPublié depuis editeur.html';
    const nouveau = await gh(jeton, '/git/commits', { method: 'POST', body: JSON.stringify({ message: msg, tree: arbre.sha, parents: [tete] }) });
    await gh(jeton, `/git/refs/heads/${DEPOT.branche}`, { method: 'PATCH', body: JSON.stringify({ sha: nouveau.sha }) });
    S.publieTexte = textes; S.publie = { mise: structuredClone(S.mise), recit: structuredClone(S.recit) };
    ls.set(CLE_BROUILLON + '-base', JSON.stringify(S.publieTexte));
    majEtat();
    etat(`✅ Publié. Le site et les PDF se reconstruisent (2 à 4 minutes) : <a href="https://github.com/${DEPOT.owner}/${DEPOT.repo}/actions" target="_blank" rel="noopener">suivre la construction</a>.`);
  } catch (err) {
    if (err.status === 401) { ls.del(CLE_JETON); etat('❌ Clé refusée par GitHub (expirée ou mal copiée). Colle une nouvelle clé.'); ecranPublier(); }
    else if (err.status === 403 || err.status === 404) etat('❌ Accès refusé : vérifie que la clé donne « Contents : Read and write » sur ' + DEPOT.repo + '. (' + esc(err.message) + ')');
    else etat('❌ Échec : ' + esc(err.message));
  } finally { const b = $('go'); if (b) b.disabled = false; }
}
$('publier').addEventListener('click', () => { ecranPublier(); $('dlgPublier').showModal(); });

// ---------- navigation, raccourcis ----------
document.querySelectorAll('[data-ferme]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
const pas = (d) => { const i = sections.findIndex((s) => s.cle === S.cle) + d; if (sections[i]) allerA(sections[i].cle); };
$('prec').addEventListener('click', () => pas(-1));
$('suiv').addEventListener('click', () => pas(1));
$('annuler').addEventListener('click', annuler);
$('refaire').addEventListener('click', refaire);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select') || document.querySelector('dialog[open]')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? refaire() : annuler(); }
  else if (e.key === 'PageDown') pas(1); else if (e.key === 'PageUp') pas(-1);
});
addEventListener('resize', ajusterZoom);

// ---------- démarrage ----------
(async () => {
  try {
    const sansCache = { cache: 'no-store' };
    const [mise, recit, album, logo] = await Promise.all([
      fetch(FICHIERS.mise, sansCache).then((r) => r.text()),
      fetch(FICHIERS.recit, sansCache).then((r) => r.text()),
      fetch('photos/album.json').then((r) => r.json()),
      fetch('logo.svg').then((r) => r.text()),
    ]);
    S.publie = { mise: JSON.parse(mise), recit: JSON.parse(recit) };
    S.publieTexte = { mise: texteJSON(S.publie.mise), recit: texteJSON(S.publie.recit) };
    S.album = album; S.logo = logo;
    const chemins = [...new Set(S.publie.mise.pages.map((p) => p.carte).filter(Boolean))];
    for (const c of chemins) S.cartes[c] = await (await fetch(c)).text();
    // brouillon existant ?
    let b = null; try { b = JSON.parse(ls.get(CLE_BROUILLON)); } catch {}
    S.mise = structuredClone(S.publie.mise); S.recit = structuredClone(S.publie.recit);
    if (b?.mise && b?.recit && (texteJSON(b.mise) !== S.publieTexte.mise || texteJSON(b.recit) !== S.publieTexte.recit)) {
      S.mise = b.mise; S.recit = b.recit;
      const ban = $('banniere');
      ban.innerHTML = `📝 Brouillon repris (${new Date(b.t).toLocaleString('fr-FR')}), pas encore publié. <button class="btn sm" id="banPub">Voir la version publiée</button><button class="btn sm" id="banOk">OK</button>`;
      ban.hidden = false;
      $('banOk').onclick = () => { ban.hidden = true; };
      $('banPub').onclick = () => { ban.hidden = true; $('revenir').click(); };
    }
    await preparerApercu();
    toutRendre();
    majEtat();
  } catch (err) {
    $('etat').textContent = 'erreur de chargement : ' + err.message;
    console.error(err);
  }
})();
