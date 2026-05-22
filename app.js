function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function clone(v) {
  return typeof window.structuredClone === "function" ? window.structuredClone(v) : JSON.parse(JSON.stringify(v));
}

// ─── HATÁRÉRTÉKEK ────────────────────────────────────────────────────────────
const BREAKER_LIMITS = {
  "B6":  7.67, "B10": 4.60, "B13": 3.54, "B16": 2.88,
  "B20": 2.30, "B25": 1.84, "B32": 1.44,
  "C6":  3.83, "C10": 2.30, "C13": 1.77, "C16": 1.44,
  "C20": 1.15, "C25": 0.92, "C32": 0.72,
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

function autoHurokStatus(breaker, valueOhm, fault, severity) {
  if (fault || severity) return "NMF";
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
    { id: "hurok", name: "Hurok + EPH", weight: 50 },
    { id: "avk",   name: "AVK",         weight: 20 },
    { id: "eloszto", name: "Elosztók",  weight: 25 },
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

const storageKey = "smartguard-mvp-state-v10";
const legacyKeys = ["smartguard-mvp-state-v9","smartguard-mvp-state-v8","smartguard-mvp-state-v7"];
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
  customerName: "SPAR Kft.",
  siteAddress: "Eger - 802 SM",
  inspectionDate: new Date().toISOString().slice(0, 10),
  protocolNumbers: { hurok: "", avk: "", eloszto: "" },
  protocolBodies:  { hurok: "", avk: "", eloszto: "" },
  alapdok: clone(defaultAlapdok),
  rooms: [
    { id: "aggregator_gephaz", name: "Aggregátor gépház", level: "", tuzvedelem: "–", defaultDistributor: "FE", defaultBreakerDugalj: "B16", defaultBreakerVilagitas: "B10" },
    { id: "kazanhaz",          name: "Kazánház",          level: "", tuzvedelem: "–", defaultDistributor: "FE", defaultBreakerDugalj: "B16", defaultBreakerVilagitas: "B10" },
    { id: "fe",                name: "FE",                level: "főelosztó", tuzvedelem: "–", defaultDistributor: "FE", defaultBreakerDugalj: "", defaultBreakerVilagitas: "" },
  ],
  avkTypes: avkDefaultTypes,
  scoring: clone(defaultScoring),
  collapsedRooms: {},
  collapsedAvkDists: {},
  hurokRows: [
    { id: uid(), no:1, roomId:"aggregator_gephaz", type:"eph",   point:"Fém bejárati ajtó EPH", modeClass:"II", distributor:"FE", breaker:"",    pe:"-",  valueOhm:"",    status:"NMF", severity:"D", fault:"Potenciálrögzítő földelés hiányzik" },
    { id: uid(), no:2, roomId:"kazanhaz",          type:"hurok", point:"Kötődoboz",              modeClass:"I",  distributor:"FE", breaker:"B16", pe:"-",  valueOhm:"",    status:"NMF", severity:"C", fault:"Nyitott kötődoboz" },
  ],
  avkRows: [
    { id: uid(), no:1, distributorId:"fe_eloszto", place:"FE", mark:"29", type:"Schrack", inA:"16", deltaMa:"30", unV:"230", poles:"2", iDeltaMa:"28,5", timeMs:"168,0", mp:"-", szv:"+", status:"NMF", severity:"B", fault:"NEM OLD LE." },
  ],
  elosztoRows: [
    { id:"fe_eloszto", no:1, name:"FE elosztó", voltage:"400", mainFuse:"250/630",
      ce:"MF", warningLabel:"MF", thermal:"MF", ip:"NMF", evMode:"TN-C-S",
      documentation:"NMF", status:"NMF",
      hurokL1:"", hurokL2:"", hurokL3:"", feszL1:"",
      faults:[
        { id:uid(), text:"Rögzítetlen WAGO-s kötések találhatók az elosztóban", severity:"D" },
        { id:uid(), text:"Tervdokumentáció hiányzik", severity:"D" },
      ],
    },
  ],
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
  target.rooms.forEach(room => {
    const existing = target.hurokRows.filter(r => r.roomId === room.id).length;
    for (let i = existing; i < 10; i++) target.hurokRows.push(emptyHurokRow(target.hurokRows.length+1, room.id, room));
  });
  target.elosztoRows.forEach(dist => {
    const existing = target.avkRows.filter(r => r.distributorId === dist.id).length;
    for (let i = existing; i < 20; i++) target.avkRows.push(emptyAvkRow(target.avkRows.length+1, dist.id, dist.name, target.avkTypes[0]||"Schrack"));
  });
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
    inA:"16", deltaMa:"30", unV:"230", poles:"2", iDeltaMa:"", timeMs:"", mp:"", szv:"", status:"", severity:"", fault:"" };
}

function saveState(source) {
  localStorage.setItem(storageKey, JSON.stringify(state));
  setSyncState("Mentve");
  if (channel && source !== "remote") channel.postMessage(state);
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
  // Hibák (severity kitöltve)
  const hurokFaults = state.hurokRows.filter(r => r.severity && isFilledHurok(r))
    .map(r => ({ category:"hurok", severity:r.severity, text:`${roomName(r.roomId)} – ${r.point}: ${r.fault}`, isNA:false }));
  const avkFaults = state.avkRows.filter(r => r.severity && isFilledAvk(r))
    .map(r => ({ category:"avk", severity:r.severity, text:`${r.place} – ${r.mark}: ${r.fault}`, isNA:false }));
  const elosztóFaults = [];
  state.elosztoRows.forEach(d => d.faults.filter(f=>f.severity).forEach(f =>
    elosztóFaults.push({ category:"eloszto", severity:f.severity, text:`${d.name}: ${f.text}`, isNA:false })));
  const dokFaults = state.elosztoRows.filter(r=>r.documentation==="NMF")
    .map(r => ({ category:"dok", severity:"D", text:`${r.name}: tervdokumentáció hiányzik`, isNA:false }));

  // NA sorok (Nincs adat)
  const hurokNA = state.hurokRows.filter(r => r.status==="NA" && isFilledHurok(r))
    .map(r => ({ category:"hurok", severity:"NA", text:`${roomName(r.roomId)} – ${r.point}`, isNA:true }));
  const avkNA = state.avkRows.filter(r => r.status==="NA" && isFilledAvk(r))
    .map(r => ({ category:"avk", severity:"NA", text:`${r.place} – ${r.mark}`, isNA:true }));

  return [...hurokFaults, ...avkFaults, ...elosztóFaults, ...dokFaults, ...hurokNA, ...avkNA];
}

function categoryScore(catId) {
  const faults = allFaultRows().filter(r => r.category===catId && !r.isNA);
  const hasData = hasCategoryData(catId);
  if (!hasData && !faults.length) return 100;
  const penalty = faults.reduce((s,r) => s+(Number(penalties()[r.severity])||0), 0);
  return Math.max(0, Math.round(100-penalty));
}

function hasCategoryData(id) {
  if (id==="hurok")   return state.hurokRows.some(isFilledHurok);
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
  renderProtocol(); renderReports(); renderSettings(); renderAlapdok();
}

function renderScoreOnly() {
  const score = totalScore();
  document.querySelector("#smartScore").textContent = score;
  document.querySelector("#qualification").textContent = `${qualification(score)} – intézkedési szint: ${actionLevel()}`;
  document.querySelector("#categoryGrid").innerHTML = categories().map(categoryCard).join("");
  renderCriticalList();
  renderClientViews();
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
  document.querySelector("#roomList").innerHTML = state.rooms.map(room => `
    <div class="room-row-extended">
      <div class="room-row-main">
        <input data-room-name="${room.id}" value="${escapeHtml(room.name)}" placeholder="Helyiség neve" />
        <input data-room-level="${room.id}" value="${escapeHtml(room.level||"")}" placeholder="szint/zóna" />
        <span class="room-count">${state.hurokRows.filter(r=>r.roomId===room.id&&isFilledHurok(r)).length} kitöltve</span>
        <button class="delete-btn" data-room-delete="${room.id}">×</button>
      </div>
      <div class="room-row-defaults">
        <label>Elosztó: <input data-room-dist="${room.id}" value="${escapeHtml(room.defaultDistributor||"")}" placeholder="pl. FE" /></label>
        <label>Dugalj megszakító: <input data-room-breaker-dugalj="${room.id}" value="${escapeHtml(room.defaultBreakerDugalj||"")}" placeholder="pl. B16" /></label>
        <label>Világítás megszakító: <input data-room-breaker-vilagitas="${room.id}" value="${escapeHtml(room.defaultBreakerVilagitas||"")}" placeholder="pl. B10" /></label>
        <label>EBF tűzvédelmi osztály:
          <select data-room-tuzvedelem="${room.id}">
            ${TUZVEDELEM_OSZTALYOK.map(o=>`<option value="${o}" ${(room.tuzvedelem||"–")===o?"selected":""}>${o}</option>`).join("")}
          </select>
        </label>
        <button class="secondary room-fill-btn" data-fill-room="${room.id}">⚡ Tömeges kitöltés</button>
      </div>
    </div>`).join("");
}

function renderAvkTypes() {
  document.querySelector("#avkTypeList").innerHTML = state.avkTypes.map(t =>
    `<span class="type-chip">${t}<button data-type-delete="${t}">×</button></span>`).join("");
}

// ─── HUROK TÁBLA ─────────────────────────────────────────────────────────────
// Fejléc csak a nyitott szekció BELSEJÉBEN, közvetlenül a sorok felett
function hurokHeaderRow() {
  const cols = ["Ssz.","Típus","Mérési pont / megnevezés","Mód/oszt.","Elosztó","Megszakító","PE folyt.","Érték [Ω]","Max Zs [Ω]","Minősítés","Hiba kat.","Hiba leírás"];
  return `<div class="grid-row hurok-row-12 hurok-inner-header">
    ${cols.map(h=>`<div class="grid-cell grid-head">${h}</div>`).join("")}
  </div>`;
}

function renderHurokTable() {
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
      const displayNo = localIdx + 1; // 1-től indul minden helyiségben
      return `<div class="grid-row hurok-row-12">
        ${cell(`<span class="row-no-badge">${displayNo}</span>`)}
        ${cell(`<select data-hurok="${row.id}" data-field="type"><option value="hurok" ${row.type==="hurok"?"selected":""}>Hurok</option><option value="eph" ${row.type==="eph"?"selected":""}>EPH</option></select>`)}
        ${cell(`<input data-hurok="${row.id}" data-field="point" value="${escapeHtml(row.point)}">`)}
        ${cell(selectHtml("hurok",row.id,"modeClass",["I","II"],row.modeClass))}
        ${cell(`<input data-hurok="${row.id}" data-field="distributor" value="${escapeHtml(row.distributor)}">`)}
        ${cell(`<input data-hurok="${row.id}" data-field="breaker" value="${escapeHtml(row.breaker)}">`)}
        ${cell(selectHtml("hurok",row.id,"pe",["-","OK","nem OK"],row.pe))}
        ${cell(`<input data-hurok="${row.id}" data-field="valueOhm" value="${escapeHtml(row.valueOhm)}">`)}
        ${cell(`<span class="limit-badge ${limitStr!=="–"?"":"limit-unknown"}">${limitStr}</span>`)}
        ${cell(selectHtml("hurok",row.id,"status",["","MF","NMF","NA"],row.status))}
        ${cell(selectHtml("hurok",row.id,"severity",["","A","B","C","D"],row.severity))}
        ${cell(`<input data-hurok="${row.id}" data-field="fault" value="${escapeHtml(row.fault)}">`)}
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
  const cols = ["Ssz.","Jele","Típus","In [A]","Δn [mA]","Un [V]","pólus","IΔn [mA]","t [ms]","MP","SZV","Minősítés","Hiba kat.","Hiba"];
  return `<div class="grid-row avk-row-14 avk-inner-header">
    ${cols.map(h=>`<div class="grid-cell grid-head">${h}</div>`).join("")}
  </div>`;
}

function renderAvkTable() {
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
      return `
      <div class="grid-row avk-row-14">
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
  const scoreColor = categoryColorHex(score);
  const faults     = allFaultRows();
  const errors     = faults.filter(r=>!r.isNA).sort((a,b)=>"ABCD".indexOf(a.severity)-"ABCD".indexOf(b.severity));
  const naHurok    = faults.filter(r=>r.isNA&&r.category==="hurok");
  const naAvk      = faults.filter(r=>r.isNA&&r.category==="avk");

  document.querySelector("#reportScore").textContent  = score;
  document.querySelector("#reportIntro").textContent  = `${state.customerName} / ${state.siteAddress} – ${qual}, intézkedési szint: ${al}`;

  document.querySelector("#reportBars").innerHTML = categories().map(c => {
    const v = categoryScore(c.id);
    return `<div class="report-bar-row">
      <strong>${c.name}</strong>
      <div class="bar-track"><div class="bar-fill" style="width:${v}%;background:${categoryColor(v)}"></div></div>
      <span style="color:${categoryColor(v)};font-weight:800">${v}%</span>
    </div>`;
  }).join("");

  let priorityHtml = "";
  if (errors.length) {
    const avkErrors   = errors.filter(r=>r.category==="avk");
    const hurokErrors = errors.filter(r=>r.category==="hurok"||r.category==="eloszto"||r.category==="dok");
    if (avkErrors.length) {
      priorityHtml += `<div class="fault-section-label">AVK hibák</div>`;
      priorityHtml += avkErrors.map(f=>`<div class="compact-item"><span>${f.text}</span><span class="pill" style="background:${severityColor(f.severity)}">${f.severity}</span></div>`).join("");
    }
    if (hurokErrors.length) {
      priorityHtml += `<div class="fault-section-label">Hurok és EPH hibák</div>`;
      priorityHtml += hurokErrors.map(f=>`<div class="compact-item"><span>${f.text}</span><span class="pill" style="background:${severityColor(f.severity)}">${f.severity}</span></div>`).join("");
    }
  } else {
    priorityHtml = "<p>Nincs rögzített hiba.</p>";
  }
  if (naHurok.length) {
    priorityHtml += `<div class="na-section-label">Nincs adat – Hurok és EPH</div>`;
    priorityHtml += naHurok.map(r=>`<div class="compact-item na-item"><span>${r.text}</span><span class="pill pill-na">NA</span></div>`).join("");
  }
  if (naAvk.length) {
    priorityHtml += `<div class="na-section-label">Nincs adat – AVK</div>`;
    priorityHtml += naAvk.map(r=>`<div class="compact-item na-item"><span>${r.text}</span><span class="pill pill-na">NA</span></div>`).join("");
  }
  document.querySelector("#reportPriorities").innerHTML = priorityHtml;

  document.querySelector("#printCustomer").textContent = state.customerName;
  document.querySelector("#printSite").textContent     = state.siteAddress;
  document.querySelector("#printDate").textContent     = `Dátum: ${state.inspectionDate}`;
  document.querySelector("#printSummary").innerHTML = `
    <div class="print-score-hero" style="background:linear-gradient(135deg,#102536,#1F497D);color:#fff;padding:24px 32px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
      <div>
        <div style="font-size:13px;font-weight:800;text-transform:uppercase;color:#9fb2c4;margin-bottom:4px">SMARTScore</div>
        <div style="font-size:72px;font-weight:800;line-height:1">${score}</div>
        <div style="font-size:22px;color:#dce6ef;margin-top:4px">${qual}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;color:#9fb2c4;margin-bottom:8px">Intézkedési szint</div>
        <div style="font-size:32px;font-weight:800;color:${scoreColor}">${al}</div>
        <div style="font-size:13px;color:#9fb2c4;margin-top:8px">${state.inspectionDate}</div>
      </div>
    </div>
    <div style="margin-bottom:20px">
      ${categories().map(c=>{const v=categoryScore(c.id);const hex=categoryColorHex(v);return `
        <div style="display:grid;grid-template-columns:200px 1fr 60px;gap:12px;align-items:center;margin-bottom:10px">
          <span style="font-weight:700;color:#1F497D">${c.name}</span>
          <div style="background:#e8eef5;border-radius:999px;height:14px;overflow:hidden"><div style="width:${v}%;height:100%;background:${hex};border-radius:999px"></div></div>
          <span style="font-weight:800;color:${hex};text-align:right">${v}%</span>
        </div>`;}).join("")}
    </div>
    ${errors.length?`<div style="margin-top:16px"><h3 style="color:#1F497D;border-bottom:2px solid #1F497D;padding-bottom:6px">Azonosított hibák</h3>
      ${errors.map(f=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #eee">
        <span style="background:${severityColorHex(f.severity)};color:#fff;font-weight:800;padding:3px 8px;border-radius:999px;font-size:12px;min-width:24px;text-align:center">${f.severity}</span>
        <span style="font-size:14px">${f.text}</span></div>`).join("")}</div>`:""}`;
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
function showView(id) {
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
}

// ─── WORKSPACE EVENTS ────────────────────────────────────────────────────────
function isTableCell(t) { return !!(t.dataset.hurok||t.dataset.avk||t.dataset.eloszto||t.dataset.fault); }

function applyWorkspaceValue(t) {
  if (t.dataset.hurok) {
    updateRow(state.hurokRows, t.dataset.hurok, t.dataset.field, t.value);
    // Auto-minősítés: ha breaker vagy valueOhm változott
    if (t.dataset.field==="valueOhm"||t.dataset.field==="breaker") {
      const row = state.hurokRows.find(r=>r.id===t.dataset.hurok);
      if (row) {
        // PE auto
        if (t.dataset.field==="valueOhm") row.pe = t.value?"OK":"-";
        // Auto status csak ha a user nem manuálisan állította (status mező nem ez a target)
        const newStatus = autoStatus(row.breaker, row.valueOhm, row.fault, row.severity);
        if (newStatus) row.status = newStatus;
      }
    }
    if (t.dataset.field==="fault"||t.dataset.field==="severity") {
      const row = state.hurokRows.find(r=>r.id===t.dataset.hurok);
      if (row) {
        const newStatus = autoStatus(row.breaker, row.valueOhm, row.fault, row.severity);
        if (newStatus) row.status = newStatus;
      }
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
  applyWorkspaceValue(event.target);
  saveState();
  if (isTableCell(event.target)) renderScoreOnly();
  else render();
}

function handleWorkspaceChange(event) {
  const t = event.target;
  applyWorkspaceValue(t);
  saveState();
  // Ha AVK unV változott → pólus is frissül a DOM-ban, kell renderAvkTable
  if (t.dataset.avk && t.dataset.field === "unV") {
    renderAvkTable(); renderScoreOnly(); return;
  }
  // Ha AVK mért értékek változtak → status frissül, renderAvkTable kell
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

  // + sorok hurokhoz
  if (t.dataset.addRoomRows) {
    event.stopPropagation();
    addHurokRows(10, t.dataset.addRoomRows, t.dataset.rowType||"hurok");
    saveState(); renderHurokTable(); return;
  }

  // AVK elosztó toggle
  const toggleDist = t.closest("[data-toggle-avk-dist]");
  if (toggleDist && !t.dataset.addAvkDistRows) {
    state.collapsedAvkDists[toggleDist.dataset.toggleAvkDist] = !state.collapsedAvkDists[toggleDist.dataset.toggleAvkDist];
    saveState(); renderAvkTable(); return;
  }
  if (t.dataset.addAvkDistRows) { event.stopPropagation(); addAvkRows(10, t.dataset.addAvkDistRows); saveState(); renderAvkTable(); return; }

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

function downloadDataPackage() {
  const blob = new Blob([JSON.stringify({
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
function wireEvents() {
  document.querySelectorAll(".nav-item").forEach(b=>{
    const go=e=>{e.preventDefault();showView(b.dataset.view);};
    b.addEventListener("click",go); b.addEventListener("touchend",go);
  });
  document.querySelectorAll("[data-jump]").forEach(b=>{
    const go=e=>{e.preventDefault();showView(b.dataset.jump);};
    b.addEventListener("click",go); b.addEventListener("touchend",go);
  });
  ["customerName","siteAddress","inspectionDate"].forEach(id=>{
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
    for(let i=0;i<10;i++) state.hurokRows.push(emptyHurokRow(nextNo(state.hurokRows),room.id,room,"hurok"));
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
    for(let i=0;i<10;i++) state.hurokRows.push(emptyHurokRow(nextNo(state.hurokRows),room.id,room,"hurok"));
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
    for(let i=0;i<20;i++) state.avkRows.push(emptyAvkRow(nextNo(state.avkRows),newDist.id,newDist.name,state.avkTypes[0]||"Schrack"));
    saveState(); render();
  });
  document.querySelector(".workspace").addEventListener("input",  handleWorkspaceInput);
  document.querySelector(".workspace").addEventListener("change", handleWorkspaceChange);
  document.querySelector(".workspace").addEventListener("click",  handleWorkspaceClick);
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
  if(channel) channel.addEventListener("message",e=>{state=migrateState(e.data);saveState("remote");render();});
}

wireEvents();
render();
saveState();

if("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(regs=>regs.forEach(r=>r.unregister()));
if("caches" in window) caches.keys().then(keys=>keys.forEach(k=>caches.delete(k)));
