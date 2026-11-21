# โครงสร้าง MarAct ตามหน้าที่ของผลิตภัณฑ์

สถานะ: นำมาใช้แทนการแบ่งโมดูลตาม idea ใน ADR 0001 และ 0002

MarAct มีหนึ่ง storefront และหนึ่ง checkout ผู้ซื้อใช้ได้ทั้งผ่านหน้าตลาดและแชต ให้ทั้งสองช่องทางเรียกกฎสต็อก ราคา และค่าขนส่งชุดเดียวกัน คง React/Vite, FastAPI, PostgreSQL และการ deploy เป็น container เดียว

```text
frontend/
  src/app/                    routing และ entry point
  src/features/marketplace/   ค้นหา เปรียบเทียบ ตะกร้า และ checkout
  src/features/copilot/       แชต tool trace และ trend citations
  src/shared/                 HTTP client และ UI ที่หลาย feature ใช้
  src/legacy/                 หน้าสาธิต records และ workspace เดิม
  tests/e2e/                  buyer journey ข้าม feature และ legacy redirects
backend/
  src/app/                    FastAPI app, router mounts และ health checks
  src/modules/marketplace/    catalog, buyer sessions, quotes และ orders
  src/modules/copilot/        intent, orchestration, trends, MCP และ agent skills
  src/shared/                 DB pool และโค้ดกลาง
  src/legacy/                 handlers และ fixtures สำหรับสัญญาเดิม
  tests/                      integration tests แยกตาม marketplace, copilot และ legacy
  db/migrations/              migration history ต่อเนื่อง
  db/seeds/                   ข้อมูลเดโมแยกตามโดเมน
infra/                        วิธี release และ rollback บน GCP
.github/workflows/            CI และ manual deploy
```

## ขอบเขตการเรียกใช้

Copilot เรียก catalog และ quote ของ marketplace ด้วย lot ID จากฐานข้อมูล โมดูล marketplace ทำงานได้เมื่อปิด OpenAI และ MCP ผู้ซื้อเป็นผู้ยืนยัน checkout หน้าจอแชตรับ callback สำหรับนำข้อเสนอไปเข้าตะกร้า และใช้ชนิดข้อมูล Lot จากสัญญาของ marketplace

## ลำดับการย้าย

1. เปลี่ยน CI เป็น jobs `backend`, `frontend` และ `e2e` รัน pytest แบบเต็ม, lint/typecheck/build และ Playwright ตามลำดับ เก็บ `ci` เป็น required check เดิม ตรวจว่าการรันพบเทสต์ครบก่อนถอด scripts ที่สร้าง matrix จากชื่อโฟลเดอร์
2. ย้ายหน้าจอและเทสต์จาก `frontend/src/ideas` เข้าปลายทางตามตารางหน้าที่ด้านบน ย้าย shared types ออกจาก screen ย้าย registry เดิมไปยัง legacy routing และลบโฟลเดอร์ `ideas` ตรวจลิงก์เดิมทั้ง query, hash และตะกร้าหลัง reload
3. ย้าย orchestration, trend tools และ agent skills จาก `idea_b` และ marketplace เข้าสู่ copilot แยกข้อมูลจำลองของ workspace ไว้กับ legacy ย้ายเทสต์จาก `idea_c` ไป marketplace ปรับทั้ง Python imports, MCP subprocess module path, pytest discovery และ helper ที่ Playwright ใช้สร้างล็อต
4. ย้าย seed ไปตามโดเมน อัปเดต Makefile, README และ AGENTS.md พร้อมกัน ทดสอบ initial setup บน DB ว่างและ upgrade จาก DB ที่มีออเดอร์แล้ว เก็บ migration ที่เคย apply ไว้ตามเดิม
5. คง URL และ API เดิมระหว่างย้ายไฟล์ การเปลี่ยน public API prefix เป็นงานแยกที่ต้องรองรับทั้ง session cookie path, logout และผู้ใช้ที่มีตะกร้าค้างอยู่

เกณฑ์จบคือ source และ CI ใช้ชื่อหน้าที่ผลิตภัณฑ์ ทีมรันเทสต์ครบได้จาก clean checkout และผู้ซื้อทำเส้นทางค้นหา → แชต → ตรวจราคา → ตะกร้า → ยืนยันคำสั่งซื้อได้บน container ที่จะ deploy
