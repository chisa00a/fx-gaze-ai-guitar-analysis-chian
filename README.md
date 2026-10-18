# 🎸 FxGaze — AI-Powered Guitar Effect Analyzer

เว็บแอปพลิเคชันสำหรับวิเคราะห์ไฟล์เสียง/สัญญาณสดจากกีตาร์ แยกแยะประเภทเอฟเฟกต์
(Reverb / Delay / Fuzz / ...), สกัดค่าพารามิเตอร์ทางฟิสิกส์ แล้วแสดงผลเป็น
ก้อนเอฟเฟกต์จำลอง (Stompbox) ที่หมุน Knob ให้อัตโนมัติ

> ตรงตามเอกสารข้อกำหนด `requirement.md` เวอร์ชัน 1.0.0 (14 ตุลาคม 2026)

## สถาปัตยกรรม

```
Browser (Next.js 16 + Tailwind + Wavesurfer.js)
   │  อัปโหลด/อัดเสียงสด → FormData (FR-01, FR-02)
   ▼
FastAPI  :8000
   │  POST /api/analyze-tone  → เก็บไฟล์ + เข้าคิว (NFR-02)
   ▼
Celery worker ── Redis broker (ผ่าน docker compose)
   │  Pipeline: [demucs แยกเสียงกีตาร์ (optional, FR-03)]
   │            → librosa สกัดฟีเจอร์ ZCR / RMS / RT60 / Spectral Centroid (FR-04)
   │            → Pathumma 8B ผ่าน Ollama แปลงเป็น JSON (FR-05)
   ▼
GET /api/analyze-tone/{task_id} → Frontend อ่าน JSON สร้าง PedalBox + Knobs (FR-06)
```

**ทั้งหมดรันบนเครื่อง Local (NFR-03)** — ไม่มีการส่งเสียงออก Cloud

## โครงสร้างโปรเจกต์

```
backend/
  app/main.py              FastAPI + CORS + /health
  app/config.py            ตั้งค่าจาก Environment Variables
  app/celery_app.py        Celery + Redis (มี eager fallback เมื่อไม่มี Redis)
  app/api/routes_analyze.py  POST /api/analyze-tone, GET status
  app/tasks/pipeline.py    Celery task: extract → AI (FR-05 pipeline เดียว)
  app/audio/extractor.py   AudioFeatureExtractor: ZCR, RT60/Schroeder, Centroid
  app/audio/stem.py        (Optional) HTDemucs แยกเสียงกีตาร์
  app/ai/pathumma.py       PathummaAnalyzer: System Prompt → strict JSON + fallback
  tests/                   pytest: unit + end-to-end (eager mode)
frontend/
  app/page.tsx             หน้าหลักครบทั้ง 4 ขั้น: นำเข้า → กราฟ → วิเคราะห์ → Stompbox
  components/WaveformPlayer.tsx  Wavesurfer + drag-select ช่วงวิเคราะห์ (FR-02)
  components/RecordButton.tsx    navigator.mediaDevices (อัดสด)
  components/PedalBox.tsx        ก้อนเอฟเฟกต์เปลี่ยนสีตาม effect_type (FR-06)
  components/Knob.tsx            SVG knob ลากหมุน 0-100 หรือหน่วย ms
```

## การติดตั้งและรัน

### 1. Backend

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt     # (Windows)
# .venv/bin/pip install -r backend/requirements.txt       # (Linux/macOS)

# เริ่ม Redis + Celery worker + Ollama (ทางเลือกแบบเต็ม)
docker compose up -d redis
.venv/Scripts/celery -A app.celery_app:app worker -Q fxgaze -c 1 --loglevel=info  # จากโฟลเดอร์ backend/

# เริ่ม API
cd backend && ../.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

> หากไม่มี Redis ระบบจะ fallback รัน task แบบ in-process ทันที (ใช้งานจริง
> สำหรับเดโมได้ แต่ไม่ตอบโจทย์ NFR-02 100%) — กลไกใน `app/celery_app.py`

### 2. Ollama + Pathumma 8B

```bash
ollama pull pathumma-thaillm-8b-think:Q4_K_M
ollama serve   # อยู่ที่ http://127.0.0.1:11434
```

ถ้าโมเดลยังไม่พร้อม ระบบจะใช้ heuristic analyzer แทนโดยอัตโนมัติ
(ผลลัพธ์มี field `source: "fallback"`) เพื่อไม่ให้หน้าเว็บตาย

### 3. Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

### 4. ทดสอบ

```bash
cd backend && ../.venv/Scripts/python -m pytest tests -q       # 7 tests
cd frontend && npm run build                                   # typecheck + build
```

## การรับประกันตามข้อกำหนด (FR/NFR Coverage)

| ข้อ | วิธีที่ระบบทำตาม |
|------|------------------|
| FR-01 | อัปโหลดไฟล์ (.wav/.mp3/.webm) และปุ่ม "อัดเสียงสด" ด้วย MediaRecorder |
| FR-02 | WaveformPlayer (Wavesurfer.js) + ลากเมาส์สร้าง Region เลือกช่วง |
| FR-03 | `app/audio/stem.py` ใช้ HTDemucs เปิดด้วย `FXGAZE_ENABLE_DEMUCS=1` |
| FR-04 | `AudioFeatureExtractor`: ZCR, RMS, RT60 (Schroeder), Spectral Centroid, Echo Similarity |
| FR-05 | `PathummaAnalyzer` สร้าง Thai prompt → JSON ตาม schema {effect_type, parameters, description, advice} |
| FR-06 | `PedalBox` + `Knob` bind จาก JSON: เปลี่ยนสีตาม effect_type, หมุน knob อัตโนมัติ, แสดง advice ด้านล่าง |
| NFR-01 | คลิป ≤15 วิ ผ่าน pipeline Celery + วิเคราะห์ใน one task |
| NFR-02 | สถานะ queued/processing บนหน้าเว็บ + polling ทุก 1.2 วินาที |
| NFR-03 | ทุกการประมวลผลเกิดบน localhost เท่านั้น (CORS localhost, Ollama local) |

## Error Handling (Phase 6)

- อัปโหลดไฟล์เงียบ (สัญญาณพลังงานต่ำมาก) → AI/heuristic ตอบคำแนะนำให้อัดใหม่
- ไฟล์ชนิดที่ไม่รองรับ → HTTP 415; ไฟล์ใหญ่เกิน → 413; ไฟล์ว่าง → 400
- โมเดลออฟไลน์ → heuristic fallback (ไม่พัง, แจ้ง `source: fallback`)
- Task ล้มเหลว → สถานะ `failed` พร้อมข้อความที่ผู้ใช้อ่านได้
