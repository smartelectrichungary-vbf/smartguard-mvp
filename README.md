# SMARTGuard – v26 (frissítés)

Ebben a verzióban **csak a `fill_templates.py` módosult**, minden más fájl változatlan.

## Mi változott
- **Hurok+EPH jegyzőkönyv:** a helyiség neve már NEM a tételek mellett jelenik meg, hanem
  teljes szélességű, **halványszürke sorként** a táblázatban (mint a kézi Word-ben). A sorszámozás
  végig **folyamatos** (1, 2, 3 …), a szürke sorok nincsenek beszámozva. A korábbi sok felesleges
  üres oldal is megszűnt (egyetlen, automatikusan tördelő, ismétlődő fejlécű táblázat).
- **Alapdokumentáció:** megszűnt a felesleges **üres oldal** (a Hibajegyzék és az Útmutató között).
  Ok: oldalt megtöltő tábla után a kézi oldaltörés plusz üres oldalt szült Wordben – ezt
  `pageBreakBefore`-ra cseréltük.

## FONTOS – templates mappa
A `templates/` mappában **3** Word-sablonnak kell lennie:
- `60364-6_HUROKIMP.docx`  ✅ (mellékelve)
- `MSZ_HD_60364-6_Alapdok.docx`  ✅ (mellékelve)
- `AVK_JK_2025.docx`  ✅ (mellékelve)

## Indítás (helyi teszt)
```
pip install -r requirements.txt
python server.py 5000
```
Megnyitás: http://127.0.0.1:5000  (telefonról a fekete ablakban kiírt IP-n)

---

# SMARTGuard helyszíni MVP

Ez egy első, böngészőből futó SMARTGuard prototípus. A célja, hogy gyorsan lehessen kipróbálni a helyszíni VBF adatfelvétel, SMARTScore, hibalista és riport logikáját iPad/iPhone jellegű felületen.

## Futtatás

A prototípus jelenleg statikus webapp:

```powershell
cd "C:\Users\nyiki\Documents\Codex\2026-05-22\smartguard-kontextus-tvitel-j-chathez-a\smartguard-mvp"
python -m http.server 4173 --bind 127.0.0.1
```

Megnyitás:

```text
http://127.0.0.1:4173
```

## Mit tud most

- iPad/iPhone-barát helyszíni adatbevitel
- 5 VBF kategória: Hurok, EPH/PE, AVK, Elosztók, Dokumentáció
- automatikus SMARTScore
- A/B/C/D súlyossági logika plafon nélkül
- helyiség alapú hibalista
- ügyfélnek mutatható nagy SMARTScore nézet
- vezetői riport nyomtatása PDF-be a böngésző nyomtatásával
- jegyzőkönyv-generátorhoz előkészített JSON adatcsomag export
- programozás nélkül állítható súlyozás, hibalevonás és minősítési sáv
- új értékelési szempont / kategória hozzáadása az admin felületen
- helyiség törzs kezelése
- automatikus jegyzőkönyv sorszám
- szerkeszthető VBF jegyzőkönyv előnézet
- külön Hurok+EPH, AVK és Elosztó+Dokumentáció jegyzőkönyvi ág
- külön sorszám a három kiküldendő jegyzőkönyvhöz
- AVK típus törzs, választható gyártó/típus mezővel
- elosztónként tételes hibasorok A/B/C/D súlyossággal
- helyi mentés böngészőben
- ugyanazon gépen több böngészőfül között élő frissítés

## Ami a következő körben kell

- Supabase adatbázis és belépés
- valódi több készülék közötti real-time szinkron
- admin jogosultságok a pontozási modellhez
- fotófeltöltés
- hivatalos VBF Word jegyzőkönyv generálása `docxtemplater`-rel
- vezetői PDF generálása szerveren
- ügyfél/telephely/projekt kezelés
