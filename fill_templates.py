#!/usr/bin/env python3
"""
SMARTGuard – Word sablon kitöltő
Az eredeti sablon formátumát TELJESEN megtartja.
Csak a szöveg tartalmát cseréli, minden stílus változatlan marad.
"""
import sys, json, os, io, zipfile
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

def fill_hurok(state, out_path):
    """
    HUROK sablon kitöltése.
    Struktúra: 17 táblázat
    - Tábla 0: Fejléc (munkaszám, mérést végezték, műszer) 
    - Tábla 1+: Adattáblák, soronként 9 cella:
      [0]=Sorszám, [1]=Mérési pont/megnevezés, [2]=Mód/Oszt, 
      [3]=Elosztó helye, [4]=Típus (In, kar.), [5]=ÁVK, 
      [6]=PE folyt, [7]=Érték [Ω], [8]=Minősítés
    - Tábla 2 speciális: 10 cellás sorok (extra gridSpan oszlop)
    """
    root, all_files = load_docx(os.path.join(TMPL, '60364-6_HUROKIMP.docx'))
    
    pn   = state.get('munkaszam', '') or (state.get('protocolNumbers') or {}).get('hurok', '')
    date = state.get('inspectionDate', '')
    
    # Munkaszám és Kelt csere - regex alapon, egyszer
    replace_munkaszam_kelt(root, pn, date)
    
    # Helyiség névtérkép
    room_map = {r['id']: r.get('name', '') for r in (state.get('rooms') or [])}
    
    # Kitöltendő sorok
    hurok_rows = [r for r in (state.get('hurokRows') or [])
                  if r.get('point') or r.get('valueOhm') or r.get('status') or r.get('distributor')]
    
    tables = root.findall('.//' + W('tbl'))
    
    row_idx = 0
    for tbl in tables[1:]:  # Az első tábla a fejléc
        rows = tbl.findall(W('tr'))
        for row in rows:
            cells = row.findall(W('tc'))
            if len(cells) < 7:
                continue
            # Adatsor azonosítása: első cella szám
            first_text = get_cell_text(cells[0]).strip()
            if not first_text.isdigit():
                continue
            
            if row_idx < len(hurok_rows):
                r = hurok_rows[row_idx]
                room = room_map.get(r.get('roomId', ''), '')
                rtype = r.get('type', 'hurok')
                
                # Mérési pont: helyiség + megnevezés
                point_parts = []
                if room:
                    point_parts.append(room)
                if r.get('point'):
                    point_parts.append(r['point'])
                point_text = ' – '.join(point_parts) if point_parts else ''
                
                # EPH jelölés
                if rtype == 'eph':
                    point_text = point_text + ' (EPH)' if point_text else '(EPH)'
                
                # Cellaértékek - sorszámot NEM írjuk felül
                # [0]=Ssz (megtartjuk), [1]=Mérési pont, [2]=Mód/Oszt,
                # [3]=Helye (elosztó), [4]=Típus/In kar, [5]=ÁVK, [6]=PE folyt,
                # [7]=Érték Ω, [8]=Minősítés
                vals = {
                    1: point_text,
                    2: r.get('modeClass', ''),
                    3: r.get('distributor', ''),
                    4: r.get('breaker', ''),
                    5: '',             # ÁVK – általában üres a hurok JK-ban
                    6: r.get('pe', ''),
                    7: r.get('valueOhm', ''),
                    8: r.get('status', ''),
                }
                
                for ci, val in vals.items():
                    if ci < len(cells):
                        set_cell_text(cells[ci], val)
                
                row_idx += 1
    
    save_docx(all_files, root, out_path)
    return out_path

# ─── ALAPDOK KITÖLTÉS ────────────────────────────────────────────────────────

def fill_alapdok(state, out_path):
    """Alapdok kitöltése az EREDETI FORMÁTUM TELJES MEGTARTÁSÁVAL.
    Csak a Munkaszám, Kelt és vizsgálati eredmény értékek cserélődnek."""
    src = os.path.join(TMPL, 'MSZ_HD_60364-6_Alapdok.docx')
    root, all_files = load_docx(src)
    
    ad   = state.get('alapdok') or {}
    pn   = state.get('munkaszam') or (state.get('protocolNumbers') or {}).get('hurok','')
    date = state.get('inspectionDate','')
    
    # Munkaszám csere – minden fejléc cellában
    # Az eredeti sablon: "Munkaszám:  MINŐSÍTŐ IRAT", "MINŐSÍTÉSI ALAPADATOK", stb.
    munkaszam_val = f'Munkaszám: {pn}'
    for tc in root.iter(W('tc')):
        full = get_cell_text(tc)
        if full.startswith('Munkaszám:') or 'Munkaszám:  ' in full:
            # Az összes Munkaszám előfordulást cseréljük
            new_text = full.replace('Munkaszám:  ', munkaszam_val + ' ').replace('Munkaszám: villamos', munkaszam_val + ' villamos')
            if new_text != full:
                set_cell_text(tc, new_text.strip())
        # Kelt csere
        if full.strip() == 'Kelt:' or full.strip() == 'Kelt: ':
            set_cell_text(tc, f'Kelt: {date}')
    
    # Vizsgálati eredmények (MF/NMF/NA értékek)
    vizsgalat = ad.get('vizsgalat') or []
    if vizsgalat:
        tables = root.findall('.//' + W('tbl'))
        viz_idx = 0
        for tbl in tables:
            for row in tbl.findall(W('tr')):
                cells = row.findall(W('tc'))
                if len(cells) >= 2:
                    cell1_text = get_cell_text(cells[1]).strip()
                    if cell1_text in ('MF', 'NMF', 'NA', 'NV', '-') and viz_idx < len(vizsgalat):
                        vrow = vizsgalat[viz_idx]
                        if len(vrow) >= 2 and vrow[1]:
                            set_cell_text(cells[1], vrow[1])
                        if len(vrow) >= 3 and len(cells) > 2 and vrow[2]:
                            set_cell_text(cells[2], vrow[2] or '-')
                        viz_idx += 1
    
    new_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    buf = __import__('io').BytesIO()
    import zipfile as zf
    with zf.ZipFile(src,'r') as zin:
        files = {n: zin.read(n) for n in zin.namelist()}
    import io
    buf2 = io.BytesIO()
    with zf.ZipFile(buf2,'w',zf.ZIP_DEFLATED) as zout:
        for n,d in files.items():
            zout.writestr(n, new_xml if n=='word/document.xml' else d)
    with open(out_path,'wb') as f:
        f.write(buf2.getvalue())


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
