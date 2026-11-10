# Waymark Web (Next.js 15)

Live outdoor trail tracking web application and REST API built with Next.js 15 (App Router), MapLibre GL, and Supabase.

---

## 🚀 Fitur Utama
- **Live Trail Viewer**: Map interaktif berbasis MapLibre GL dengan rendering rute resmi GPX (Oranye `#FF6B00`) dan jalur yang sudah dilalui pelari (Hijau `#10B981`).
- **Pulsing Runner Marker**: Marker dinamis dengan animasi denyut yang memusatkan posisi terkini pelari secara otomatis.
- **REST Tracking API**:
  - `POST /api/tracking/start`: Memulai sesi lari baru dan mengembalikan `shareToken`.
  - `POST /api/tracking/location`: Menerima update koordinat GPS, akurasi, dan baterai dari mobile client.
  - `GET /api/tracking/[token]`: Mengambil status sesi, seluruh riwayat lokasi, dan rute GPX.
- **Supabase Persistence**: Penyimpanan permanen data sesi lari dan titik GPS dengan in-memory fallback otomatis.

---

## 🛠️ Instalasi & Menjalankan Lokal

```bash
# 1. Install dependencies
npm install

# 2. Siapkan file .env.local (salin dari .env.example)
cp .env.example .env.local

# 3. Jalankan development server
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser.

---

## ☁️ Deployment ke Vercel

Folder ini sudah **100% standalone** dan siap di-push ke GitHub untuk di-deploy ke Vercel:

1. Buat repository baru di GitHub (misal: `waymark-web`).
2. Di folder `waymark-web`:
   ```bash
   git init -b main
   git add .
   git commit -m "feat: initial waymark web project"
   git remote add origin https://github.com/<username>/waymark-web.git
   git push -u origin main
   ```
3. Buka dashboard [Vercel](https://vercel.com) -> **Add New Project** -> Pilih repo `waymark-web`.
4. Masukkan **Environment Variables** di Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`: URL project Supabase Anda
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Publishable key Supabase
   - `SUPABASE_SERVICE_ROLE_KEY`: Secret service role key Supabase
5. Klik **Deploy**! Selesai.

---

## 🗄️ Database Supabase
Skrip skema tabel tersedia di [`supabase/migrations/202611100001_initial_tracking.sql`](./supabase/migrations/202611100001_initial_tracking.sql). Salin dan jalankan di SQL Editor dashboard Supabase Anda.
