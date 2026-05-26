/* Smart LightCare – világítás-korszerűsítési felmérő modul
   Adatszerkezet és számítómotor a Smart Electric Excel-sablonok alapján. */
"use strict";
console.log("%cSmart LightCare betöltve","background:#0b5fd4;color:#fff;padding:2px 8px;border-radius:4px;font-weight:bold");

function uid(){return "lc_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);}
function clone(v){return JSON.parse(JSON.stringify(v));}
function num(v){var n=parseFloat(String(v==null?"":v).replace(",",".").replace(/\s/g,""));return isFinite(n)?n:0;}
function fmtInt(n){return Math.round(n).toLocaleString("hu-HU");}
function fmtFt(n){return fmtInt(n)+" Ft";}

var storageKey="smartguard-lightcare-v1";

/* ── Listák (a lámpakivonat Munka1 + Parameterek alapján) ── */
var ROOM_CATEGORIES=["Folyosó","Raktár","Vizesblokk","Gyógyító terület","Betegfelvétel",
  "Konferenciaterem/Díszterem/Előadó/Tárgyaló","Tornaterem/foglalkoztató","Öltöző/személyzeti zuhanyzó",
  "Orvosi szoba","Nővérdolgozó/Teakonyha/Ápolók","Kórterem/szoba","Iroda","Váróterem",
  "Gépház/Hőközpont/Elektromos kapcsolótér/Vezérlők","Rendelő","Kültér","Műtő","Konyha","Labor","Egyéb"];

var TECHNOLOGIES=["LED","LED panel","Fénycsöves LFL","Fénycső","CFL-Brio","Mélysugárzó CFL",
  "Halogén spot","Halogén vagy normál izzó","HID/Nátrium/Higany","Egyéb"];

// Technológia pontok (Parameterek lap)
var TECH_POINTS={"LED":100,"LED panel":100,"Fénycsöves LFL":35,"Fénycső":35,"CFL-Brio":25,
  "Mélysugárzó CFL":20,"Halogén spot":10,"Halogén vagy normál izzó":10,"HID/Nátrium/Higany":15,"Egyéb":50};

var CONTROL_TYPES=["Kézi","Csoportos kapcsolás","Időzített","Mozgásérzékelős","Fényérzékelős","BMS / épületfelügyelet"];
var CONTROL_POINTS={"Kézi":40,"Csoportos kapcsolás":60,"Időzített":75,"Mozgásérzékelős":85,"Fényérzékelős":90,"BMS / épületfelügyelet":95};

// Rögzítési felület / mennyezet kialakítása (lámpakivonat minta)
var SURFACES=["Vasbeton födém","Gipszkarton álmennyezet","Kazettás álmennyezet",
  "Boltíves/poroszsüveg födém","Fa födém","Rejtett bordás álmennyezet","Tégla","Beton","Egyéb"];
// Szerelési mód
var MOUNTS=["mennyezetre szerelt","oldalfali","függesztett","süllyesztett",
  "tartószerkezetre szerelt","oszlopkarra szerelt","oszlopcsúcsra szerelt","egyéb"];

// Minősítési sávok
var BANDS=[{min:90,label:"Kiváló",note:"Stabil, korszerű rendszer"},
  {min:80,label:"Jó",note:"Kisebb optimalizálási potenciál"},
  {min:70,label:"Megfelelő",note:"Jól működő, de fejleszthető"},
  {min:55,label:"Fejlesztendő",note:"Célzott korszerűsítés javasolt"},
  {min:0,label:"Korszerűsítés indokolt",note:"Magas megtakarítási és komfort potenciál"}];

/* ── Kezdeti állapot ── */
var initialState={
  customer:"", site:"", date:"", inspector:"SMART Electric", type:"Smart LightCare",
  priceFt:57, daysPerYear:365, investFt:0, execFt:0, auditFt:0, note:"",
  // megtérülési kedvezmény-paraméterek
  taoRate:0.45, ekrPriceGj:8000, maintAnnualCur:0, maintAnnualLed:0,
  vatRate:0.27,                          // ÁFA az árajánlathoz
  wEnergy:40, wComfort:30, wTech:30,     // pontszám-súlyok (auto-normalizált)
  lamps:[],         // lámpa-sorok
  quotePrices:{},   // javasolt LED típus -> {unit: nettó ár/db, install: kivitelezés/db}
  luxRef:{},        // kategória -> elvárt lux (a felhasználó tölti ki)
  luxRooms:[]       // mért lux helyiségenként
};

var state=load();

function load(){
  try{var s=localStorage.getItem(storageKey); if(s) return migrate(JSON.parse(s));}catch(e){}
  return clone(initialState);
}
function migrate(s){
  var base=clone(initialState);
  for(var k in base){ if(!(k in s)) s[k]=base[k]; }
  if(!Array.isArray(s.lamps)) s.lamps=[];
  s.lamps.forEach(function(l){
    if(l.sources==null) l.sources=1;
    if(l.surface==null) l.surface="Vasbeton födém";
    if(l.mount==null) l.mount="mennyezetre szerelt";
    if(l.ledType==null) l.ledType="";
    if(l.ledSku==null) l.ledSku="";
    if(l.ledBrand==null) l.ledBrand="";
  });
  if(!Array.isArray(s.luxRooms)) s.luxRooms=[];
  if(typeof s.luxRef!=="object"||!s.luxRef) s.luxRef={};
  if(typeof s.quotePrices!=="object"||!s.quotePrices) s.quotePrices={};
  return s;
}
function save(){ try{localStorage.setItem(storageKey,JSON.stringify(state)); setSync("Mentve");}catch(e){setSync("Mentés hiba");} }
function setSync(t){var el=document.getElementById("sync"); if(el) el.textContent=t;}

function emptyLamp(){
  return {id:uid(), building:"", room:"", category:"Iroda", tech:"Fénycsöves LFL",
    control:"Kézi", qty:0, sources:1, wCur:0, wLed:0, hoursPerDay:0, condition:3,
    surface:"Vasbeton födém", mount:"mennyezetre szerelt",
    ledType:"", ledSku:"", ledBrand:""};
}
function addLamps(n){ for(var i=0;i<n;i++) state.lamps.push(emptyLamp()); }

/* ── SZÁMÍTÓMOTOR (a Megtérülési_számítás minta képletei) ── */
function calc(){
  var days=num(state.daysPerYear)||365;
  var price=num(state.priceFt);
  var curW=0, ledW=0, curKwh=0, ledKwh=0, qtyTotal=0;
  state.lamps.forEach(function(l){
    var q=num(l.qty);
    var srcs=num(l.sources)||1;        // fényforrás / lámpatest (régi oldal)
    var pcW=q*srcs*num(l.wCur);         // előtte összW = db × fényforrás/lámpatest × fényforrás W
    var plW=q*num(l.wLed);              // utána összW = db × LED W (a LED W a teljes armatúra)
    var h=num(l.hoursPerDay)*days;
    curW+=pcW; ledW+=plW; qtyTotal+=q;
    curKwh+=pcW*h/1000; ledKwh+=plW*h/1000;
  });
  var saveKwh=curKwh-ledKwh;
  var curFt=curKwh*price, ledFt=ledKwh*price, saveFt=curFt-ledFt;
  var maintSave=num(state.maintAnnualCur)-num(state.maintAnnualLed);

  // beruházás: LED lámpák nettó (investFt) + kivitelezés (execFt); auditor külön (auditFt)
  var invest=num(state.investFt)+num(state.execFt);
  var audit=num(state.auditFt);
  var denom=saveFt+maintSave; // éves megtakarítás (áram + karbantartás)

  var pbPlain = denom>0 ? (invest)/denom : 0;
  // TAO
  var tao=invest*num(state.taoRate);
  var pbTao = denom>0 ? (invest+audit-tao)/denom : 0;
  // EKR: GJ = megtak kWh * 3.6 / 1000 ; Ft = GJ * ekrPriceGj
  var ekrGj=saveKwh*3.6/1000;
  var ekrFt=ekrGj*num(state.ekrPriceGj);
  var pbEkr = denom>0 ? (invest+audit-ekrFt)/denom : 0;

  return {qtyTotal:qtyTotal, curW:curW, ledW:ledW, curKwh:curKwh, ledKwh:ledKwh,
    saveKwh:saveKwh, curFt:curFt, ledFt:ledFt, saveFt:saveFt, maintSave:maintSave,
    invest:invest, audit:audit, denom:denom,
    pbPlain:pbPlain, tao:tao, pbTao:pbTao, ekrGj:ekrGj, ekrFt:ekrFt, pbEkr:pbEkr};
}

/* ── PONTOZÁS (Parameterek logika) ── */
function score(){
  var lamps=state.lamps.filter(function(l){return num(l.qty)>0;});
  if(!lamps.length) return null;
  var totQty=0, techWsum=0, condWsum=0, ctrlWsum=0;
  lamps.forEach(function(l){
    var q=num(l.qty); totQty+=q;
    techWsum += (TECH_POINTS[l.tech]||50)*q;
    var cp=[0,20,40,60,80,100][num(l.condition)]||60;
    condWsum += cp*q;
    ctrlWsum += (CONTROL_POINTS[l.control]||40)*q;
  });
  var techScore = totQty? techWsum/totQty : 0;
  var condScore = totQty? condWsum/totQty : 0;
  var ctrlScore = totQty? ctrlWsum/totQty : 0;

  // Energiahatékonyság: a LED-re váltással elérhető megtakarítás aránya
  var c=calc();
  var energyScore = c.curKwh>0 ? Math.max(0,Math.min(100, 100*(1-c.ledKwh/c.curKwh)*1.0 + 0)) : 0;
  // ha már most jó (kevés megtakarítás), az is lehet jó pont -> invertáljuk értelmesen:
  // minél kisebb a megtakarítási potenciál, annál korszerűbb -> de itt a megtakarítás a cél, ezért
  // az energia-alpont a JELENLEGI technológiát tükrözi (tech pontok), a megtakarítás külön KPI.
  energyScore = techScore; // a Parameterek szerint a technológia adja az energia-alpontot

  // Komfort/lux: a lux-megfelelés aránya (ha van mért adat), különben a kondíció
  var comfortScore=luxComplianceScore();
  if(comfortScore==null) comfortScore=condScore;

  // Összpontszám: súlyozott (energia 40%, komfort 30%, technológia 30%)
  // Összpontszám: a Beállításokban megadott súlyokkal (auto-normalizálva)
  var we=num(state.wEnergy), wc=num(state.wComfort), wt=num(state.wTech);
  var ws=we+wc+wt; if(ws<=0){we=40;wc=30;wt=30;ws=100;}
  var total=Math.round((energyScore*we + comfortScore*wc + techScore*wt)/ws);
  var band=BANDS.find(function(b){return total>=b.min;});
  return {total:total, band:band, energy:Math.round(energyScore),
    comfort:Math.round(comfortScore), tech:Math.round(techScore),
    cond:Math.round(condScore), ctrl:Math.round(ctrlScore)};
}

function luxComplianceScore(){
  var rooms=state.luxRooms.filter(function(r){return num(r.measured)>0;});
  if(!rooms.length) return null;
  var ok=0;
  rooms.forEach(function(r){
    var req=num(state.luxRef[r.category]);
    if(req<=0){ ok+=1; return; } // ha nincs elvárt érték megadva, ne büntessünk
    if(num(r.measured)>=req) ok+=1;
    else ok += Math.max(0, num(r.measured)/req);
  });
  return 100*ok/rooms.length;
}

/* ── RENDER ── */
function render(){
  renderTitle(); renderDashboard(); renderAlap(); renderLampTable();
  renderLux(); renderMegterules(); renderQuote(); renderSettings();
}
function renderTitle(){
  var t=document.getElementById("siteTitle");
  if(state.customer||state.site) t.textContent=(state.customer||"")+(state.site?" – "+state.site:"");
  else t.textContent="Új felmérés";
}

function renderDashboard(){
  var c=calc(), s=score();
  document.getElementById("kCur").textContent=fmtInt(c.curKwh)+" kWh/év";
  document.getElementById("kLed").textContent=fmtInt(c.ledKwh)+" kWh/év";
  document.getElementById("kSave").textContent=fmtFt(c.saveFt)+"/év";
  document.getElementById("kPb").textContent=c.pbPlain>0?(c.pbPlain.toFixed(2).replace(".",",")+" év"):"– év";
  var sn=document.getElementById("scoreNumber"), sl=document.getElementById("scoreLabel"), ss=document.getElementById("scoreSub");
  if(s){
    sn.textContent=s.total;
    sl.textContent=s.band.label;
    ss.textContent=s.band.note;
    document.getElementById("sEnergy").textContent=s.energy+"%";
    document.getElementById("sComfort").textContent=s.comfort+"%";
    document.getElementById("sTech").textContent=s.tech+"%";
  }else{
    sn.textContent="–"; sl.textContent="Még nincs adat"; ss.textContent="Vidd fel a lámpákat a felmérés indításához.";
    document.getElementById("sEnergy").textContent="–";
    document.getElementById("sComfort").textContent="–";
    document.getElementById("sTech").textContent="–";
  }
  renderFindings(c,s);
}

function renderFindings(c,s){
  var ul=document.getElementById("findings"); ul.innerHTML="";
  var items=[];
  if(c.qtyTotal>0){
    items.push("Felmért lámpatestek száma: <b>"+fmtInt(c.qtyTotal)+" db</b>.");
    if(c.saveKwh>0) items.push("A LED-re váltással az éves fogyasztás <b>"+fmtInt(c.curKwh)+" kWh-ról "+fmtInt(c.ledKwh)+" kWh-ra</b> csökkenthető (–"+Math.round(100*c.saveKwh/(c.curKwh||1))+"%).");
    if(c.saveFt>0) items.push("Becsült éves áramdíj-megtakarítás: <b>"+fmtFt(c.saveFt)+"</b>.");
    if(c.pbPlain>0) items.push("A beruházás kedvezmények nélkül <b>"+c.pbPlain.toFixed(2).replace(".",",")+" év</b> alatt térül meg.");
  }
  if(s && s.tech<60) items.push("A nem LED technológiák aránya még jelentős – korszerűsítés indokolt.");
  if(!items.length) items.push("Még nincs elég adat a megállapításokhoz.");
  items.forEach(function(t){var li=document.createElement("li"); li.innerHTML=t; ul.appendChild(li);});
}

function field(label,key,type,opts){
  var v=state[key]==null?"":state[key];
  if(type==="select"){
    var o=opts.map(function(x){return '<option value="'+x+'"'+(String(v)===String(x)?" selected":"")+'>'+x+'</option>';}).join("");
    return '<div class="fld"><label>'+label+'</label><select data-k="'+key+'">'+o+'</select></div>';
  }
  if(type==="textarea") return '<div class="fld" style="grid-column:1/-1"><label>'+label+'</label><textarea data-k="'+key+'" rows="2">'+v+'</textarea></div>';
  return '<div class="fld"><label>'+label+'</label><input data-k="'+key+'" type="'+(type||"text")+'" value="'+v+'"></div>';
}

function renderAlap(){
  document.getElementById("alapForm").innerHTML=
    field("Ügyfél neve","customer")+
    field("Telephely címe","site")+
    field("Felmérés dátuma","date")+
    field("Felmérést végző","inspector")+
    field("Áramdíj (Ft/kWh)","priceFt","number")+
    field("Üzemnap / év","daysPerYear","number")+
    field("LED beruházás – lámpák nettó (Ft)","investFt","number")+
    field("Kivitelezési költség (Ft)","execFt","number")+
    field("Energetikai auditor költsége (Ft)","auditFt","number")+
    field("Vezetői fókusz / megjegyzés","note","textarea");
}

function renderSettings(){
  var we=num(state.wEnergy), wc=num(state.wComfort), wt=num(state.wTech), ws=we+wc+wt||1;
  document.getElementById("settForm").innerHTML=
    '<div class="fld" style="grid-column:1/-1"><label style="font-weight:800;color:#16304a">Pontszám-súlyok (összpontszám = súlyozott átlag, auto-normalizált)</label></div>'+
    field("Energiahatékonyság súly","wEnergy","number")+
    field("Komfort / lux súly","wComfort","number")+
    field("Technológia súly","wTech","number")+
    '<div class="fld"><label>Jelenlegi arányok</label><input value="'+
      Math.round(100*we/ws)+'% / '+Math.round(100*wc/ws)+'% / '+Math.round(100*wt/ws)+'%" disabled></div>'+
    field("ÁFA mértéke az árajánlathoz (pl. 0,27)","vatRate","number")+
    field("TAO támogatás mértéke (pl. 0,45)","taoRate","number")+
    field("EKR eladási ár (Ft/GJ)","ekrPriceGj","number")+
    field("Jelenlegi éves karbantartási költség (Ft)","maintAnnualCur","number")+
    field("LED utáni éves karbantartási költség (Ft)","maintAnnualLed","number");
  // lux referencia tábla
  var t=document.getElementById("luxRefTable");
  var rows=ROOM_CATEGORIES.map(function(cat){
    var v=state.luxRef[cat]==null?"":state.luxRef[cat];
    return '<tr><td>'+cat+'</td><td class="num"><input type="number" class="num" data-luxref="'+cat+'" value="'+v+'" placeholder="lux"></td></tr>';
  }).join("");
  t.innerHTML='<thead><tr><th>Helyiség kategória</th><th>Elvárt lux</th></tr></thead><tbody>'+rows+'</tbody>';
}

function renderLampTable(){
  var t=document.getElementById("lampTable");
  var days=num(state.daysPerYear)||365, price=num(state.priceFt);
  var head='<thead><tr>'+
    '<th>#</th><th>Épület</th><th>Helyiség</th><th>Kategória</th><th>Felület</th><th>Szerelés</th><th>Technológia</th><th>Vezérlés</th>'+
    '<th>Db</th><th>Fényforrás/<br>lámpatest</th><th>Jelenlegi<br>fényforrás W/db</th><th>Javasolt<br>LED W/db</th><th>Kiváltó típus</th><th>SKU/cikkszám</th><th>Gyártó</th><th>Üzemóra/nap</th><th>Állapot</th>'+
    '<th>Előtte kWh/év</th><th>Utána kWh/év</th><th></th></tr></thead>';
  var body=state.lamps.map(function(l,i){
    var q=num(l.qty), srcs=num(l.sources)||1, h=num(l.hoursPerDay)*days;
    var curKwh=q*srcs*num(l.wCur)*h/1000, ledKwh=q*num(l.wLed)*h/1000;
    function sel(opts,key){return '<select data-id="'+l.id+'" data-f="'+key+'">'+opts.map(function(x){return '<option'+(l[key]===x?" selected":"")+'>'+x+'</option>';}).join("")+'</select>';}
    return '<tr>'+
      '<td class="calc">'+(i+1)+'</td>'+
      '<td><input data-id="'+l.id+'" data-f="building" value="'+(l.building||"")+'"></td>'+
      '<td><input data-id="'+l.id+'" data-f="room" value="'+(l.room||"")+'"></td>'+
      '<td>'+sel(ROOM_CATEGORIES,"category")+'</td>'+
      '<td>'+sel(SURFACES,"surface")+'</td>'+
      '<td>'+sel(MOUNTS,"mount")+'</td>'+
      '<td>'+sel(TECHNOLOGIES,"tech")+'</td>'+
      '<td>'+sel(CONTROL_TYPES,"control")+'</td>'+
      '<td><input class="num" type="number" data-id="'+l.id+'" data-f="qty" value="'+(l.qty||"")+'"></td>'+
      '<td><input class="num" type="number" data-id="'+l.id+'" data-f="sources" value="'+(l.sources!=null?l.sources:1)+'"></td>'+
      '<td><input class="num" type="number" data-id="'+l.id+'" data-f="wCur" value="'+(l.wCur||"")+'"></td>'+
      '<td><input class="num" type="number" data-id="'+l.id+'" data-f="wLed" value="'+(l.wLed||"")+'"></td>'+
      '<td><input data-id="'+l.id+'" data-f="ledType" value="'+(l.ledType||"")+'" placeholder="pl. 28W LED panel 600×600"></td>'+
      '<td><input data-id="'+l.id+'" data-f="ledSku" value="'+(l.ledSku||"")+'" placeholder="cikkszám"></td>'+
      '<td><input data-id="'+l.id+'" data-f="ledBrand" value="'+(l.ledBrand||"")+'" placeholder="gyártó"></td>'+
      '<td><input class="num" type="number" data-id="'+l.id+'" data-f="hoursPerDay" value="'+(l.hoursPerDay||"")+'"></td>'+
      '<td>'+sel([1,2,3,4,5].map(String),"condition")+'</td>'+
      '<td class="num calc">'+fmtInt(curKwh)+'</td>'+
      '<td class="num calc">'+fmtInt(ledKwh)+'</td>'+
      '<td><button class="row-x" data-del="'+l.id+'">×</button></td></tr>';
  }).join("");
  t.innerHTML=head+'<tbody>'+body+'</tbody>';
}

function renderLux(){
  // a lámpa-felmérésből egyedi helyiségek (épület+helyiség+kategória)
  var seen={}, list=[];
  state.lamps.forEach(function(l){
    if(!l.room && !l.building) return;
    var key=(l.building||"")+"|"+(l.room||"")+"|"+l.category;
    if(!seen[key]){seen[key]=true; list.push({building:l.building||"",room:l.room||"",category:l.category});}
  });
  // szinkronizáljuk a luxRooms-ot a listával (megtartva a mért értékeket)
  var byKey={}; state.luxRooms.forEach(function(r){byKey[(r.building||"")+"|"+(r.room||"")+"|"+r.category]=r;});
  state.luxRooms=list.map(function(r){var k=(r.building||"")+"|"+(r.room||"")+"|"+r.category; var ex=byKey[k]; return {building:r.building,room:r.room,category:r.category,measured:ex?ex.measured:""};});

  var t=document.getElementById("luxTable");
  if(!state.luxRooms.length){ t.innerHTML='<thead><tr><th>Helyiség</th></tr></thead><tbody><tr><td>Még nincs felmért helyiség. Tölts ki lámpa-sorokat helyiség névvel.</td></tr></tbody>'; return; }
  var head='<thead><tr><th>Épület</th><th>Helyiség</th><th>Kategória</th><th>Elvárt lux</th><th>Mért lux</th><th>Megfelelés</th></tr></thead>';
  var body=state.luxRooms.map(function(r,i){
    var req=num(state.luxRef[r.category]);
    var meas=num(r.measured);
    var badge='<span class="badge na">nincs adat</span>';
    if(meas>0 && req>0) badge = meas>=req?'<span class="badge ok">megfelel</span>':'<span class="badge low">alacsony</span>';
    else if(meas>0 && req<=0) badge='<span class="badge na">nincs elvárt</span>';
    return '<tr>'+
      '<td class="calc">'+(r.building||"–")+'</td><td>'+(r.room||"–")+'</td><td class="calc">'+r.category+'</td>'+
      '<td class="num calc">'+(req>0?req:"–")+'</td>'+
      '<td><input class="num" type="number" data-luxroom="'+i+'" value="'+(r.measured||"")+'" placeholder="lux"></td>'+
      '<td>'+badge+'</td></tr>';
  }).join("");
  t.innerHTML=head+'<tbody>'+body+'</tbody>';
}

function renderMegterules(){
  var c=calc();
  function pb(x){return x>0?(x.toFixed(2).replace(".",",")+" év"):"–";}
  document.getElementById("paybackGrid").innerHTML=
    pbCard("Éves áramdíj-megtakarítás",fmtFt(c.saveFt),"jelenlegi "+fmtFt(c.curFt)+" → LED "+fmtFt(c.ledFt))+
    pbCard("Beruházás (lámpák + kivitelezés)",fmtFt(c.invest),"auditor: "+fmtFt(c.audit))+
    pbCard("Megtérülés – kedvezmény nélkül",pb(c.pbPlain),"",true)+
    pbCard("Megtérülés – TAO támogatással",pb(c.pbTao),"TAO: "+fmtFt(c.tao))+
    pbCard("Megtérülés – EKR eladással",pb(c.pbEkr),"EKR: "+fmtFt(c.ekrFt)+" ("+c.ekrGj.toFixed(1).replace(".",",")+" GJ)");
  // 5 éves kumulált
  var rows="", cumCur=0, cumLed=c.invest+c.audit-c.tao; // LED oldal: induló beruházás (TAO után, mint a minta)
  var annualCur=c.curFt+num(state.maintAnnualCur);
  var annualLed=c.ledFt+num(state.maintAnnualLed);
  rows+='<tr><td>beruházás</td><td class="num">'+fmtFt(0)+'</td><td class="num">'+fmtFt(cumLed)+'</td><td class="num calc">'+fmtFt(0-cumLed)+'</td></tr>';
  for(var y=1;y<=5;y++){
    cumCur+=annualCur; cumLed+=annualLed;
    rows+='<tr><td>'+y+'. év</td><td class="num">'+fmtFt(cumCur)+'</td><td class="num">'+fmtFt(cumLed)+'</td><td class="num calc">'+fmtFt(cumCur-cumLed)+'</td></tr>';
  }
  document.getElementById("cumTable").innerHTML=
    '<thead><tr><th>Időszak</th><th class="num">Jelenlegi költség</th><th class="num">LED költség</th><th class="num">Megtakarítás</th></tr></thead><tbody>'+rows+'</tbody>';
}
function pbCard(h,v,s,accent){return '<div class="pb-card'+(accent?" accent":"")+'"><h3>'+h+'</h3><div class="v">'+v+'</div>'+(s?'<div class="s">'+s+'</div>':"")+'</div>';}

/* ── ÁRAJÁNLAT: a felmérésből típusonként összegezve ── */
function buildQuote(){
  var map={}; // ledType -> {type, qty, sku, brand}
  state.lamps.forEach(function(l){
    var q=num(l.qty); if(q<=0) return;
    var key=(l.ledType||"").trim() || (l.tech+" (típus megadása szükséges)");
    if(!map[key]) map[key]={type:key, qty:0, sku:(l.ledSku||"").trim(), brand:(l.ledBrand||"").trim()};
    map[key].qty+=q;
    if(!map[key].sku && l.ledSku) map[key].sku=(l.ledSku||"").trim();
    if(!map[key].brand && l.ledBrand) map[key].brand=(l.ledBrand||"").trim();
  });
  var items=Object.keys(map).map(function(k){
    var it=map[k];
    var p=state.quotePrices[it.type]||{};
    var unit=num(p.unit), install=num(p.install);
    it.unit=unit; it.install=install;
    it.netItems=it.qty*unit;          // termék nettó
    it.netInstall=it.qty*install;     // kivitelezés nettó
    it.net=it.netItems+it.netInstall; // sor nettó össz
    return it;
  });
  var netItems=items.reduce(function(a,b){return a+b.netItems;},0);
  var netInstall=items.reduce(function(a,b){return a+b.netInstall;},0);
  var net=netItems+netInstall;
  var vat=net*num(state.vatRate);
  var gross=net+vat;
  return {items:items, netItems:netItems, netInstall:netInstall, net:net, vat:vat, gross:gross};
}

function renderQuote(){
  var q=buildQuote();
  var t=document.getElementById("quoteTable"); if(!t) return;
  if(!q.items.length){
    t.innerHTML='<thead><tr><th>Tétel</th></tr></thead><tbody><tr><td>Még nincs felmért LED-tétel. Tölts ki lámpa-sorokat darabszámmal és „javasolt LED típus"-sal.</td></tr></tbody>';
    document.getElementById("quoteTotals").innerHTML=""; return;
  }
  var head='<thead><tr><th>Javasolt LED típus</th><th>Db</th><th>Nettó ár/db</th><th>Kivitelezés/db</th><th>Termék nettó</th><th>Kivitelezés nettó</th><th>Sor nettó</th></tr></thead>';
  var body=q.items.map(function(it){
    var p=state.quotePrices[it.type]||{};
    var sub=[it.brand,it.sku].filter(Boolean).join(" · ");
    var name=it.type+(sub?'<br><span style="color:#8aa0b6;font-size:11px">'+sub+'</span>':"");
    return '<tr>'+
      '<td>'+name+'</td>'+
      '<td class="num calc">'+fmtInt(it.qty)+'</td>'+
      '<td><input class="num" type="number" data-qprice="'+encodeURIComponent(it.type)+'" data-pf="unit" value="'+(p.unit!=null?p.unit:"")+'" placeholder="Ft"></td>'+
      '<td><input class="num" type="number" data-qprice="'+encodeURIComponent(it.type)+'" data-pf="install" value="'+(p.install!=null?p.install:"")+'" placeholder="Ft"></td>'+
      '<td class="num calc">'+fmtFt(it.netItems)+'</td>'+
      '<td class="num calc">'+fmtFt(it.netInstall)+'</td>'+
      '<td class="num calc">'+fmtFt(it.net)+'</td></tr>';
  }).join("");
  t.innerHTML=head+'<tbody>'+body+'</tbody>';
  document.getElementById("quoteTotals").innerHTML=
    pbCard("Termékek nettó",fmtFt(q.netItems),"")+
    pbCard("Kivitelezés nettó",fmtFt(q.netInstall),"")+
    pbCard("Nettó összesen",fmtFt(q.net),"")+
    pbCard("ÁFA ("+Math.round(num(state.vatRate)*100)+"%)",fmtFt(q.vat),"")+
    pbCard("Bruttó végösszeg",fmtFt(q.gross),"",true);
}

/* ── ESEMÉNYEK ── */
function showView(id){
  document.querySelectorAll(".nav-item").forEach(function(b){b.classList.toggle("active",b.dataset.view===id);});
  document.querySelectorAll(".view").forEach(function(v){v.classList.toggle("active",v.id===id);});
}

function wire(){
  // navigáció
  document.querySelectorAll(".nav-item").forEach(function(b){
    b.addEventListener("click",function(){showView(b.dataset.view);});
  });
  document.getElementById("addLampBtn").addEventListener("click",function(){addLamps(10); save(); renderLampTable(); renderLux();});
  var pq=document.getElementById("printQuoteBtn"); if(pq) pq.addEventListener("click",printQuote);
  var pe=document.getElementById("printExecBtn"); if(pe) pe.addEventListener("click",printExec);

  var ws=document.querySelector(".workspace");
  // input (gépelés): csak adat + könnyű frissítés, NEM teljes render (fókusz megmarad)
  ws.addEventListener("input",function(e){
    var t=e.target;
    if(t.dataset.k!==undefined){ state[t.dataset.k]=t.value; save(); scheduleLight(); }
    else if(t.dataset.id!==undefined){ var l=state.lamps.find(function(x){return x.id===t.dataset.id;}); if(l){l[t.dataset.f]=t.value; save(); scheduleLight();} }
    else if(t.dataset.luxref!==undefined){ state.luxRef[t.dataset.luxref]=t.value; save(); }
    else if(t.dataset.luxroom!==undefined){ var idx=+t.dataset.luxroom; if(state.luxRooms[idx]){state.luxRooms[idx].measured=t.value; save();} }
    else if(t.dataset.qprice!==undefined){ var ty=decodeURIComponent(t.dataset.qprice); if(!state.quotePrices[ty])state.quotePrices[ty]={}; state.quotePrices[ty][t.dataset.pf]=t.value; save(); scheduleQuote(); }
  });
  // change (select / kilépés mezőből): teljes, de a számokat frissítő render
  ws.addEventListener("change",function(e){
    var t=e.target;
    if(t.dataset.id!==undefined){ var l=state.lamps.find(function(x){return x.id===t.dataset.id;}); if(l){l[t.dataset.f]=t.value; save();} renderLampTable(); renderLux(); renderDashboard(); renderMegterules(); }
    else if(t.dataset.k!==undefined){ renderAll(); }
    else if(t.dataset.luxref!==undefined){ renderLux(); }
    else if(t.dataset.luxroom!==undefined){ renderLux(); }
    else if(t.dataset.qprice!==undefined){ renderQuote(); }
  });
  // törlés
  ws.addEventListener("click",function(e){
    var t=e.target;
    if(t.dataset.del){ state.lamps=state.lamps.filter(function(x){return x.id!==t.dataset.del;}); save(); renderLampTable(); renderLux(); renderDashboard(); renderMegterules(); }
  });
  // blur: a táblázat kalkulált oszlopai frissüljenek
  ws.addEventListener("blur",function(e){
    if(e.target.dataset && e.target.dataset.id!==undefined){ renderLampTable(); renderDashboard(); renderMegterules(); }
  },true);
}

// gépelés közbeni könnyű frissítés debounce-szal (dashboard/megtérülés szám), fókusz nem vész el
var _t=null;
function scheduleLight(){ if(_t)clearTimeout(_t); _t=setTimeout(function(){_t=null; renderTitle(); renderDashboard(); renderMegterules();},300); }
var _tq=null;
function scheduleQuote(){ if(_tq)clearTimeout(_tq); _tq=setTimeout(function(){_tq=null; renderQuoteTotalsOnly();},300); }
function renderQuoteTotalsOnly(){
  var q=buildQuote();
  var el=document.getElementById("quoteTotals"); if(!el) return;
  el.innerHTML=
    pbCard("Termékek nettó",fmtFt(q.netItems),"")+
    pbCard("Kivitelezés nettó",fmtFt(q.netInstall),"")+
    pbCard("Nettó összesen",fmtFt(q.net),"")+
    pbCard("ÁFA ("+Math.round(num(state.vatRate)*100)+"%)",fmtFt(q.vat),"")+
    pbCard("Bruttó végösszeg",fmtFt(q.gross),"",true);
}

/* ── NYOMTATHATÓ PDF NÉZETEK (böngésző: Nyomtatás → PDF) ── */
function printCss(){
  return '<style>'+
    '@page{size:A4;margin:16mm}'+
    '*{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}'+
    'body{margin:0;color:#16304a;font-size:12px}'+
    '.band{background:linear-gradient(90deg,#0a4fb0,#0b5fd4 55%,#1b8ff5);color:#fff;padding:14px 22px;display:flex;justify-content:space-between;align-items:center;font-size:12px}'+
    '.head{display:flex;align-items:center;gap:14px;padding:18px 22px;border-bottom:3px solid #ffd200}'+
    '.head img{width:54px;height:54px;object-fit:contain}'+
    '.head .nm{font-size:20px;font-weight:800}.head .nm b{color:#f2b705}'+
    '.head .tg{font-size:11px;color:#5f7388;text-transform:uppercase;letter-spacing:.12em}'+
    '.wrap{padding:10px 22px 30px}'+
    'h1{font-size:18px;margin:14px 0 4px}h2{font-size:14px;margin:20px 0 8px;color:#0b5fd4}'+
    '.meta{font-size:12px;color:#33485c;line-height:1.7;margin-bottom:8px}'+
    'table{border-collapse:collapse;width:100%;font-size:11.5px;margin-top:6px}'+
    'th{background:#102536;color:#fff;text-align:left;padding:7px 8px;font-size:10.5px;text-transform:uppercase}'+
    'td{border-bottom:1px solid #e3eaf2;padding:6px 8px}'+
    '.num{text-align:right;font-variant-numeric:tabular-nums}'+
    '.tot td{font-weight:800;background:#f4f8ff}'+
    '.grand td{font-weight:800;background:#102536;color:#ffd200;font-size:13px}'+
    '.cards{display:flex;gap:10px;margin:10px 0;flex-wrap:wrap}'+
    '.c{flex:1;min-width:150px;border:1px solid #e3eaf2;border-radius:10px;padding:12px}'+
    '.c h3{margin:0 0 4px;font-size:10.5px;color:#5f7388;text-transform:uppercase}'+
    '.c .v{font-size:20px;font-weight:800}'+
    '.foot{margin-top:24px;font-size:10.5px;color:#8aa0b6;border-top:1px solid #e3eaf2;padding-top:10px}'+
    /* vezetői riport vizuális elemek */
    '.execrow{display:flex;gap:18px;margin:14px 0 6px;align-items:stretch}'+
    '.gaugebox{flex:none;width:180px;border:1px solid #e3eaf2;border-radius:14px;padding:14px;text-align:center;background:#fff}'+
    '.gaugelabel{font-size:16px;font-weight:800;margin-top:2px}'+
    '.gaugesub{font-size:10.5px;color:#8aa0b6;text-transform:uppercase;letter-spacing:.1em}'+
    '.kpibox{flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center}'+
    '.kpi2{border:1px solid #e3eaf2;border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center}'+
    '.kpi2 span{font-size:12px;color:#5f7388}.kpi2 b{font-size:17px;font-weight:800;color:#16304a}'+
    '.subbars{margin-top:2px;display:flex;flex-direction:column;gap:7px}'+
    '.scorebar{font-size:11px}'+
    '.sbl{display:flex;justify-content:space-between;margin-bottom:3px}.sbl b{font-weight:800}'+
    '.sbtrack{height:9px;background:#eef2f7;border-radius:6px;overflow:hidden}'+
    '.sbfill{height:100%;border-radius:6px}'+
    '.chartrow{display:flex;gap:14px;margin:8px 0 4px}'+
    '.chartbox{flex:1;border:1px solid #e3eaf2;border-radius:14px;padding:12px;background:#fff}'+
    '.chartbox h3.ch{font-size:12.5px;color:#0b5fd4;margin:0 0 4px;font-weight:800}'+
    '.chartnote{font-size:11px;color:#2fcf6f;font-weight:700;text-align:center;margin-top:4px}'+
    '</style>';
}
function printHead(title){
  return '<div class="band"><span><b>SMART</b>Guard · Smart LightCare</span><span>Smart Electric Hungary Kft.</span></div>'+
    '<div class="head"><img src="./logo_icon.png" alt=""><div><div class="nm"><b>SMART</b>Guard · Smart LightCare</div>'+
    '<div class="tg">Smart Electric Hungary Kft.</div></div></div>';
}
function metaBlock(){
  return '<div class="meta"><b>Ügyfél:</b> '+(state.customer||"–")+'<br><b>Telephely:</b> '+(state.site||"–")+
    '<br><b>Dátum:</b> '+(state.date||"–")+'<br><b>Felmérést végezte:</b> '+(state.inspector||"–")+'</div>';
}
function openPrint(html){
  var w=window.open("","_blank");
  if(!w){alert("Engedélyezd a felugró ablakot a nyomtatáshoz.");return;}
  w.document.write('<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>SMARTGuard</title>'+printCss()+'</head><body>'+html+
    '<scr'+'ipt>window.onload=function(){setTimeout(function(){window.print();},350);}</scr'+'ipt></body></html>');
  w.document.close();
}

function printQuote(){
  var q=buildQuote();
  var rows=q.items.map(function(it){
    var sub=[it.brand,it.sku].filter(Boolean).join(" · ");
    var name=it.type+(sub?'<br><span style="color:#8aa0b6;font-size:10px">'+sub+'</span>':"");
    return '<tr><td>'+name+'</td><td class="num">'+fmtInt(it.qty)+'</td><td class="num">'+fmtFt(it.unit)+
      '</td><td class="num">'+fmtFt(it.install)+'</td><td class="num">'+fmtFt(it.net)+'</td></tr>';
  }).join("");
  var html=printHead()+'<div class="wrap"><h1>Árajánlat – világítás-korszerűsítés</h1>'+metaBlock()+
    '<table><thead><tr><th>Javasolt LED típus</th><th class="num">Db</th><th class="num">Nettó ár/db</th><th class="num">Kivitelezés/db</th><th class="num">Nettó össz.</th></tr></thead><tbody>'+rows+
    '<tr class="tot"><td>Nettó összesen</td><td></td><td></td><td></td><td class="num">'+fmtFt(q.net)+'</td></tr>'+
    '<tr class="tot"><td>ÁFA ('+Math.round(num(state.vatRate)*100)+'%)</td><td></td><td></td><td></td><td class="num">'+fmtFt(q.vat)+'</td></tr>'+
    '<tr class="grand"><td>Bruttó végösszeg</td><td></td><td></td><td></td><td class="num">'+fmtFt(q.gross)+'</td></tr>'+
    '</tbody></table>'+
    '<div class="foot">Az árajánlat tájékoztató jellegű, a felmérés adatain alapul. Érvényesség és fizetési feltételek külön megállapodás szerint.<br>Smart Electric Hungary Kft.</div></div>';
  openPrint(html);
}

function printExec(){
  var c=calc(), s=score(), q=buildQuote();
  function pb(x){return x>0?(x.toFixed(2).replace(".",",")+" év"):"–";}
  var total = s ? s.total : 0;
  // összpontszám szín a sáv szerint
  var scColor = total>=80 ? "#2fcf6f" : total>=70 ? "#9acd32" : total>=55 ? "#f2b705" : "#e5484d";
  var bandLabel = s ? s.band.label : "–";

  // SVG gauge (kör) az összpontszámhoz
  var R=54, C=2*Math.PI*R, off=C*(1-total/100);
  var gauge =
    '<svg width="150" height="150" viewBox="0 0 150 150">'+
      '<circle cx="75" cy="75" r="'+R+'" fill="none" stroke="#e9eef4" stroke-width="14"/>'+
      '<circle cx="75" cy="75" r="'+R+'" fill="none" stroke="'+scColor+'" stroke-width="14" stroke-linecap="round" '+
        'stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 75 75)"/>'+
      '<text x="75" y="70" text-anchor="middle" font-size="38" font-weight="800" fill="#16304a">'+total+'</text>'+
      '<text x="75" y="92" text-anchor="middle" font-size="13" fill="#8aa0b6">/ 100</text>'+
    '</svg>';

  // alpontszám-sávok
  function bar(label, val, col){
    return '<div class="scorebar"><div class="sbl"><span>'+label+'</span><b>'+val+'</b></div>'+
      '<div class="sbtrack"><div class="sbfill" style="width:'+val+'%;background:'+col+'"></div></div></div>';
  }
  var subBars = s ?
    bar("Energiahatékonyság", s.energy, "#1b8ff5")+
    bar("Komfort / lux", s.comfort, "#f2b705")+
    bar("Technológia", s.tech, "#2fcf6f") : "";

  // fogyasztás oszlopdiagram (jelenlegi vs LED)
  var maxKwh = Math.max(c.curKwh, c.ledKwh, 1);
  var hCur = Math.round(150*c.curKwh/maxKwh), hLed = Math.round(150*c.ledKwh/maxKwh);
  var barChart =
    '<svg width="100%" height="200" viewBox="0 0 280 200" preserveAspectRatio="xMidYMid meet">'+
      '<line x1="20" y1="170" x2="260" y2="170" stroke="#d9e2ec" stroke-width="1.5"/>'+
      '<rect x="60" y="'+(170-hCur)+'" width="60" height="'+hCur+'" rx="5" fill="#e5484d"/>'+
      '<text x="90" y="'+(170-hCur-7)+'" text-anchor="middle" font-size="12" font-weight="800" fill="#16304a">'+fmtInt(c.curKwh)+'</text>'+
      '<text x="90" y="187" text-anchor="middle" font-size="11" fill="#5f7388">Jelenlegi</text>'+
      '<rect x="160" y="'+(170-hLed)+'" width="60" height="'+hLed+'" rx="5" fill="#2fcf6f"/>'+
      '<text x="190" y="'+(170-hLed-7)+'" text-anchor="middle" font-size="12" font-weight="800" fill="#16304a">'+fmtInt(c.ledKwh)+'</text>'+
      '<text x="190" y="187" text-anchor="middle" font-size="11" fill="#5f7388">LED után</text>'+
      '<text x="140" y="14" text-anchor="middle" font-size="10.5" fill="#8aa0b6">éves fogyasztás (kWh)</text>'+
    '</svg>';

  // kumulált megtakarítás adatok + vonaldiagram
  var cum="", pts=[], cc=0, cl=c.invest+c.audit-c.tao;
  var ac=c.curFt+num(state.maintAnnualCur), al=c.ledFt+num(state.maintAnnualLed);
  cum+='<tr><td>beruházás</td><td class="num">'+fmtFt(0)+'</td><td class="num">'+fmtFt(cl)+'</td><td class="num">'+fmtFt(0-cl)+'</td></tr>';
  var saveSeries=[0-cl];
  for(var y=1;y<=5;y++){cc+=ac;cl+=al;cum+='<tr><td>'+y+'. év</td><td class="num">'+fmtFt(cc)+'</td><td class="num">'+fmtFt(cl)+'</td><td class="num">'+fmtFt(cc-cl)+'</td></tr>'; saveSeries.push(cc-cl);}
  // vonaldiagram a kumulált megtakarításról (0..5 év)
  var minS=Math.min.apply(null,saveSeries), maxS=Math.max.apply(null,saveSeries), rng=(maxS-minS)||1;
  var lpts = saveSeries.map(function(v,i){ var x=30+i*(420/5); var yy=170-150*(v-minS)/rng; return x.toFixed(0)+","+yy.toFixed(0); });
  var zeroY = 170-150*(0-minS)/rng;
  var lineChart =
    '<svg width="100%" height="200" viewBox="0 0 470 200" preserveAspectRatio="xMidYMid meet">'+
      '<line x1="30" y1="'+zeroY.toFixed(0)+'" x2="450" y2="'+zeroY.toFixed(0)+'" stroke="#d9e2ec" stroke-width="1" stroke-dasharray="4 3"/>'+
      '<polyline fill="none" stroke="#0b5fd4" stroke-width="3" stroke-linejoin="round" points="'+lpts.join(" ")+'"/>'+
      lpts.map(function(pt,i){var xy=pt.split(","); return '<circle cx="'+xy[0]+'" cy="'+xy[1]+'" r="4" fill="#0b5fd4"/><text x="'+xy[0]+'" y="190" text-anchor="middle" font-size="10" fill="#5f7388">'+(i===0?"start":i+". év")+'</text>';}).join("")+
      '<text x="240" y="14" text-anchor="middle" font-size="10.5" fill="#8aa0b6">kumulált megtakarítás (Ft)</text>'+
    '</svg>';

  var html=printHead()+'<div class="wrap"><h1>Vezetői összefoglaló – világítás-korszerűsítés</h1>'+metaBlock()+
    // FŐ MUTATÓ blokk: gauge + minősítés + 2 KPI
    '<div class="execrow">'+
      '<div class="gaugebox">'+gauge+'<div class="gaugelabel" style="color:'+scColor+'">'+bandLabel+'</div><div class="gaugesub">SMARTScore</div></div>'+
      '<div class="kpibox">'+
        '<div class="kpi2"><span>Éves megtakarítás</span><b style="color:#2fcf6f">'+fmtFt(c.saveFt)+'</b></div>'+
        '<div class="kpi2"><span>Megtérülés (kedvezmény nélkül)</span><b>'+pb(c.pbPlain)+'</b></div>'+
        '<div class="subbars">'+subBars+'</div>'+
      '</div>'+
    '</div>'+
    (state.note?'<p style="font-size:12px;margin-top:10px"><b>Vezetői fókusz:</b> '+state.note+'</p>':"")+
    // két diagram egymás mellett
    '<div class="chartrow">'+
      '<div class="chartbox"><h3 class="ch">Energetikai megtakarítás</h3>'+barChart+
        '<div class="chartnote">–'+Math.round(100*c.saveKwh/(c.curKwh||1))+'% éves fogyasztáscsökkenés ('+fmtInt(c.saveKwh)+' kWh/év)</div></div>'+
      '<div class="chartbox"><h3 class="ch">5 éves kumulált megtakarítás</h3>'+lineChart+'</div>'+
    '</div>'+
    '<h2>Megtérülés – részletek</h2>'+
    '<table><tbody>'+
    '<tr><td>Beruházás (lámpák + kivitelezés)</td><td class="num">'+fmtFt(c.invest)+'</td></tr>'+
    '<tr><td>Megtérülés – kedvezmény nélkül</td><td class="num">'+pb(c.pbPlain)+'</td></tr>'+
    '<tr><td>Megtérülés – TAO támogatással</td><td class="num">'+pb(c.pbTao)+'</td></tr>'+
    '<tr><td>Megtérülés – EKR eladással</td><td class="num">'+pb(c.pbEkr)+'</td></tr>'+
    '</tbody></table>'+
    '<h2>5 éves kumulált megtakarítás</h2>'+
    '<table><thead><tr><th>Időszak</th><th class="num">Jelenlegi</th><th class="num">LED</th><th class="num">Megtakarítás</th></tr></thead><tbody>'+cum+'</tbody></table>'+
    '<div class="foot">A számítás a helyszíni felmérés adatain és a megadott paramétereken alapul, tájékoztató jellegű.<br>Smart Electric Hungary Kft.</div></div>';
  openPrint(html);
}


function renderAll(){ render(); }

document.addEventListener("DOMContentLoaded",function(){
  if(!state.lamps.length) addLamps(10);
  render(); wire();
});
