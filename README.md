# Waymark Mobile (Flutter)

A cross-platform outdoor trail tracker client built with Flutter. Supports native GPX file parsing, active GPS background location streaming, and live connection to the Waymark tracking server.

---

## 🏃 Fitur Mobile
- **Pick GPX File**: Buka dan parsing file rute `.gpx` lokal dengan penghitungan otomatis jarak (Haversine km) dan elevasi.
- **Sample GPX Route**: Terintegrasi contoh rute Gunung Rinjani untuk testing instan.
- **Live GPS Tracking**: Penguncian GPS instan via `geolocator` beserta streaming interval berkala (4 detik) dan reporting persentase baterai (`battery_plus`).
- **Support Android, iOS, & Chrome**: Dapat dijalankan di perangkat fisik Android/iOS, emulator, atau langsung di Google Chrome untuk pengujian cepat.

---

## 🚀 Cara Menjalankan

### Menjalankan di Chrome (Pengujian Cepat)
```bash
flutter run -d chrome --web-port=3001
```

### Menjalankan di Android
```bash
flutter run -d android
```

---

## ⚙️ Konfigurasi URL Backend
Secara default:
- Di **Chrome / Desktop**: otomatis menghubungkan ke `http://localhost:3000`.
- Di **Android Emulator**: otomatis menghubungkan ke `http://10.0.2.2:3000`.
- Di **Perangkat Fisik / Production**: jalankan dengan flag environment:
  ```bash
  flutter run --dart-define=WAYMARK_API_URL=https://nama-web-anda.vercel.app
  ```

---

## 🧪 Testing
```bash
flutter test
```
