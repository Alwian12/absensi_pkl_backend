const express = require('express');
const { pool } = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const upload = require('../config/upload');
const fs = require('fs');

const router = express.Router();

// Get today's attendance status
router.get('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    
    const [rows] = await pool.query(
      'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );
    
    if (rows.length === 0) {
      return res.json({
        hasCheckedIn: false,
        hasCheckedOut: false,
        statusCheckIn: null,
        statusCheckOut: null,
        checkInTime: null,
        checkOutTime: null,
        fotoCheckIn: null,
        fotoCheckOut: null
      });
    }
    
    const record = rows[0];
    // For izin status, check_in is NULL but should count as hasCheckedIn = true
    const isIzin = record.status_check_in === 'izin';
    
    // Get izin details if status is izin
    let izinDetail = null;
    if (isIzin) {
      const [izinRows] = await pool.query(
        `SELECT jenis, alasan, tanggal_mulai, tanggal_selesai FROM izin 
         WHERE user_id = ? AND status = 'disetujui' AND ? BETWEEN tanggal_mulai AND tanggal_selesai
         ORDER BY created_at DESC LIMIT 1`,
        [userId, today]
      );
      if (izinRows.length > 0) {
        izinDetail = {
          jenis: izinRows[0].jenis,
          alasan: izinRows[0].alasan,
          tanggal_mulai: izinRows[0].tanggal_mulai,
          tanggal_selesai: izinRows[0].tanggal_selesai
        };
      }
    }
    
    res.json({
      hasCheckedIn: !!record.check_in || isIzin,
      hasCheckedOut: !!record.check_out || isIzin,
      statusCheckIn: record.status_check_in,
      statusCheckOut: record.status_check_out,
      checkInTime: record.check_in ? record.check_in.slice(0, 8) : null,
      checkOutTime: record.check_out ? record.check_out.slice(0, 8) : null,
      fotoCheckIn: record.foto_check_in,
      fotoCheckOut: record.foto_check_out,
      isIzin: isIzin,
      izinDetail: izinDetail
    });
  } catch (error) {
    console.error('Get today status error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get office location
router.get('/office-location', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM unit_kantor LIMIT 1');
    
    if (rows.length === 0) {
      return res.json({
        latitude: 3.286916,
        longitude: 99.369089,
        radius: 100,
        address: 'Kantor Diskominfo'
      });
    }
    
    const kantor = rows[0];
    res.json({
      latitude: kantor.latitude,
      longitude: kantor.longitude,
      radius: kantor.radius || 100,
      address: kantor.nama_unit || 'Kantor Diskominfo'
    });
  } catch (error) {
    console.error('Error:', error);
    res.json({
      latitude: 3.286916,
      longitude: 99.369089,
      radius: 100,
      address: 'Kantor Diskominfo'
    });
  }
});

// Check-in with photo
router.post('/checkin', verifyToken, upload.uploadAttendancePhoto.single('foto'), async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    
    // Validate coordinates
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Koordinat lokasi tidak valid' });
    }
    
    // Get foto path if uploaded
    const fotoPath = req.file ? `/uploads/absensi/${req.file.filename}` : null;
    
    // Check existing record
    const [existingRows] = await pool.query(
      'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );
    
    if (existingRows.length > 0) {
      const record = existingRows[0];
      // CRITICAL: Check if user is on izin - BLOCK ALL CHECKIN ATTEMPTS
      if (record.status_check_in === 'izin') {
        return res.status(403).json({ 
          message: 'Anda sedang izin hari ini. Tidak perlu absen.',
          status: 'izin',
          blocked: true
        });
      }
      if (record.check_in) {
        return res.status(400).json({ message: 'Anda sudah check-in hari ini' });
      }
    }
    
    // Get office location
    const [kantorRows] = await pool.query('SELECT * FROM unit_kantor LIMIT 1');
    const kantor = kantorRows[0] || { latitude: 3.286916, longitude: 99.369089, radius: 100 };
    
    // Calculate distance using validated coordinates
    const distance = calculateDistance(lat, lng, kantor.latitude, kantor.longitude);
    
    if (distance > kantor.radius) {
      return res.status(400).json({ message: 'Anda di luar radius kantor' });
    }
    
    // Check time
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);
    const lateTime = '09:00:00';
    
    let statusCheckIn;
    if (currentTime <= lateTime) {
      statusCheckIn = 'tepat_waktu';
    } else {
      statusCheckIn = 'terlambat';
    }
    
    const checkInTime = now.toTimeString().slice(0, 8);
    
    // Insert or update with foto
    if (existingRows.length > 0) {
      await pool.query(
        'UPDATE absensi SET check_in = ?, status_check_in = ?, lat_check_in = ?, lng_check_in = ?, foto_check_in = ? WHERE id = ?',
        [checkInTime, statusCheckIn, lat, lng, fotoPath, existingRows[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO absensi (user_id, tanggal, check_in, lat_check_in, lng_check_in, status_check_in, status_check_out, foto_check_in) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
        [userId, today, checkInTime, lat, lng, statusCheckIn, fotoPath]
      );
    }
    
    res.json({
      message: 'Check-in berhasil',
      status: statusCheckIn,
      checkInTime: checkInTime,
      foto: fotoPath
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// Check-out with photo
router.post('/checkout', verifyToken, upload.uploadAttendancePhoto.single('foto'), async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    
    // Validate coordinates
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Koordinat lokasi tidak valid' });
    }
    
    // Get foto path if uploaded
    const fotoPath = req.file ? `/uploads/absensi/${req.file.filename}` : null;
    
    // Check existing record
    const [existingRows] = await pool.query(
      'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );
    
    // If no record at all
    if (existingRows.length === 0) {
      return res.status(400).json({ message: 'Anda belum check-in hari ini' });
    }
    
    const record = existingRows[0];
    
    // CRITICAL: Check if user is on izin - BLOCK ALL CHECKOUT ATTEMPTS
    if (record.status_check_in === 'izin') {
      return res.status(403).json({ 
        message: 'Anda sedang izin hari ini. Tidak perlu check-out.',
        status: 'izin',
        blocked: true
      });
    }
    
    // Check if already checked out
    if (record.check_out) {
      return res.status(400).json({ message: 'Anda sudah check-out hari ini' });
    }
    
    // Check if never checked in (and not izin)
    if (!record.check_in) {
      return res.status(400).json({ message: 'Anda belum check-in hari ini' });
    }
    
    // Get office location
    const [kantorRows] = await pool.query('SELECT * FROM unit_kantor LIMIT 1');
    const kantor = kantorRows[0] || { latitude: 3.286916, longitude: 99.369089, radius: 100 };
    
    // Calculate distance using validated coordinates
    const distance = calculateDistance(lat, lng, kantor.latitude, kantor.longitude);
    
    if (distance > kantor.radius) {
      return res.status(400).json({ message: 'Anda di luar radius kantor' });
    }
    
    // Check time
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);
    const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri
    const endTime = dayOfWeek === 5 ? '15:00:00' : '16:30:00';
    
    // Check if trying to check out before end time without izin
    if (currentTime < endTime) {
      // Check if user has approved early leave izin OR already has pulang_cepat_izin status
      const hasEarlyLeaveStatus = record.status_check_out === 'pulang_cepat_izin';
      
      if (!hasEarlyLeaveStatus) {
        const [earlyLeaveIzin] = await pool.query(
          `SELECT id FROM izin 
           WHERE user_id = ? 
           AND ? BETWEEN tanggal_mulai AND tanggal_selesai
           AND jenis = 'pulang_cepat'
           AND status = 'disetujui'`,
          [userId, today]
        );
        
        if (earlyLeaveIzin.length === 0) {
          return res.status(403).json({
            message: `Anda tidak bisa check-out sebelum jam ${dayOfWeek === 5 ? '15:00' : '16:30'} tanpa izin pulang cepat. Silakan ajukan izin terlebih dahulu.`,
            required: 'izin_pulang_cepat',
            blocked: true
          });
        }
      }
    }
    
    let statusCheckOut;
    if (currentTime >= endTime) {
      statusCheckOut = 'tepat_waktu';
    } else {
      statusCheckOut = 'pulang_cepat';
    }
    
    const checkOutTime = now.toTimeString().slice(0, 8);
    
    // Update record
    await pool.query(
      'UPDATE absensi SET check_out = ?, status_check_out = ?, lat_check_out = ?, lng_check_out = ?, foto_check_out = ? WHERE id = ?',
      [checkOutTime, statusCheckOut, lat, lng, fotoPath, record.id]
    );
    
    res.json({
      message: 'Check-out berhasil',
      status: statusCheckOut,
      checkOutTime: checkOutTime,
      foto: fotoPath
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get user attendance history
router.get('/history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 100;
    
    const [rows] = await pool.query(
      `SELECT * FROM absensi 
       WHERE user_id = ? 
       ORDER BY tanggal DESC 
       LIMIT ?`,
      [userId, limit]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get user attendance statistics
router.get('/statistics', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    
    // Monthly statistics
    const [monthlyStats] = await pool.query(
      `SELECT 
        COUNT(*) as totalHari,
        SUM(CASE WHEN status_check_in = 'tepat_waktu' THEN 1 ELSE 0 END) as hadir,
        SUM(CASE WHEN status_check_in = 'terlambat' THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN status_check_in = 'izin' THEN 1 ELSE 0 END) as izin,
        SUM(CASE WHEN status_check_in = 'tidak_hadir' THEN 1 ELSE 0 END) as alpha,
        SUM(CASE WHEN status_check_out IN ('pulang_cepat', 'pulang_cepat_izin') THEN 1 ELSE 0 END) as pulangCepat
       FROM absensi 
       WHERE user_id = ? 
       AND MONTH(tanggal) = MONTH(CURRENT_DATE())
       AND YEAR(tanggal) = YEAR(CURRENT_DATE())`,
      [userId]
    );
    
    // Izin statistics (sakit, total)
    const [izinStats] = await pool.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN jenis = 'sakit' THEN 1 ELSE 0 END) as sakit,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
       FROM izin 
       WHERE user_id = ? 
       AND MONTH(tanggal_mulai) = MONTH(CURRENT_DATE())
       AND YEAR(tanggal_mulai) = YEAR(CURRENT_DATE())`,
      [userId]
    );
    
    // Calculate percentage
    const hadir = monthlyStats[0]?.hadir || 0;
    const alpha = monthlyStats[0]?.alpha || 0;
    const izin = monthlyStats[0]?.izin || 0;
    const terlambat = monthlyStats[0]?.terlambat || 0;
    const totalWorkingDays = hadir + alpha + izin + terlambat;
    const kehadiranPercentage = totalWorkingDays > 0 
      ? Math.round(((hadir + izin) / totalWorkingDays) * 100) 
      : 0;
    
    // Today's status
    const [todayRow] = await pool.query(
      'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );
    
    res.json({
      monthly: {
        hadir,
        alpha,
        terlambat,
        izin,
        pulangCepat: monthlyStats[0]?.pulangCepat || 0,
        kehadiranPercentage
      },
      izin: {
        total: izinStats[0]?.total || 0,
        sakit: izinStats[0]?.sakit || 0,
        pending: izinStats[0]?.pending || 0
      },
      today: todayRow[0] || null
    });
  } catch (error) {
    console.error('Get statistics error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
