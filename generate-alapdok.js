try { require('docx'); } catch(e) {
  const Module = require('module'), path = require('path'), os = require('os');
  [path.join(os.homedir(),'AppData','Roaming','npm','node_modules'),
   path.join(os.homedir(),'.npm-global','lib','node_modules'),
   '/usr/lib/node_modules','/usr/local/lib/node_modules'].forEach(p => {
    if (!Module.globalPaths.includes(p)) Module.globalPaths.push(p);
  });
}
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
        PageOrientation } = require('docx');
const fs = require('fs');

const stateJson = process.argv[2];
if (!stateJson) { process.stderr.write("Nincs state JSON!"); process.exit(1); }
const state = JSON.parse(stateJson);
const ad = state.alapdok || {};
const cb = ad.cb || {};

// ─── STÍLUSOK ────────────────────────────────────────────────────────────────
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" };
const thinBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const boldBorder = { style: BorderStyle.SINGLE, size: 4, color: "1F497D" };
const boldBorders = { top: boldBorder, bottom: boldBorder, left: boldBorder, right: boldBorder };

function txt(text, opts) {
  opts = opts || {};
  return new TextRun({ text: String(text||""), bold: opts.bold||false, size: opts.size||18,
    font: "Arial", color: opts.color||"000000", underline: opts.underline?{}:undefined,
    italics: opts.italics||false });
}
function para(texts, opts) {
  opts = opts || {};
  const runs = Array.isArray(texts) ? texts : [txt(texts, opts)];
  return new Paragraph({ alignment: opts.align||AlignmentType.LEFT,
    spacing: { before: opts.before||60, after: opts.after||60 }, children: Array.isArray(texts)?texts:[txt(texts,opts)] });
}

function titlePara(text) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 100 },
    children: [txt(text, { bold:true, size:24, color:"1F497D" })] });
}

function sectionTitle(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F497D", space: 3 } },
    children: [txt(text, { bold:true, size:20, color:"1F497D" })]
  });
}

function fieldRow(label, value, totalW) {
  const lw = 3200, vw = totalW - lw;
  return new TableRow({ children: [
    new TableCell({ borders: thinBorders, width: {size:lw, type:WidthType.DXA},
      shading: { fill:"EAF0F8", type:ShadingType.CLEAR },
      margins: {top:60,bottom:60,left:120,right:120},
      children: [para(label, {before:0,after:0})] }),
    new TableCell({ borders: thinBorders, width: {size:vw, type:WidthType.DXA},
      margins: {top:60,bottom:60,left:120,right:120},
      children: [new Paragraph({ children: [txt(value||"–", {bold:true})] })] }),
  ]});
}

function infoTable(rows, totalW) {
  return new Table({ width:{size:totalW, type:WidthType.DXA}, columnWidths:[3200, totalW-3200], rows });
}

// Jelölőnégyzet sor (☑ / ☐)
function cbRow(checked, label) {
  const mark = checked ? "☑" : "☐";
  const color = checked ? "1F497D" : "666666";
  return new Paragraph({ spacing:{before:40,after:40}, children: [
    txt(mark + " ", {bold:checked, color, size:18}),
    txt(label, {bold:checked, color: checked?"000000":"888888", size:17,
      underline: checked })
  ]});
}

function cbSection(title, items) {
  return [
    new Paragraph({ spacing:{before:120,after:60}, children: [txt(title, {bold:true, size:18})] }),
    ...items.map(([key, label]) => cbRow(!!cb[key], label))
  ];
}

// Vizsgálati táblázat sor
function vizsgalatRow(label, ertek, megjegyzes, colWidths, isHeader) {
  const bg = isHeader ? "1F497D" : (ertek==="NMF"?"FFE8E8":ertek==="NA"?"FFF8E0":"FFFFFF");
  const textColor = isHeader ? "FFFFFF" : (ertek==="NMF"?"CC0000":ertek==="NA"?"886600":"000000");
  return new TableRow({ children: [
    new TableCell({ borders:thinBorders, width:{size:colWidths[0],type:WidthType.DXA},
      shading:{fill:isHeader?"1F497D":bg, type:ShadingType.CLEAR},
      margins:{top:60,bottom:60,left:100,right:100},
      children:[new Paragraph({children:[txt(label,{bold:isHeader,color:isHeader?"FFFFFF":textColor,size:15})]})] }),
    new TableCell({ borders:thinBorders, width:{size:colWidths[1],type:WidthType.DXA},
      shading:{fill:isHeader?"1F497D":bg, type:ShadingType.CLEAR},
      margins:{top:60,bottom:60,left:80,right:80},
      verticalAlign: VerticalAlign.CENTER,
      children:[new Paragraph({alignment:AlignmentType.CENTER, children:[txt(ertek,{bold:true,color:isHeader?"FFFFFF":textColor,size:15})]})] }),
    new TableCell({ borders:thinBorders, width:{size:colWidths[2],type:WidthType.DXA},
      shading:{fill:isHeader?"1F497D":"FAFAFA", type:ShadingType.CLEAR},
      margins:{top:60,bottom:60,left:80,right:80},
      children:[new Paragraph({children:[txt(megjegyzes||"–",{size:14,color:isHeader?"FFFFFF":"666666"})]})] }),
  ]});
}

// ─── DOKUMENTUM ──────────────────────────────────────────────────────────────
function makeAlapdokDoc() {
  const totalW = 9000;
  const colW = [6600, 1200, 1200];

  const children = [
    // FEJLÉC
    new Paragraph({ alignment:AlignmentType.CENTER, spacing:{after:20}, children:[
      txt("Smart Electric Hungary Kft.", {bold:true, size:22, color:"1F497D"})
    ]}),
    new Paragraph({ alignment:AlignmentType.CENTER, spacing:{after:160},
      border:{bottom:{style:BorderStyle.SINGLE,size:8,color:"1F497D",space:4}},
      children:[txt("www.smartelectrichungary.com  |  +36 30 365 1161", {size:16,color:"888888"})]
    }),

    titlePara("VILLAMOS BERENDEZÉS IDŐSZAKOS ELLENŐRZÉSE"),
    titlePara("MSZ HD 60364-6:2017 – ALAPDOKUMENTÁCIÓ"),
    new Paragraph({spacing:{after:120},children:[]}),

    // ÁLTALÁNOS ADATOK
    sectionTitle("Általános adatok"),
    infoTable([
      fieldRow("A felülvizsgálat helye:", ad.hely, totalW),
      fieldRow("Megrendelő cég adatai:", ad.megrendelo, totalW),
      fieldRow("Üzemi kísérő / kapcsolattartó:", ad.kisero, totalW),
      fieldRow("A felülvizsgálat időtartama:", ad.idotartam, totalW),
      fieldRow("Felelős felülvizsgáló:", ad.felelos, totalW),
      fieldRow("Végzettség:", ad.vegzettseg, totalW),
      fieldRow("VBF Vizsgabizonyítványának száma:", ad.vbf_szam, totalW),
      fieldRow("Tűzvédelmi Szakvizsga sz.:", ad.tuz_szam, totalW),
    ], totalW),

    new Paragraph({spacing:{after:100},children:[]}),

    // KÖVETKEZŐ VIZSGÁLAT
    sectionTitle("Következő vizsgálat legkésőbbi időpontja és módja"),
    new Table({ width:{size:totalW,type:WidthType.DXA}, columnWidths:[totalW/4,totalW/4,totalW/4,totalW/4],
      rows:[
        new TableRow({ children: ["1.","2.","3.","4."].map(n => new TableCell({
          borders:thinBorders, shading:{fill:"EAF0F8",type:ShadingType.CLEAR},
          margins:{top:60,bottom:60,left:120,right:120},
          children:[para(n+" "+ad["kov"+(n.replace(".",""))], {before:0,after:0})]
        }))}),
      ]
    }),

    new Paragraph({spacing:{after:100},children:[]}),

    // MINŐSÍTÉSI ALAPADATOK
    sectionTitle("Minősítési alapadatok"),
    infoTable([
      fieldRow("A villamos berendezés névleges feszültsége:", ad.feszultseg, totalW),
      fieldRow("A villamos hálózat rendszere:", ad.halozat, totalW),
      fieldRow("A villamos hálózat földelési típusa:", ad.foldelestype, totalW),
      fieldRow("Alapvető érintésvédelmi mód:", ad.erintesvedelmi, totalW),
      fieldRow("Betáplálás módja:", ad.betaplalasmod, totalW),
      fieldRow("Tartalék energia:", ad.tartalek, totalW),
      fieldRow("Létesítés / legutóbbi felújítás éve:", ad.ev, totalW),
    ], totalW),

    new Paragraph({spacing:{after:100},children:[]}),

    // VÉDELMI MÓDOK CHECKBOXOK
    sectionTitle("A felülvizsgált rendszerek, védelmi módok és érintésvédelmi osztályok"),

    ...cbSection("Védelmi mód: a táplálás önműködő lekapcsolása", [
      ["tn_c","TN-C rendszer"], ["tn_s","TN-S rendszer"], ["tn_cs","TN-C-S rendszer (TN)"],
      ["tt","TT rendszer (TT)"], ["it","IT rendszer (IT)"],
    ]),
    ...cbSection("Védelmi mód:", [
      ["kmsz","Kettős vagy megerősített szigetelés (KMSZ)"],
      ["velv","Villamos elválasztás (VELV)"],
      ["selv","SELV- és PELV-törpefeszültség (SELV, PELV)"],
    ]),
    ...cbSection("Kiegészítő védelmek:", [
      ["rcd","Áram-védőkapcsolók (RCD)"],
      ["keph","Kiegészítő egyenpotenciálú összekötés (KEPH)"],
    ]),
    ...cbSection("Szakképzett személyek berendezéseinek védelmi módjai:", [
      ["ke","Környezet elszigetelése (KE)"],
      ["heph","Védelem földeletlen helyi egyenpotenciálú összekötéssel (HEPH)"],
      ["velvt","Villamos elválasztás egynél több fogyasztókészülékkel (VELVT)"],
    ]),
    cbRow(cb.eph, "Egyenpotenciálra hozó hálózat (EPH)"),
    ...cbSection("Alapvédelem:", [
      ["asz","Aktív részek alapszigetelése (ASZ)"],
      ["vf","Védőfedések (VF)"],
      ["vb","Védőburkolatok (VB)"],
    ]),
    ...cbSection("Alapvédelem szakképzett személyek berendezéseiben:", [
      ["va","Védőakadályok (VA)"],
      ["eh","Elérhető tartományon kívüli elhelyezés (EH)"],
    ]),
    ...cbSection("Érintésvédelmi osztályok:", [
      ["ev0","0-s érintésvédelmi osztály (0)"],
      ["ev1","I-es érintésvédelmi osztály – PE-t igénylő szerkezetek (I)"],
      ["ev2","II-es érintésvédelmi osztály – kettős vagy megerősített szigetelés (II)"],
      ["ev3","III-as érintésvédelmi osztály – törpefeszültségű szerkezetek (III)"],
    ]),

    new Paragraph({spacing:{after:100},children:[]}),

    // VIZSGÁLATI EREDMÉNYEK TÁBLÁZAT
    sectionTitle("Vizsgálati eredmények összefoglalása"),
    new Table({
      width:{size:totalW,type:WidthType.DXA},
      columnWidths: colW,
      rows: [
        vizsgalatRow("Tétel megnevezése","Minősítés","Megjegyzés", colW, true),
        ...(ad.vizsgalat||[]).map(row => vizsgalatRow(row[0], row[1], row[2], colW, false))
      ]
    }),

    new Paragraph({spacing:{after:160},children:[]}),

    // LÁBLÉC
    new Paragraph({
      alignment:AlignmentType.CENTER, spacing:{before:200},
      border:{top:{style:BorderStyle.SINGLE,size:4,color:"CCCCCC",space:4}},
      children:[txt("Smart Electric Hungary Kft.  |  www.smartelectrichungary.com  |  +36 30 365 1161", {size:14,color:"AAAAAA"})]
    }),
  ];

  return new Document({
    sections:[{
      properties:{ page:{ size:{width:11906,height:16838}, margin:{top:900,right:900,bottom:900,left:900} } },
      children
    }]
  });
}

async function main() {
  const outDir = process.argv[3] || ".";
  const doc = makeAlapdokDoc();
  const buf = await Packer.toBuffer(doc);
  const pn = state.protocolNumbers && state.protocolNumbers.hurok || "export";
  const filename = `${outDir}/Alapdokumentacio_${pn}.docx`;
  fs.writeFileSync(filename, buf);
  process.stdout.write(filename + "\n");
}

main().catch(e => { process.stderr.write(String(e) + "\n"); process.exit(1); });
