/* SMARTGuard frontend – V26 (AVK +/+ default, hurok input debounce, mobil layout fix) */
console.log("%cSMARTGuard app.js V26 betöltve","background:#0f7ac0;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold");

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function clone(v) {
  return typeof window.structuredClone === "function" ? window.structuredClone(v) : JSON.parse(JSON.stringify(v));
}

// ─── HATÁRÉRTÉKEK ────────────────────────────────────────────────────────────
const BREAKER_LIMITS = {
  // B karakterisztika (5×In)
  "B2":  23.0, "B4": 11.5, "B6": 7.67, "B10": 4.60, "B13": 3.54, "B16": 2.88,
  "B20": 2.30, "B25": 1.84, "B32": 1.44, "B40": 1.15, "B50": 0.92, "B63": 0.73,
  // C karakterisztika (10×In)
  "C2":  11.5, "C4": 5.75, "C6": 3.83, "C10": 2.30, "C13": 1.77, "C16": 1.44,
  "C20": 1.15, "C25": 0.92, "C32": 0.72, "C40": 0.58, "C50": 0.46, "C63": 0.36,
  // D karakterisztika (20×In)
  "D6":  1.92, "D10": 1.15, "D13": 0.88, "D16": 0.72,
  "D20": 0.58, "D25": 0.46, "D32": 0.36,
  // FI/RCD (csak jelzés, nincs hurokimpedancia limit)
  "FI": null, "RCD": null,
};

// AVK leoldási tartományok (IΔn alapján)
// deltaMa: névleges érzékenység (10/30/100 mA)
// iDeltaMa: mért leoldási áram, timeMs: mért leoldási idő
const AVK_RANGES = {
  "10":  { minI: 6,   maxI: 10,  maxT: 300 },
  "30":  { minI: 16,  maxI: 30,  maxT: 300 },
  "100": { minI: 51,  maxI: 100, maxT: 300 },
};

function autoAvkStatus(row) {
  // Ha hiba szöveg vagy severity van → NMF
  if (row.fault || row.severity) return "NMF";
  // Mp (működési próba) negatív → NMF
  if (row.mp === "-") return "NMF";
  // Szv (szemrevételezés) negatív → NMF
  if (row.szv === "-") return "NMF";
  // Ha nincs mért adat → üres
  if (!row.iDeltaMa && !row.timeMs) return "";
  
  const deltaMa = String(row.deltaMa || "").trim();
  const range = AVK_RANGES[deltaMa];
  if (!range) return ""; // ismeretlen érzékenység

  let ok = true;

  // Mért leoldási áram ellenőrzése
  if (row.iDeltaMa) {
    const measI = parseFloat(String(row.iDeltaMa).replace(",", "."));
    if (!isNaN(measI)) {
      if (measI < range.minI || measI > range.maxI) ok = false;
    }
  }

  // Mért leoldási idő ellenőrzése
  if (row.timeMs) {
    const measT = parseFloat(String(row.timeMs).replace(",", "."));
    if (!isNaN(measT)) {
      if (measT > range.maxT) ok = false;
    }
  }

  return ok ? "MF" : "NMF";
}

// LÁMPATEST-FELISMERÉS: ha a mérési pont megnevezése lámpatestre utal,
// az eszköz jellemzően II. (kettős/megerősített szigetelésű) osztály,
// ahol nincs PE és nincs mit mérni (KSZ).
var LUMINAIRE_WORDS = ["lámpa","lampa","lámpatest","lampatest","armatúra","armatura",
  "led panel","panel","bulkhead","downlight","downlighter","spot","exit",
  "vészvilág","veszvilag","reflektor","fénycső","fenycso","mennyezeti","oldalfali",
  "függeszt","fuggeszt","csillár","csillar","tükörvilág","tukorvilag"];
function looksLikeLuminaire(text) {
  var s = String(text || "").toLowerCase();
  if (!s.trim()) return false;
  return LUMINAIRE_WORDS.some(function (w) { return s.indexOf(w) !== -1; });
}

function autoHurokStatus(breaker, valueOhm, fault, severity) {
  if (fault || severity) return "NMF";
  // KSZ = Kettős Szigetelés – szemrevételezéssel megfelelt, nem mérünk
  if (String(valueOhm).trim().toUpperCase() === "KSZ") return "MF";
  if (!valueOhm || !breaker) return "";
  const val = parseFloat(String(valueOhm).replace(",", "."));
  if (isNaN(val)) return "";
  const limit = BREAKER_LIMITS[breaker.trim().toUpperCase()];
  if (limit === undefined) return "";
  return val <= limit ? "MF" : "NMF";
}

// Visszafelé kompatibilitás
function autoStatus(breaker, valueOhm, fault, severity) {
  return autoHurokStatus(breaker, valueOhm, fault, severity);
}

// ─── SCORING ─────────────────────────────────────────────────────────────────
const defaultScoring = {
  categories: [
    { id: "hurok", name: "Hurok",        weight: 30 },
    { id: "eph",   name: "EPH",          weight: 20 },
    { id: "avk",   name: "AVK",          weight: 20 },
    { id: "eloszto", name: "Elosztók",   weight: 25 },
    { id: "dok",   name: "Dokumentáció", weight: 5 },
  ],
  penalties: { A: 25, B: 5, C: 3, D: 1 },
  thresholds: [
    { id: "excellent", label: "Kiváló",                  min: 90 },
    { id: "good",      label: "Jó",                      min: 75 },
    { id: "acceptable",label: "Megfelelő, de javítandó", min: 59 },
    { id: "weak",      label: "Gyenge",                  min: 39 },
  ],
};

const storageKey = "smartguard-mvp-state-v14";
const legacyKeys = ["smartguard-mvp-state-v13","smartguard-mvp-state-v9","smartguard-mvp-state-v8"];
const channel = "BroadcastChannel" in window ? new BroadcastChannel("smartguard-mvp") : null;
const avkDefaultTypes = ["Schneider","Schrack","Omusystem","ETI","EATON","ABB","Stilo","Hager","Legrand","Tracon"];

const TUZVEDELEM_OSZTALYOK = ["–","A","B","C","D","E","Irodai","Technológiai","Raktár","Egyéb"];

const defaultAlapdok = {
  hely: "", megrendelo: "", kisero: "", idotartam: "",
  felelos: "Nyikos Dániel", vegzettseg: "Villamos Biztonsági Felülvizsgáló",
  vbf_szam: "SZVSZ/2025/24/010", tuz_szam: "OKVI-1683/14/2025",
  kov1: "", kov2: "", kov3: "", kov4: "",
  feszultseg: "400/230 V 50 Hz", halozat: "TN-C-S (TN)",
  foldelestype: "Betonalap földelés",
  erintesvedelmi: "Táplálás önműködő lekapcsolása - nullázás",
  betaplalasmod: "Áramszolgáltatói 400V", tartalek: "-", ev: "",
  cb: {
    tn_c:false, tn_s:false, tn_cs:true, tt:false, it:false,
    kmsz:true, velv:false, selv:false,
    rcd:true, keph:true,
    ke:false, heph:false, velvt:false,
    eph:true,
    asz:true, vf:true, vb:true,
    va:false, eh:false,
    ev0:false, ev1:true, ev2:true, ev3:false,
  },
  vizsgalat: [
    // [label, ertek, megjegyzes]
    ["a) a rögzített villamos berendezés szerkezetei megfelelnek a termékszabványnak","MF","-"],
    ["b) az MSZ HD 60364 szerint kiválasztásuk és szerelésük megfelelő","MF","-"],
    ["c) nincsen látható sérülés, amely csökkentené a biztonságot","MF","-"],
    ["a) az áramütés elleni védelmi mód (IEC 60364-4-41)","MF","-"],
    ["b) tűzgátló szerkezetek és hőhatások elleni védelem megléte","MF","-"],
    ["c) a vezetők megfelelő kiválasztása a megengedett áram szempontjából","MF","-"],
    ["d) védelmi eszközök kiválasztása, beállítása, szelektivitása és koordinációja","MF","-"],
    ["e) túlfeszültség-védelmi eszközök (SPD) kiválasztása és szerelése","MF","-"],
    ["f) leválasztó- és kapcsolókészülékek kiválasztása és szerelése","MF","-"],
    ["g) villamos szerkezetek kiválasztása külső hatásoknak megfelelően","MF","-"],
    ["h) a nulla- és a védővezető megjelölése (514.3)","MF","-"],
    ["i) kapcsolási rajzok, figyelmeztető feliratok megléte (514.5)","MF","-"],
    ["j) az áramkörök, túláramvédelmi eszközök, kapcsolók megjelölése (514)","MF","-"],
    ["k) kábelek és vezetékek végződéseinek megfelelősége (526)","MF","-"],
    ["l) földelőberendezések és védővezetők kiválasztása és szerelése","MF","-"],
    ["m) könnyű kezelhetőség, azonosíthatóság, karbantarthatóság (513-514)","MF","-"],
    ["n) elektromágneses zavarok elleni intézkedések (444)","MF","-"],
    ["o) test csatlakoztatása a földelőberendezéshez (411)","MF","-"],
    ["p) kábel- és vezetékrendszerek kiválasztása és szerelése (521-522)","MF","-"],
    ["a) a vezetők folytonossága (6.4.3.2.) – MSZ EN 61557-4:2007","MF","Jegyzőkönyv"],
    ["b) szigetelési ellenállás állandó üzemelés miatt szemrevételezéssel","MF","-"],
    ["c) szigetelési ellenállás SELV, PELV és villamos elválasztás ellenőrzéséhez (6.4.3.4.)","NA","-"],
    ["d) szigetelési ellenállás padlózat és fal ellenállásának ellenőrzéséhez (61.3.5)","NA","-"],
    ["e) polaritás vizsgálata (6.4.3.6.)","NA","-"],
    ["f) táplálás önműködő lekapcsolásával megvalósított védelmi mód (6.4.3.7.)","MF","Jegyzőkönyv"],
    ["g) kiegészítő védelem hatásosságát (6.4.3.8.)","MF","-"],
    ["h) a fázissorrendet (6.4.3.9.)","MF","-"],
    ["i) a működést (6.4.3.10.)","MF","-"],
    ["j) a feszültségesést (6.4.3.11.)","MF","-"],
  ],
};

const initialState = {
  customerName: "",
  siteAddress: "",
  munkaszam: "",
  inspectionDate: new Date().toISOString().slice(0, 10),
  protocolNumbers: { hurok: "", avk: "", eloszto: "" },
  protocolBodies:  { hurok: "", avk: "", eloszto: "" },
  alapdok: clone(defaultAlapdok),
  rooms: [],
  avkTypes: avkDefaultTypes,
  scoring: clone(defaultScoring),
  collapsedRooms: {},
  collapsedAvkDists: {},
  collapsedEloszto: {},
  hurokRows: [],
  avkRows: [],
  elosztoRows: [],
  lezarva: false,
  lezarvaDatum: "",
  ajanlat: { hibaArak:{}, szolgChecked:{}, szolgArak:{}, sgChecked:{}, sgArak:{}, afa:0.27 },
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey) || legacyKeys.map(k=>localStorage.getItem(k)).find(Boolean);
    return migrateState(raw ? JSON.parse(raw) : clone(initialState));
  } catch { return clone(initialState); }
}

function migrateState(loaded) {
  const next = Object.assign({}, clone(initialState), loaded);
  next.scoring = {
    categories: loaded.scoring?.categories || clone(defaultScoring.categories),
    penalties:  Object.assign({}, defaultScoring.penalties, loaded.scoring?.penalties || {}),
    thresholds: loaded.scoring?.thresholds || clone(defaultScoring.thresholds),
  };
  next.rooms = (loaded.rooms?.length ? loaded.rooms : clone(initialState.rooms)).map(r => ({
    defaultDistributor:"", defaultBreakerDugalj:"", defaultBreakerVilagitas:"", tuzvedelem:"–", ...r
  }));
  next.alapdok = Object.assign({}, clone(defaultAlapdok), loaded.alapdok || {});
  next.alapdok.cb = Object.assign({}, clone(defaultAlapdok.cb), loaded.alapdok?.cb || {});
  if (!next.alapdok.vizsgalat || !next.alapdok.vizsgalat.length) next.alapdok.vizsgalat = clone(defaultAlapdok.vizsgalat);
  next.avkTypes      = loaded.avkTypes?.length ? loaded.avkTypes : avkDefaultTypes;
  next.hurokRows     = (loaded.hurokRows || clone(initialState.hurokRows)).map(r => ({ type:"hurok", ...r }));
  next.avkRows       = (loaded.avkRows   || clone(initialState.avkRows)).map(r   => ({ distributorId:"", ...r }));
  next.elosztoRows   = (loaded.elosztoRows || clone(initialState.elosztoRows)).map(d => ({
    hurokL1:"", hurokL2:"", hurokL3:"", feszL1:"", ...d
  }));
  next.collapsedRooms    = loaded.collapsedRooms    || {};
  next.collapsedAvkDists = loaded.collapsedAvkDists || {};
  next.protocolNumbers = loaded.protocolNumbers || { hurok:makeProtocolNumber(next,"HUROK"), avk:makeProtocolNumber(next,"AVK"), eloszto:makeProtocolNumber(next,"ELOSZTO") };
  if (!next.protocolNumbers.hurok)   next.protocolNumbers.hurok   = makeProtocolNumber(next,"HUROK");
  if (!next.protocolNumbers.avk)     next.protocolNumbers.avk     = makeProtocolNumber(next,"AVK");
  if (!next.protocolNumbers.eloszto) next.protocolNumbers.eloszto = makeProtocolNumber(next,"ELOSZTO");
  next.protocolBodies = loaded.protocolBodies || { hurok:"", avk:"", eloszto:"" };
  if (!next.protocolBodies.hurok)   next.protocolBodies.hurok   = makeProtocolBody("hurok", next);
  if (!next.protocolBodies.avk)     next.protocolBodies.avk     = makeProtocolBody("avk", next);
  if (!next.protocolBodies.eloszto) next.protocolBodies.eloszto = makeProtocolBody("eloszto", next);
  ensureMinimumRows(next);
  return next;
}

function ensureMinimumRows(target) {
  // Nem töltünk fel automatikusan üres sorokat.
  // A felhasználó a "+ 10 sor" gombokkal adhat hozzá sorokat.
}

function emptyHurokRow(no, roomId, room, type) {
  room = room || state.rooms.find(r => r.id === roomId) || {};
  const rowType = type || "hurok";
  const breaker = rowType === "hurok" ? (room.defaultBreakerDugalj||"") : (room.defaultBreakerVilagitas||"");
  return { id:uid(), no, roomId, type:rowType, point:"", modeClass:"I",
    distributor: room.defaultDistributor||"", breaker,
    pe:"-", valueOhm:"", status:"", severity:"", fault:"" };
}

function emptyAvkRow(no, distributorId, place, type) {
  return { id:uid(), no, distributorId:distributorId||"", place:place||"", mark:"", type:type||"Schrack",
    inA:"16", deltaMa:"30", unV:"230", poles:"2", iDeltaMa:"", timeMs:"", mp:"+", szv:"+", status:"", severity:"", fault:"" };
}

function saveState(source) {
  localStorage.setItem(storageKey, JSON.stringify(state));
  setSyncState("Mentve");
  if (channel && source !== "remote") _broadcastDebounced();
}

// Gépelés közbeni mentés: NE írjunk localStorage-ba minden leütésre
// (nagy adatnál – pl. sok hurok-sor – ez fagyasztotta le a gépet PC-n).
// A blur/change/gomb események úgyis azonnal mentenek.
var _saveDebounceTimer = null;
function saveStateDebounced() {
  setSyncState("Mentés…");
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(function () {
    _saveDebounceTimer = null;
    saveState();
  }, 400);
}
// A localStorage-mentés AZONNALI (nincs adatvesztés), de a fülek közti
// broadcastot debounce-oljuk: gépelés közben ne küldjünk minden leütésre
// teljes state-et a többi fülnek (az ott teljes render()-t indítana).
var _broadcastTimer = null;
function _broadcastDebounced() {
  if (_broadcastTimer) clearTimeout(_broadcastTimer);
  _broadcastTimer = setTimeout(function () {
    _broadcastTimer = null;
    try { channel.postMessage(state); } catch (e) {}
  }, 350);
}
// Másik fülből érkező state: a teljes render()-t debounce-oljuk, hogy egy
// gyors gépelési sorozat ne indítson minden üzenetre teljes újrarajzolást.
var _remoteData = null, _remoteTimer = null;
function _remoteRenderDebounced() {
  if (_remoteTimer) clearTimeout(_remoteTimer);
  _remoteTimer = setTimeout(function () {
    _remoteTimer = null;
    state = migrateState(_remoteData);
    saveState("remote");
    render();
  }, 250);
}
function setSyncState(text) {
  document.querySelector("#syncState").textContent = text;
  if (text !== "Mentve") window.setTimeout(() => document.querySelector("#syncState").textContent = "Mentve", 900);
}

function categories() { return state.scoring.categories; }
function penalties()   { return state.scoring.penalties; }

function makeProtocolNumber(source, suffix) {
  const year     = new Date(source.inspectionDate || Date.now()).getFullYear();
  const customer = slugify(source.customerName || "UGYFEL").slice(0,4).toUpperCase();
  const site     = slugify(source.siteAddress   || "HELY").slice(0,6).toUpperCase();
  return `VBF-${year}-${customer}-${site}-${suffix}-001`;
}

// ─── HIBÁK & HIÁNYOS ADATOK ──────────────────────────────────────────────────

function allFaultRows() {
  // Hurok hibák (type === "hurok")
  const hurokFaults = state.hurokRows.filter(r => r.severity && isFilledHurok(r) && r.type !== "eph")
    .map(r => ({ category:"hurok", severity:r.severity, text:`${roomName(r.roomId)} – ${r.point}: ${r.fault}`, isNA:false }));
  // EPH hibák (type === "eph")
  const ephFaults = state.hurokRows.filter(r => r.severity && isFilledHurok(r) && r.type === "eph")
    .map(r => ({ category:"eph", severity:r.severity, text:`${roomName(r.roomId)} – ${r.point}: ${r.fault}`, isNA:false }));
  const avkFaults = state.avkRows.filter(r => r.severity && isFilledAvk(r))
    .map(r => ({ category:"avk", severity:r.severity, text:`${r.place} – ${r.mark}: ${r.fault}`, isNA:false }));
  const elosztóFaults = [];
  state.elosztoRows.forEach(d => d.faults.filter(f=>f.severity).forEach(f =>
    elosztóFaults.push({ category:"eloszto", severity:f.severity, text:`${d.name}: ${f.text}`, isNA:false })));
  const dokFaults = state.elosztoRows.filter(r=>r.documentation==="NMF")
    .map(r => ({ category:"dok", severity:"D", text:`${r.name}: tervdokumentáció hiányzik`, isNA:false }));

  // NA sorok
  const hurokNA = state.hurokRows.filter(r => r.status==="NA" && isFilledHurok(r) && r.type !== "eph")
    .map(r => ({ category:"hurok", severity:"NA", text:`${roomName(r.roomId)} – ${r.point}`, isNA:true }));
  const ephNA = state.hurokRows.filter(r => r.status==="NA" && isFilledHurok(r) && r.type === "eph")
    .map(r => ({ category:"eph", severity:"NA", text:`${roomName(r.roomId)} – ${r.point}`, isNA:true }));
  const avkNA = state.avkRows.filter(r => r.status==="NA" && isFilledAvk(r))
    .map(r => ({ category:"avk", severity:"NA", text:`${r.place} – ${r.mark}`, isNA:true }));

  return [...hurokFaults, ...ephFaults, ...avkFaults, ...elosztóFaults, ...dokFaults, ...hurokNA, ...ephNA, ...avkNA];
}

function categoryScore(catId) {
  const faults = allFaultRows().filter(r => r.category===catId && !r.isNA);
  const hasData = hasCategoryData(catId);
  if (!hasData && !faults.length) return 100;
  const penalty = faults.reduce((s,r) => s+(Number(penalties()[r.severity])||0), 0);
  return Math.max(0, Math.round(100-penalty));
}

function hasCategoryData(id) {
  if (id==="hurok")   return state.hurokRows.some(r => isFilledHurok(r) && r.type !== "eph");
  if (id==="eph")     return state.hurokRows.some(r => isFilledHurok(r) && r.type === "eph");
  if (id==="avk")     return state.avkRows.some(isFilledAvk);
  if (id==="eloszto") return state.elosztoRows.length > 0;
  if (id==="dok")     return state.elosztoRows.some(r=>r.documentation);
  return false;
}
function isFilledHurok(r) { return !!(r.point||r.distributor||r.breaker||r.valueOhm||r.status||r.severity||r.fault); }
function isFilledAvk(r)   { return !!(r.place||r.mark||r.inA||r.iDeltaMa||r.timeMs||r.status||r.severity||r.fault); }

function totalWeight() { return categories().reduce((s,c)=>s+Number(c.weight||0),0); }
function totalScore() {
  const w = totalWeight()||1;
  return Math.round(categories().reduce((s,c)=>s+categoryScore(c.id)*(Number(c.weight||0)/w),0));
}
function qualification(score) {
  const t = state.scoring.thresholds.slice().sort((a,b)=>b.min-a.min).find(t=>score>=t.min);
  return t ? t.label : "Nem megfelelő";
}
function actionLevel() {
  const f = allFaultRows().filter(r=>!r.isNA);
  if (f.some(r=>r.severity==="A")) return "Azonnali";
  if (f.some(r=>r.severity==="B")||totalScore()<70) return "Sürgős";
  if (totalScore()<80) return "Ütemezett";
  return "Tervezett";
}
function categoryColor(v) {
  if (v>=90) return "var(--green)"; if (v>=80) return "var(--lime)";
  if (v>=70) return "var(--yellow)"; if (v>=50) return "var(--orange)"; return "var(--red)";
}
function categoryColorHex(v) {
  if (v>=90) return "#1f9d55"; if (v>=80) return "#74b816";
  if (v>=70) return "#f2b705"; if (v>=50) return "#e67700"; return "#c92a2a";
}
function severityColor(s)    { return {A:"var(--red)",B:"var(--orange)",C:"var(--yellow)",D:"var(--blue-2)"}[s]||"#8792a2"; }
function severityColorHex(s) { return {A:"#c92a2a",B:"#e67700",C:"#f2b705",D:"#1478b8"}[s]||"#8792a2"; }

// ─── RENDER ──────────────────────────────────────────────────────────────────
function render() {
  renderSite(); renderDashboard(); renderRooms(); renderAvkTypes();
  renderHurokTable(); renderAvkTable(); renderElosztoTable();
  renderProtocol(); renderReports(); renderSettings(); renderAlapdok(); renderAjanlat(); renderKeszGomb();
}

function renderScoreOnly() {
  renderKeszGomb();
  const score = totalScore();
  document.querySelector("#smartScore").textContent = score;
  document.querySelector("#qualification").textContent = `${qualification(score)} – intézkedési szint: ${actionLevel()}`;
  document.querySelector("#categoryGrid").innerHTML = categories().map(categoryCard).join("");
  renderCriticalList();
  renderClientViews();
  renderReports(); // Riport fül is azonnal frissül!
}

// Gépelés közbeni teljesítmény: a nehéz pontszám-/riport-újraszámítást
// debounce-oljuk, hogy ne fusson le minden egyes billentyűleütésre
// (nagy adathalmaznál ez okozta a lefagyást). A blur-kezelő úgyis
// azonnal frissít, amikor kilépsz a mezőből.
var _scoreDebounceTimer = null;
function renderScoreOnlyDebounced() {
  if (_scoreDebounceTimer) clearTimeout(_scoreDebounceTimer);
  _scoreDebounceTimer = setTimeout(function () {
    _scoreDebounceTimer = null;
    renderScoreOnly();
  }, 250);
}

function renderCriticalList() {
  const faults = allFaultRows();
  const errors  = faults.filter(r => !r.isNA && (r.severity==="A"||r.severity==="B"));
  const naHurok = faults.filter(r => r.isNA && r.category==="hurok");
  const naAvk   = faults.filter(r => r.isNA && r.category==="avk");

  let html = "";
  if (errors.length) {
    html += errors.map(r => `<div class="compact-item"><span>${r.text}</span><span class="pill" style="background:${severityColor(r.severity)}">${r.severity}</span></div>`).join("");
  } else {
    html += `<p>Nincs A vagy B szintű hiba.</p>`;
  }
  if (naHurok.length) {
    html += `<div class="na-section-label">Nincs adat – Hurok + EPH</div>`;
    html += naHurok.map(r => `<div class="compact-item na-item"><span>${r.text}</span><span class="pill pill-na">NA</span></div>`).join("");
  }
  if (naAvk.length) {
    html += `<div class="na-section-label">Nincs adat – AVK</div>`;
    html += naAvk.map(r => `<div class="compact-item na-item"><span>${r.text}</span><span class="pill pill-na">NA</span></div>`).join("");
  }
  document.querySelector("#criticalList").innerHTML = html;
}

function renderSite() {
  document.querySelector("#customerName").value   = state.customerName;
  document.querySelector("#siteAddress").value    = state.siteAddress;
  document.querySelector("#munkaszam") && (document.querySelector("#munkaszam").value = state.munkaszam || "");
  document.querySelector("#inspectionDate").value = state.inspectionDate;
  document.querySelector("#protocolHurok").value  = state.protocolNumbers.hurok;
  document.querySelector("#protocolAvk").value    = state.protocolNumbers.avk;
  document.querySelector("#protocolEloszto").value= state.protocolNumbers.eloszto;
  document.querySelector("#siteTitle").textContent= `${state.customerName} – ${state.siteAddress}`;
}

function renderDashboard() {
  const score = totalScore();
  document.querySelector("#smartScore").textContent    = score;
  document.querySelector("#qualification").textContent = `${qualification(score)} – intézkedési szint: ${actionLevel()}`;
  document.querySelector("#categoryGrid").innerHTML    = categories().map(categoryCard).join("");
  renderCriticalList();
  document.querySelector("#protocolList").innerHTML = `
    <div class="compact-item"><span>Hurok + EPH</span><strong>${state.protocolNumbers.hurok}</strong></div>
    <div class="compact-item"><span>AVK</span><strong>${state.protocolNumbers.avk}</strong></div>
    <div class="compact-item"><span>Elosztó + dokumentáció</span><strong>${state.protocolNumbers.eloszto}</strong></div>`;
  renderClientViews();
}

function categoryCard(c) {
  const v = categoryScore(c.id);
  return `<article class="category-card"><strong>${c.name}</strong><div class="bar-track"><div class="bar-fill" style="width:${v}%;background:${categoryColor(v)}"></div></div><div class="category-meta"><span>${v}%</span><span>${c.weight}% súly</span></div></article>`;
}

// ─── HELYISÉGEK ──────────────────────────────────────────────────────────────
function renderRooms() {
  const headerRow = `<div class="room-header-row">
    <div class="room-header-cell" style="flex:1.5">Helyiség neve</div>
    <div class="room-header-cell" style="width:80px">Elosztó</div>
    <div class="room-header-cell" style="width:70px">Dugalj</div>
    <div class="room-header-cell" style="width:70px">Világ.</div>
    <div class="room-header-cell" style="width:90px">EBF osztály</div>
    <div class="room-header-cell" style="width:36px"></div>
  </div>`;

  document.querySelector("#roomList").innerHTML = headerRow + state.rooms.map(room => `
    <div class="room-compact-row">
      <input class="room-compact-cell" style="flex:1.5" data-room-name="${room.id}" value="${escapeHtml(room.name)}" placeholder="Helyiség neve" />
      <input class="room-compact-cell" style="width:80px" data-room-dist="${room.id}" value="${escapeHtml(room.defaultDistributor||"")}" placeholder="FE" />
      <input class="room-compact-cell" style="width:70px" data-room-breaker-dugalj="${room.id}" value="${escapeHtml(room.defaultBreakerDugalj||"")}" placeholder="B16" />
      <input class="room-compact-cell" style="width:70px" data-room-breaker-vilagitas="${room.id}" value="${escapeHtml(room.defaultBreakerVilagitas||"")}" placeholder="B10" />
      <select class="room-compact-cell" style="width:90px" data-room-tuzvedelem="${room.id}">
        ${TUZVEDELEM_OSZTALYOK.map(o=>`<option value="${o}" ${(room.tuzvedelem||"–")===o?"selected":""}>${o}</option>`).join("")}
      </select>
      <button class="row-delete-btn" data-room-delete="${room.id}" title="Törlés">×</button>
    </div>`).join("");
}

function renderAvkTypes() {
  document.querySelector("#avkTypeList").innerHTML = state.avkTypes.map(t =>
    `<span class="type-chip">${t}<button data-type-delete="${t}">×</button></span>`).join("");
}

// ─── HUROK TÁBLA ─────────────────────────────────────────────────────────────
// Fejléc csak a nyitott szekció BELSEJÉBEN, közvetlenül a sorok felett
function hurokHeaderRow() {
  var cols = ["Ssz.","Típus","Mérési pont / megnevezés","Mód","Elosztó","Megszakító","PE","Érték [Ω]","Max Zs","Minősítés","Hiba kat.","Hiba",""];
  // Desktop és mobil oszlopszélességek pontosan egyeznek a CSS grid-del
  var isMobile = window.innerWidth <= 640;
  var widths = isMobile
    ? [48, 72, 220, 72, 100, 90, 72, 90, 72, 100, 90, 180, 36]   // mobil: grid-template-columns
    : [52, 80, 260, 80, 110, 100, 80, 100, 80, 110, 100, 200, 36]; // desktop
  var tds = cols.map(function(h,i){
    return '<td style="width:'+widths[i]+'px;padding:4px 3px;color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;white-space:nowrap;overflow:hidden;border-right:1px solid #1e3f5a;box-sizing:border-box;">'+h+'</td>';
  }).join('');
  var totalW = widths.reduce(function(a,b){return a+b;},0);
  return '<table style="border-collapse:collapse;background:#0d1f2d;width:'+totalW+'px;table-layout:fixed;"><tbody><tr>'+tds+'</tr></tbody></table>';
}

function renderHurokTable() {
  const el = document.querySelector("#hurokGrid");

  if (state.rooms.length === 0) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:#667084;background:#fff;border-radius:8px;border:1px solid #d7dee8">
      <div style="font-size:32px;margin-bottom:12px">🏠</div>
      <strong style="display:block;font-size:16px;color:#172331;margin-bottom:8px">Még nincs helyiség felvéve</strong>
      <p style="margin:0;font-size:14px">A hurok adatok helyiségenkéntcsoportosítva jelennek meg.<br>
      Kattints a <strong>„+ Új helyiség"</strong> gombra vagy menj a <strong>Helyiségek</strong> fülre.</p>
    </div>`;
    return;
  }

  const grouped = {};
  state.rooms.forEach(r => { grouped[r.id] = []; });
  grouped["__egyeb__"] = [];
  state.hurokRows.forEach(row => {
    const key = grouped[row.roomId] !== undefined ? row.roomId : "__egyeb__";
    grouped[key].push(row);
  });

  const sections = state.rooms.map(room => {
    const rows        = grouped[room.id] || [];
    const isCollapsed = !!state.collapsedRooms[room.id];
    const filledCount = rows.filter(isFilledHurok).length;
    const faultCount  = rows.filter(r => r.severity==="A"||r.severity==="B").length;

    const rowsHtml = rows.map((row, localIdx) => {
      const limit = BREAKER_LIMITS[(row.breaker||"").trim().toUpperCase()];
      const limitStr = limit !== undefined ? limit.toFixed(2) : "–";
      const isKsz = String(row.valueOhm||"").trim().toUpperCase() === "KSZ";
      const displayNo = localIdx + 1; // 1-től indul minden helyiségben
      return `<div class="grid-row hurok-row-13">
        ${cell(`<span class="row-no-badge">${displayNo}</span>`)}
        ${cell(`<select data-hurok="${row.id}" data-field="type"><option value="hurok" ${row.type==="hurok"?"selected":""}>Hurok</option><option value="eph" ${row.type==="eph"?"selected":""}>EPH</option></select>`)}
        ${cell(`<input data-hurok="${row.id}" data-field="point" value="${escapeHtml(row.point)}">`)}
        ${cell(selectHtml("hurok",row.id,"modeClass",["I","II"],row.modeClass))}
        ${cell(`<input data-hurok="${row.id}" data-field="distributor" value="${escapeHtml(row.distributor)}">`)}
        ${cell(`<input data-hurok="${row.id}" data-field="breaker" value="${escapeHtml(row.breaker)}">`)}
        ${cell(`<span style="font-weight:700;color:${row.pe==='OK'?'#1f9d55':row.pe==='nem OK'?'#c92a2a':'#8792a2'}">${row.pe||'-'}</span>`)}
        ${cell(`<input data-hurok="${row.id}" data-field="valueOhm" value="${escapeHtml(row.valueOhm)}">`)}
        ${cell(`<span class="limit-badge ${isKsz?"ksz-badge":limitStr!=="–"?"":"limit-unknown"}">${isKsz?"KSZ ✓":limitStr}</span>`)}
        ${cell(`<select data-hurok="${row.id}" data-field="status" style="${row.manualStatus?'border:2px solid #e67700;':''}">
          ${'<option value="">–</option><option value="MF" '+((row.status==="MF")?"selected":"")+'>MF</option><option value="NMF" '+((row.status==="NMF")?"selected":"")+'>NMF</option><option value="NA" '+((row.status==="NA")?"selected":"")+'>NA</option>'}
        </select>`)}
        ${cell(selectHtml("hurok",row.id,"severity",["","A","B","C","D"],row.severity))}
        ${cell(`<input data-hurok="${row.id}" data-field="fault" value="${escapeHtml(row.fault)}">`)}
        ${cell(`<button class="row-multiply-btn" data-multiply-hurok="${row.id}" title="Sor többszörözése (pl. 50 azonos lámpatest)" style="border:0;background:transparent;cursor:pointer;font-weight:700;color:#0b5fd4;font-size:13px;">⊞×N</button><button class="row-delete-btn" data-delete-hurok="${row.id}" title="Sor törlése">×</button>`)}
      </div>`;
    }).join("");

    return `<div class="room-section ${isCollapsed?"collapsed":""}">
      <div class="room-section-header" data-toggle-room="${room.id}">
        <span class="room-toggle-icon">${isCollapsed?"▶":"▼"}</span>
        <strong class="room-section-name">${escapeHtml(room.name)}</strong>
        ${room.level?`<span class="room-section-level">${escapeHtml(room.level)}</span>`:""}
        <span class="room-section-count">${rows.length} sor</span>
        ${filledCount>0?`<span class="room-done-badge">${filledCount} kitöltve</span>`:""}
        ${faultCount>0?`<span class="room-fault-badge">${faultCount} kritikus</span>`:""}
        ${room.defaultBreakerDugalj||room.defaultBreakerVilagitas?`<span class="room-breaker-badge">⚡ D:${room.defaultBreakerDugalj||"–"} V:${room.defaultBreakerVilagitas||"–"}</span>`:""}
      </div>
      <div class="room-section-body">
        ${!isCollapsed ? `
          <div class="room-section-actions">
            <button class="room-add-btn" data-add-room-rows="${room.id}" data-row-type="hurok">+ 10 Hurok sor</button>
            <button class="room-add-btn room-add-eph" data-add-room-rows="${room.id}" data-row-type="eph">+ 10 EPH sor</button>
          </div>
          ${hurokHeaderRow()}
          ${rowsHtml}` : ""}
      </div>
    </div>`;
  }).join("");

  document.querySelector("#hurokGrid").innerHTML = sections;
}

// ─── AVK TÁBLA ───────────────────────────────────────────────────────────────
function avkHeaderRow() {
  var cols = ["Ssz.","Jele","Típus","In [A]","Δn [mA]","Un [V]","pólus","IΔn [mA]","t [ms]","MP","SZV","Minősítés","Hiba kat.","Hiba",""];
  var isMobile = window.innerWidth <= 640;
  var widths = isMobile
    ? [48, 90, 130, 64, 74, 64, 60, 84, 84, 56, 56, 94, 90, 160, 36]   // mobil
    : [52, 100, 140, 70, 80, 70, 66, 90, 90, 60, 60, 100, 96, 160, 36]; // desktop
  var tds = cols.map(function(h,i){
    return '<td style="width:'+widths[i]+'px;padding:4px 3px;color:#fff;font-size:9px;font-weight:800;text-transform:uppercase;white-space:nowrap;overflow:hidden;border-right:1px solid #1e3f5a;box-sizing:border-box;">'+h+'</td>';
  }).join('');
  var totalW = widths.reduce(function(a,b){return a+b;},0);
  return '<table style="border-collapse:collapse;background:#0d1f2d;width:'+totalW+'px;table-layout:fixed;"><tbody><tr>'+tds+'</tr></tbody></table>';
}

function renderAvkTable() {
  const el = document.querySelector("#avkGrid");

  // Ha nincs elosztó, útmutató
  if (state.elosztoRows.length === 0) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:#667084;background:#fff;border-radius:8px;border:1px solid #d7dee8">
      <div style="font-size:32px;margin-bottom:12px">⚡</div>
      <strong style="display:block;font-size:16px;color:#172331;margin-bottom:8px">Még nincs elosztó felvéve</strong>
      <p style="margin:0;font-size:14px">Az AVK adatok elosztónként csoportosítva jelennek meg.<br>
      Először menj az <strong>Elosztó</strong> fülre és adj hozzá egy elosztót.</p>
    </div>`;
    return;
  }

  const grouped = {};
  state.elosztoRows.forEach(d => { grouped[d.id] = []; });
  grouped["__egyeb__"] = [];
  state.avkRows.forEach(row => {
    const key = grouped[row.distributorId] !== undefined ? row.distributorId : "__egyeb__";
    grouped[key].push(row);
  });

  const sections = state.elosztoRows.map(dist => {
    const rows        = grouped[dist.id] || [];
    const isCollapsed = !!state.collapsedAvkDists[dist.id];
    const filledCount = rows.filter(isFilledAvk).length;
    const faultCount  = rows.filter(r => r.severity==="A"||r.severity==="B").length;

    const rowsHtml = rows.map((row, localIdx) => {
      const dm = String(row.deltaMa||"").trim();
      const range = AVK_RANGES[dm];
      let rangeBadge = "";
      if (range && row.iDeltaMa) {
        const measI = parseFloat(String(row.iDeltaMa).replace(",","."));
        if (!isNaN(measI)) {
          const inRange = measI >= range.minI && measI <= range.maxI;
          rangeBadge = `<span style="font-size:10px;color:${inRange?"#1f9d55":"#c92a2a"};font-weight:800">${inRange?"✓":"✗"}${range.minI}–${range.maxI}</span>`;
        }
      }
      const displayNo = localIdx + 1;
      const emptyInDist = rows.filter(r => !isFilledAvk(r)).length;
      const canAddMore = emptyInDist < 20;
      return `
      <div class="grid-row avk-row-15">
        ${cell(`<span class="row-no-badge">${displayNo}</span>`)}
        ${cell(`<input data-avk="${row.id}" data-field="mark" value="${escapeHtml(row.mark)}">`)}
        ${cell(selectHtml("avk",row.id,"type",state.avkTypes,row.type))}
        ${cell(selectHtml("avk",row.id,"inA",["","6","10","16","20","25","32","63"],row.inA))}
        ${cell(selectHtml("avk",row.id,"deltaMa",["","10","30","100"],row.deltaMa))}
        ${cell(selectHtml("avk",row.id,"unV",["","230","400"],row.unV))}
        ${cell(`<input data-avk="${row.id}" data-field="poles" value="${escapeHtml(row.poles)}" style="background:#f0f5fb;text-align:center">`)}
        ${cell(`<div style="display:flex;flex-direction:column;gap:2px"><input data-avk="${row.id}" data-field="iDeltaMa" value="${escapeHtml(row.iDeltaMa)}">${rangeBadge}</div>`)}
        ${cell(`<input data-avk="${row.id}" data-field="timeMs" value="${escapeHtml(row.timeMs)}">`)}
        ${cell(selectHtml("avk",row.id,"mp",["","+","-"],row.mp))}
        ${cell(selectHtml("avk",row.id,"szv",["","+","-"],row.szv))}
        ${cell(selectHtml("avk",row.id,"status",["","MF","NMF","NA"],row.status))}
        ${cell(selectHtml("avk",row.id,"severity",["","A","B","C","D"],row.severity))}
        ${cell(`<input data-avk="${row.id}" data-field="fault" value="${escapeHtml(row.fault)}">`)}
        ${cell(`<button class="row-delete-btn" data-delete-avk="${row.id}" title="Sor törlése">×</button>`)}
      </div>`;
    }).join("");

    return `<div class="room-section ${isCollapsed?"collapsed":""}">
      <div class="room-section-header" data-toggle-avk-dist="${dist.id}">
        <span class="room-toggle-icon">${isCollapsed?"▶":"▼"}</span>
        <strong class="room-section-name">${escapeHtml(dist.name)}</strong>
        <span class="room-section-count">${rows.length} sor</span>
        ${filledCount>0?`<span class="room-done-badge">${filledCount} kitöltve</span>`:""}
        ${faultCount>0?`<span class="room-fault-badge">${faultCount} kritikus</span>`:""}
      </div>
      <div class="room-section-body">
        ${!isCollapsed ? `
          <div class="room-section-actions">
            <button class="room-add-btn" data-add-avk-dist-rows="${dist.id}">+ 10 AVK sor</button>
          </div>
          ${avkHeaderRow()}
          ${rowsHtml}` : ""}
      </div>
    </div>`;
  }).join("");

  document.querySelector("#avkGrid").innerHTML = sections;
}

// ─── ELOSZTÓ TÁBLA ───────────────────────────────────────────────────────────
function renderElosztoTable() {
  document.querySelector("#elosztoGrid").innerHTML = state.elosztoRows.map(row => `<article class="distribution-card">
    <div class="distribution-head">
      <input data-eloszto="${row.id}" data-field="name" value="${escapeHtml(row.name)}">
      ${selectHtml("eloszto",row.id,"status",["MF","NMF"],row.status)}
    </div>
    <div class="distribution-fields">
      <label>Feszültség ${selectHtml("eloszto",row.id,"voltage",["230","400"],row.voltage)}</label>
      <label>Főbiztosító <input data-eloszto="${row.id}" data-field="mainFuse" value="${escapeHtml(row.mainFuse)}"></label>
      <label>CE matrica ${selectHtml("eloszto",row.id,"ce",["MF","NMF"],row.ce)}</label>
      <label>Fesz. figy. matrica ${selectHtml("eloszto",row.id,"warningLabel",["MF","NMF"],row.warningLabel)}</label>
      <label>Hőkamera ${selectHtml("eloszto",row.id,"thermal",["MF","NMF"],row.thermal)}</label>
      <label>Burkolat IP ${selectHtml("eloszto",row.id,"ip",["MF","NMF"],row.ip)}</label>
      <label>ÉV mód ${selectHtml("eloszto",row.id,"evMode",["TN","TN-S","TN-C-S"],row.evMode)}</label>
      <label>Tervdokumentáció ${selectHtml("eloszto",row.id,"documentation",["MF","NMF"],row.documentation)}</label>
    </div>
    <div class="distribution-measurements">
      <strong>Betáp hurokimpedancia mérés</strong>
      <div class="measurement-row">
        <label>L1 [Ω] <input data-eloszto="${row.id}" data-field="hurokL1" value="${escapeHtml(row.hurokL1||"")}" placeholder="0.00"></label>
        <label>L2 [Ω] <input data-eloszto="${row.id}" data-field="hurokL2" value="${escapeHtml(row.hurokL2||"")}" placeholder="0.00"></label>
        <label>L3 [Ω] <input data-eloszto="${row.id}" data-field="hurokL3" value="${escapeHtml(row.hurokL3||"")}" placeholder="0.00"></label>
        <label>Feszültség L1 [V] <input data-eloszto="${row.id}" data-field="feszL1" value="${escapeHtml(row.feszL1||"")}" placeholder="230"></label>
      </div>
    </div>
    <div class="fault-subtable">
      <div class="fault-subhead"><strong>Hiba leírása</strong><strong>Kategória</strong><button class="secondary" data-add-fault="${row.id}">+ hiba</button></div>
      ${row.faults.map((fault,i) => `<div class="fault-subrow"><span>Hiba${i+1}</span><input data-fault="${fault.id}" data-parent="${row.id}" data-field="text" value="${escapeHtml(fault.text)}">${selectHtml("fault",fault.id,"severity",["","A","B","C","D"],fault.severity,row.id)}<button class="delete-btn" data-delete-fault="${fault.id}" data-parent="${row.id}">×</button></div>`).join("")}
    </div>
  </article>`).join("");
}

// ─── ÜGYFÉL NÉZET ────────────────────────────────────────────────────────────
function renderClientViews() {
  const siteEl = document.querySelector("#clientSiteName");
  if (siteEl) siteEl.textContent = `${state.customerName} – ${state.siteAddress}`;

  const score = totalScore();
  const qual  = qualification(score);
  const al    = actionLevel();
  const faults = allFaultRows().filter(r=>!r.isNA).sort((a,b)=>"ABCD".indexOf(a.severity)-"ABCD".indexOf(b.severity));

  document.querySelector("#modalScore").textContent         = score;
  document.querySelector("#modalQualification").textContent = `${qual} – ${al}`;

  document.querySelector("#modalBars").innerHTML = categories().map(c => {
    const v = categoryScore(c.id); const hex = categoryColorHex(v);
    return `<div class="client-bar-row">
      <div class="client-bar-label">${c.name}</div>
      <div class="client-bar-track"><div class="client-bar-fill" style="width:${v}%;background:${hex}"></div></div>
      <div class="client-bar-pct" style="color:${hex}">${v}%</div>
    </div>`;
  }).join("");

  document.querySelector("#modalFaults").innerHTML = faults.length
    ? `<h3 style="color:#9fb2c4;font-size:13px;font-weight:800;text-transform:uppercase;margin:0 0 10px">Azonosított hibák</h3>
       <div class="client-fault-list">${faults.slice(0,12).map(f=>`
        <div class="client-fault-row">
          <span class="client-fault-pill" style="background:${severityColorHex(f.severity)}">${f.severity}</span>
          <span class="client-fault-text">${f.text}</span>
        </div>`).join("")}
        ${faults.length>12?`<p style="color:#9fb2c4;margin:8px 0 0;font-size:13px">+ még ${faults.length-12} hiba</p>`:""}
      </div>`
    : `<p style="color:#4CAF50;font-size:18px;margin:12px 0">✓ Nincs kritikus hiba azonosítva</p>`;
}

// ─── RIPORT ──────────────────────────────────────────────────────────────────
function renderReports() {
  const score      = totalScore();
  const qual       = qualification(score);
  const al         = actionLevel();
  const scoreHex   = categoryColorHex(score);
  const faults     = allFaultRows();
  const errors     = faults.filter(r=>!r.isNA).sort((a,b)=>"ABCD".indexOf(a.severity)-"ABCD".indexOf(b.severity));
  const naItems    = faults.filter(r=>r.isNA);

  // ── Összefoglaló kártya ──────────────────────────────────
  const alColor = {Azonnali:"#c92a2a", Sürgős:"#e67700", Ütemezett:"#f2b705", Tervezett:"#1f9d55"}[al]||"#8792a2";
  const scoreQual = score >= 90 ? "Kiváló" : score >= 75 ? "Jó" : score >= 59 ? "Megfelelő" : score >= 39 ? "Gyenge" : "Nem megfelelő";

  document.querySelector("#reportSummaryCard").innerHTML = `
    <div class="rscard">
      <div class="rscard-left">
        <div class="rscard-eyebrow">SMARTGuard Állapotértékelés</div>
        <div class="rscard-customer">${escapeHtml(state.customerName)||"–"}</div>
        <div class="rscard-site">${escapeHtml(state.siteAddress)||""} ${state.inspectionDate ? `· ${state.inspectionDate}` : ""}</div>
      </div>
      <div class="rscard-right">
        <div class="rscard-score" style="color:${scoreHex}">${score}<span class="rscard-pct">%</span></div>
        <div class="rscard-qual">${qual}</div>
        <div class="rscard-al" style="background:${alColor}">⚡ ${al} intézkedés</div>
      </div>
    </div>`;

  // ── Kategória progress bárok ─────────────────────────────
  document.querySelector("#reportBars").innerHTML = `
    <div class="rsbars-grid">
      ${categories().map(c => {
        const v = categoryScore(c.id);
        const hex = categoryColorHex(v);
        const faultCount = faults.filter(r=>r.category===c.id&&!r.isNA).length;
        return `<div class="rsbar-card">
          <div class="rsbar-header">
            <span class="rsbar-name">${c.name}</span>
            <span class="rsbar-pct" style="color:${hex}">${v}%</span>
          </div>
          <div class="rsbar-track">
            <div class="rsbar-fill" style="width:${v}%;background:${hex}"></div>
          </div>
          <div class="rsbar-meta">${faultCount > 0 ? `<span style="color:#c92a2a;font-size:11px">⚠ ${faultCount} hiba</span>` : `<span style="color:#1f9d55;font-size:11px">✓ Rendben</span>`}</div>
        </div>`;
      }).join("")}
    </div>`;

  // ── Hibalista ─────────────────────────────────────────────
  let priorityHtml = "";
  if (errors.length) {
    const grouped = {};
    errors.forEach(f => {
      const label = f.category === "avk" ? "AVK hibák"
        : f.category === "eph" ? "EPH hibák"
        : f.category === "hurok" ? "Hurok hibák"
        : f.category === "eloszto" ? "Elosztó hibák"
        : "Dokumentáció hibák";
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(f);
    });
    Object.entries(grouped).forEach(([label, items]) => {
      priorityHtml += `<div class="fault-section-label">${label}</div>`;
      priorityHtml += items.map(f=>
        `<div class="compact-item">
          <span class="pill" style="background:${severityColor(f.severity)}">${f.severity}</span>
          <span>${escapeHtml(f.text)}</span>
        </div>`).join("");
    });
  } else {
    priorityHtml = `<div style="padding:16px;text-align:center;color:#1f9d55;font-weight:700">✓ Nincs rögzített hiba</div>`;
  }
  if (naItems.length) {
    priorityHtml += `<div class="na-section-label">Nincs adat (${naItems.length} tétel)</div>`;
    priorityHtml += naItems.map(r=>
      `<div class="compact-item na-item">
        <span class="pill pill-na">NA</span>
        <span>${escapeHtml(r.text)}</span>
      </div>`).join("");
  }
  document.querySelector("#reportPriorities").innerHTML = priorityHtml;
}

// ─── PROTOCOL & SETTINGS ─────────────────────────────────────────────────────
function renderProtocol() {
  document.querySelector("#protocolHurokPreview").textContent = state.protocolNumbers.hurok;
  document.querySelector("#protocolAvkPreview").textContent   = state.protocolNumbers.avk;
  document.querySelector("#protocolElosztoPreview").textContent = state.protocolNumbers.eloszto;
  document.querySelector("#protocolBodyHurok").value   = state.protocolBodies.hurok;
  document.querySelector("#protocolBodyAvk").value     = state.protocolBodies.avk;
  document.querySelector("#protocolBodyEloszto").value = state.protocolBodies.eloszto;
}

function makeProtocolBody(type, source) {
  if (!source) source = state;
  const title = {hurok:"Hurok + EPH",avk:"AVK",eloszto:"Elosztó + dokumentáció"}[type];
  const number = source.protocolNumbers?.[type] || makeProtocolNumber(source, type.toUpperCase());
  return [`Jegyzőkönyv: ${title}`,`Sorszám: ${number}`,`Ügyfél: ${source.customerName}`,
    `Telephely: ${source.siteAddress}`,`Dátum: ${source.inspectionDate}`,"",
    "A részletes táblázat a webapp szakági adatlapjából készül."].join("\n");
}

function renderSettings() {
  document.querySelector("#categorySettings").innerHTML = categories().map(c =>
    `<div class="settings-row"><input data-category-name="${c.id}" value="${escapeHtml(c.name)}"><input data-category-weight="${c.id}" type="number" value="${c.weight}"><span></span></div>`).join("");
  const w = totalWeight();
  document.querySelector("#weightTotal").textContent = `Összes súly: ${w}%${w===100?"":" – arányosítva lesz"}`;
  document.querySelector("#weightTotal").className   = `weight-total ${w===100?"ok":"warn"}`;
  document.querySelector("#penaltySettings").innerHTML = ["A","B","C","D"].map(s =>
    `<label>${s} hiba levonása<input data-penalty="${s}" type="number" min="0" max="100" step="1" value="${penalties()[s]}"></label>`).join("");
  document.querySelector("#thresholdSettings").innerHTML = state.scoring.thresholds.map(t =>
    `<label>${t.label}<input data-threshold="${t.id}" type="number" min="0" max="100" step="1" value="${t.min}"></label>`).join("");
}

// ─── ALAPDOKUMENTÁCIÓ RENDER ─────────────────────────────────────────────────
function renderAlapdok() {
  const ad = state.alapdok;
  const fields = [
    ["ad_hely","hely"],["ad_megrendelo","megrendelo"],["ad_kisero","kisero"],
    ["ad_idotartam","idotartam"],["ad_felelos","felelos"],["ad_vegzettseg","vegzettseg"],
    ["ad_vbf_szam","vbf_szam"],["ad_tuz_szam","tuz_szam"],
    ["ad_kov1","kov1"],["ad_kov2","kov2"],["ad_kov3","kov3"],["ad_kov4","kov4"],
    ["ad_foldelestype","foldelestype"],["ad_erintesvedelmi","erintesvedelmi"],
    ["ad_tartalek","tartalek"],["ad_ev","ev"],
  ];
  fields.forEach(([id, key]) => {
    const el = document.querySelector(`#${id}`);
    if (el && el.value === "") el.value = ad[key] || "";
  });
  const selects = [["ad_feszultseg","feszultseg"],["ad_halozat","halozat"],["ad_betaplalasmod","betaplalasmod"]];
  selects.forEach(([id, key]) => {
    const el = document.querySelector(`#${id}`);
    if (el) el.value = ad[key] || "";
  });
  Object.entries(ad.cb).forEach(([key, val]) => {
    const el = document.querySelector(`#ad_${key}`);
    if (el) el.checked = !!val;
  });
  renderVizsgalatiTable();
}

function readAlapdokFromDOM() {
  const ad = state.alapdok;
  const fields = [
    ["ad_hely","hely"],["ad_megrendelo","megrendelo"],["ad_kisero","kisero"],
    ["ad_idotartam","idotartam"],["ad_felelos","felelos"],["ad_vegzettseg","vegzettseg"],
    ["ad_vbf_szam","vbf_szam"],["ad_tuz_szam","tuz_szam"],
    ["ad_kov1","kov1"],["ad_kov2","kov2"],["ad_kov3","kov3"],["ad_kov4","kov4"],
    ["ad_foldelestype","foldelestype"],["ad_erintesvedelmi","erintesvedelmi"],
    ["ad_tartalek","tartalek"],["ad_ev","ev"],
  ];
  fields.forEach(([id, key]) => {
    const el = document.querySelector(`#${id}`);
    if (el) ad[key] = el.value;
  });
  const selects = [["ad_feszultseg","feszultseg"],["ad_halozat","halozat"],["ad_betaplalasmod","betaplalasmod"]];
  selects.forEach(([id, key]) => {
    const el = document.querySelector(`#${id}`);
    if (el) ad[key] = el.value;
  });
  Object.keys(ad.cb).forEach(key => {
    const el = document.querySelector(`#ad_${key}`);
    if (el) ad.cb[key] = el.checked;
  });
}

function renderVizsgalatiTable() {
  const el = document.querySelector("#vizsgalatiTable");
  if (!el) return;
  const rows = state.alapdok.vizsgalat;
  el.innerHTML = `
    <div class="vizsgalat-header">
      <span>Tétel</span><span>Minősítés</span><span>Megjegyzés</span>
    </div>
    ${rows.map((row, i) => `
      <div class="vizsgalat-row">
        <span class="vizsgalat-label">${escapeHtml(row[0])}</span>
        <select data-vizsgalat-idx="${i}" data-vizsgalat-col="1">
          ${["MF","NMF","NA","NV"].map(v=>`<option ${row[1]===v?"selected":""}>${v}</option>`).join("")}
        </select>
        <input data-vizsgalat-idx="${i}" data-vizsgalat-col="2" value="${escapeHtml(row[2]||"")}" placeholder="-" />
      </div>`).join("")}`;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function cell(content) { return `<div class="grid-cell">${content}</div>`; }
function selectHtml(kind, id, field, options, value, parent) {
  parent = parent||"";
  const attr = kind==="fault"?`data-fault="${id}" data-parent="${parent}"`:` data-${kind}="${id}"`;
  const cur  = value==null?"":value;
  return `<select${attr} data-field="${field}">${options.map(o=>`<option value="${o}" ${String(cur)===String(o)?"selected":""}>${o||"–"}</option>`).join("")}</select>`;
}
function roomName(id) { const r=state.rooms.find(r=>r.id===id); return r?r.name:id||""; }
function getVal(sel)  { return document.querySelector(sel).value.trim(); }
function slugify(t)   { return String(t).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")||`e_${Date.now()}`; }
function escapeHtml(t){ return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function nextNo(rows) { return Math.max(0,...rows.map(r=>Number(r.no)||0))+1; }

function addHurokRows(count, roomId, type) {
  const room = state.rooms.find(r=>r.id===roomId);
  for (let i=0;i<count;i++) state.hurokRows.push(emptyHurokRow(nextNo(state.hurokRows), roomId, room, type));
}
function addAvkRows(count, distributorId) {
  const dist = state.elosztoRows.find(d=>d.id===distributorId);
  for (let i=0;i<count;i++) state.avkRows.push(emptyAvkRow(nextNo(state.avkRows), distributorId, dist?dist.name:"", state.avkTypes[0]||"Schrack"));
}
const TABLE_VIEWS = new Set(['hurokTable','avkTable','elosztoTable','rooms','alapdok','protocol','ajanlat']);

function showView(id) {
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  // Topbar egyszerűsítése beviteli nézetekben
  const ws = document.querySelector(".workspace");
  const sidebar = document.querySelector(".sidebar");
  if (TABLE_VIEWS.has(id)) {
    ws.classList.add("view-table");
    if (sidebar) sidebar.classList.add("table-view-active");
  } else {
    ws.classList.remove("view-table");
    if (sidebar) sidebar.classList.remove("table-view-active");
  }
}

// ─── WORKSPACE EVENTS ────────────────────────────────────────────────────────
function isTableCell(t) {
  return !!(t.dataset.hurok || t.dataset.avk || t.dataset.eloszto || t.dataset.fault ||
            t.dataset.ajanlatHiba || t.dataset.ajanlatSzolgAr || t.dataset.sgAr ||
            t.closest('#ajanlat'));
}

function applyWorkspaceValue(t) {
  if (t.dataset.hurok) {
    updateRow(state.hurokRows, t.dataset.hurok, t.dataset.field, t.value);
    // LÁMPATEST-FELISMERÉS: ha a megnevezésbe lámpatestre utaló szót írnak,
    // és a vonatkozó mezőket még NEM állították kézzel, automatikusan
    // II. osztály + KSZ + PE "-" (kettős szigetelés, nincs mérendő érték).
    if (t.dataset.field === "point") {
      const row = state.hurokRows.find(r => r.id === t.dataset.hurok);
      if (row && looksLikeLuminaire(t.value)) {
        if (!row.manualClass && (!row.modeClass || row.modeClass === "I")) row.modeClass = "II";
        if (!row.manualOhm && !String(row.valueOhm || "").trim()) { row.valueOhm = "KSZ"; row.pe = "-"; }
        if (!row.manualStatus) row.status = "MF";
      }
    }
    // Auto-minősítés hurok mezőknél
    const hurokAutoFields = ["valueOhm","breaker","fault","severity","pe"];
    if (hurokAutoFields.includes(t.dataset.field)) {
      const row = state.hurokRows.find(r=>r.id===t.dataset.hurok);
      if (row) {
        // PE auto: ha valueOhm-ba írnak értéket -> PE = OK, ha üres -> "-"
        if (t.dataset.field==="valueOhm") {
          row.manualOhm = true; // a user kézzel állította a mért értéket
          const v = String(t.value || "").trim();
          if (v === "" || v === "-") {
            row.pe = "-";
          } else if (v.toUpperCase() === "KSZ") {
            row.pe = "-"; // KSZ = kettős szigetelés, nincs PE mérés
          } else {
            row.pe = "OK"; // Ha van mért érték -> PE folytonosság rendben
          }
        }
        // PE mező közvetlen szerkesztés: ha 2.0 Ohm-nál nagyobb szám -> nem OK
        if (t.dataset.field==="pe" && t.value && t.value!=="-") {
          const peVal = parseFloat(String(t.value).replace(",","."));
          if (!isNaN(peVal)) row.pe = peVal <= 2.0 ? "OK" : "nem OK";
        }
        // KSZ esetén: MF, nincs PE, nincs limit
        if (String(row.valueOhm).trim().toUpperCase() === "KSZ") {
          row.status = row.manualStatus ? row.status : "MF";
        } else {
          // Auto status - csak ha nincs kézi felülírás
          if (!row.manualStatus) {
            const newStatus = autoStatus(row.breaker, row.valueOhm, row.fault, row.severity);
            if (newStatus) row.status = newStatus;
          }
        }
      }
    }
    // Ha a user KÉZZEL állítja a status-t → manualStatus flag
    if (t.dataset.field === "status") {
      const row = state.hurokRows.find(r=>r.id===t.dataset.hurok);
      if (row) row.manualStatus = true;
    }
    // Ha a user KÉZZEL állítja a mód/osztályt → manualClass flag (ne írja felül az automatika)
    if (t.dataset.field === "modeClass") {
      const row = state.hurokRows.find(r=>r.id===t.dataset.hurok);
      if (row) row.manualClass = true;
    }
  }
  if (t.dataset.avk) {
    updateRow(state.avkRows, t.dataset.avk, t.dataset.field, t.value);
    const avkRow = state.avkRows.find(r => r.id === t.dataset.avk);
    if (avkRow) {
      // Auto pólus: Un alapján
      if (t.dataset.field === "unV") {
        avkRow.poles = t.value === "400" ? "4" : t.value === "230" ? "2" : avkRow.poles;
      }
      // Auto status: iDeltaMa, timeMs, deltaMa, mp, szv, fault, severity változásakor
      const autoFields = ["iDeltaMa","timeMs","deltaMa","mp","szv","fault","severity"];
      if (autoFields.includes(t.dataset.field)) {
        const newStatus = autoAvkStatus(avkRow);
        if (newStatus) avkRow.status = newStatus;
      }
      // Ha manuálisan írnak hibát → NMF
      if (t.dataset.field === "fault" && t.value) {
        avkRow.status = "NMF";
      }
    }
  }
  if (t.dataset.eloszto) updateRow(state.elosztoRows,  t.dataset.eloszto, t.dataset.field, t.value);
  if (t.dataset.fault)   updateFault(t.dataset.parent, t.dataset.fault,   t.dataset.field, t.value);
  if (t.dataset.roomName)    updateRow(state.rooms, t.dataset.roomName,    "name",                  t.value);
  if (t.dataset.roomLevel)   updateRow(state.rooms, t.dataset.roomLevel,   "level",                 t.value);
  if (t.dataset.roomDist)    updateRow(state.rooms, t.dataset.roomDist,    "defaultDistributor",    t.value);
  if (t.dataset.roomBreakerDugalj)    updateRow(state.rooms, t.dataset.roomBreakerDugalj,    "defaultBreakerDugalj",    t.value);
  if (t.dataset.roomBreakerVilagitas) updateRow(state.rooms, t.dataset.roomBreakerVilagitas, "defaultBreakerVilagitas", t.value);
  if (t.dataset.roomTuzvedelem)       updateRow(state.rooms, t.dataset.roomTuzvedelem, "tuzvedelem", t.value);
  // Alapdok vizsgálati táblázat
  if (t.dataset.vizsgalatIdx !== undefined && t.dataset.vizsgalatCol !== undefined) {
    const idx = Number(t.dataset.vizsgalatIdx);
    const col = Number(t.dataset.vizsgalatCol);
    if (state.alapdok.vizsgalat[idx]) state.alapdok.vizsgalat[idx][col] = t.value;
  }
  if (t.dataset.categoryName)   updateCategory(t.dataset.categoryName, {name:t.value});
  if (t.dataset.categoryWeight) updateCategory(t.dataset.categoryWeight, {weight:Number(t.value)});
  if (t.dataset.penalty)    state.scoring.penalties[t.dataset.penalty] = Number(t.value);
  if (t.dataset.threshold)  updateThreshold(t.dataset.threshold, Number(t.value));
  if (t.id==="protocolBodyHurok")   state.protocolBodies.hurok   = t.value;
  if (t.id==="protocolBodyAvk")     state.protocolBodies.avk     = t.value;
  if (t.id==="protocolBodyEloszto") state.protocolBodies.eloszto = t.value;
}

function handleWorkspaceInput(event) {
  const t = event.target;
  applyWorkspaceValue(t);
  // Gépelés közben DEBOUNCE-olt mentés (PC-n a sok soros tábla lefagyott
  // a minden-leütésre futó szinkron localStorage írástól). Blur/change azonnal ment.
  if (isTableCell(t)) { saveStateDebounced(); renderScoreOnlyDebounced(); }
  else { saveState(); render(); }
}

function handleWorkspaceChange(event) {
  const t = event.target;
  applyWorkspaceValue(t);
  saveState();
  // Hurok: breaker select változott → auto status frissítése + tábla újrarajzolás
  if (t.dataset.hurok && ["breaker","type","modeClass","severity","status","pe"].includes(t.dataset.field)) {
    renderHurokTable(); renderScoreOnly(); return;
  }
  // AVK unV változott → pólus frissül
  if (t.dataset.avk && t.dataset.field === "unV") {
    renderAvkTable(); renderScoreOnly(); return;
  }
  // AVK mért értékek → status frissül
  if (t.dataset.avk && ["mp","szv","deltaMa"].includes(t.dataset.field)) {
    renderAvkTable(); renderScoreOnly(); return;
  }
  renderScoreOnly();
}

function handleWorkspaceClick(event) {
  const t = event.target;
  let changed = false;

  // Hurok helyiség toggle
  const toggleRoom = t.closest("[data-toggle-room]");
  if (toggleRoom && !t.dataset.addRoomRows) {
    state.collapsedRooms[toggleRoom.dataset.toggleRoom] = !state.collapsedRooms[toggleRoom.dataset.toggleRoom];
    saveState(); renderHurokTable(); return;
  }

  // + sorok hurokhoz – max 20 üres sor helyiségenként
  if (t.dataset.addRoomRows) {
    event.stopPropagation();
    const roomId = t.dataset.addRoomRows;
    const emptyInRoom = state.hurokRows.filter(r => r.roomId === roomId && !isFilledHurok(r)).length;
    if (emptyInRoom >= 20) {
      alert("Maximum 20 üres sor lehet egy helyiségben. Előbb töltsd ki a meglévőket!"); return;
    }
    const toAdd = Math.min(10, 20 - emptyInRoom);
    addHurokRows(toAdd, roomId, t.dataset.rowType||"hurok");
    saveState(); renderHurokTable(); return;
  }

  // Hurok sor törlése
  if (t.dataset.deleteHurok) {
    state.hurokRows = state.hurokRows.filter(r => r.id !== t.dataset.deleteHurok);
    saveState(); renderHurokTable(); renderScoreOnly(); return;
  }

  // Sor többszörözése: a kijelölt sorról N db másolatot készít (pl. 50 azonos lámpatest)
  if (t.dataset.multiplyHurok) {
    const src = state.hurokRows.find(r => r.id === t.dataset.multiplyHurok);
    if (src) {
      const ans = window.prompt("Hány DARAB legyen összesen ebből a sorból?\n(Pl. 50 = 49 további másolat jön létre.)", "10");
      if (ans !== null) {
        let total = parseInt(String(ans).replace(/\D/g, ""), 10);
        if (isFinite(total) && total > 1) {
          if (total > 500) total = 500; // észszerű felső korlát
          const idx = state.hurokRows.findIndex(r => r.id === src.id);
          const copies = [];
          for (let i = 0; i < total - 1; i++) {
            const c = clone(src);
            c.id = uid();
            copies.push(c);
          }
          state.hurokRows.splice(idx + 1, 0, ...copies);
          saveState(); renderHurokTable(); renderScoreOnly();
        }
      }
    }
    return;
  }

  // AVK elosztó toggle
  const toggleDist = t.closest("[data-toggle-avk-dist]");
  if (toggleDist && !t.dataset.addAvkDistRows) {
    state.collapsedAvkDists[toggleDist.dataset.toggleAvkDist] = !state.collapsedAvkDists[toggleDist.dataset.toggleAvkDist];
    saveState(); renderAvkTable(); return;
  }

  // + sorok AVK-hoz – max 20 üres sor elosztónként
  if (t.dataset.addAvkDistRows) {
    event.stopPropagation();
    const distId = t.dataset.addAvkDistRows;
    const emptyInDist = state.avkRows.filter(r => r.distributorId === distId && !isFilledAvk(r)).length;
    if (emptyInDist >= 20) {
      alert("Maximum 20 üres sor lehet egy elosztóban. Előbb töltsd ki a meglévőket!"); return;
    }
    const toAdd = Math.min(10, 20 - emptyInDist);
    addAvkRows(toAdd, distId);
    saveState(); renderAvkTable(); return;
  }

  // AVK sor törlése
  if (t.dataset.deleteAvk) {
    state.avkRows = state.avkRows.filter(r => r.id !== t.dataset.deleteAvk);
    saveState(); renderAvkTable(); renderScoreOnly(); return;
  }

  // Tömeges kitöltés
  if (t.dataset.fillRoom) {
    const room = state.rooms.find(r=>r.id===t.dataset.fillRoom);
    if (room) {
      state.hurokRows.filter(r=>r.roomId===room.id&&!isFilledHurok(r)).forEach(r => {
        if (room.defaultDistributor) r.distributor = room.defaultDistributor;
        if (r.type==="eph"&&room.defaultBreakerVilagitas) r.breaker = room.defaultBreakerVilagitas;
        else if (r.type==="hurok"&&room.defaultBreakerDugalj) r.breaker = room.defaultBreakerDugalj;
      });
      saveState(); renderHurokTable();
    }
    return;
  }

  if (t.dataset.typeDelete)   { state.avkTypes=state.avkTypes.filter(x=>x!==t.dataset.typeDelete); changed=true; }
  if (t.dataset.addFault)     { const d=state.elosztoRows.find(r=>r.id===t.dataset.addFault); if(d) d.faults.push({id:uid(),text:"",severity:""}); changed=true; }
  if (t.dataset.deleteFault)  { const d=state.elosztoRows.find(r=>r.id===t.dataset.parent); if(d) d.faults=d.faults.filter(f=>f.id!==t.dataset.deleteFault); changed=true; }
  if (t.dataset.roomDelete)   { state.rooms=state.rooms.filter(r=>r.id!==t.dataset.roomDelete); changed=true; }
  if (!changed) return;
  saveState(); render();
}

function updateRow(rows, id, field, value) {
  const r=rows.find(r=>r.id===id);
  if(r) r[field]=field==="no"?Number(value):value;
}
function updateFault(parentId, faultId, field, value) {
  const d=state.elosztoRows.find(r=>r.id===parentId);
  const f=d?d.faults.find(f=>f.id===faultId):null;
  if(f) f[field]=value;
}
function updateCategory(id, patch)  { state.scoring.categories=state.scoring.categories.map(c=>c.id===id?Object.assign({},c,patch):c); }
function updateThreshold(id, min)   { state.scoring.thresholds=state.scoring.thresholds.map(t=>t.id===id?Object.assign({},t,{min}):t); }

function generatePdfHtml() {
  const score = totalScore();
  const qual = qualification(score);
  const al = actionLevel();
  const scoreHex = categoryColorHex(score);
  const faults = allFaultRows();
  const errors = faults.filter(r=>!r.isNA).sort((a,b)=>"ABCD".indexOf(a.severity)-"ABCD".indexOf(b.severity));
  const alColor = {Azonnali:"#c92a2a",Sürgős:"#e67700",Ütemezett:"#f2b705",Tervezett:"#1f9d55"}[al]||"#8792a2";

  return `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="UTF-8">
<title>SMARTGuard – Vezetői kiértékelés</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 14px; color: #1a2332; background: #fff; padding: 24px; max-width: 800px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #102536, #1F497D); color: #fff; border-radius: 10px; padding: 24px 28px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .header-left .eyebrow { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #9fb2c4; letter-spacing: 0.1em; margin-bottom: 6px; }
  .header-left .customer { font-size: 22px; font-weight: 800; color: #fff; }
  .header-left .site { font-size: 13px; color: #9fb2c4; margin-top: 4px; }
  .header-right { text-align: right; }
  .score-big { font-size: 64px; font-weight: 800; line-height: 1; color: ${scoreHex}; }
  .score-label { font-size: 12px; color: #9fb2c4; margin-bottom: 4px; }
  .qual-text { font-size: 16px; color: #dce6ef; margin-top: 4px; }
  .al-badge { display: inline-block; background: ${alColor}; color: #fff; font-size: 12px; font-weight: 800; padding: 4px 12px; border-radius: 999px; margin-top: 8px; }
  .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; color: #667084; letter-spacing: 0.08em; margin: 20px 0 10px; border-bottom: 2px solid #e5e9ef; padding-bottom: 6px; }
  .bars-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
  .bar-card { background: #f8f9fa; border-radius: 8px; padding: 12px 14px; }
  .bar-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .bar-name { font-size: 13px; font-weight: 700; }
  .bar-pct { font-size: 15px; font-weight: 800; }
  .bar-track { background: #e5e9ef; border-radius: 999px; height: 8px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; }
  .fault-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f2f5; }
  .sev-badge { flex-shrink: 0; font-size: 11px; font-weight: 800; color: #fff; padding: 3px 8px; border-radius: 999px; min-width: 28px; text-align: center; }
  .fault-text { font-size: 13px; color: #334155; }
  .no-faults { padding: 16px; text-align: center; color: #1f9d55; font-weight: 700; background: #f0fdf4; border-radius: 8px; }
  .footer { margin-top: 24px; padding-top: 14px; border-top: 1px solid #e5e9ef; font-size: 11px; color: #8792a2; display: flex; justify-content: space-between; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="eyebrow">SMARTGuard · Villamos Biztonsági Felülvizsgálat</div>
      <div class="customer">${escapeHtml(state.customerName)||"Ügyfél"}</div>
      <div class="site">${escapeHtml(state.siteAddress)||""} · ${state.inspectionDate||""}</div>
    </div>
    <div class="header-right">
      <div class="score-label">SMARTScore</div>
      <div class="score-big">${score}%</div>
      <div class="qual-text">${qual}</div>
      <div class="al-badge">⚡ ${al}</div>
    </div>
  </div>

  <div class="section-title">Kategória értékelés</div>
  <div class="bars-grid">
    ${categories().map(c => {
      const v = categoryScore(c.id);
      const hex = categoryColorHex(v);
      return `<div class="bar-card">
        <div class="bar-header">
          <span class="bar-name">${c.name}</span>
          <span class="bar-pct" style="color:${hex}">${v}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${v}%;background:${hex}"></div></div>
      </div>`;
    }).join("")}
  </div>

  <div class="section-title">Azonosított hibák</div>
  ${errors.length ? errors.map(f => `
    <div class="fault-row">
      <span class="sev-badge" style="background:${severityColorHex(f.severity)}">${f.severity}</span>
      <span class="fault-text">${escapeHtml(f.text)}</span>
    </div>`).join("") : `<div class="no-faults">✓ Nincs rögzített hiba</div>`}

  <div class="footer">
    <span>Smart Electric Hungary Kft. · SMARTGuard VBF rendszer</span>
    <span>Generálva: ${new Date().toLocaleDateString("hu-HU")}</span>
  </div>
</body>
</html>`;
}

async function downloadPdf() {
  const html = generatePdfHtml();
  // Nyomtatás PDF-ként egy új ablakban
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 500);
}

function downloadDataPackage() {  const blob = new Blob([JSON.stringify({
    meta:{customerName:state.customerName,siteAddress:state.siteAddress,inspectionDate:state.inspectionDate,
      protocolNumbers:state.protocolNumbers,smartScore:totalScore(),qualification:qualification(totalScore()),actionLevel:actionLevel()},
    rooms:state.rooms,avkTypes:state.avkTypes,scoring:state.scoring,
    hurokRows:state.hurokRows,avkRows:state.avkRows,elosztoRows:state.elosztoRows,
    protocolBodies:state.protocolBodies,
  },null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`smartguard-vbf-${state.protocolNumbers.hurok}.json`; a.click();
  URL.revokeObjectURL(url);
}

async function downloadWordDocs(type) {
  const btnId={avk:"#downloadAvkWord",hurok:"#downloadHurokWord",both:"#downloadAllWord",report:"#downloadReportWord",alapdok:"#downloadAlapdokWord"}[type]||"#downloadAllWord";
  const btn=document.querySelector(btnId);
  const orig=btn?btn.textContent:"";
  if(btn){btn.textContent="Generálás...";btn.disabled=true;}
  try {
    const res=await fetch("/generate-docs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,state})});
    if(!res.ok) throw new Error("Szerver hiba: "+res.status);
    const contentType=res.headers.get("Content-Type")||"";
    if(contentType.includes("application/json")) {
      const json=await res.json();
      (json.files||[]).forEach(f=>{
        const bytes=atob(f.data);
        const arr=new Uint8Array(bytes.length);
        for(let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
        const blob=new Blob([arr],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a"); a.href=url; a.download=f.name; a.click();
        URL.revokeObjectURL(url);
      });
    } else {
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a"); a.href=url;
      const cd=res.headers.get("Content-Disposition")||"";
      const m=cd.match(/filename="?([^";\s]+)"?/);
      a.download=m?m[1]:(type+"_JK.docx");
      a.click(); URL.revokeObjectURL(url);
    }
  } catch(e) {
    alert("Word generálás sikertelen!\n\n"+e.message);
  } finally {
    if(btn){btn.textContent=orig;btn.disabled=false;}
  }
}

// ─── WIRE EVENTS ─────────────────────────────────────────────────────────────
var SZOLGALTATASOK = [
  { id:"eloszto_karb",  label:"Elosztó karbantartás"             },
  { id:"koteshuzas",    label:"Kötéshúzás"                       },
  { id:"vedelem_csere", label:"Hibás védelmi eszközök cseréje"   },
  { id:"eloszto_atep",  label:"Elosztó átépítés"                 },
  { id:"hokamera",      label:"Hőkamerás vizsgálat"              },
  { id:"vilagitas_felm",label:"Világítás felmérés"               },
  { id:"led_korszer",   label:"Világítás korszerűsítés (LED)"    },
  { id:"villamved",     label:"Villámvédelem felülvizsgálat"     },
  { id:"tulfeszultseg", label:"Túlfeszültség védelem"            },
  { id:"erintesved",    label:"Érintésvédelmi javítás"          },
  { id:"smartguard",    label:"SMART Guard monitoring"           },
  { id:"eves_karb",     label:"Éves karbantartási szerződés"     },
  { id:"prediktiv",     label:"Prediktív karbantartás"           },
  { id:"fogyaszt",      label:"Fogyasztásmérés"                  },
  { id:"aleloszto",     label:"Alelosztó kialakítás"             },
];

var SMART_MODULOK = [
  { id:"vbf_plus",     name:"Smart VBF Plus",       icon:"🔁", desc:"Éves VBF + karbantartási szolgáltatás.",          mikor:"Sok NMF kötés, rossz elosztó, sok hiba, nincs éves karbantartás." },
  { id:"repair",       name:"Smart Repair",          icon:"🔧", desc:"Feltárt hibák javítása, üzembiztonság helyreállítása.", mikor:"Konkrét hibák, hibás védelmek, melegedés, égésnyom." },
  { id:"light_care",   name:"Smart Light Care",      icon:"💡", desc:"Világítási rendszer felmérése és optimalizálása.", mikor:"Rossz világítás, elégtelen LUX, régi fényforrások." },
  { id:"relight",      name:"Smart ReLight",         icon:"⚡", desc:"LED korszerűsítés és energiahatékonysági fejlesztés.", mikor:"Korszerűtlen világítás, magas energiafogyasztás." },
  { id:"energy",       name:"Smart Energy",          icon:"📊", desc:"Fogyasztás monitoring és energetikai elemzés.",   mikor:"Magas fogyasztás, ingadozó terhelés, csúcsterhelések." },
  { id:"voltage_guard",name:"Smart Voltage Guard",   icon:"🛡", desc:"Feszültség monitoring és anomália figyelés.",     mikor:"Feszültség ingadozás, érzékeny berendezések." },
];

function wireEvents() {
  document.querySelectorAll(".nav-item").forEach(b=>{
    const go=e=>{e.preventDefault();showView(b.dataset.view);};
    b.addEventListener("click",go); b.addEventListener("touchend",go);
  });
  document.querySelectorAll("[data-jump]").forEach(b=>{
    const go=e=>{e.preventDefault();showView(b.dataset.jump);};
    b.addEventListener("click",go); b.addEventListener("touchend",go);
  });
  ["customerName","siteAddress","munkaszam","inspectionDate"].forEach(id=>{
    document.querySelector(`#${id}`).addEventListener("input",e=>{
      state[id]=e.target.value;
      state.protocolNumbers={hurok:makeProtocolNumber(state,"HUROK"),avk:makeProtocolNumber(state,"AVK"),eloszto:makeProtocolNumber(state,"ELOSZTO")};
      saveState(); render();
    });
  });
  document.querySelector("#roomForm").addEventListener("submit",e=>{
    e.preventDefault();
    const name=getVal("#newRoomName");
    const room={id:slugify(name)+`_${Date.now()}`,name,level:getVal("#newRoomLevel"),defaultDistributor:"",defaultBreakerDugalj:"",defaultBreakerVilagitas:""};
    state.rooms.push(room);
    for(let i=0;i<5;i++) state.hurokRows.push(emptyHurokRow(nextNo(state.hurokRows),room.id,room,"hurok"));
    e.target.reset(); saveState(); render();
  });
  document.querySelector("#avkTypeForm").addEventListener("submit",e=>{
    e.preventDefault();
    const type=getVal("#newAvkType");
    if(type&&!state.avkTypes.includes(type)) state.avkTypes.push(type);
    e.target.reset(); saveState(); render();
  });
  document.querySelector("#addHurokRoom").addEventListener("click",()=>{
    const name=prompt("Új helyiség neve:"); if(!name) return;
    const room={id:slugify(name)+`_${Date.now()}`,name,level:"",defaultDistributor:"",defaultBreakerDugalj:"",defaultBreakerVilagitas:""};
    state.rooms.push(room);
    for(let i=0;i<5;i++) state.hurokRows.push(emptyHurokRow(nextNo(state.hurokRows),room.id,room,"hurok"));
    saveState(); render();
  });
  document.querySelector("#addAvkRow").addEventListener("click",()=>{
    if(state.elosztoRows[0]) addAvkRows(10,state.elosztoRows[0].id);
    saveState(); renderAvkTable();
  });
  document.querySelector("#addElosztoRow").addEventListener("click",()=>{
    const newDist={id:uid(),no:nextNo(state.elosztoRows),name:"Új elosztó",voltage:"400",mainFuse:"",
      ce:"MF",warningLabel:"MF",thermal:"MF",ip:"MF",evMode:"TN-C-S",documentation:"MF",status:"MF",
      hurokL1:"",hurokL2:"",hurokL3:"",feszL1:"",faults:[]};
    state.elosztoRows.push(newDist);
    for(let i=0;i<5;i++) state.avkRows.push(emptyAvkRow(nextNo(state.avkRows),newDist.id,newDist.name,state.avkTypes[0]||"Schrack"));
    saveState(); render();
  });
  document.querySelector(".workspace").addEventListener("input",  handleWorkspaceInput);
  document.querySelector(".workspace").addEventListener("change", handleWorkspaceChange);
  document.querySelector(".workspace").addEventListener("click",  handleWorkspaceClick);
  // Blur: valueOhm/fault kilépéskor frissítjük a táblát - DE csak ha a fókusz KÍVÜL megy
  document.querySelector(".workspace").addEventListener("blur", function(e) {
    const t = e.target;
    // RelatedTarget: ahova a fókusz megy. Ha workspace-en belül marad -> NEM renderelünk
    var relTarget = e.relatedTarget;
    var ws = document.querySelector(".workspace");
    // Kilépéskor a függőben lévő (debounce-olt) mentést azonnal véglegesítjük
    if (_saveDebounceTimer) { clearTimeout(_saveDebounceTimer); _saveDebounceTimer = null; saveState(); }
    if (relTarget && ws && ws.contains(relTarget)) return; // workspace-en belüli fókuszváltás -> skip
    if (t.dataset.hurok && ["valueOhm","fault"].includes(t.dataset.field)) {
      renderHurokTable(); renderScoreOnly();
    }
    if (t.dataset.avk && ["iDeltaMa","timeMs","deltaMa"].includes(t.dataset.field)) {
      renderAvkTable(); renderScoreOnly();
    }
  }, true);
  document.querySelector("#regenerateProtocol").addEventListener("click",()=>{
    state.protocolBodies={hurok:makeProtocolBody("hurok"),avk:makeProtocolBody("avk"),eloszto:makeProtocolBody("eloszto")};
    saveState(); render();
  });
  document.querySelector("#showClientMode").addEventListener("click",()=>document.querySelector("#clientModal").classList.add("open"));
  document.querySelector("#closeClientMode").addEventListener("click",()=>document.querySelector("#clientModal").classList.remove("open"));
  document.querySelector("#printExecutive").addEventListener("click",()=>window.print());
  document.querySelector("#downloadJson").addEventListener("click",downloadDataPackage);
  document.querySelector("#downloadAllWord").addEventListener("click",()=>downloadWordDocs("both"));
  document.querySelector("#downloadHurokWord").addEventListener("click",()=>downloadWordDocs("hurok"));
  document.querySelector("#downloadAvkWord").addEventListener("click",()=>downloadWordDocs("avk"));
  document.querySelector("#downloadReportWord").addEventListener("click",()=>downloadWordDocs("report"));
  document.querySelector("#downloadPdf").addEventListener("click", downloadPdf);
  document.querySelector("#resetScoring").addEventListener("click",()=>{state.scoring=clone(defaultScoring);saveState();render();});
  document.querySelector("#clearStorage").addEventListener("click",()=>{
    if(!confirm("Biztosan törlöd az összes mentett adatot?")) return;
    localStorage.clear(); state=clone(initialState); ensureMinimumRows(state); saveState(); render();
    alert("Törölve!");
  });

  // Alapdokumentáció – minden változás mentése
  document.querySelector("#alapdok").addEventListener("input", e => {
    readAlapdokFromDOM();
    saveState();
  });
  document.querySelector("#alapdok").addEventListener("change", e => {
    readAlapdokFromDOM();
    saveState();
    // vizsgálati sor frissítés - applyWorkspaceValue is kezeli
    applyWorkspaceValue(e.target);
  });
  document.querySelector("#ad_kovSyncBtn").addEventListener("click", () => {
    const d = document.querySelector("#ad_kov1").value;
    ["#ad_kov2","#ad_kov3","#ad_kov4"].forEach(sel => document.querySelector(sel).value = d);
    state.alapdok.kov1 = state.alapdok.kov2 = state.alapdok.kov3 = state.alapdok.kov4 = d;
    saveState();
  });
  document.querySelector("#downloadAlapdokWord").addEventListener("click", () => downloadWordDocs("alapdok"));
  const btn2 = document.querySelector("#downloadAlapdokWord2");
  if (btn2) btn2.addEventListener("click", () => downloadWordDocs("alapdok"));
  if(channel) channel.addEventListener("message",e=>{ _remoteData = e.data; _remoteRenderDebounced(); });

  // ─── Ajánlat event kezelők ───────────────────────────────────
  var ajanlatSection = document.querySelector("#ajanlat");
  if (ajanlatSection) {
    ajanlatSection.addEventListener("input", function(e) {
      if (!state.ajanlat) state.ajanlat = getAjanlatState();
      var changed = false;
      if (e.target.dataset.ajanlatHiba) {
        state.ajanlat.hibaArak[e.target.dataset.ajanlatHiba] = e.target.value;
        changed = true;
      }
      if (e.target.dataset.ajanlatSzolgAr !== undefined) {
        if (!state.ajanlat.szolgArak) state.ajanlat.szolgArak = {};
        state.ajanlat.szolgArak[e.target.dataset.ajanlatSzolgAr] = e.target.value;
        changed = true;
      }
      if (e.target.dataset.sgAr !== undefined) {
        if (!state.ajanlat.sgArak) state.ajanlat.sgArak = {};
        state.ajanlat.sgArak[e.target.dataset.sgAr] = e.target.value;
        changed = true;
      }
      if (changed) {
        saveState();
        renderAjanlatSummaryOnly(); // Csak az összesítőt frissítjük, NEM az egész DOM-t
      }
    });
    ajanlatSection.addEventListener("blur", function(e) {
      // Blur-kor NEM renderelünk újra - az ár mezők tartalma megmarad
      // Az összesítő frissítése az input event-kor történik
    }, true);
    ajanlatSection.addEventListener("change", function(e) {
      if (!state.ajanlat) state.ajanlat = getAjanlatState();
      if (e.target.dataset.ajanlatSzolg) {
        if (!state.ajanlat.szolgChecked) state.ajanlat.szolgChecked = {};
        state.ajanlat.szolgChecked[e.target.dataset.ajanlatSzolg] = e.target.checked;
        saveState(); renderAjanlat();
      }
      if (e.target.dataset.sgModul) {
        if (!state.ajanlat.sgChecked) state.ajanlat.sgChecked = {};
        state.ajanlat.sgChecked[e.target.dataset.sgModul] = e.target.checked;
        saveState(); renderAjanlat();
      }
      if (e.target.id === "ajanlatAfa") {
        state.ajanlat.afa = Number(e.target.value);
        saveState(); renderAjanlat();
      }
    });
    ajanlatSection.addEventListener("click", function(e) {
      // Ha input vagy annak gyereke -> NEM toggleolunk, csak engedjük a fókuszt
      if (e.target.closest("input") || e.target.tagName === "INPUT") return;
      var t = e.target.closest("[data-toggle-szolg]");
      var t2 = e.target.closest("[data-toggle-sg]");
      if (t) {
        var id = t.dataset.toggleSzolg;
        if (!state.ajanlat) state.ajanlat = getAjanlatState();
        if (!state.ajanlat.szolgChecked) state.ajanlat.szolgChecked = {};
        var wasChecked = state.ajanlat.szolgChecked.hasOwnProperty(id) ? state.ajanlat.szolgChecked[id] : !!(autoSzolgJavas()[id]);
        state.ajanlat.szolgChecked[id] = !wasChecked;
        saveState(); renderAjanlat();
      }
      if (t2) {
        var id2 = t2.dataset.toggleSg;
        if (!state.ajanlat) state.ajanlat = getAjanlatState();
        if (!state.ajanlat.sgChecked) state.ajanlat.sgChecked = {};
        var wasChecked2 = state.ajanlat.sgChecked.hasOwnProperty(id2) ? state.ajanlat.sgChecked[id2] : !!(autoSmartJavas()[id2]);
        state.ajanlat.sgChecked[id2] = !wasChecked2;
        saveState(); renderAjanlat();
      }
    });
    var dlBtn = document.querySelector("#downloadAjanlat");
    if (dlBtn) dlBtn.addEventListener("click", downloadAjanlatPdf);
  }

  // ─── Kész gomb ────────────────────────────────────────────────
  var keszBtnEl = document.querySelector("#keszBtn");
  var visszavonBtnEl = document.querySelector("#visszavonBtn");
  if (keszBtnEl) keszBtnEl.addEventListener("click", function() {
    if (!confirm("Biztosan lezárod a jegyzőkönyvet?")) return;
    state.lezarva = true;
    state.lezarvaDatum = new Date().toLocaleDateString("hu-HU");
    saveState(); renderKeszGomb();
  });
  if (visszavonBtnEl) visszavonBtnEl.addEventListener("click", function() {
    state.lezarva = false;
    state.lezarvaDatum = "";
    saveState(); renderKeszGomb();
  });
}

wireEvents();
render();
saveState();

if("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(regs=>regs.forEach(r=>r.unregister()));
if("caches" in window) caches.keys().then(keys=>keys.forEach(k=>caches.delete(k)));

// ─── SMART GUARD & AJÁNLAT (v25) ─────────────────────────────────────────────





function getAjanlatState() {
  var base = state.ajanlat || {};
  return {
    hibaArak:     base.hibaArak     || {},
    szolgChecked: base.szolgChecked || {},
    szolgArak:    base.szolgArak    || {},
    sgChecked:    base.sgChecked    || {},
    sgArak:       base.sgArak       || {},
    afa:          base.afa !== undefined ? base.afa : 0.27,
  };
}

function autoSzolgJavas() {
  try {
    var faults = allFaultRows().filter(function(r){return !r.isNA;});
    return {
      eloszto_karb:  categoryScore("eloszto") < 80 || totalScore() < 80,
      koteshuzas:    state.elosztoRows.some(function(d){return d.kotesek==="NMF";}),
      vedelem_csere: faults.some(function(r){return r.severity==="A"||r.severity==="B";}),
      hokamera:      state.elosztoRows.some(function(d){return d.thermal==="NMF";}),
      erintesved:    faults.some(function(r){return r.category==="hurok"&&r.severity==="A";}),
    };
  } catch(e) { return {}; }
}

function autoSmartJavas() {
  try {
    var score = totalScore();
    var faults = allFaultRows().filter(function(r){return !r.isNA;});
    var auto = {};
    if (score <= 89) auto.vbf_plus = true;
    if (score <= 79) auto.repair = true;
    if (score <= 59) { auto.energy = true; auto.voltage_guard = true; }
    if (state.elosztoRows.some(function(d){return d.kotesek==="NMF";})) { auto.repair = true; auto.vbf_plus = true; }
    if (faults.some(function(r){return r.severity==="A"||r.severity==="B";})) auto.repair = true;
    return auto;
  } catch(e) { return {}; }
}

function getSmartModulTotal() {
  var aj = getAjanlatState();
  var auto = autoSmartJavas();
  return SMART_MODULOK.reduce(function(sum, m) {
    var isChecked = aj.sgChecked.hasOwnProperty(m.id) ? aj.sgChecked[m.id] : !!auto[m.id];
    return sum + (isChecked ? (Number(aj.sgArak[m.id])||0) : 0);
  }, 0);
}

function svCheckbox(checked, small) {
  var sz = small ? 14 : 18;
  var style = 'width:'+sz+'px;height:'+sz+'px;border-radius:4px;border:2px solid '+(checked?'#1F497D':'#cbd5e1')+';background:'+(checked?'#1F497D':'#fff')+';display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
  var check = checked ? '<svg width="10" height="8" viewBox="0 0 10 8"><polyline points="1,4 3.5,7 9,1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
  return '<div style="'+style+'">'+check+'</div>';
}

function renderSmartModulok() {
  var el = document.querySelector("#smartGuardModulok");
  if (!el) return;
  try {
    var aj = getAjanlatState();
    var auto = autoSmartJavas();
    var score = 100; try { score = totalScore(); } catch(e) {}
    var scoreHex = categoryColorHex(score);
    var szint = score>=90?"✅ Kiváló – nincs szükséges beavatkozás.":score>=80?"⚡ Ajánlott: Smart VBF Plus":score>=60?"⚠️ Ajánlott: Smart Repair + VBF Plus":"🔴 Azonnali beavatkozás szükséges!";

    var html = '<div class="sg-score-banner"><span class="sg-score-val" style="color:'+scoreHex+'">'+score+'%</span><span class="sg-score-text">'+szint+'</span></div>';
    html += '<p style="font-size:12px;color:#667084;margin:0 0 12px">Pipáld be amit ajánlani szeretnél és add meg az árat. Az ⚡ jelöltek a vizsgálat alapján automatikusan ajánlottak.</p>';

    SMART_MODULOK.forEach(function(m) {
      var isAuto = !!auto[m.id];
      var isChecked = aj.sgChecked.hasOwnProperty(m.id) ? aj.sgChecked[m.id] : isAuto;
      var ar = aj.sgArak[m.id] || "";
      var badge = isAuto ? ' <span style="background:#1F497D;color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;margin-left:6px;">⚡ ajánlott</span>' : '';
      var priceHtml = isChecked
        ? '<div style="display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #e5e9ef;" onclick="event.stopPropagation()"><label style="font-size:12px;color:#667084;white-space:nowrap">Ár:</label><input type="number" min="0" step="1000" placeholder="0" value="'+ar+'" data-sg-ar="'+m.id+'" style="flex:1;padding:6px 8px;border:1px solid #1F497D;border-radius:6px;font-size:13px;text-align:right;"><span style="font-size:12px;color:#667084">Ft</span></div>'
        : '<div style="margin-top:6px;font-size:11px;color:#8792a2;font-style:italic">Kérhető – nincs automatikus javaslat</div>';
      var cardStyle = 'border:1.5px solid '+(isChecked?'#1F497D':'#e5e9ef')+';border-radius:10px;padding:12px 14px;background:'+(isChecked?'#f0f5fb':'#f8f9fa')+';';
      html += '<div style="'+cardStyle+'">';
      // Toggle CSAK a header során - ár input kívül van
      html += '<div style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;" data-toggle-sg="'+m.id+'">';
      html += svCheckbox(isChecked, false);
      html += '<span style="font-size:18px;">'+m.icon+'</span>';
      html += '<div style="flex:1;"><div style="font-size:14px;font-weight:800;color:#102536;">'+m.name+badge+'</div><div style="font-size:12px;color:#667084;margin-top:2px;">'+m.desc+'</div></div>';
      html += '</div>';
      html += priceHtml;
      html += '</div>';
    });
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<p style="color:red">Hiba: '+e.message+'</p>';
  }
}


function renderAjanlatSummaryOnly() {
  // Csak az összesítő részt frissíti - az ár input mezők érintetlenek maradnak
  var sumEl = document.querySelector("#ajanlatSummary");
  if (!sumEl) return;
  var aj = getAjanlatState();
  var auto = autoSzolgJavas();

  var hibaTotal = 0;
  Object.values(aj.hibaArak).forEach(function(v) { hibaTotal += Number(v)||0; });

  var egyebSzolgTotal = (SZOLGALTATASOK||[]).reduce(function(s, sv) {
    var ch = aj.szolgChecked.hasOwnProperty(sv.id) ? aj.szolgChecked[sv.id] : false;
    return s + (ch ? (Number(aj.szolgArak[sv.id])||0) : 0);
  }, 0);

  var sgTotal = getSmartModulTotal();
  var nettoTotal = hibaTotal + egyebSzolgTotal + sgTotal;
  var afaKulcs = Number(aj.afa||0.27);
  var afaOsszeg = Math.round(nettoTotal * afaKulcs);
  var bruttoTotal = nettoTotal + afaOsszeg;

  var sumHtml = '<div style="border:1px solid #e5e9ef;border-radius:8px;overflow:hidden;">';
  if (hibaTotal>0) sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;"><span>Hibajavítás összesen</span><strong>'+hibaTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
  if (egyebSzolgTotal>0) sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;"><span>Egyéb szolgáltatások</span><strong>'+egyebSzolgTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
  if (sgTotal>0) sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;"><span>SMART Guard modulok</span><strong>'+sgTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
  sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:14px;font-weight:700;background:#f0f5fb;"><span>Nettó összesen</span><strong>'+nettoTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
  sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;color:#667084;"><span>ÁFA ('+Math.round(afaKulcs*100)+'%)</span><span>'+afaOsszeg.toLocaleString("hu-HU")+' Ft</span></div>';
  sumHtml += '<div style="display:flex;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,#102536,#1F497D);color:#fff;font-size:16px;font-weight:800;"><span>Bruttó végösszeg</span><strong>'+bruttoTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
  sumHtml += '</div>';
  sumEl.innerHTML = sumHtml;
}

function renderAjanlat() {
  var aj = getAjanlatState();
  var auto = autoSzolgJavas();
  var faults = allFaultRows().filter(function(r){return !r.isNA;}).sort(function(a,b){return "ABCD".indexOf(a.severity)-"ABCD".indexOf(b.severity);});

  // 1. Hibajavítás
  var hibaEl = document.querySelector("#ajanlatHibaList");
  if (!hibaEl) return;
  var hibaTotal = 0;
  if (!faults.length) {
    hibaEl.innerHTML = '<div style="padding:16px;text-align:center;color:#1f9d55;font-weight:700;background:#f0fdf4;border-radius:8px;">✓ Nincs rögzített hiba – nincs szükség hibajavításra.</div>';
  } else {
    var hibaHtml = '';
    faults.forEach(function(f) {
      var key = btoa(encodeURIComponent(f.text)).slice(0,20);
      var ar = aj.hibaArak[key] || "";
      hibaTotal += Number(ar)||0;
      var sevColor = {A:"#c92a2a",B:"#e67700",C:"#daa520",D:"#1478b8"}[f.severity]||"#667084";
      hibaHtml += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f0f2f5;">';
      hibaHtml += '<span style="background:'+sevColor+';color:#fff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;flex-shrink:0;">'+f.severity+'</span>';
      hibaHtml += '<span style="flex:1;font-size:13px;">'+escapeHtml(f.text)+'</span>';
      hibaHtml += '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;"><input type="number" min="0" step="1000" placeholder="0" value="'+ar+'" data-ajanlat-hiba="'+key+'" style="width:90px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;text-align:right;"><span style="font-size:12px;color:#667084">Ft</span></div>';
      hibaHtml += '</div>';
    });
    if (hibaTotal > 0) hibaHtml += '<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 0;font-weight:700;">Hibajavítás összesen: '+hibaTotal.toLocaleString("hu-HU")+' Ft</div>';
    hibaEl.innerHTML = hibaHtml;
  }

  // 2. Ajánlható szolgáltatások
  var szolgEl = document.querySelector("#ajanlatSzolgList");
  if (szolgEl) {
    var szolgHtml = '';
    SZOLGALTATASOK.forEach(function(s) {
      var isAuto = !!auto[s.id];
      var isChecked = aj.szolgChecked.hasOwnProperty(s.id) ? aj.szolgChecked[s.id] : isAuto;
      var ar = aj.szolgArak[s.id] || "";
      var badge = isAuto ? '<span style="background:#dce8f5;color:#1F497D;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:4px;">⚡ ajánlott</span>' : '';
      var outerStyle = 'border:1.5px solid '+(isChecked?'#1F497D':'#e5e9ef')+';border-radius:8px;padding:10px 12px;background:'+(isChecked?'#f0f5fb':'#f8f9fa')+';';
      // A kártya külső div-je NEM toggle - csak vizuális keret
      szolgHtml += '<div style="'+outerStyle+'">';
      // A toggle CSAK a checkbox+label sorára vonatkozik
      szolgHtml += '<div style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;" data-toggle-szolg="'+s.id+'">';
      szolgHtml += svCheckbox(isChecked, true);
      szolgHtml += '<span style="font-size:13px;font-weight:600;color:#102536;flex:1;">'+s.label+badge+'</span>';
      szolgHtml += '</div>';
      // Az ár input KÍVÜL van a toggle div-ből - semmi nem zavarja
      if (isChecked) {
        szolgHtml += '<div style="display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:6px;border-top:1px solid #e5e9ef;">';
        szolgHtml += '<label style="font-size:11px;color:#667084;white-space:nowrap">Ár:</label>';
        szolgHtml += '<input type="number" min="0" step="1000" placeholder="0" value="'+ar+'" data-ajanlat-szolgar="'+s.id+'" style="flex:1;padding:5px 8px;border:1px solid #1F497D;border-radius:6px;font-size:13px;text-align:right;">';
        szolgHtml += '<span style="font-size:11px;color:#667084">Ft</span>';
        szolgHtml += '</div>';
      }
      szolgHtml += '</div>';
    });
    szolgEl.innerHTML = szolgHtml;
  }

  // 3. Smart Guard
  renderSmartModulok();

  // 4. Összesítő
  var egyebSzolgTotal = SZOLGALTATASOK.reduce(function(sum,s){
    var isChecked = aj.szolgChecked.hasOwnProperty(s.id) ? aj.szolgChecked[s.id] : false;
    return sum + (isChecked ? (Number(aj.szolgArak[s.id])||0) : 0);
  }, 0);
  var sgTotal = getSmartModulTotal();
  var nettoTotal = hibaTotal + egyebSzolgTotal + sgTotal;
  var afaKulcs = Number(aj.afa||0.27);
  var afaOsszeg = Math.round(nettoTotal * afaKulcs);
  var bruttoTotal = nettoTotal + afaOsszeg;

  var sumEl = document.querySelector("#ajanlatSummary");
  if (sumEl) {
    var sumHtml = '<div style="border:1px solid #e5e9ef;border-radius:8px;overflow:hidden;">';
    if (hibaTotal>0) sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;"><span>Hibajavítás összesen</span><strong>'+hibaTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
    if (egyebSzolgTotal>0) sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;"><span>Egyéb szolgáltatások</span><strong>'+egyebSzolgTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
    if (sgTotal>0) sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;"><span>SMART Guard modulok</span><strong>'+sgTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
    sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:14px;font-weight:700;background:#f0f5fb;"><span>Nettó összesen</span><strong>'+nettoTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
    sumHtml += '<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f0f2f5;font-size:13px;color:#667084;"><span>ÁFA ('+Math.round(afaKulcs*100)+'%)</span><span>'+afaOsszeg.toLocaleString("hu-HU")+' Ft</span></div>';
    sumHtml += '<div style="display:flex;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,#102536,#1F497D);color:#fff;font-size:16px;font-weight:800;"><span>Bruttó végösszeg</span><strong>'+bruttoTotal.toLocaleString("hu-HU")+' Ft</strong></div>';
    sumHtml += '</div>';
    sumEl.innerHTML = sumHtml;
    document.querySelector("#ajanlatAfa").value = String(aj.afa||0.27);
  }
}

function wireAjanlat() {
  var ajanlatSection = document.querySelector("#ajanlat");
  ajanlatSection.addEventListener("input", function(e) {
    if (!state.ajanlat) state.ajanlat = getAjanlatState();
    if (e.target.dataset.ajanlatHiba) {
      state.ajanlat.hibaArak[e.target.dataset.ajanlatHiba] = e.target.value;
      saveState();
    }
    if (e.target.dataset.ajanlatSzolgAr !== undefined) {
      if (!state.ajanlat.szolgArak) state.ajanlat.szolgArak = {};
      state.ajanlat.szolgArak[e.target.dataset.ajanlatSzolgAr] = e.target.value;
      saveState();
    }
    if (e.target.dataset.sgAr !== undefined) {
      if (!state.ajanlat.sgArak) state.ajanlat.sgArak = {};
      state.ajanlat.sgArak[e.target.dataset.sgAr] = e.target.value;
      saveState();
    }
  });
  ajanlatSection.addEventListener("blur", function(e) {
    if (e.target.dataset.ajanlatHiba || e.target.dataset.ajanlatSzolgAr !== undefined || e.target.dataset.sgAr !== undefined) {
      renderAjanlat();
    }
  }, true);
  ajanlatSection.addEventListener("change", function(e) {
    if (!state.ajanlat) state.ajanlat = getAjanlatState();
    if (e.target.dataset.ajanlatSzolg) {
      if (!state.ajanlat.szolgChecked) state.ajanlat.szolgChecked = {};
      state.ajanlat.szolgChecked[e.target.dataset.ajanlatSzolg] = e.target.checked;
      saveState(); renderAjanlat();
    }
    if (e.target.dataset.sgModul) {
      if (!state.ajanlat.sgChecked) state.ajanlat.sgChecked = {};
      state.ajanlat.sgChecked[e.target.dataset.sgModul] = e.target.checked;
      saveState(); renderAjanlat();
    }
    if (e.target.id === "ajanlatAfa") {
      state.ajanlat.afa = Number(e.target.value);
      saveState(); renderAjanlat();
    }
  });
  // Click delegation a vizuális checkbox div-ekre
  ajanlatSection.addEventListener("click", function(e) {
    var t = e.target.closest("[data-toggle-szolg]");
    var t2 = e.target.closest("[data-toggle-sg]");
    if (t) {
      var id = t.dataset.toggleSzolg;
      if (!state.ajanlat) state.ajanlat = getAjanlatState();
      if (!state.ajanlat.szolgChecked) state.ajanlat.szolgChecked = {};
      var auto = autoSzolgJavas();
      var wasChecked = state.ajanlat.szolgChecked.hasOwnProperty(id) ? state.ajanlat.szolgChecked[id] : !!auto[id];
      state.ajanlat.szolgChecked[id] = !wasChecked;
      saveState(); renderAjanlat();
    }
    if (t2) {
      var id2 = t2.dataset.toggleSg;
      if (!state.ajanlat) state.ajanlat = getAjanlatState();
      if (!state.ajanlat.sgChecked) state.ajanlat.sgChecked = {};
      var autoSG = autoSmartJavas();
      var wasChecked2 = state.ajanlat.sgChecked.hasOwnProperty(id2) ? state.ajanlat.sgChecked[id2] : !!autoSG[id2];
      state.ajanlat.sgChecked[id2] = !wasChecked2;
      saveState(); renderAjanlat();
    }
  });
  document.querySelector("#downloadAjanlat").addEventListener("click", downloadAjanlatPdf);
}

function renderKeszGomb() {
  var btn = document.querySelector("#keszBtn");
  var banner = document.querySelector("#keszBanner");
  if (!btn || !banner) return;
  if (state.lezarva) {
    btn.style.display = "none";
    banner.style.display = "flex";
    document.querySelector("#keszDatum").textContent = state.lezarvaDatum ? " · Lezárva: "+state.lezarvaDatum : "";
  } else {
    btn.style.display = "block";
    banner.style.display = "none";
  }
}

function downloadAjanlatPdf() {
  var aj = getAjanlatState();
  var auto = autoSzolgJavas();
  var autoSG = autoSmartJavas();
  var faults = allFaultRows().filter(function(r){return !r.isNA;}).sort(function(a,b){return "ABCD".indexOf(a.severity)-"ABCD".indexOf(b.severity);});
  var score = 100; try { score = totalScore(); } catch(e) {}
  var qual = qualification(score);
  var al = actionLevel();
  var scoreHex = categoryColorHex(score);
  var alColor = {Azonnali:"#c92a2a",Sürgős:"#e67700",Ütemezett:"#f2b705",Tervezett:"#1f9d55"}[al]||"#667084";
  var hibaTotal = 0;
  faults.forEach(function(f){var k=btoa(encodeURIComponent(f.text)).slice(0,20);hibaTotal+=Number(aj.hibaArak[k]||0);});
  var egyebTotal = SZOLGALTATASOK.reduce(function(s,sv){var ch=aj.szolgChecked.hasOwnProperty(sv.id)?aj.szolgChecked[sv.id]:false;return s+(ch?(Number(aj.szolgArak[sv.id])||0):0);},0);
  var sgTotal = getSmartModulTotal();
  var nettoTotal = hibaTotal + egyebTotal + sgTotal;
  var afaKulcs = Number(aj.afa||0.27);
  var afaOsszeg = Math.round(nettoTotal*afaKulcs);
  var bruttoTotal = nettoTotal + afaOsszeg;

  var hibaRows = faults.filter(function(f){var k=btoa(encodeURIComponent(f.text)).slice(0,20);return aj.hibaArak[k];}).map(function(f){
    var k=btoa(encodeURIComponent(f.text)).slice(0,20);var ar=Number(aj.hibaArak[k]||0);
    var sevColor={A:"#c92a2a",B:"#e67700",C:"#daa520",D:"#1478b8"}[f.severity]||"#667084";
    return '<tr><td><span style="background:'+sevColor+';color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;">'+f.severity+'</span></td><td>'+escapeHtml(f.text)+'</td><td style="text-align:right;font-weight:700;">'+ar.toLocaleString("hu-HU")+' Ft</td></tr>';
  }).join("");

  var sgRows = SMART_MODULOK.map(function(m){
    var isAuto=!!autoSG[m.id];var ch=aj.sgChecked.hasOwnProperty(m.id)?aj.sgChecked[m.id]:isAuto;var ar=Number(aj.sgArak[m.id]||0);
    var badge=isAuto?'<span style="background:#1F497D;color:#fff;font-size:9px;padding:1px 5px;border-radius:999px;">⚡</span>':'';
    return '<tr style="background:'+(ch?'#f0f5fb':'#fafafa')+'"><td>'+m.icon+' '+m.name+' '+badge+'</td><td style="font-size:11px;color:#667084;">'+m.desc+'</td><td style="text-align:right;font-weight:700;">'+(ch&&ar>0?ar.toLocaleString("hu-HU")+' Ft':'—')+'</td></tr>';
  }).join("");

  var html = '<!DOCTYPE html><html lang="hu"><head><meta charset="UTF-8"><title>Árajánlat</title><style>'
    +'*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:13px;color:#1a2332;background:#f4f6f9}'
    +'.page{max-width:860px;margin:0 auto;padding:0 0 40px}'
    +'.hdr{background:linear-gradient(135deg,#0d1f2d,#1F497D);color:#fff;padding:24px 32px;display:flex;justify-content:space-between;align-items:center;gap:16px}'
    +'.hdr h1{font-size:24px;font-weight:800;}.hdr .sub{font-size:12px;color:#9fb2c4;margin-top:4px}'
    +'.hdr .meta{margin-top:10px;font-size:12px;color:#b8c9d9}'
    +'.score-big{font-size:52px;font-weight:800;text-align:right;}'
    +'.body{background:#fff;padding:24px 32px}'
    +'h2{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#667084;border-bottom:2px solid #e5e9ef;padding-bottom:5px;margin:20px 0 12px}'
    +'table{width:100%;border-collapse:collapse;margin-bottom:4px}'
    +'thead th{background:#102536;color:#fff;padding:7px 12px;font-size:11px;text-align:left}'
    +'tbody td{padding:8px 12px;font-size:12px;border-bottom:1px solid #f0f2f5}'
    +'.sum-card{border:1px solid #e5e9ef;border-radius:8px;overflow:hidden}'
    +'.sum-row{display:flex;justify-content:space-between;padding:9px 16px;border-bottom:1px solid #f0f2f5;font-size:13px}'
    +'.sum-netto{background:#f0f5fb;font-weight:700}'
    +'.sum-brutto{background:linear-gradient(135deg,#102536,#1F497D);color:#fff;font-weight:800;font-size:16px;padding:14px 16px}'
    +'.footer{background:#102536;color:#9fb2c4;padding:12px 32px;font-size:11px;display:flex;justify-content:space-between}'
    +'@media print{body{background:#fff}.page{max-width:100%}}'
    +'</style></head><body><div class="page">'
    +'<div class="hdr"><div><div style="font-size:11px;font-weight:800;letter-spacing:.1em;color:#9fb2c4;margin-bottom:8px">SG · SMART ELECTRIC HUNGARY</div><h1>Árajánlat</h1><div class="sub">Villamos biztonsági felülvizsgálat – helyszíni ajánlat</div><div class="meta">🏢 '+(escapeHtml(state.customerName)||"–")+' &nbsp;·&nbsp; 📍 '+(escapeHtml(state.siteAddress)||"–")+(state.munkaszam?' &nbsp;·&nbsp; 📋 '+escapeHtml(state.munkaszam):'')+' &nbsp;·&nbsp; 📅 '+(state.inspectionDate||"")+'</div></div>'
    +'<div style="text-align:right"><div style="font-size:10px;color:#9fb2c4;margin-bottom:4px">SMARTScore</div><div class="score-big" style="color:'+scoreHex+'">'+score+'%</div><div style="font-size:13px;color:#dce6ef">'+qual+'</div><div style="display:inline-block;background:'+alColor+';color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:999px;margin-top:6px">⚡ '+al+'</div></div></div>'
    +'<div class="body">'
    +(hibaRows?'<h2>🔧 Hibajavítás tételei</h2><table><thead><tr><th width="60">Kat.</th><th>Hiba</th><th width="120" style="text-align:right">Nettó ár</th></tr></thead><tbody>'+hibaRows+'<tr style="background:#f0f5fb"><td colspan="2" style="font-weight:800">Hibajavítás összesen</td><td style="text-align:right;font-weight:800">'+hibaTotal.toLocaleString("hu-HU")+' Ft</td></tr></tbody></table>':'')
    +'<h2>🛡 SMART Guard modulok</h2><table><thead><tr><th>Modul</th><th>Leírás</th><th width="120" style="text-align:right">Ár</th></tr></thead><tbody>'+sgRows+'</tbody></table>'
    +'<h2>💰 Összesítő</h2><div class="sum-card">'
    +(hibaTotal>0?'<div class="sum-row"><span>Hibajavítás összesen</span><strong>'+hibaTotal.toLocaleString("hu-HU")+' Ft</strong></div>':'')
    +(egyebTotal>0?'<div class="sum-row"><span>Egyéb szolgáltatások</span><strong>'+egyebTotal.toLocaleString("hu-HU")+' Ft</strong></div>':'')
    +(sgTotal>0?'<div class="sum-row"><span>SMART Guard modulok</span><strong>'+sgTotal.toLocaleString("hu-HU")+' Ft</strong></div>':'')
    +'<div class="sum-row sum-netto"><span>Nettó összesen</span><strong>'+nettoTotal.toLocaleString("hu-HU")+' Ft</strong></div>'
    +'<div class="sum-row" style="color:#667084"><span>ÁFA ('+Math.round(afaKulcs*100)+'%)</span><span>'+afaOsszeg.toLocaleString("hu-HU")+' Ft</span></div>'
    +'<div class="sum-row sum-brutto"><span>Bruttó végösszeg</span><strong>'+bruttoTotal.toLocaleString("hu-HU")+' Ft</strong></div>'
    +'</div>'
    +'<p style="margin-top:12px;font-size:11px;color:#8792a2">Az árajánlat tájékoztató jellegű, érvényes 30 napig. A végleges ár a megrendelő igényei alapján módosulhat.</p>'
    +'</div>'
    +'<div class="footer"><span><strong>Smart Electric Hungary Kft.</strong> · SMARTGuard VBF rendszer</span><span>Generálva: '+new Date().toLocaleDateString("hu-HU")+'</span></div>'
    +'</div></body></html>';

  var w = window.open('','_blank');
  w.document.write(html);
  w.document.close();
}
