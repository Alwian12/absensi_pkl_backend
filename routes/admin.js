const express = require('express');
const { pool } = require('../config/database');
const { verifyAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { uploadAdminTTD, handleUploadError } = require('../config/upload');
const { sendIzinApprovalEmail, sendIzinRejectionEmail } = require('../utils/notificationEmails');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Dashboard statistics
router.get('/dashboard', verifyAdmin, async (req, res) => {
  try {
    // Total peserta
    const [totalPeserta] = await pool.query(
      'SELECT COUNT(*) as total FROM users_pkl WHERE status = "aktif"'
    );
    
    // Get today's attendance statistics
    const today = new Date().toISOString().split('T')[0];
    
    const [todayStats] = await pool.query(
      `SELECT 
        COUNT(DISTINCT CASE WHEN check_in IS NOT NULL THEN user_id END) as hadir,
        COUNT(DISTINCT CASE WHEN status_check_in = 'terlambat' THEN user_id END) as terlambat,
        COUNT(DISTINCT CASE WHEN status_check_in = 'tepat_waktu' THEN user_id END) as tepatWaktu
       FROM absensi 
       WHERE tanggal = ?`,
      [today]
    );

    // Count izin untuk hari ini (cek apakah today ada dalam range tanggal_mulai - tanggal_selesai)
    const [izinStats] = await pool.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'disetujui' THEN 1 ELSE 0 END) as disetujui
       FROM izin 
       WHERE ? BETWEEN tanggal_mulai AND tanggal_selesai`,
      [today]
    );

    // Count total active peserta and those who haven't checked in (Alpha = tidak absen dan tidak izin)
    const [tidakHadirStats] = await pool.query(
      `SELECT COUNT(*) as total,
              GROUP_CONCAT(u.nama) as alpha_names
       FROM users_pkl u
       WHERE u.status = 'aktif'
       AND u.id NOT IN (
         SELECT DISTINCT user_id FROM absensi WHERE tanggal = ? AND check_in IS NOT NULL
       )
       AND u.id NOT IN (
         SELECT DISTINCT user_id FROM izin 
         WHERE ? BETWEEN tanggal_mulai AND tanggal_selesai 
         AND status = 'disetujui'
       )`,
      [today, today]
    );
    
    // Debug logging
    console.log(`[DEBUG] Dashboard ${today}:`, {
      totalPeserta: totalPeserta[0]?.total,
      hadir: todayStats[0]?.hadir,
      terlambat: todayStats[0]?.terlambat,
      izinDisetujui: izinStats[0]?.disetujui,
      alpha: tidakHadirStats[0]?.total,
      alphaNames: tidakHadirStats[0]?.alpha_names
    });

    
    // Weekly attendance data for chart
    const [weeklyData] = await pool.query(
      `SELECT 
        DATE_FORMAT(dates.tanggal, '%Y-%m-%d') as tanggal,
        COUNT(DISTINCT CASE WHEN a.check_in IS NOT NULL THEN a.user_id END) as hadir,
        COUNT(DISTINCT CASE WHEN a.status_check_in = 'terlambat' THEN a.user_id END) as terlambat,
        COUNT(DISTINCT CASE WHEN i.status = 'disetujui' THEN i.user_id END) as izin
       FROM (SELECT CURDATE() - INTERVAL n DAY as tanggal 
             FROM (SELECT 0 as n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 
                   UNION SELECT 4 UNION SELECT 5 UNION SELECT 6) nums) dates
       LEFT JOIN absensi a ON dates.tanggal = a.tanggal
       LEFT JOIN users_pkl u ON a.user_id = u.id
       LEFT JOIN izin i ON dates.tanggal BETWEEN i.tanggal_mulai AND i.tanggal_selesai 
                         AND i.status = 'disetujui' AND i.user_id = u.id
       WHERE dates.tanggal >= CURDATE() - INTERVAL 6 DAY
       GROUP BY dates.tanggal
       ORDER BY dates.tanggal`
    );
    
    res.json({
      statistics: {
        totalPeserta: totalPeserta[0]?.total || 0,
        hadirHariIni: todayStats[0]?.hadir || 0,
        terlambat: todayStats[0]?.terlambat || 0,
        izinPending: izinStats[0]?.pending || 0,
        izinDisetujui: izinStats[0]?.disetujui || 0,
        tidakHadirHariIni: tidakHadirStats[0]?.total || 0
      },
      weeklyChart: weeklyData
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get all peserta
router.get('/peserta', verifyAdmin, async (req, res) => {
  try {
    console.log('[DEBUG] Fetching peserta...');
    
    const [rows] = await pool.query(
      `SELECT id, nama, email, asal_sekolah, jurusan, 
              tanggal_mulai, tanggal_selesai, status, created_at 
       FROM users_pkl 
       ORDER BY created_at DESC`
    );
    
    console.log('[DEBUG] Peserta rows:', rows.length);
    if (rows.length > 0) {
      console.log('[DEBUG] Sample peserta:', rows[0]);
    }
    
    res.json(rows);
  } catch (error) {
    console.error('Get peserta error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Add new peserta
router.post('/peserta', verifyAdmin, async (req, res) => {
  try {
    const { nama, email, password, asal_sekolah, jurusan, tanggal_mulai, tanggal_selesai } = req.body;
    
    if (!nama || !password) {
      return res.status(400).json({ message: 'Nama dan password wajib diisi' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [result] = await pool.query(
      `INSERT INTO users_pkl (nama, email, password, asal_sekolah, jurusan, 
                             tanggal_mulai, tanggal_selesai) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nama, email, hashedPassword, asal_sekolah, jurusan, tanggal_mulai, tanggal_selesai]
    );
    
    res.json({ 
      message: 'Peserta berhasil ditambahkan',
      id: result.insertId
    });
  } catch (error) {
    console.error('Add peserta error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sql: error.sql,
      sqlState: error.sqlState
    });
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Email sudah terdaftar' });
    }
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Update peserta
router.put('/peserta/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, email, asal_sekolah, jurusan, tanggal_mulai, tanggal_selesai, status, password } = req.body;
    
    // Build update query dynamically
    let updateFields = [];
    let params = [];
    
    if (nama !== undefined) {
      updateFields.push('nama = ?');
      params.push(nama);
    }
    if (email !== undefined) {
      updateFields.push('email = ?');
      params.push(email);
    }
    if (asal_sekolah !== undefined) {
      updateFields.push('asal_sekolah = ?');
      params.push(asal_sekolah);
    }
    if (jurusan !== undefined) {
      updateFields.push('jurusan = ?');
      params.push(jurusan);
    }
    if (tanggal_mulai !== undefined) {
      updateFields.push('tanggal_mulai = ?');
      params.push(tanggal_mulai);
    }
    if (tanggal_selesai !== undefined) {
      updateFields.push('tanggal_selesai = ?');
      params.push(tanggal_selesai);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      params.push(status);
    }
    
    // Handle password update
    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password minimal 6 karakter' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push('password = ?');
      params.push(hashedPassword);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'Tidak ada data yang diupdate' });
    }
    
    params.push(id);
    
    const query = `UPDATE users_pkl SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, params);
    
    res.json({ 
      message: 'Peserta berhasil diperbarui',
      updatedFields: updateFields.length
    });
  } catch (error) {
    console.error('Update peserta error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sql: error.sql,
      sqlState: error.sqlState
    });
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Reset password peserta (admin only)
router.post('/peserta/:id/reset-password', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password baru wajib diisi (minimal 6 karakter)' });
    }
    
    // Check if user exists
    const [userRows] = await pool.query(
      'SELECT id, nama FROM users_pkl WHERE id = ?',
      [id]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ message: 'Peserta tidak ditemukan' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await pool.query(
      'UPDATE users_pkl SET password = ? WHERE id = ?',
      [hashedPassword, id]
    );
    
    res.json({ 
      message: `Password untuk ${userRows[0].nama} berhasil direset`,
      userId: id,
      userName: userRows[0].nama
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Delete peserta
router.delete('/peserta/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Delete related records first (to avoid foreign key constraint errors)
      await connection.query('DELETE FROM absensi WHERE user_id = ?', [id]);
      await connection.query('DELETE FROM jurnal WHERE user_id = ?', [id]);
      await connection.query('DELETE FROM izin WHERE user_id = ?', [id]);
      
      // Now delete the user
      await connection.query('DELETE FROM users_pkl WHERE id = ?', [id]);
      
      await connection.commit();
      connection.release();
      
      res.json({ message: 'Peserta berhasil dihapus' });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (error) {
    console.error('Delete peserta error:', error);
    res.status(500).json({ message: 'Gagal menghapus peserta: ' + error.message });
  }
});

// Get all absensi with filter
router.get('/absensi', verifyAdmin, async (req, res) => {
  try {
    const { tanggal, user_id, bulan, tahun } = req.query;
    
    console.log('[DEBUG] Absensi query params:', { tanggal, user_id, bulan, tahun });
    
    // Use LEFT JOIN to show absensi even if user was deleted
    let query = `
      SELECT a.*, u.nama as nama_peserta, u.asal_sekolah 
      FROM absensi a 
      LEFT JOIN users_pkl u ON a.user_id = u.id 
      WHERE 1=1
    `;
    const params = [];
    
    if (tanggal) {
      query += ' AND a.tanggal = ?';
      params.push(tanggal);
    }
    
    if (user_id) {
      query += ' AND a.user_id = ?';
      params.push(user_id);
    }
    
    if (bulan && tahun) {
      query += ' AND MONTH(a.tanggal) = ? AND YEAR(a.tanggal) = ?';
      params.push(parseInt(bulan), parseInt(tahun));
    }
    
    query += ' ORDER BY a.tanggal DESC, a.check_in DESC';
    
    console.log('[DEBUG] Final query:', query);
    console.log('[DEBUG] Query params:', params);
    
    const [rows] = await pool.query(query, params);
    console.log('[DEBUG] Result rows:', rows.length);
    
    // Show sample data if any
    if (rows.length > 0) {
      console.log('[DEBUG] Sample row:', rows[0]);
    }
    
    res.json(rows);
  } catch (error) {
    console.error('Get absensi error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update absensi (admin only) - untuk mengubah data absen jika hari libur atau koreksi
// AUTO-CALCULATE: Status check_in otomatis dihitung berdasarkan jam:
// - <= 09:00:00 = tepat_waktu
// - > 09:00:00 = terlambat
router.put('/absensi/:id', verifyAdmin, async (req, res) => {
  try {
    const absensiId = req.params.id;
    const { check_in, check_out, status_check_in, status_check_out, keterangan } = req.body;
    
    // DEBUG logging
    console.log('[DEBUG ADMIN EDIT] Request body:', req.body);
    console.log('[DEBUG ADMIN EDIT] check_in value:', check_in, 'type:', typeof check_in);
    
    // Get existing data
    const [existingRows] = await pool.query(
      'SELECT * FROM absensi WHERE id = ?',
      [absensiId]
    );
    
    if (existingRows.length === 0) {
      return res.status(404).json({ message: 'Data absensi tidak ditemukan' });
    }
    
    const existing = existingRows[0];
    
    // Build update query
    let updateFields = [];
    let params = [];
    let autoCalculatedStatus = null;
    
    if (check_in !== undefined) {
      // Normalize time format to HH:MM:SS (pad with leading zeros)
      let normalizedCheckIn = check_in;
      if (check_in && check_in.length === 5) { // Format: HH:MM
        normalizedCheckIn = check_in + ':00'; // Add seconds
      } else if (check_in && check_in.length === 4 && check_in[1] === ':') { // Format: H:MM
        normalizedCheckIn = '0' + check_in + ':00'; // Add leading zero and seconds
      }
      
      updateFields.push('check_in = ?');
      params.push(normalizedCheckIn);
      
      // AUTO-CALCULATE status_check_in berdasarkan waktu
      // Rules: <= 09:00:00 = tepat_waktu, > 09:00:00 = terlambat
      const lateTime = '09:00:00';
      let calculatedStatus;
      if (normalizedCheckIn <= lateTime) {
        calculatedStatus = 'tepat_waktu';
      } else {
        calculatedStatus = 'terlambat';
      }
      
      updateFields.push('status_check_in = ?');
      params.push(calculatedStatus);
      autoCalculatedStatus = calculatedStatus;
      
      // DEBUG
      console.log(`[DEBUG ADMIN EDIT] Original: ${check_in}, Normalized: ${normalizedCheckIn}, Calculated status: ${calculatedStatus}`);
    }
    
    if (check_out !== undefined) {
      updateFields.push('check_out = ?');
      params.push(check_out);
      
      // AUTO-CALCULATE status_check_out berdasarkan waktu
      // Rules: >= 16:00:00 = tepat_waktu, < 16:00:00 = pulang_cepat
      const endTime = '16:00:00';
      let calculatedStatusOut;
      if (check_out >= endTime) {
        calculatedStatusOut = 'tepat_waktu';
      } else {
        calculatedStatusOut = 'pulang_cepat';
      }
      
      updateFields.push('status_check_out = ?');
      params.push(calculatedStatusOut);
    }
    
    // Only use manual status if check_in/check_out not provided (backward compatibility)
    if (check_in === undefined && status_check_in !== undefined) {
      updateFields.push('status_check_in = ?');
      params.push(status_check_in);
    }
    if (check_out === undefined && status_check_out !== undefined) {
      updateFields.push('status_check_out = ?');
      params.push(status_check_out);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'Tidak ada data yang diupdate' });
    }
    
    params.push(absensiId);
    
    const query = `UPDATE absensi SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, params);
    
    res.json({ 
      message: 'Data absensi berhasil diupdate',
      id: absensiId,
      updated_fields: updateFields,
      auto_calculated: {
        status_check_in: autoCalculatedStatus
      }
    });
  } catch (error) {
    console.error('Update absensi error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get all izin
router.get('/izin', verifyAdmin, async (req, res) => {
  try {
    const { status, bulan, tahun } = req.query;
    
    let query = `
      SELECT i.*, u.nama as nama_peserta 
      FROM izin i 
      JOIN users_pkl u ON i.user_id = u.id 
      WHERE 1=1
    `;
    const params = [];
    
    if (status) {
      query += ' AND i.status = ?';
      params.push(status);
    }
    
    // Filter by month/year - izin that overlap with the given month
    if (bulan && tahun) {
      query += ` AND (
        (MONTH(i.tanggal_mulai) = ? AND YEAR(i.tanggal_mulai) = ?)
        OR (MONTH(i.tanggal_selesai) = ? AND YEAR(i.tanggal_selesai) = ?)
        OR (i.tanggal_mulai <= LAST_DAY(MAKEDATE(?, ?)) 
            AND i.tanggal_selesai >= MAKEDATE(?, ?))
      )`;
      const bulanInt = parseInt(bulan);
      const tahunInt = parseInt(tahun);
      params.push(bulanInt, tahunInt, bulanInt, tahunInt, tahunInt, bulanInt, tahunInt, bulanInt);
    }
    
    query += ' ORDER BY i.created_at DESC';
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Get izin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Approve izin - auto create absensi records for the date range
router.put('/izin/:id/approve', verifyAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    console.log(`[DEBUG] Approving izin ID: ${req.params.id}`);
    
    const { id } = req.params;
    
    // Get izin details
    const [izinData] = await connection.query(
      'SELECT user_id, tanggal_mulai, tanggal_selesai, jenis, alasan FROM izin WHERE id = ?',
      [id]
    );
    
    if (izinData.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Izin tidak ditemukan' });
    }
    
    const { user_id, tanggal_mulai, tanggal_selesai, jenis, alasan } = izinData[0];
    
    // Update izin status to approved
    await connection.query(
      'UPDATE izin SET status = ? WHERE id = ?',
      ['disetujui', id]
    );
    
    const createdRecords = [];
    
    if (jenis === 'pulang_cepat') {
      // For pulang_cepat: update existing absensi status_check_out to 'pulang_cepat_izin'
      const startDate = new Date(tanggal_mulai);
      const endDate = new Date(tanggal_selesai);
      
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        const [existingAbsen] = await connection.query(
          'SELECT id, check_in FROM absensi WHERE user_id = ? AND tanggal = ?',
          [user_id, dateStr]
        );
        
        if (existingAbsen.length > 0 && existingAbsen[0].check_in) {
          // User already checked in - update checkout status
          await connection.query(
            `UPDATE absensi SET status_check_out = 'pulang_cepat_izin' WHERE id = ?`,
            [existingAbsen[0].id]
          );
          createdRecords.push(dateStr);
        }
      }
    } else {
      // For sakit/izin/cuti: create absensi records with 'izin' status
      const startDate = new Date(tanggal_mulai);
      const endDate = new Date(tanggal_selesai);
      
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        const [existingAbsen] = await connection.query(
          'SELECT id FROM absensi WHERE user_id = ? AND tanggal = ?',
          [user_id, dateStr]
        );
        
        if (existingAbsen.length === 0) {
          await connection.query(
            `INSERT INTO absensi (user_id, tanggal, check_in, check_out, status_check_in, status_check_out, created_at) 
             VALUES (?, ?, NULL, NULL, 'izin', NULL, NOW())`,
            [user_id, dateStr]
          );
          createdRecords.push(dateStr);
        }
      }
    }
    
    await connection.commit();
    connection.release();
    
    res.json({ 
      message: 'Izin berhasil disetujui',
      absensiCreated: createdRecords.length,
      dates: createdRecords
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('[ERROR] Approve izin failed:', {
      id: req.params.id,
      error: error.message,
      sql: error.sql,
      stack: error.stack
    });
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Reject izin
router.put('/izin/:id/reject', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { alasan } = req.body;
    
    // Get user info for email notification
    const [izinRows] = await pool.query(
      `SELECT i.jenis, i.tanggal_mulai, i.tanggal_selesai, u.nama, u.email
       FROM izin i
       JOIN users_pkl u ON i.user_id = u.id
       WHERE i.id = ?`,
      [id]
    );
    
    await pool.query(
      'UPDATE izin SET status = ? WHERE id = ?',
      ['ditolak', id]
    );
    
    // Send email notification
    if (izinRows.length > 0) {
      const izin = izinRows[0];
      if (izin.email) {
        await sendIzinRejectionEmail(izin.email, izin.nama, izin.jenis, alasan || 'Tidak ada alasan');
      }
    }
    
    res.json({ message: 'Izin berhasil ditolak' });
  } catch (error) {
    console.error('Reject izin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Generic Approve/Reject izin (backward compatibility)
router.put('/izin/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'disetujui' or 'ditolak'
    
    if (!['disetujui', 'ditolak'].includes(status)) {
      return res.status(400).json({ message: 'Status tidak valid' });
    }
    
    // Get user info for email notification
    const [izinRows] = await pool.query(
      `SELECT i.jenis, i.tanggal_mulai, i.tanggal_selesai, u.nama, u.email
       FROM izin i
       JOIN users_pkl u ON i.user_id = u.id
       WHERE i.id = ?`,
      [id]
    );
    
    await pool.query(
      'UPDATE izin SET status = ? WHERE id = ?',
      [status, id]
    );
    
    // Send email notification
    if (izinRows.length > 0) {
      const izin = izinRows[0];
      if (izin.email) {
        if (status === 'disetujui') {
          await sendIzinApprovalEmail(izin.email, izin.nama, izin.jenis, `${izin.tanggal_mulai} - ${izin.tanggal_selesai}`);
        } else {
          await sendIzinRejectionEmail(izin.email, izin.nama, izin.jenis, 'Tidak ada alasan');
        }
      }
    }
    
    res.json({ message: `Izin berhasil ${status}` });
  } catch (error) {
    console.error('Update izin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get attendance chart data for all participants
router.get('/attendance-chart', verifyAdmin, async (req, res) => {
  try {
    const unitId = req.user.unit_id;
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    // Get weekly data for current month (filtered by unit)
    const [weeklyData] = await pool.query(
      `SELECT 
        WEEK(a.tanggal) as week,
        COUNT(*) as totalDays,
        SUM(CASE WHEN a.check_in IS NOT NULL THEN 1 ELSE 0 END) as hadir,
        SUM(CASE WHEN a.check_in IS NULL THEN 1 ELSE 0 END) as tidakHadir,
        SUM(CASE WHEN a.status_check_in = 'terlambat' THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN a.status_check_out IN ('pulang_cepat', 'pulang_cepat_izin') THEN 1 ELSE 0 END) as pulangCepat
       FROM absensi a
       JOIN users_pkl u ON a.user_id = u.id
       WHERE u.unit_id = ? AND MONTH(a.tanggal) = ? AND YEAR(a.tanggal) = ?
       GROUP BY WEEK(a.tanggal)
       ORDER BY WEEK(a.tanggal)`,
      [unitId, currentMonth, currentYear]
    );
    
    // Get individual participant stats (filtered by unit)
    const [participantStats] = await pool.query(
      `SELECT 
        up.nama,
        up.unit_id,
        COUNT(a.id) as totalDays,
        SUM(CASE WHEN a.check_in IS NOT NULL THEN 1 ELSE 0 END) as hadir,
        SUM(CASE WHEN a.check_in IS NULL THEN 1 ELSE 0 END) as tidakHadir
       FROM users_pkl up
       LEFT JOIN absensi a ON up.id = a.user_id 
         AND MONTH(a.tanggal) = ? 
         AND YEAR(a.tanggal) = ?
       WHERE up.unit_id = ?
       GROUP BY up.id, up.nama, up.unit_id
       ORDER BY hadir DESC`,
      [currentMonth, currentYear, unitId]
    );
    
    // Get izin summary (filtered by unit)
    const [izinSummary] = await pool.query(
      `SELECT 
        i.jenis,
        COUNT(*) as total
       FROM izin i
       JOIN users_pkl u ON i.user_id = u.id
       WHERE MONTH(i.tanggal_mulai) = ? 
         AND YEAR(i.tanggal_mulai) = ?
         AND i.status = 'disetujui'
         AND u.unit_id = ?
       GROUP BY i.jenis`,
      [currentMonth, currentYear, unitId]
    );
    
    res.json({
      weekly: weeklyData,
      participants: participantStats,
      izin: izinSummary
    });
  } catch (error) {
    console.error('Get chart data error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Auto approve izin for absent participants who have submitted izin/sakit requests
// Others who are absent without submission will be marked as Alpha (no izin created)
router.post('/auto-izin-absen', verifyAdmin, async (req, res) => {
  try {
    // Get all participants who haven't checked in today
    const [absentParticipants] = await pool.query(
      `SELECT up.id, up.nama, up.email 
       FROM users_pkl up
       LEFT JOIN absensi a ON up.id = a.user_id AND a.tanggal = CURDATE()
       WHERE a.id IS NULL OR a.check_in IS NULL`
    );
    
    if (absentParticipants.length === 0) {
      return res.json({ 
        message: 'Tidak ada peserta yang absen hari ini',
        approved: 0,
        alpha: 0
      });
    }
    
    const approvedIzin = [];
    const alphaList = [];
    
    for (const participant of absentParticipants) {
      // Check if there's a pending izin request for today
      const [pendingIzin] = await pool.query(
        `SELECT id, jenis, alasan FROM izin 
         WHERE user_id = ? 
         AND CURDATE() BETWEEN tanggal_mulai AND tanggal_selesai
         AND status = 'pending'`,
        [participant.id]
      );
      
      if (pendingIzin.length > 0) {
        // Auto-approve the existing izin request
        await pool.query(
          `UPDATE izin SET status = 'disetujui', updated_at = NOW() 
           WHERE id = ?`,
          [pendingIzin[0].id]
        );
        
        approvedIzin.push({
          id: pendingIzin[0].id,
          user_id: participant.id,
          nama: participant.nama,
          jenis: pendingIzin[0].jenis,
          alasan: pendingIzin[0].alasan
        });
      } else {
        // Check if already has approved izin (to avoid double counting)
        const [approvedIzinCheck] = await pool.query(
          `SELECT id FROM izin 
           WHERE user_id = ? 
           AND CURDATE() BETWEEN tanggal_mulai AND tanggal_selesai
           AND status = 'disetujui'`,
          [participant.id]
        );
        
        if (approvedIzinCheck.length === 0) {
          // No izin submitted - this participant is Alpha (absent without permission)
          alphaList.push({
            user_id: participant.id,
            nama: participant.nama
          });
        }
      }
    }
    
    res.json({
      message: `Proses selesai: ${approvedIzin.length} izin disetujui, ${alphaList.length} peserta dianggap Alpha`,
      approved: approvedIzin.length,
      alpha: alphaList.length,
      approvedData: approvedIzin,
      alphaData: alphaList
    });
    
  } catch (error) {
    console.error('Auto izin absen error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Get attendance photos for verification
router.get('/attendance-photos', verifyAdmin, async (req, res) => {
  try {
    const { date, type = 'all' } = req.query;
    
    let query = `
      SELECT 
        a.id,
        a.user_id,
        up.nama,
        a.tanggal,
        a.check_in,
        a.check_out,
        a.lat_check_in,
        a.lng_check_in,
        a.lat_check_out,
        a.lng_check_out,
        a.foto_check_in,
        a.foto_check_out,
        a.status_check_in,
        a.status_check_out
      FROM absensi a
      JOIN users_pkl up ON a.user_id = up.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (date) {
      query += ' AND a.tanggal = ?';
      params.push(date);
    }
    
    if (type === 'check_in') {
      query += ' AND a.foto_check_in IS NOT NULL';
    } else if (type === 'check_out') {
      query += ' AND a.foto_check_out IS NOT NULL';
    } else {
      query += ' AND (a.foto_check_in IS NOT NULL OR a.foto_check_out IS NOT NULL)';
    }
    
    query += ' ORDER BY a.tanggal DESC, a.check_in DESC';
    
    const [rows] = await pool.query(query, params);
    
    res.json(rows);
  } catch (error) {
    console.error('Get attendance photos error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update Admin Profile
router.put('/profile', verifyAdmin, async (req, res) => {
  try {
    const adminId = req.user.id;
    const { nama, username, password } = req.body;
    
    // Validate input
    if (!nama || !username) {
      return res.status(400).json({ message: 'Nama dan username wajib diisi' });
    }
    
    // Check if username already exists (for other admins)
    const [existingUsers] = await pool.query(
      'SELECT id FROM admins WHERE username = ? AND id != ?',
      [username, adminId]
    );
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Username sudah digunakan oleh admin lain' });
    }
    
    // Build update query
    let updateQuery = 'UPDATE admins SET nama = ?, username = ?';
    let params = [nama, username];
    
    // Update password if provided
    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password minimal 6 karakter' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery += ', password = ?';
      params.push(hashedPassword);
    }
    
    updateQuery += ' WHERE id = ?';
    params.push(adminId);
    
    await pool.query(updateQuery, params);
    
    res.json({ 
      message: 'Profil berhasil diperbarui',
      user: {
        id: adminId,
        nama,
        username
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// ==========================================
// ADMIN MANAGEMENT ROUTES (Multi-Admin)
// ==========================================

// Get all admins with jabatan
router.get('/admin/all', verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.nama, a.username, a.nip, a.jabatan, a.no_hp, 
              a.is_active, a.created_at, a.ttd,
              u.nama as unit_nama
       FROM admins a
       LEFT JOIN unit_kerja u ON a.unit_id = u.id
       ORDER BY a.created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('Get all admins error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Create new admin with NIP and jabatan
router.post('/admin/create', verifyAdmin, uploadAdminTTD.single('ttd'), handleUploadError, async (req, res) => {
  try {
    const { nama, username, password, nip, jabatan, no_hp, unit_id } = req.body;
    const ttdPath = req.file ? `/uploads/admin/ttd/${req.file.filename}` : null;
    
    if (!nama || !username || !password) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Nama, username, dan password wajib diisi' });
    }
    
    if (password.length < 6) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Password minimal 6 karakter' });
    }
    
    // Check if username exists
    const [existingUsers] = await pool.query(
      'SELECT id FROM admins WHERE username = ?',
      [username]
    );
    
    if (existingUsers.length > 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Username sudah digunakan' });
    }
    
    // Check if NIP exists (if provided)
    if (nip) {
      const [existingNIP] = await pool.query(
        'SELECT id FROM admins WHERE nip = ?',
        [nip]
      );
      if (existingNIP.length > 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'NIP sudah terdaftar' });
      }
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [result] = await pool.query(
      `INSERT INTO admins (nama, username, password, nip, jabatan, no_hp, unit_id, ttd) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nama, username, hashedPassword, nip || null, jabatan || null, no_hp || null, unit_id || 1, ttdPath]
    );
    
    res.json({
      message: 'Admin berhasil ditambahkan',
      id: result.insertId,
      nama,
      username,
      nip: nip || null,
      jabatan: jabatan || null
    });
  } catch (error) {
    console.error('Create admin error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update admin with NIP, jabatan, ttd
router.put('/admin/:id', verifyAdmin, uploadAdminTTD.single('ttd'), handleUploadError, async (req, res) => {
  try {
    const adminId = req.params.id;
    const { nama, username, password, nip, jabatan, no_hp, unit_id, is_active } = req.body;
    const ttdPath = req.file ? `/uploads/admin/ttd/${req.file.filename}` : null;
    
    // Check if admin exists
    const [existingAdmin] = await pool.query(
      'SELECT ttd FROM admins WHERE id = ?',
      [adminId]
    );
    
    if (existingAdmin.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'Admin tidak ditemukan' });
    }
    
    // Delete old TTD if new one uploaded
    if (ttdPath && existingAdmin[0].ttd) {
      const oldTTDPath = path.join(__dirname, '..', existingAdmin[0].ttd);
      if (fs.existsSync(oldTTDPath)) {
        fs.unlinkSync(oldTTDPath);
      }
    }
    
    // Build update query dynamically
    let updateFields = [];
    let params = [];
    
    if (nama !== undefined) {
      updateFields.push('nama = ?');
      params.push(nama);
    }
    if (username !== undefined) {
      // Check if username exists for other admins
      const [existingUsers] = await pool.query(
        'SELECT id FROM admins WHERE username = ? AND id != ?',
        [username, adminId]
      );
      if (existingUsers.length > 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Username sudah digunakan oleh admin lain' });
      }
      updateFields.push('username = ?');
      params.push(username);
    }
    if (nip !== undefined) {
      // Check if NIP exists for other admins
      const [existingNIP] = await pool.query(
        'SELECT id FROM admins WHERE nip = ? AND id != ?',
        [nip, adminId]
      );
      if (existingNIP.length > 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'NIP sudah terdaftar oleh admin lain' });
      }
      updateFields.push('nip = ?');
      params.push(nip);
    }
    if (jabatan !== undefined) {
      updateFields.push('jabatan = ?');
      params.push(jabatan);
    }
    if (no_hp !== undefined) {
      updateFields.push('no_hp = ?');
      params.push(no_hp);
    }
    if (unit_id !== undefined) {
      updateFields.push('unit_id = ?');
      params.push(unit_id);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      params.push(is_active);
    }
    if (password && password.trim() !== '') {
      if (password.length < 6) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Password minimal 6 karakter' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push('password = ?');
      params.push(hashedPassword);
    }
    if (ttdPath) {
      updateFields.push('ttd = ?');
      params.push(ttdPath);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'Tidak ada data yang diupdate' });
    }
    
    params.push(adminId);
    const query = `UPDATE admins SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, params);
    
    res.json({ 
      message: 'Admin berhasil diperbarui',
      updatedFields: updateFields.length
    });
  } catch (error) {
    console.error('Update admin error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Delete admin
router.delete('/admin/:id', verifyAdmin, async (req, res) => {
  try {
    const adminId = req.params.id;
    
    // Prevent deleting yourself
    if (parseInt(adminId) === req.user.id) {
      return res.status(400).json({ message: 'Tidak dapat menghapus diri sendiri' });
    }
    
    // Get TTD path before delete
    const [adminRows] = await pool.query(
      'SELECT ttd FROM admins WHERE id = ?',
      [adminId]
    );
    
    if (adminRows.length === 0) {
      return res.status(404).json({ message: 'Admin tidak ditemukan' });
    }
    
    // Delete TTD file if exists
    if (adminRows[0].ttd) {
      const ttdPath = path.join(__dirname, '..', adminRows[0].ttd);
      if (fs.existsSync(ttdPath)) {
        fs.unlinkSync(ttdPath);
      }
    }
    
    await pool.query('DELETE FROM admins WHERE id = ?', [adminId]);
    
    res.json({ message: 'Admin berhasil dihapus' });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Create new admin
router.post('/create', verifyAdmin, uploadAdminTTD.single('ttd'), async (req, res) => {
  try {
    const { nama, username, password, nip, jabatan, no_hp, unit_id, is_active } = req.body;
    
    // Validate required fields
    if (!nama || !username || !password) {
      return res.status(400).json({ message: 'Nama, username, dan password wajib diisi' });
    }
    
    // Check if username already exists
    const [existing] = await pool.query('SELECT id FROM admins WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Username sudah digunakan' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Get TTD path if uploaded
    const ttdPath = req.file ? `/uploads/admin/ttd/${req.file.filename}` : null;
    
    // Insert admin
    const [result] = await pool.query(
      `INSERT INTO admins (nama, username, password, nip, jabatan, no_hp, unit_id, ttd, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nama, username, hashedPassword, nip || null, jabatan || null, no_hp || null, unit_id || 1, ttdPath, is_active !== 'false']
    );
    
    res.json({ 
      message: 'Admin berhasil dibuat',
      adminId: result.insertId
    });
  } catch (error) {
    console.error('Create admin error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get all admins
router.get('/all', verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, u.nama as unit_nama 
      FROM admins a 
      LEFT JOIN unit_kerja u ON a.unit_id = u.id 
      ORDER BY a.id DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Get all admins error:', error.message);
    console.error('SQL Error:', error.sqlMessage || error.message);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.sqlMessage || error.message });
  }
});

// Get all jabatan (master data)
router.get('/jabatan/all', verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM jabatan ORDER BY level');
    res.json(rows);
  } catch (error) {
    console.error('Get jabatan error:', error.message);
    console.error('SQL Error:', error.sqlMessage || error.message);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.sqlMessage || error.message });
  }
});

// Get all unit_kerja
router.get('/unit/all', verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM unit_kerja ORDER BY nama');
    res.json(rows);
  } catch (error) {
    console.error('Get unit error:', error.message);
    console.error('SQL Error:', error.sqlMessage || error.message);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.sqlMessage || error.message });
  }
});

// Update admin
router.put('/:id', verifyAdmin, uploadAdminTTD.single('ttd'), async (req, res) => {
  try {
    const adminId = req.params.id;
    const { nama, username, password, nip, jabatan, no_hp, unit_id, is_active } = req.body;
    
    // Build update fields
    const updateFields = [];
    const params = [];
    
    if (nama) {
      updateFields.push('nama = ?');
      params.push(nama);
    }
    if (username) {
      updateFields.push('username = ?');
      params.push(username);
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push('password = ?');
      params.push(hashedPassword);
    }
    if (nip !== undefined) {
      updateFields.push('nip = ?');
      params.push(nip || null);
    }
    if (jabatan !== undefined) {
      updateFields.push('jabatan = ?');
      params.push(jabatan || null);
    }
    if (no_hp !== undefined) {
      updateFields.push('no_hp = ?');
      params.push(no_hp || null);
    }
    if (unit_id !== undefined) {
      updateFields.push('unit_id = ?');
      params.push(unit_id || 1);
    }
    if (is_active !== undefined) {
      updateFields.push('is_active = ?');
      params.push(is_active === 'true' || is_active === true);
    }
    if (req.file) {
      const ttdPath = `/uploads/admin/ttd/${req.file.filename}`;
      updateFields.push('ttd = ?');
      params.push(ttdPath);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'Tidak ada field yang diupdate' });
    }
    
    params.push(adminId);
    const query = `UPDATE admins SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, params);
    
    res.json({ 
      message: 'Admin berhasil diperbarui',
      updatedFields: updateFields.length
    });
  } catch (error) {
    console.error('Update admin error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
