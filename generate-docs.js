try { require('docx'); } catch(e) {
  const Module = require('module');
  const path = require('path');
  const os = require('os');
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
if (!stateJson) { process.stderr.write("Nincs state JSON!\n"); process.exit(1); }
const state = JSON.parse(stateJson);

const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" };
const thinBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function cell(text, opts) {
  opts = opts || {};
  return new TableCell({
    borders: opts.borders || thinBorders,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({ text: String(text || ""), bold: opts.bold || false, size: opts.size || 16, font: "Arial", color: opts.color || "000000" })]
    })]
  });
}

function headerCell(text, width) {
  return cell(text, { bold: true, shading: "1F497D", color: "FFFFFF", borders: thinBorders, width, size: 16 });
}

function titleRow(text, colCount) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "1F497D" };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new TableRow({ children: [new TableCell({
    columnSpan: colCount, borders,
    shading: { fill: "1F497D", type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, size: 20, font: "Arial", color: "FFFFFF" })] })]
  })] });
}

function infoRow(label, value, colCount) {
  const half = Math.floor(colCount / 2);
  return new TableRow({ children: [
    new TableCell({ columnSpan: half, borders: thinBorders, shading: { fill: "DCE6F1", type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 16, font: "Arial" })] })] }),
    new TableCell({ columnSpan: colCount - half, borders: thinBorders, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: String(value || ""), size: 16, font: "Arial" })] })] })
  ]});
}

function makeAvkDoc() {
  const filled = state.avkRows.filter(r => r.place || r.mark || r.inA || r.iDeltaMa || r.timeMs || r.status || r.fault);
  const cols = [600, 1200, 800, 1400, 700, 800, 700, 700, 900, 1000, 600, 600, 1000];
  const total = cols.reduce((a, b) => a + b, 0);
  const nmf = filled.filter(r => r.status === "NMF");
  return new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children: [
    new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: cols, rows: [
      titleRow("VILLAMOS BERENDEZÉS IDŐSZAKOS ELLENŐRZÉSE – MSZ HD 60364-6:2017", 13),
      titleRow("JEGYZŐKÖNYV – ÁRAM-VÉDŐKAPCSOLÓK MŰKÖDÉSÉNEK ELLENŐRZÉSE", 13),
      infoRow("Sorszám:", (state.protocolNumbers && state.protocolNumbers.avk) || "", 13),
      infoRow("Ügyfél:", state.customerName || "", 13),
      infoRow("Telephely:", state.siteAddress || "", 13),
      infoRow("Vizsgálat dátuma:", state.inspectionDate || "", 13),
      infoRow("Mérést végezte:", "Nyikos Dániel – Villamos Biztonsági felülvizsgáló", 13),
      infoRow("Műszer:", "Metrel Eurotest XD MI3102 BT  |  Gyári sz.: 21050848  |  Kalibrálás: 2021.05.04.", 13),
      new TableRow({ tableHeader: true, children: [
        headerCell("Ssz.", cols[0]), headerCell("Helye", cols[1]), headerCell("Jele", cols[2]),
        headerCell("Típus", cols[3]), headerCell("In [A]", cols[4]), headerCell("IΔn [mA]", cols[5]),
        headerCell("Un [V]", cols[6]), headerCell("Pólus", cols[7]), headerCell("IΔn mért [mA]", cols[8]),
        headerCell("t [ms]", cols[9]), headerCell("MP", cols[10]), headerCell("SZV", cols[11]),
        headerCell("Minősítés", cols[12]),
      ]}),
      ...filled.map((r, i) => new TableRow({ children: [
        cell(r.no || i+1, { width: cols[0], align: AlignmentType.CENTER }),
        cell(r.place, { width: cols[1] }),
        cell(r.mark, { width: cols[2] }),
        cell(r.type, { width: cols[3] }),
        cell(r.inA, { width: cols[4], align: AlignmentType.CENTER }),
        cell(r.deltaMa, { width: cols[5], align: AlignmentType.CENTER }),
        cell(r.unV, { width: cols[6], align: AlignmentType.CENTER }),
        cell(r.poles, { width: cols[7], align: AlignmentType.CENTER }),
        cell(r.iDeltaMa, { width: cols[8], align: AlignmentType.CENTER }),
        cell(r.timeMs, { width: cols[9], align: AlignmentType.CENTER }),
        cell(r.mp, { width: cols[10], align: AlignmentType.CENTER }),
        cell(r.szv, { width: cols[11], align: AlignmentType.CENTER }),
        cell(r.status, { width: cols[12], align: AlignmentType.CENTER, shading: r.status === "NMF" ? "FFE0E0" : r.status === "MF" ? "E0FFE8" : r.status === "NA" ? "FFF8DC" : undefined }),
      ]})),
      ...(nmf.length > 0 ? [new TableRow({ children: [new TableCell({ columnSpan: 13, borders: thinBorders, shading: { fill: "FFE0E0", type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: "NEM MEGFELELT: " + nmf.map(r => r.place + " " + r.mark + (r.fault ? " – " + r.fault : "")).join(" | "), bold: true, size: 16, font: "Arial", color: "CC0000" })] })] })] })] : []),
      ...(() => { const na = filled.filter(r => r.status === "NA"); return na.length > 0 ? [new TableRow({ children: [new TableCell({ columnSpan: 13, borders: thinBorders, shading: { fill: "FFF8DC", type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: "NINCS ADAT (NA): " + na.map(r => r.place + " " + r.mark).join(" | "), bold: true, size: 16, font: "Arial", color: "886600" })] })] })] })] : []; })(),
      infoRow("Kelt:", state.inspectionDate || "", 13),
      infoRow("Felelős felülvizsgáló:", "Nyikos Dániel", 13),
    ]})
  ]}]});
}

const BREAKER_LIMITS = {
  "B6":7.67,"B10":4.60,"B13":3.54,"B16":2.88,"B20":2.30,"B25":1.84,"B32":1.44,
  "C6":3.83,"C10":2.30,"C13":1.77,"C16":1.44,"C20":1.15,"C25":0.92,"C32":0.72,
};

function makeHurokDoc() {
  const roomName = (id) => { const r = (state.rooms || []).find(r => r.id === id); return r ? r.name : id || ""; };
  const filled = state.hurokRows.filter(r => r.point || r.distributor || r.breaker || r.valueOhm || r.status || r.fault);
  // 11 oszlop: Ssz, Típus, Helyiség, Mérési pont, Mód, Elosztó, In kar., PE, Érték[Ω], Max Zs[Ω], Minősítés
  const cols = [520, 700, 1300, 2600, 660, 1100, 800, 680, 820, 800, 920];
  const total = cols.reduce((a, b) => a + b, 0);
  const nmf = filled.filter(r => r.status === "NMF");
  const na  = filled.filter(r => r.status === "NA");
  const faults = filled.filter(r => r.severity && r.fault);

  function statusShading(status) {
    if (status === "NMF") return "FFE0E0";
    if (status === "MF")  return "E0FFE8";
    if (status === "NA")  return "FFF8DC";
    return undefined;
  }

  return new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children: [
    new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: cols, rows: [
      titleRow("VILLAMOS BIZTONSÁGI FELÜLVIZSGÁLAT – MSZ HD 60364-6:2017", 11),
      titleRow("JEGYZŐKÖNYV – TÁPLÁLÁS ÖNMŰKÖDŐ LEKAPCSOLÁSA (Hurok + EPH)", 11),
      infoRow("Sorszám:", (state.protocolNumbers && state.protocolNumbers.hurok) || "", 11),
      infoRow("Ügyfél:", state.customerName || "", 11),
      infoRow("Telephely:", state.siteAddress || "", 11),
      infoRow("Vizsgálat dátuma:", state.inspectionDate || "", 11),
      infoRow("Mérést végezte:", "Nyikos Dániel – Villamos Biztonsági felülvizsgáló  |  Bizonyítvány: SZVSZ/2025/24/010", 11),
      infoRow("Műszer:", "Metrel Eurotest XD MI3102 BT  |  Gyári sz.: 21050848  |  Kalibrálás: 2021.05.04.", 11),
      new TableRow({ tableHeader: true, children: [
        headerCell("Ssz.", cols[0]),
        headerCell("Típus", cols[1]),
        headerCell("Helyiség", cols[2]),
        headerCell("Mérési pont / megnevezés / egyéb adat", cols[3]),
        headerCell("Mód/Oszt.", cols[4]),
        headerCell("Elosztó / Helye", cols[5]),
        headerCell("In kar.", cols[6]),
        headerCell("PE folyt.", cols[7]),
        headerCell("Érték [Ω]", cols[8]),
        headerCell("Max Zs [Ω]", cols[9]),
        headerCell("Minősítés", cols[10]),
      ]}),
      ...filled.map((r, i) => {
        const limit = BREAKER_LIMITS[(r.breaker||"").trim().toUpperCase()];
        const limitStr = limit !== undefined ? limit.toFixed(2) : "–";
        const shading = statusShading(r.status);
        return new TableRow({ children: [
          cell(r.no || i+1, { width: cols[0], align: AlignmentType.CENTER }),
          cell((r.type||"hurok").toUpperCase(), { width: cols[1], align: AlignmentType.CENTER, bold: true, color: r.type==="eph"?"1f7a3a":"1F497D" }),
          cell(roomName(r.roomId), { width: cols[2] }),
          cell(r.point, { width: cols[3] }),
          cell(r.modeClass, { width: cols[4], align: AlignmentType.CENTER }),
          cell(r.distributor, { width: cols[5], align: AlignmentType.CENTER }),
          cell(r.breaker, { width: cols[6], align: AlignmentType.CENTER }),
          cell(r.pe, { width: cols[7], align: AlignmentType.CENTER }),
          cell(r.valueOhm, { width: cols[8], align: AlignmentType.CENTER }),
          cell(limitStr, { width: cols[9], align: AlignmentType.CENTER, color: "666666" }),
          cell(r.status, { width: cols[10], align: AlignmentType.CENTER, shading }),
        ]});
      }),
      ...(nmf.length > 0 ? [new TableRow({ children: [new TableCell({ columnSpan: 11, borders: thinBorders, shading: { fill: "FFE0E0", type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: "NEM MEGFELELT: " + nmf.map(r => roomName(r.roomId) + " – " + r.point).join(" | "), bold: true, size: 16, font: "Arial", color: "CC0000" })] })] })] })] : []),
      ...(na.length > 0 ? [new TableRow({ children: [new TableCell({ columnSpan: 11, borders: thinBorders, shading: { fill: "FFF8DC", type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: "NINCS ADAT (NA): " + na.map(r => roomName(r.roomId) + " – " + r.point).join(" | "), bold: true, size: 16, font: "Arial", color: "886600" })] })] })] })] : []),
      ...(faults.length > 0 ? [new TableRow({ children: [new TableCell({ columnSpan: 11, borders: thinBorders, shading: { fill: "FFF3CD", type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: "HIBÁK: " + faults.map(r => "[" + r.severity + "] " + roomName(r.roomId) + " – " + r.point + ": " + r.fault).join(" | "), bold: true, size: 16, font: "Arial", color: "8A5A00" })] })] })] })] : []),
      infoRow("Kelt:", state.inspectionDate || "", 11),
      infoRow("Felelős felülvizsgáló:", "Nyikos Dániel", 11),
    ]})
  ]}]});
}

async function main() {
  const outDir = process.argv[3] || ".";
  const [avkBuf, hurokBuf] = await Promise.all([Packer.toBuffer(makeAvkDoc()), Packer.toBuffer(makeHurokDoc())]);
  const avkFile = outDir + "/AVK_JK_" + ((state.protocolNumbers && state.protocolNumbers.avk) || "export") + ".docx";
  const hurokFile = outDir + "/HUROK_JK_" + ((state.protocolNumbers && state.protocolNumbers.hurok) || "export") + ".docx";
  fs.writeFileSync(avkFile, avkBuf);
  fs.writeFileSync(hurokFile, hurokBuf);
  process.stdout.write(avkFile + "\n" + hurokFile + "\n");
}

main().catch(e => { process.stderr.write(String(e) + "\n"); process.exit(1); });
