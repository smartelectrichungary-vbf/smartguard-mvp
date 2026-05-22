// Windows npm global path beállítás
const path = require("path");
const os = require("os");
const Module = require("module");
const winGlobal = path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules");
const unixGlobal = "/usr/lib/node_modules";
const npmGlobal2 = path.join(os.homedir(), ".npm-global", "lib", "node_modules");
[winGlobal, unixGlobal, npmGlobal2].forEach(p => {
  if (!Module.globalPaths.includes(p)) Module.globalPaths.push(p);
});

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
        PageOrientation, HeadingLevel, UnderlineType } = require('docx');
const fs = require('fs');

const stateJson = process.argv[2];
if (!stateJson) { process.stderr.write("Nincs state JSON!"); process.exit(1); }
const state = JSON.parse(stateJson);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const thinB = { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" };
const thinBorders = { top: thinB, bottom: thinB, left: thinB, right: thinB };

// Szín a százalékhoz
function scoreColor(pct) {
  if (pct >= 90) return "1A7A3C"; // zöld
  if (pct >= 75) return "4CAF50"; // világoszöld
  if (pct >= 60) return "F2A500"; // sárga
  if (pct >= 40) return "E67700"; // narancs
  return "C0392B";               // piros
}

function scoreLabel(pct) {
  if (pct >= 90) return "Kiváló";
  if (pct >= 75) return "Jó";
  if (pct >= 60) return "Megfelelő, de javítandó";
  if (pct >= 40) return "Gyenge";
  return "Nem megfelelő";
}

function actionLevelLabel(state) {
  const faults = allFaults(state);
  if (faults.some(f => f.severity === "A")) return "Azonnali";
  const score = totalScore(state);
  if (faults.some(f => f.severity === "B") || score < 70) return "Sürgős";
  if (score < 80) return "Ütemezett";
  return "Tervezett";
}

function actionLevelDesc(level) {
  return {
    "Azonnali": "Életvédelmi vagy közvetlen érintésveszélyt jelentő hibák elhárítása szükséges azonnal.",
    "Sürgős": "A feltárt hibák között súlyos, üzembiztonsági kockázatot jelentő eltérések találhatók. Rövid határidőn belüli javítás szükséges.",
    "Ütemezett": "Közepes és kisebb hiányosságok, dokumentációs és jelölési rendezések szükségesek.",
    "Tervezett": "A rendszer megfelelő állapotban van. Tervezett karbantartás és fejlesztés javasolt."
  }[level] || "";
}

function allFaults(state) {
  const penalties = (state.scoring && state.scoring.penalties) || { A: 25, B: 5, C: 3, D: 1 };
  const hurok = (state.hurokRows || []).filter(r => r.severity);
  const avk = (state.avkRows || []).filter(r => r.severity);
  const eloszto = [];
  (state.elosztoRows || []).forEach(d => (d.faults || []).filter(f => f.severity).forEach(f => eloszto.push(f)));
  return [...hurok.map(r => ({severity: r.severity, text: `${roomName(state, r.roomId)} – ${r.point}: ${r.fault}`})),
          ...avk.map(r => ({severity: r.severity, text: `${r.place} – ${r.mark}: ${r.fault}`})),
          ...eloszto.map(f => ({severity: f.severity, text: f.text}))];
}

function roomName(state, id) {
  const r = (state.rooms || []).find(r => r.id === id);
  return r ? r.name : id || "";
}

function categoryScore(state, catId) {
  const penalties = (state.scoring && state.scoring.penalties) || { A: 25, B: 5, C: 3, D: 1 };
  let faults = [];
  if (catId === "hurok") faults = (state.hurokRows || []).filter(r => r.severity && (r.point || r.fault));
  if (catId === "avk") faults = (state.avkRows || []).filter(r => r.severity && (r.place || r.fault));
  if (catId === "eloszto") {
    (state.elosztoRows || []).forEach(d => (d.faults || []).filter(f => f.severity).forEach(f => faults.push(f)));
  }
  if (catId === "dok") {
    (state.elosztoRows || []).filter(r => r.documentation === "NMF").forEach(() => faults.push({severity: "D"}));
  }
  const hasData = catId === "hurok" ? (state.hurokRows||[]).some(r => r.point||r.fault)
    : catId === "avk" ? (state.avkRows||[]).some(r => r.place||r.fault)
    : catId === "eloszto" ? (state.elosztoRows||[]).length > 0
    : catId === "dok" ? (state.elosztoRows||[]).some(r => r.documentation)
    : false;
  if (!hasData && !faults.length) return 100;
  const penalty = faults.reduce((s, r) => s + (Number(penalties[r.severity]) || 0), 0);
  return Math.max(0, Math.round(100 - penalty));
}

function totalScore(state) {
  const cats = (state.scoring && state.scoring.categories) || [
    { id: "hurok", weight: 50 }, { id: "avk", weight: 20 },
    { id: "eloszto", weight: 25 }, { id: "dok", weight: 5 }
  ];
  const totalW = cats.reduce((s, c) => s + Number(c.weight || 0), 0) || 1;
  return Math.round(cats.reduce((s, c) => s + categoryScore(state, c.id) * (Number(c.weight || 0) / totalW), 0));
}

// ─── DESIGN ELEMEEK ──────────────────────────────────────────────────────────

// Üres sor
function spacer(pts) {
  return new Paragraph({ spacing: { before: 0, after: pts * 20 }, children: [] });
}

// Fejléc kék csíkkal
function sectionHeader(text) {
  return new Paragraph({
    spacing: { before: 320, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1F497D", space: 4 } },
    children: [new TextRun({ text, bold: true, size: 28, font: "Arial", color: "1F497D" })]
  });
}

// Százalékos progress bar táblázatként
function progressBar(label, pct, weight) {
  const color = scoreColor(pct);
  const filled = Math.round(pct * 80 / 100); // max 8000 DXA = ~5.5 inch
  const empty = 8000 - filled * 100;
  const filledW = filled * 100;

  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [3200, 4800, 1000],
    margins: { top: 40, bottom: 40 },
    rows: [
      new TableRow({ children: [
        // Label
        new TableCell({
          borders: noBorders,
          width: { size: 3200, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 0, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: "Arial", color: "1F497D" })] })]
        }),
        // Progress bar
        new TableCell({
          borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
          width: { size: 4800, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 0, right: 0 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Table({
              width: { size: 4800, type: WidthType.DXA },
              columnWidths: filledW > 0 ? (filledW < 4800 ? [filledW, 4800 - filledW] : [4800]) : [4800],
              rows: [new TableRow({ children: [
                ...(filledW > 0 ? [new TableCell({
                  borders: noBorders,
                  width: { size: Math.min(filledW, 4800), type: WidthType.DXA },
                  shading: { fill: color, type: ShadingType.CLEAR },
                  children: [new Paragraph({ children: [new TextRun({ text: " ", size: 16 })] })]
                })] : []),
                ...(filledW < 4800 ? [new TableCell({
                  borders: noBorders,
                  width: { size: 4800 - Math.min(filledW, 4800), type: WidthType.DXA },
                  shading: { fill: "EEEEEE", type: ShadingType.CLEAR },
                  children: [new Paragraph({ children: [new TextRun({ text: " ", size: 16 })] })]
                })] : [])
              ]})]
            })
          ]
        }),
        // Percentage
        new TableCell({
          borders: noBorders,
          width: { size: 1000, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 120, right: 0 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: pct + "%", bold: true, size: 20, font: "Arial", color })]
          })]
        }),
      ]})
    ]
  });
}

// Nagy score kártya
function scoreBanner(score, label) {
  const color = scoreColor(score);
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [4500, 4500],
    rows: [new TableRow({ children: [
      new TableCell({
        borders: noBorders,
        shading: { fill: "1F497D", type: ShadingType.CLEAR },
        width: { size: 4500, type: WidthType.DXA },
        margins: { top: 200, bottom: 200, left: 300, right: 300 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "SMARTScore", bold: true, size: 24, font: "Arial", color: "B8D0E8" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: score + "/100", bold: true, size: 72, font: "Arial", color: "FFFFFF" })] }),
        ]
      }),
      new TableCell({
        borders: noBorders,
        shading: { fill: color, type: ShadingType.CLEAR },
        width: { size: 4500, type: WidthType.DXA },
        margins: { top: 200, bottom: 200, left: 300, right: 300 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Minősítés", bold: true, size: 24, font: "Arial", color: "FFFFFF" })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, bold: true, size: 36, font: "Arial", color: "FFFFFF" })] }),
        ]
      }),
    ]})]
  });
}

// Hiba sor a prioritás listában
function faultRow(text, severity, idx) {
  const colors = { A: "C0392B", B: "E67700", C: "F2A500", D: "2980B9" };
  const bg = { A: "FDECEA", B: "FEF0E6", C: "FFFBE6", D: "EBF5FB" };
  const color = colors[severity] || "666666";
  const bgColor = bg[severity] || "F5F5F5";
  return new TableRow({ children: [
    new TableCell({
      borders: thinBorders, width: { size: 600, type: WidthType.DXA },
      shading: { fill: color, type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: severity, bold: true, size: 18, font: "Arial", color: "FFFFFF" })] })]
    }),
    new TableCell({
      borders: thinBorders, width: { size: 8400, type: WidthType.DXA },
      shading: { fill: bgColor, type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: String(text || ""), size: 16, font: "Arial" })] })]
    }),
  ]});
}

// Info sor (kártya stílusú)
function infoCard(label, value) {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [2500, 6500],
    rows: [new TableRow({ children: [
      new TableCell({
        borders: noBorders,
        shading: { fill: "EAF0F8", type: ShadingType.CLEAR },
        width: { size: 2500, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 16, font: "Arial", color: "1F497D" })] })]
      }),
      new TableCell({
        borders: { top: noBorder, bottom: noBorder, right: noBorder, left: { style: BorderStyle.SINGLE, size: 4, color: "1F497D" } },
        width: { size: 6500, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 160, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: String(value || ""), size: 18, font: "Arial", bold: true })] })]
      }),
    ]})]
  });
}

// Intézkedési szint badge
function actionBadge(level) {
  const colors = { Azonnali: "C0392B", Sürgős: "E67700", Ütemezett: "F2A500", Tervezett: "1A7A3C" };
  const color = colors[level] || "666666";
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [9000],
    rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 12, color }, bottom: noBorder, left: noBorder, right: noBorder },
      shading: { fill: "F8F9FA", type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Javasolt intézkedési szint", size: 18, font: "Arial", color: "666666" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: level, bold: true, size: 40, font: "Arial", color })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: actionLevelDesc(level), size: 16, font: "Arial", color: "444444" })] }),
      ]
    })]})],
  });
}

// ─── FŐFÜGGVÉNY ──────────────────────────────────────────────────────────────

function makeReportDoc() {
  const score = totalScore(state);
  const qual = scoreLabel(score);
  const level = actionLevelLabel(state);
  const cats = (state.scoring && state.scoring.categories) || [
    { id: "hurok", name: "Hurok + EPH", weight: 50 },
    { id: "avk", name: "AVK", weight: 20 },
    { id: "eloszto", name: "Elosztók", weight: 25 },
    { id: "dok", name: "Dokumentáció", weight: 5 },
  ];
  const faults = allFaults(state).sort((a, b) => "ABCD".indexOf(a.severity) - "ABCD".indexOf(b.severity));
  const critA = faults.filter(f => f.severity === "A");
  const critB = faults.filter(f => f.severity === "B");

  const children = [
    // ─── FEJLÉC ───────────────────────────────────────────────────
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [
      new TextRun({ text: "Smart Electric Hungary Kft.", bold: true, size: 28, font: "Arial", color: "1F497D" })
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [
      new TextRun({ text: "www.smartelectrichungary.com  |  +36 30 365 1161", size: 18, font: "Arial", color: "888888" })
    ]}),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "1F497D", space: 6 } },
      children: []
    }),
    spacer(12),

    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [
      new TextRun({ text: "Smart VBF — Villamos biztonsági felülvizsgálat", bold: true, size: 36, font: "Arial", color: "1F497D" })
    ]}),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [
      new TextRun({ text: "Vezetői kiértékelés  |  MSZ-HD 60364-6:2017 szerint", size: 22, font: "Arial", color: "555555" })
    ]}),

    spacer(8),

    // Ügyfél info kártyák
    infoCard("Ügyfél", state.customerName || ""),
    spacer(4),
    infoCard("Telephely", state.siteAddress || ""),
    spacer(4),
    infoCard("Vizsgálat dátuma", state.inspectionDate || ""),
    spacer(4),
    infoCard("Hurok jegyzőkönyv", (state.protocolNumbers && state.protocolNumbers.hurok) || ""),
    spacer(4),
    infoCard("AVK jegyzőkönyv", (state.protocolNumbers && state.protocolNumbers.avk) || ""),

    spacer(20),

    // ─── SMARTSCORE ───────────────────────────────────────────────
    sectionHeader("Összesített SMARTScore"),
    spacer(8),
    scoreBanner(score, qual),
    spacer(12),

    new Paragraph({ spacing: { after: 100 }, children: [
      new TextRun({ text: "Objektív villamos állapotértékelés — ", size: 18, font: "Arial", color: "555555" }),
      new TextRun({ text: "Kiegészítő összegző dokumentum a hivatalos VBF jegyzőkönyv mellé.", size: 18, font: "Arial", color: "555555", italics: true })
    ]}),

    spacer(16),

    // ─── KATEGÓRIA BONTÁS ─────────────────────────────────────────
    sectionHeader("Kategória bontás"),
    spacer(8),
    ...cats.flatMap(cat => {
      const pct = categoryScore(state, cat.id);
      return [progressBar(cat.name + ` (${cat.weight}% súly)`, pct, cat.weight), spacer(6)];
    }),

    spacer(16),

    // ─── INTÉZKEDÉSI SZINT ────────────────────────────────────────
    sectionHeader("Javasolt intézkedési szint"),
    spacer(8),
    actionBadge(level),

    spacer(16),

    // ─── HIBALISTA ────────────────────────────────────────────────
    sectionHeader("Azonosított hibák prioritás szerint"),
    spacer(8),

    ...(faults.length === 0 ? [
      new Paragraph({ children: [new TextRun({ text: "A vizsgálat során nem kerültek azonosításra hibák.", size: 18, font: "Arial", color: "1A7A3C" })] })
    ] : [
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        columnWidths: [600, 8400],
        rows: [
          new TableRow({ children: [
            new TableCell({ borders: thinBorders, shading: { fill: "1F497D", type: ShadingType.CLEAR }, width: { size: 600, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Kat.", bold: true, size: 16, font: "Arial", color: "FFFFFF" })] })] }),
            new TableCell({ borders: thinBorders, shading: { fill: "1F497D", type: ShadingType.CLEAR }, width: { size: 8400, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Hiba leírása", bold: true, size: 16, font: "Arial", color: "FFFFFF" })] })] }),
          ]}),
          ...faults.map((f, i) => faultRow(f.text, f.severity, i))
        ]
      })
    ]),

    spacer(16),

    // ─── ÖSSZEFOGLALÓ MEGÁLLAPÍTÁSOK ──────────────────────────────
    sectionHeader("Összefoglaló megállapítások"),
    spacer(8),

    // A hibák
    new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [9000], rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 8, color: critA.length > 0 ? "C0392B" : "1A7A3C" }, bottom: noBorder, left: noBorder, right: noBorder },
      shading: { fill: critA.length > 0 ? "FDECEA" : "EBF9EE", type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [
        new Paragraph({ children: [new TextRun({ text: "1. Azonnali beavatkozást igénylő megállapítások", bold: true, size: 20, font: "Arial", color: critA.length > 0 ? "C0392B" : "1A7A3C" })] }),
        new Paragraph({ spacing: { before: 80 }, children: [new TextRun({
          text: critA.length > 0
            ? `A kategóriás hibák száma: ${critA.length} db. Életvédelmi vagy közvetlen érintésveszélyt jelentő hibák azonosítva!`
            : "A kategóriás hibák száma: 0 db. A vizsgálat során azonnali beavatkozást igénylő hiba nem került azonosításra.",
          size: 18, font: "Arial"
        })] }),
        ...(critA.length > 0 ? critA.map(f => new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: "• " + f.text, size: 16, font: "Arial", color: "C0392B" })] })) : [])
      ]
    })]})]}),

    spacer(8),

    // B hibák / prioritások
    new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [9000], rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 8, color: "E67700" }, bottom: noBorder, left: noBorder, right: noBorder },
      shading: { fill: "FEF8F0", type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [
        new Paragraph({ children: [new TextRun({ text: "2. Legnagyobb fejlesztési prioritások", bold: true, size: 20, font: "Arial", color: "E67700" })] }),
        ...(critB.length > 0
          ? critB.slice(0, 5).map(f => new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "• " + f.text, size: 16, font: "Arial" })] }))
          : [new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: "Kritikus B szintű hiba nem azonosítható. A C és D szintű hibák ütemezett javítása javasolt.", size: 16, font: "Arial" })] })]
        )
      ]
    })]})]}),

    spacer(8),

    // Várható eredmény
    new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [9000], rows: [new TableRow({ children: [new TableCell({
      borders: { top: { style: BorderStyle.SINGLE, size: 8, color: "1F497D" }, bottom: noBorder, left: noBorder, right: noBorder },
      shading: { fill: "EEF4FB", type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [
        new Paragraph({ children: [new TextRun({ text: "3. Várható eredmény a javítások után", bold: true, size: 20, font: "Arial", color: "1F497D" })] }),
        new Paragraph({ spacing: { before: 80 }, children: [new TextRun({
          text: `A vizsgálat alapján a létesítmény villamos rendszere összességében ${score}/100 pontot kapott (${qual}). A prioritási sorrend alapján végrehajtott javításokkal a rendszer biztonsága és üzembiztonsága érdemben javítható.`,
          size: 16, font: "Arial"
        })] })
      ]
    })]})]}),

    spacer(20),

    // ─── INTÉZKEDÉSI SZINTEK TÁBLÁZATA ────────────────────────────
    sectionHeader("Intézkedési szintek"),
    spacer(8),
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      columnWidths: [1600, 2000, 5400],
      rows: [
        new TableRow({ children: [
          new TableCell({ borders: thinBorders, shading: { fill: "1F497D", type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Szint", bold: true, size: 18, font: "Arial", color: "FFFFFF" })] })] }),
          new TableCell({ borders: thinBorders, shading: { fill: "1F497D", type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Határidő", bold: true, size: 18, font: "Arial", color: "FFFFFF" })] })] }),
          new TableCell({ borders: thinBorders, shading: { fill: "1F497D", type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: "Tartalom", bold: true, size: 18, font: "Arial", color: "FFFFFF" })] })] }),
        ]}),
        ...[
          ["Azonnali", "0–7 nap", "Életvédelmi vagy közvetlen érintésveszélyt jelentő hibák elhárítása.", "C0392B", "FDECEA"],
          ["Sürgős", "30 napon belül", "Súlyos vagy üzembiztonsági kockázatot hordozó eltérések javítása.", "E67700", "FEF0E6"],
          ["Ütemezett", "90 napon belül", "Közepes és kisebb hiányosságok, dokumentációs és jelölési rendezések.", "F2A500", "FFFBE6"],
          ["Tervezett", "Határozatlan", "Esztétikai, de később balesetet előidézhető rendellenességek.", "1A7A3C", "EBF9EE"],
        ].map(([szint, hataridő, tartalom, color, bg]) => new TableRow({ children: [
          new TableCell({ borders: thinBorders, shading: { fill: bg, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: szint, bold: true, size: 16, font: "Arial", color })] })] }),
          new TableCell({ borders: thinBorders, shading: { fill: bg, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: hataridő, size: 16, font: "Arial" })] })] }),
          new TableCell({ borders: thinBorders, shading: { fill: bg, type: ShadingType.CLEAR }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: tartalom, size: 16, font: "Arial" })] })] }),
        ]}))
      ]
    }),

    spacer(20),

    // ─── LÁBLÉC ───────────────────────────────────────────────────
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 6 } },
      alignment: AlignmentType.CENTER, spacing: { before: 200 },
      children: [new TextRun({ text: "Smart Electric Hungary Kft.  |  www.smartelectrichungary.com  |  +36 30 365 1161", size: 14, font: "Arial", color: "AAAAAA" })]
    }),
  ];

  return new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, right: 900, bottom: 900, left: 900 } } },
      children
    }]
  });
}

async function main() {
  const outDir = process.argv[3] || ".";
  const doc = makeReportDoc();
  const buf = await Packer.toBuffer(doc);
  const filename = `${outDir}/SMARTGuard_Vezeto_Kiertekeles_${(state.protocolNumbers && state.protocolNumbers.hurok) || "export"}.docx`;
  fs.writeFileSync(filename, buf);
  process.stdout.write(filename + "\n");
}

main().catch(e => { process.stderr.write(String(e) + "\n"); process.exit(1); });
