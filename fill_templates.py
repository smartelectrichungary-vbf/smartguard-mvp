#!/usr/bin/env python3
"""
SMARTGuard – Word sablon kitöltő
Az eredeti sablon formátumát TELJESEN megtartja.
Csak a szöveg tartalmát cseréli, minden stílus változatlan marad.
"""
import sys, json, os, io, zipfile, copy
from lxml import etree

NS  = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W   = lambda tag: f'{{{NS}}}{tag}'
XML = '{http://www.w3.org/XML/1998/namespace}space'
BASE = os.path.dirname(os.path.abspath(__file__))
TMPL = os.path.join(BASE, 'templates')

# ─── XML HELPERS ─────────────────────────────────────────────────────────────

def get_cell_text(cell):
    """Összegyűjti egy cella összes szövegét."""
    return ''.join((t.text or '') for t in cell.iter(W('t')))

def set_cell_text(cell, new_text):
    """
    Biztonságosan beírja az új szöveget egy cellába.
    MEGTARTJA az összes stílust (betűméret, félkövér, keret stb.)
    Csak a <w:t> tartalmát cseréli.
    Ha nincs run, üres bekezdést hagy.
    """
    new_text = str(new_text) if new_text is not None else ''
    
    # Megkeressük az összes <w:t> elemet a cellában
    t_elements = list(cell.iter(W('t')))
    
    if not t_elements:
        # Nincs szöveges elem – keresünk egy <w:p>-t és adunk hozzá run-t
        para = cell.find(W('p'))
        if para is not None:
            run = etree.SubElement(para, W('r'))
            t_el = etree.SubElement(run, W('t'))
            t_el.text = new_text
            if new_text and (new_text[0] == ' ' or new_text[-1] == ' '):
                t_el.set(XML, 'preserve')
        return
    
    # Az első <w:t>-be írjuk az új szöveget
    t_elements[0].text = new_text
    if new_text and (new_text[0] == ' ' or new_text[-1] == ' '):
        t_elements[0].set(XML, 'preserve')
    else:
        t_elements[0].attrib.pop(XML, None)
    
    # A többi <w:t>-t kiürítjük (ha volt több run)
    for t_el in t_elements[1:]:
        t_el.text = ''
        t_el.attrib.pop(XML, None)

def replace_text_in_cell(cell, search, replace):
    """Szöveg keresés-csere egy cellán belül, stílusok megtartásával."""
    full = get_cell_text(cell)
    if search not in full:
        return False
    new_full = full.replace(search, replace)
    set_cell_text(cell, new_full)
    return True

def replace_in_all_cells(root_elem, search, replace):
    """Az egész dokumentumban kicseréli a szöveget (cellánként)."""
    found = 0
    for tc in root_elem.iter(W('tc')):
        if replace_text_in_cell(tc, search, replace):
            found += 1
    # Bekezdésekben is keresünk (nem táblán belül)
    for para in root_elem.iter(W('p')):
        full = ''.join((t.text or '') for t in para.iter(W('t')))
        if search in full:
            new_full = full.replace(search, replace)
            t_els = list(para.iter(W('t')))
            if t_els:
                t_els[0].text = new_full
                for t_el in t_els[1:]:
                    t_el.text = ''
            found += 1
    return found
def replace_munkaszam_kelt(root_elem, munkaszam, date):
    """Munkaszám és Kelt mezők cseréje egy lépésben, regex alapon."""
    import re
    for tc in root_elem.iter(W('tc')):
        full = get_cell_text(tc)
        changed = False
        new_text = full
        # Munkaszám: bármilyen tartalom → egységes csere
        if re.search(r'Munkasz\xe1m[: ]+', full):
            new_text = re.sub(r'Munkasz\u00e1m[: ]+.*', f'Munkasz\u00e1m: {munkaszam}', new_text)
            changed = True
        # Kelt: csere
        if re.search(r'Kelt[: ]+', full):
            new_text = re.sub(r'Kelt[: ]+.*', f'Kelt: {date}', new_text)
            changed = True
        if changed and new_text != full:
            set_cell_text(tc, new_text)



def load_docx(path):
    """Betölti a docx-et és visszaadja az XML root-ot és a ZIP tartalmát."""
    with zipfile.ZipFile(path, 'r') as z:
        xml_bytes = z.read('word/document.xml')
        all_files = {name: z.read(name) for name in z.namelist()}
    root = etree.fromstring(xml_bytes)
    return root, all_files

def save_docx(all_files, root, out_path):
    """Visszaírja a docx-et az eredeti fájlokkal, csak a document.xml módosul."""
    new_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in all_files.items():
            if name == 'word/document.xml':
                zout.writestr(name, new_xml)
            else:
                zout.writestr(name, data)
    with open(out_path, 'wb') as f:
        f.write(buf.getvalue())

# ─── AVK KITÖLTÉS ────────────────────────────────────────────────────────────

def fill_avk(state, out_path):
    """
    AVK sablon kitöltése.
    Struktúra: 9 táblázat
    - Tábla 0: Fejléc (mérést végezte, műszer) - nem módosítjuk
    - Tábla 1-8: Adattáblák, soronként 13 cella:
      [0]=Ssz, [1]=Helye, [2]=Jele, [3]=Típus, [4]=In[A], [5]=IΔn[mA],
      [6]=Un[V], [7]=Pólussz, [8]=IΔn mért[mA], [9]=t[ms], [10]=MP, [11]=SZV, [12]=Minősítés
    - Minden tábla utolsó sora: Kelt | Munkaszám | Felelős
    """
    root, all_files = load_docx(os.path.join(TMPL, 'AVK_JK_2025.docx'))
    
    pn   = state.get('munkaszam', '') or (state.get('protocolNumbers') or {}).get('avk', '')
    date = state.get('inspectionDate', '')
    
    # Munkaszám és Kelt csere
    replace_munkaszam_kelt(root, pn, date)
    
    # Kitöltendő AVK sorok (csak valóban kitöltöttek)
    avk_rows = [r for r in (state.get('avkRows') or [])
                if r.get('mark') or r.get('place') or r.get('iDeltaMa') or
                   r.get('timeMs') or r.get('status') or r.get('inA')]
    
    eloszto_map = {d['id']: d.get('name', '') for d in (state.get('elosztoRows') or [])}
    
    tables = root.findall('.//' + W('tbl'))
    
    row_idx = 0
    for tbl in tables[1:]:  # Az első tábla a fejléc
        rows = tbl.findall(W('tr'))
        for row in rows:
            cells = row.findall(W('tc'))
            if len(cells) < 13:
                continue
            # Megnézzük az első cella tartalmát - ha szám, adatsor
            first_text = get_cell_text(cells[0]).strip()
            if not first_text.isdigit():
                continue
            
            if row_idx < len(avk_rows):
                r = avk_rows[row_idx]
                place = r.get('place') or eloszto_map.get(r.get('distributorId', ''), '')
                
                vals = [
                    None,              # [0] Ssz - meghagyjuk az eredetit
                    place,             # [1] Helye
                    r.get('mark', ''), # [2] Jele
                    r.get('type', ''), # [3] Típus
                    r.get('inA', ''),  # [4] In [A]
                    r.get('deltaMa', ''), # [5] IΔn [mA] névleges
                    r.get('unV', ''),  # [6] Un [V]
                    r.get('poles', ''), # [7] Pólussz
                    r.get('iDeltaMa', ''), # [8] IΔn mért [mA]
                    r.get('timeMs', ''), # [9] t [ms]
                    r.get('mp', ''),   # [10] MP
                    r.get('szv', ''),  # [11] SZV
                    r.get('status', ''), # [12] Minősítés
                ]
                
                for ci, val in enumerate(vals):
                    if val is None:
                        continue  # Ssz-t meghagyjuk
                    if ci < len(cells):
                        set_cell_text(cells[ci], val)
                
                row_idx += 1
            # Ha nincs több adat, a sor üresen marad (az original üres)
    
    save_docx(all_files, root, out_path)
    return out_path

# ─── HUROK KITÖLTÉS ──────────────────────────────────────────────────────────

GRAY_FILL = 'D9D9D9'  # halványszürke helyiség-sor háttér

def set_cell_text_keep_style(cell, text):
    """
    Beírja a szöveget a cella ELSŐ run-jába úgy, hogy MEGTARTJA annak
    rPr stílusát (betűméret stb.). A többi run szövegét üríti.
    A set_cell_text-tel ellentétben üres (w:t nélküli) run esetén is
    a meglévő run-ba ír, így nem veszik el a betűméret.
    """
    text = '' if text is None else str(text)
    para = cell.find(W('p'))
    if para is None:
        para = etree.SubElement(cell, W('p'))
    runs = para.findall(W('r'))
    if runs:
        run = runs[0]
    else:
        run = etree.SubElement(para, W('r'))
    t = run.find(W('t'))
    if t is None:
        t = etree.SubElement(run, W('t'))
    t.text = text
    if text and (text[0] == ' ' or text[-1] == ' '):
        t.set(XML, 'preserve')
    else:
        t.attrib.pop(XML, None)
    # többi run szövegét ürítjük (a run + stílus marad)
    for extra in runs[1:]:
        for tt in extra.findall(W('t')):
            tt.text = ''

def _fix_manual_pagebreak(p):
    """
    A kézi oldaltörést (<w:br w:type="page"/>) pageBreakBefore-ra cseréli.
    Így a legend oldal után NEM keletkezik felesleges üres oldal
    (az eredeti sablonban az üres bekezdés + kézi törés egy plusz
    üres oldalt szült).
    """
    for r in list(p.findall(W('r'))):
        page_brs = [b for b in r.findall(W('br')) if b.get(W('type')) == 'page']
        for b in page_brs:
            r.remove(b)
        # ha a run kiürült, töröljük
        if len(list(r)) == 0 and not (r.text or '').strip():
            p.remove(r)
    ppr = p.find(W('pPr'))
    if ppr is None:
        ppr = etree.Element(W('pPr')); p.insert(0, ppr)
    if ppr.find(W('pageBreakBefore')) is None:
        pbb = etree.Element(W('pageBreakBefore'))
        pstyle = ppr.find(W('pStyle'))
        if pstyle is not None:
            pstyle.addnext(pbb)       # pStyle UTÁN (séma-sorrend)
        else:
            ppr.insert(0, pbb)

def _ensure_tbl_header(row):
    """A fejlécsor minden oldal tetején ismétlődjön (w:tblHeader)."""
    trpr = row.find(W('trPr'))
    if trpr is None:
        trpr = etree.Element(W('trPr'))
        row.insert(0, trpr)
    if trpr.find(W('tblHeader')) is None:
        th = etree.Element(W('tblHeader'))
        trh = trpr.find(W('trHeight'))
        if trh is not None:
            trh.addnext(th)        # trHeight UTÁN (séma-sorrend)
        else:
            trpr.append(th)

def _make_gray_room_row(template_data_row, room_name, total_width, total_span):
    """
    Egy adatsor-sablonból teljes szélességű, halványszürke, félkövér,
    középre zárt HELYISÉG-sort készít (mint a kézi Word-ben).
    """
    row = copy.deepcopy(template_data_row)
    cells = row.findall(W('tc'))
    for c in cells[1:]:            # csak az első cella marad
        row.remove(c)
    tc = cells[0]
    tcpr = tc.find(W('tcPr'))
    if tcpr is None:
        tcpr = etree.Element(W('tcPr'))
        tc.insert(0, tcpr)
    # teljes táblaszélesség
    tcw = tcpr.find(W('tcW'))
    if tcw is None:
        tcw = etree.Element(W('tcW')); tcpr.insert(0, tcw)
    tcw.set(W('w'), str(total_width)); tcw.set(W('type'), 'dxa')
    # gridSpan = összes oszlop (tcW után – séma-sorrend)
    gs = tcpr.find(W('gridSpan'))
    if gs is None:
        gs = etree.Element(W('gridSpan')); tcw.addnext(gs)
    gs.set(W('val'), str(total_span))
    # halványszürke kitöltés (vAlign elé – séma-sorrend)
    shd = tcpr.find(W('shd'))
    if shd is None:
        shd = etree.Element(W('shd'))
        valign = tcpr.find(W('vAlign'))
        if valign is not None:
            valign.addprevious(shd)
        else:
            tcpr.append(shd)
    shd.set(W('val'), 'clear'); shd.set(W('color'), 'auto'); shd.set(W('fill'), GRAY_FILL)
    # szöveg: félkövér + középre
    para = tc.find(W('p'))
    if para is None:
        para = etree.SubElement(tc, W('p'))
    ppr = para.find(W('pPr'))
    if ppr is None:
        ppr = etree.Element(W('pPr')); para.insert(0, ppr)
    jc = ppr.find(W('jc'))
    if jc is None:
        jc = etree.SubElement(ppr, W('jc'))
    jc.set(W('val'), 'center')
    runs = para.findall(W('r'))
    if runs:
        run = runs[0]
        for extra in runs[1:]:
            para.remove(extra)
    else:
        run = etree.SubElement(para, W('r'))
    rpr = run.find(W('rPr'))
    if rpr is None:
        rpr = etree.Element(W('rPr')); run.insert(0, rpr)
    if rpr.find(W('b')) is None:
        rpr.insert(0, etree.Element(W('b')))        # félkövér (sz elé)
    t = run.find(W('t'))
    if t is None:
        t = etree.SubElement(run, W('t'))
    t.text = room_name
    if room_name and (room_name[0] == ' ' or room_name[-1] == ' '):
        t.set(XML, 'preserve')
    return row

def _fill_hurok_data_row(row, number, r):
    """Kitölt egy klónozott adatsort (helyiségnév NÉLKÜL, folyamatos sorszámmal)."""
    cells = row.findall(W('tc'))
    rtype = r.get('type', 'hurok')
    point_text = r.get('point', '') or ''
    if rtype == 'eph':                              # EPH jelölés megmarad
        point_text = (point_text + ' (EPH)') if point_text else '(EPH)'
    vals = {
        0: str(number),            # [0] Sorszám – folyamatos
        1: point_text,             # [1] Mérési pont (helyiségnév NÉLKÜL)
        2: r.get('modeClass', ''), # [2] Mód/Oszt
        3: r.get('distributor', ''), # [3] Helye (elosztó)
        4: r.get('breaker', ''),   # [4] Típus (In, kar.)
        5: '',                     # [5] ÁVK – üres a hurok JK-ban
        6: r.get('pe', ''),        # [6] PE folyt.
        7: r.get('valueOhm', ''),  # [7] Érték [Ω]
        8: r.get('status', ''),    # [8] Minősítés
    }
    for ci, val in vals.items():
        if ci < len(cells):
            set_cell_text_keep_style(cells[ci], val)

def fill_hurok(state, out_path):
    """
    HUROK + EPH jegyzőkönyv kitöltése.

    Új viselkedés (v25):
    - A 16 fix adattábla helyett EGYETLEN, automatikusan tördelő táblázat,
      így nincs felesleges üres oldal.
    - A fejlécsorok minden oldal tetején ismétlődnek (w:tblHeader).
    - Minden HELYISÉG elé teljes szélességű, halványszürke sor kerül a
      helyiség nevével (mint a kézi Word-ben). A tételek mellett már
      NINCS ott a helyiségnév.
    - A sorszámozás végig FOLYAMATOS (1, 2, 3 …), a szürke sorok nincsenek
      beszámozva.
    """
    root, all_files = load_docx(os.path.join(TMPL, '60364-6_HUROKIMP.docx'))

    pn   = state.get('munkaszam', '') or (state.get('protocolNumbers') or {}).get('hurok', '')
    date = state.get('inspectionDate', '')

    # Munkaszám és Kelt csere – kitölti az 1. tábla láblécét is
    replace_munkaszam_kelt(root, pn, date)

    room_map   = {r['id']: r.get('name', '') for r in (state.get('rooms') or [])}
    room_order = [r['id'] for r in (state.get('rooms') or [])]

    hurok_rows = [r for r in (state.get('hurokRows') or [])
                  if r.get('point') or r.get('valueOhm') or r.get('status') or r.get('distributor')]

    tables = root.findall('.//' + W('tbl'))
    if len(tables) < 2:
        save_docx(all_files, root, out_path)
        return out_path

    data_table = tables[1]                 # az első adattábla a minta
    body = root.find(W('body'))

    # Sorok osztályozása: fejléc / adatsablon / lábléc
    def first_txt(rw):
        cs = rw.findall(W('tc'))
        return get_cell_text(cs[0]).strip() if cs else ''
    header_rows, data_template, footer_row = [], None, None
    for rw in data_table.findall(W('tr')):
        ft = first_txt(rw)
        if ft.isdigit():
            if data_template is None:
                data_template = rw
        elif 'Kelt' in ''.join(get_cell_text(c) for c in rw.findall(W('tc'))):
            footer_row = rw
        elif data_template is None:        # fejlécsorok az adat előtt
            header_rows.append(rw)

    if data_template is None:              # váratlan sablon – ne rontsuk el
        save_docx(all_files, root, out_path)
        return out_path

    # Teljes táblaszélesség / oszlopszám
    grid = data_table.find(W('tblGrid'))
    cols = grid.findall(W('gridCol')) if grid is not None else []
    total_span  = len(cols) or 11
    total_width = sum(int(c.get(W('w')) or 0) for c in cols) or 15660

    # Fejlécek ismétlése minden oldalon
    for hr in header_rows:
        _ensure_tbl_header(hr)

    # Csoportosítás helyiség szerint, a rooms sorrendjében
    from collections import OrderedDict
    groups = OrderedDict()
    for r in hurok_rows:
        groups.setdefault(r.get('roomId', ''), []).append(r)
    ordered_rids = [rid for rid in room_order if rid in groups] + \
                   [rid for rid in groups if rid not in room_order]

    # Új sorlista összeállítása
    new_rows = [copy.deepcopy(hr) for hr in header_rows]
    counter = 0
    for rid in ordered_rids:
        rname = room_map.get(rid, '')
        if rname:   # szürke helyiség-sor (üres helyiségnévnél nincs)
            new_rows.append(_make_gray_room_row(data_template, rname,
                                                total_width, total_span))
        for r in groups[rid]:
            counter += 1
            dr = copy.deepcopy(data_template)
            _fill_hurok_data_row(dr, counter, r)
            new_rows.append(dr)
    if footer_row is not None:
        new_rows.append(copy.deepcopy(footer_row))

    # Régi sorok cseréje az újakra (tblPr/tblGrid a helyén marad)
    for tr in data_table.findall(W('tr')):
        data_table.remove(tr)
    for nr in new_rows:
        data_table.append(nr)

    # A többi adattábla és az elválasztó üres bekezdések törlése.
    # Egyetlen üres bekezdést meghagyunk a tábla után, a sectPr-t megtartjuk.
    sectPr = body.find(W('sectPr'))
    children = list(body)
    idx = children.index(data_table)
    kept_p_done = False
    for ch in children[idx + 1:]:
        if ch is sectPr:
            continue
        tag = etree.QName(ch).localname
        is_empty_p = (tag == 'p' and not ''.join(
            (t.text or '') for t in ch.iter(W('t'))).strip())
        if is_empty_p and not kept_p_done:
            kept_p_done = True     # egy üres bekezdés marad a tábla után
            continue
        body.remove(ch)

    # A legend utáni kézi oldaltörést pageBreakBefore-ra cseréljük,
    # hogy NE keletkezzen felesleges üres oldal a 2. oldalon.
    for p in body.findall(W('p')):
        if any(b.get(W('type')) == 'page' for b in p.iter(W('br'))):
            _fix_manual_pagebreak(p)

    save_docx(all_files, root, out_path)
    return out_path

# ─── ALAPDOK KITÖLTÉS ────────────────────────────────────────────────────────

def get_para_text(para):
    return ''.join((t.text or '') for t in para.iter(W('t')))

def set_para_text_val(para, value):
    """Bekezdés utolsó run-jának szövegét cseréli"""
    value = str(value) if value is not None else ''
    runs = para.findall('.//' + W('r'))
    if not runs:
        run = etree.SubElement(para, W('r'))
        t_el = etree.SubElement(run, W('t'))
        t_el.text = value
        if value and (value[0]==' ' or value[-1]==' '):
            t_el.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        return
    last_run = runs[-1]
    t_els = list(last_run.iter(W('t')))
    if not t_els:
        t_el = etree.SubElement(last_run, W('t'))
        t_els = [t_el]
    t_els[0].text = value
    if value and (value[0]==' ' or value[-1]==' '):
        t_els[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    for t in t_els[1:]:
        t.text = ''

def set_run2_text_val(para, value):
    """A bekezdés 2. run-jának szövegét cseréli (label + érték pár)"""
    value = str(value) if value is not None else ''
    runs = para.findall('.//' + W('r'))
    if len(runs) >= 2:
        t_els = list(runs[1].iter(W('t')))
        if not t_els:
            t_el = etree.SubElement(runs[1], W('t'))
            t_els = [t_el]
        t_els[0].text = ' ' + value  # szóköz a label után
        t_els[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        for t in t_els[1:]:
            t.text = ''
    elif len(runs) == 1:
        # Csak egy run van, hozzáfűzzük
        t_els = list(runs[0].iter(W('t')))
        if t_els:
            original = t_els[-1].text or ''
            if not original.endswith(' '):
                original += ' '
            t_els[-1].text = original + value
            t_els[-1].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

def fill_alapdok(state, out_path):
    """
    Alapdok kitöltése az EREDETI FORMÁTUM PONTOS MEGŐRZÉSÉVEL.
    Minden oldal megmarad, csak a kitöltendő mezők változnak.
    """
    src = os.path.join(TMPL, 'MSZ_HD_60364-6_Alapdok.docx')
    root, all_files = load_docx(src)
    
    tables = root.findall('.//' + W('tbl'))
    
    ad          = state.get('alapdok') or {}
    munkaszam   = state.get('munkaszam', '')
    customer    = state.get('customerName', '')
    address     = state.get('siteAddress', '')
    date        = state.get('inspectionDate', '')
    kisero      = ad.get('kisero', '')
    idotartam   = ad.get('idotartam', '')
    
    # ═══ TÁBLA 1: Fedőlap ═══
    if len(tables) >= 1:
        tbl1  = tables[0]
        rows1 = tbl1.findall(W('tr'))
        if len(rows1) >= 2:
            c0    = rows1[1].findall(W('tc'))[0]
            paras = c0.findall(W('p'))
            if len(paras) >= 16:
                set_para_text_val(paras[2],  munkaszam)          # Munkaszám érték
                set_para_text_val(paras[9],  address)            # Helyszín
                set_run2_text_val(paras[10], customer)           # Megrendelő
                set_para_text_val(paras[13], kisero)             # Üzemi kísérő
                set_para_text_val(paras[15], idotartam or date)  # Időtartam
    
    # ═══ TÁBLA 2,4,5,6: Munkaszám fejlécek ═══
    for ti in [1, 3, 4, 5]:
        if ti >= len(tables):
            continue
        tbl = tables[ti]
        rows = tbl.findall(W('tr'))
        row_idx = 1 if len(rows) > 1 else 0
        row = rows[row_idx]
        cells = row.findall(W('tc'))
        if not cells:
            continue
        c = cells[0]
        cell_paras = c.findall(W('p'))
        for cp in cell_paras:
            cp_text = get_para_text(cp)
            if 'Munkaszám:' in cp_text:
                runs = cp.findall('.//' + W('r'))
                if runs:
                    t_els = list(runs[0].iter(W('t')))
                    if t_els:
                        original = t_els[0].text or ''
                        # "Munkaszám:  SECTION" -> "Munkaszám: [MKS]  SECTION"
                        if '  ' in original:
                            parts = original.split('  ', 1)
                            t_els[0].text = parts[0] + ' ' + munkaszam + '  ' + parts[1]
                        else:
                            t_els[0].text = 'Munkaszám: ' + munkaszam + '  '
                        t_els[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                break
    
    # ═══ TÁBLA 3: Vizsgálat időpontja ═══
    if len(tables) >= 3:
        tbl3  = tables[2]
        rows3 = tbl3.findall(W('tr'))
        if len(rows3) >= 3:
            cells3 = rows3[2].findall(W('tc'))
            for ci in range(1, len(cells3)):
                ps = cells3[ci].findall(W('p'))
                if ps:
                    set_para_text_val(ps[0], date)
    
    # ═══ TÁBLA 5: Kelt sor + vizsgálati eredmények ═══
    if len(tables) >= 5:
        tbl5  = tables[4]
        rows5 = tbl5.findall(W('tr'))
        
        # Kelt sor (utolsó sor)
        last_row = rows5[-1]
        for c in last_row.findall(W('tc')):
            for p in c.findall(W('p')):
                if 'Kelt:' in get_para_text(p):
                    runs = p.findall('.//' + W('r'))
                    if runs:
                        t_els = list(runs[0].iter(W('t')))
                        if t_els:
                            t_els[0].text = 'Kelt: ' + date + '  '
                            t_els[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                    break
        
        # Vizsgálati eredmények (sorok 3-33)
        vizsgalat = ad.get('vizsgalat') or []
        if vizsgalat:
            data_rows = rows5[3:34]
            for i, vrow in enumerate(vizsgalat):
                if i >= len(data_rows):
                    break
                row_cells = data_rows[i].findall(W('tc'))
                if len(row_cells) >= 2 and len(vrow) >= 2 and vrow[1]:
                    ps = row_cells[1].findall(W('p'))
                    if ps:
                        set_para_text_val(ps[0], vrow[1])
                if len(row_cells) >= 3 and len(vrow) >= 3 and vrow[2]:
                    ps = row_cells[2].findall(W('p'))
                    if ps:
                        set_para_text_val(ps[0], vrow[2])
    
    # ─── FELESLEGES ÜRES OLDAL MEGSZÜNTETÉSE ───
    # A sablonban az oldalváltások üres bekezdésbe ágyazott kézi oldaltörések
    # (<w:br w:type="page"/>). Ha az előző tábla megtölti az oldalt (pl. a
    # Hibajegyzék), az üres bekezdés átcsúszik a következő oldalra, a törés
    # pedig még egyet lök → felesleges ÜRES oldal a Wordben.
    # A kézi oldaltörést pageBreakBefore-ra cseréljük (ugyanaz a szándék,
    # de nem szül üres oldalt).
    body = root.find(W('body'))
    if body is not None:
        for p in body.findall(W('p')):
            if any(b.get(W('type')) == 'page' for b in p.iter(W('br'))):
                _fix_manual_pagebreak(p)

    # Mentés (saját ZIP logika mert save_docx bytes-t vár)
    import io as _io
    new_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    buf = _io.BytesIO()
    import zipfile as _zf
    with _zf.ZipFile(buf, 'w', _zf.ZIP_DEFLATED) as zout:
        for name, data in all_files.items():
            zout.writestr(name, new_xml if name == 'word/document.xml' else data)
    with open(out_path, 'wb') as f:
        f.write(buf.getvalue())


# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    # sys.argv[1] lehet JSON string VAGY fájlútvonal
    arg1 = sys.argv[1]
    if os.path.isfile(arg1):
        with open(arg1, 'r', encoding='utf-8') as _f:
            state = json.load(_f)
    else:
        state = json.loads(arg1)
    out_dir = sys.argv[2] if len(sys.argv) > 2 else '.'
    doc_type = state.pop('_docType', 'both')
    pn       = state.get('protocolNumbers') or {}
    outputs  = []

    if doc_type in ('both', 'avk'):
        p = os.path.join(out_dir, f"AVK_JK_{pn.get('avk', 'export')}.docx")
        fill_avk(state, p)
        outputs.append(p)

    if doc_type in ('both', 'hurok'):
        p = os.path.join(out_dir, f"HUROK_JK_{pn.get('hurok', 'export')}.docx")
        fill_hurok(state, p)
        outputs.append(p)

    if doc_type == 'alapdok':
        p = os.path.join(out_dir, f"Alapdok_{pn.get('hurok', 'export')}.docx")
        fill_alapdok(state, p)
        outputs.append(p)

    print('\n'.join(outputs))

if __name__ == '__main__':
    main()
