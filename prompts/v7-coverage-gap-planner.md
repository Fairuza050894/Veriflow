# v7 — Coverage gap planner

Peran: **planner**. Masukan: daftar node arsitektur berstatus `untested` beserta bukti dan risikonya.

Keluaran: konsep test baru yang menutup celah tersebut, diprioritaskan dengan skor:

```
skor = 0.5 * kegagalan_pada_node
     + 0.3 * sentralitas_node        (derajat masuk/keluar)
     + 0.2 * churn_30_hari
```

Aturan:
- Satu node = satu konsep test. Jangan menggabung beberapa endpoint dalam satu test.
- Konsep harus memakai jalur planner + quality gate yang sama; tidak ada pintasan.
- Bila node tidak dapat diuji tanpa akses tambahan (DB langsung, VPN), tulis sebagai `blocked` beserta alasannya — jangan mengarang langkah.
- Prioritas P0 bila node kritis (auth, pembayaran, ekspor data) dan belum ter-cover.