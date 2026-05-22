# SMARTGuard webapp technikai irány

## Javasolt végleges architektúra

- Frontend: Next.js, React, Tailwind
- Backend/adatbázis: Supabase
- Auth: Supabase Auth
- Real-time: Supabase Realtime
- Fotók: Supabase Storage
- Vezetői PDF: HTML sablonból generált PDF
- Hivatalos VBF DOCX: Word sablon + docxtemplater
- Hosting: Vercel

## Alap adatszerkezet

### customers

- id
- name
- billing_address
- contact_name
- contact_email

### sites

- id
- customer_id
- name
- address
- site_type

### inspections

- id
- site_id
- date
- status
- inspector
- smart_score
- qualification
- action_level

### inspection_entries

- id
- inspection_id
- category
- room
- item_name
- status
- severity
- note
- measurement_value
- photo_ids
- created_by
- created_at

### generated_reports

- id
- inspection_id
- type
- file_url
- created_at

## Generálási logika

1. A helyszíni webapp strukturált mérési adatokat ment.
2. A backend összesíti a hibákat kategória, helyiség és súlyosság szerint.
3. A vezetői riport HTML sablonból készül, majd PDF-be exportálódik.
4. A hivatalos VBF jegyzőkönyv a meglévő Word formátumot tartja, docxtemplater mezőkkel.
5. A generált fájlok visszakerülnek a projekthez, letölthető DOCX/PDF formában.

## MVP sorrend

1. Helyszíni adatfelvétel és projektkezelés
2. Supabase real-time több eszközön
3. Hibalista és SMARTScore
4. Vezetői PDF
5. Hivatalos DOCX jegyzőkönyv
6. Fotók és mellékletek
7. Automata árazó
