# FIX SISTEM FOTO ABSENSI LENGKAP

## MASALAH:
Database menyimpan BASE64 string bukan FILE PATH

## SOLUSI:

### 1. BACKEND - Pastikan Simpan Path File

File: `backend/routes/absensi.js`

Tambahkan logging untuk debug:

```javascript
// Check-in route (sekitar line 84-120)
router.post('/checkin', verifyToken, upload.uploadAttendancePhoto.single('foto'), async (req, res) => {
  try {
    console.log('=== CHECK-IN DEBUG ===');
    console.log('req.file:', req.file);
    console.log('req.body:', req.body);
    
    const fotoPath = req.file ? `/uploads/absensi/${req.file.filename}` : null;
    console.log('fotoPath yang akan disimpan:', fotoPath);
    
    // ... rest of code
  } catch (error) {
    console.error('Check-in error:', error);
  }
});

// Check-out route (sekitar line 168-210)
router.post('/checkout', verifyToken, upload.uploadAttendancePhoto.single('foto'), async (req, res) => {
  try {
    console.log('=== CHECK-OUT DEBUG ===');
    console.log('req.file:', req.file);
    console.log('req.body:', req.body);
    
    const fotoPath = req.file ? `/uploads/absensi/${req.file.filename}` : null;
    console.log('fotoPath yang akan disimpan:', fotoPath);
    
    // ... rest of code
  } catch (error) {
    console.error('Check-out error:', error);
  }
});
```

### 2. FRONTEND - Pastikan Kirim File Bukan Base64

File: `frontend/src/pages/Absen.jsx`

```javascript
// handleCheckIn - konversi base64 ke File
const handleCheckIn = async () => {
  if (!capturedPhoto) {
    setMessage({ type: 'error', text: 'Silakan ambil foto terlebih dahulu' });
    return;
  }

  try {
    setLoading(true);
    const position = await getCurrentPosition();

    // Convert base64 to blob dan create file
    const base64Response = await fetch(capturedPhoto);
    const blob = await base64Response.blob();
    const file = new File([blob], `checkin-${Date.now()}.jpg`, { type: 'image/jpeg' });

    // Create FormData dan append file
    const formData = new FormData();
    formData.append('foto', file);  // WAJIB nama field 'foto'
    formData.append('latitude', position.lat);
    formData.append('longitude', position.lng);

    console.log('=== SENDING CHECK-IN ===');
    console.log('FormData foto:', formData.get('foto'));

    const response = await api.post('/absensi/checkin', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    // ... rest of code
  } catch (error) {
    console.error('Check-in error:', error);
    setMessage({ type: 'error', text: error.response?.data?.message || 'Gagal check-in' });
  } finally {
    setLoading(false);
  }
};

// handleCheckOut - sama seperti check-in
const handleCheckOut = async () => {
  if (!capturedPhoto) {
    setMessage({ type: 'error', text: 'Silakan ambil foto terlebih dahulu' });
    return;
  }

  try {
    setLoading(true);
    const position = await getCurrentPosition();

    // Convert base64 to file
    const base64Response = await fetch(capturedPhoto);
    const blob = await base64Response.blob();
    const file = new File([blob], `checkout-${Date.now()}.jpg`, { type: 'image/jpeg' });

    const formData = new FormData();
    formData.append('foto', file);
    formData.append('latitude', position.lat);
    formData.append('longitude', position.lng);

    console.log('=== SENDING CHECK-OUT ===');
    console.log('FormData foto:', formData.get('foto'));

    const response = await api.post('/absensi/checkout', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    // ... rest of code
  } catch (error) {
    console.error('Check-out error:', error);
    setMessage({ type: 'error', text: error.response?.data?.message || 'Gagal check-out' });
  } finally {
    setLoading(false);
  }
};
```

### 3. SQL - Fix Data Lama (Base64 → NULL)

Jalankan di phpMyAdmin untuk membersihkan data base64 lama:

```sql
-- Cek data base64 yang tersimpan
SELECT id, nama, tanggal, 
  LEFT(foto_check_in, 30) as foto_in_preview,
  LEFT(foto_check_out, 30) as foto_out_preview
FROM absensi 
WHERE foto_check_in LIKE 'data:%' OR foto_check_out LIKE 'data:%';

-- Hapus data base64 (set NULL untuk data lama)
UPDATE absensi 
SET foto_check_in = NULL 
WHERE foto_check_in LIKE 'data:%';

UPDATE absensi 
SET foto_check_out = NULL 
WHERE foto_check_out LIKE 'data:%';

-- Verifikasi
SELECT id, tanggal, foto_check_in, foto_check_out 
FROM absensi 
WHERE foto_check_in IS NOT NULL OR foto_check_out IS NOT NULL;
```

### 4. Cek Folder Uploads

Pastikan folder ada dan writable:
```bash
# Windows CMD
cd C:\laragon\www\absensi-pkl\backend
mkdir uploads\absensi 2>nul
dir uploads\absensi
```

### 5. Test Flow Lengkap

1. User check-in dengan foto
2. Cek console backend: `req.file` harus ada object
3. Cek database: `foto_check_in` harus berisi path seperti `/uploads/absensi/absen-123-456.jpg`
4. Cek folder: file harus tercreate di `uploads/absensi/`
5. Admin buka halaman Foto Absen: gambar harus muncul

## TROUBLESHOOTING

### Kalau req.file undefined:
- Pastikan frontend kirim FormData dengan `foto` field
- Pastikan header `Content-Type: multipart/form-data`
- Pastikan multer middleware aktif

### Kalau file tersimpan tapi path tidak masuk database:
- Cek query INSERT/UPDATE di backend
- Pastikan `fotoPath` variabel digunakan di query

### Kalau path masuk tapi foto tidak muncul:
- Cek `uploads/absensi/` folder
- Cek static file serving di server.js: `app.use('/uploads', express.static('uploads'))`
- Cek frontend URL construction

## HASIL YANG DIHARAPKAN

```javascript
// Database record:
{
  id: 1,
  user_id: 5,
  tanggal: '2026-04-21',
  check_in: '08:30:00',
  foto_check_in: '/uploads/absensi/absen-5-1713690123456.jpg',  // PATH BUKAN BASE64
  check_out: '17:00:00',
  foto_check_out: '/uploads/absensi/absen-5-1713696543210.jpg'   // PATH BUKAN BASE64
}
```
