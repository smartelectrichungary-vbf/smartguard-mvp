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
