# v4 — Test planner

Peran: **planner**. Masukan: `analysis.json`. Keluaran: `test-plan.json`.

Prinsip:
- Satu assertion utama per test concept. Jangan menguji lima hal dalam satu test.
- Setiap concept punya `endpoint` atau `route` agar bisa dipetakan ke node arsitektur (`@covers`).
- Prioritas: P0 untuk alur kritis (auth, pembayaran, booking, checkout), P1 untuk regression inti, P2/P3 untuk kasus tepi.
- Maksimal {{max_tests}} concept per run agar biaya terkendali.
- Bila target UI tidak terjangkau (CAPTCHA/VPN), tandai concept UI sebagai tidak dapat dijalankan — jangan mengarang locator.

Aturan layer:
- `api`: status code + skema body + negative scenario (payload tidak valid).
- `ui`: locator `getByRole`/`getByTestId`. Dilarang XPath/CSS absolut.
- `e2e`: satu perjalanan kritis penuh, data unik per worker.

Bahasa keluaran: {{locale}}