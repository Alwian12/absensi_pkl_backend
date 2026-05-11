const express = require('express');
const { pool } = require('../config/database');
const { verifyAdmin, verifyToken } = require('../middleware/auth');

const router = express.Router();

// Get all penilaian with peserta info (admin only)
router.get('/', verifyAdmin, async (req, res) => {
  try {
    const { user_id, periode } = req.query;
    
    // Use LEFT JOIN to show penilaian even if user was deleted
    let query = `
      SELECT 
        p.*,
        u.nama as nama_peserta,
        u.asal_sekolah,
        a.nama as nama_pembimbing
      FROM penilaian p
      LEFT JOIN users_pkl u ON p.user_id = u.id
      LEFT JOIN admins a ON p.created_by = a.id
      WHERE 1=1
    `;
    const params = [];
    
    if (user_id) {
      query += ' AND p.user_id = ?';
      params.push(user_id);
    }
    
    if (periode) {
      query += ' AND ? BETWEEN p.periode_mulai AND p.periode_selesai';
      params.push(periode);
    }
    
    query += ' ORDER BY p.created_at DESC';
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Get penilaian error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
  }
});

// Get kriteria penilaian - MUST BE BEFORE /:id
router.get('/kriteria/all', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM kriteria_penilaian ORDER BY kategori'
    );
    res.json(rows);
  } catch (error) {
    console.error('Get kriteria error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get rekap penilaian per peserta (for laporan) - MUST BE BEFORE /:id
router.get('/rekap/all', verifyAdmin, async (req, res) => {
  try {
    const { periode_mulai, periode_selesai } = req.query;
    
    let query = `
      SELECT 
        u.id as user_id,
        u.nama,
        u.asal_sekolah,
        AVG(p.total_nilai) as rata_rata_nilai,
        COUNT(p.id) as jumlah_penilaian,
        MAX(p.grade) as grade_terakhir
      FROM users_pkl u
      LEFT JOIN penilaian p ON u.id = p.user_id
      WHERE u.status = 'aktif'
    `;
    const params = [];
    
    if (periode_mulai && periode_selesai) {
      query += ' AND p.periode_mulai >= ? AND p.periode_selesai <= ?';
      params.push(periode_mulai, periode_selesai);
    }
    
    query += ' GROUP BY u.id, u.nama, u.asal_sekolah ORDER BY u.nama';
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Get rekap penilaian error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get penilaian for specific user (for user view) - MUST BE BEFORE /:id
router.get('/user/:userId', verifyToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Only allow user to view their own penilaian
    if (req.user.role !== 'admin' && req.user.id !== parseInt(userId)) {
      return res.status(403).json({ message: 'Akses ditolak' });
    }
    
    const [rows] = await pool.query(
      `SELECT * FROM penilaian 
       WHERE user_id = ? AND status = 'final'
       ORDER BY periode_selesai DESC`,
      [userId]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Get user penilaian error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get penilaian by ID
router.get('/:id', verifyAdmin, async (req, res) => {
  try {
    const penilaianId = req.params.id;
    
    const [rows] = await pool.query(
      `SELECT 
        p.*,
        u.nama as nama_peserta,
        u.asal_sekolah,
        a.nama as nama_pembimbing
      FROM penilaian p
      JOIN users_pkl u ON p.user_id = u.id
      LEFT JOIN admins a ON p.created_by = a.id
      WHERE p.id = ?`,
      [penilaianId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Data penilaian tidak ditemukan' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Get penilaian by id error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Create new penilaian (admin only)
router.post('/', verifyAdmin, async (req, res) => {
  try {
    const {
      user_id,
      periode_mulai,
      periode_selesai,
      kehadiran_nilai,
      kehadiran_keterangan,
      sikap_nilai,
      sikap_keterangan,
      kinerja_nilai,
      kinerja_keterangan,
      jurnal_nilai,
      jurnal_keterangan,
      laporan_nilai,
      laporan_keterangan,
      catatan_pembimbing,
      status
    } = req.body;
    
    if (!user_id || !periode_mulai || !periode_selesai) {
      return res.status(400).json({ 
        message: 'User ID, periode mulai, dan periode selesai wajib diisi' 
      });
    }
    
    // Validate nilai range (0-100)
    const validateNilai = (nilai, fieldName) => {
      const n = parseFloat(nilai) || 0;
      if (n < 0 || n > 100) {
        throw new Error(`${fieldName} harus antara 0-100`);
      }
      return n;
    };
    
    try {
      var kn = validateNilai(kehadiran_nilai, 'Nilai kehadiran');
      var sn = validateNilai(sikap_nilai, 'Nilai sikap');
      var kin = validateNilai(kinerja_nilai, 'Nilai kinerja');
      var jn = validateNilai(jurnal_nilai, 'Nilai jurnal');
      var ln = validateNilai(laporan_nilai, 'Nilai laporan');
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    
    // Auto-calculate total_nilai and grade
    const totalNilai = (kn + sn + kin + jn + ln) / 5;
    
    let grade = 'E';
    if (totalNilai >= 90) grade = 'A';
    else if (totalNilai >= 80) grade = 'B';
    else if (totalNilai >= 70) grade = 'C';
    else if (totalNilai >= 60) grade = 'D';
    
    const [result] = await pool.query(
      `INSERT INTO penilaian (
        user_id, periode_mulai, periode_selesai,
        kehadiran_nilai, kehadiran_keterangan,
        sikap_nilai, sikap_keterangan,
        kinerja_nilai, kinerja_keterangan,
        jurnal_nilai, jurnal_keterangan,
        laporan_nilai, laporan_keterangan,
        total_nilai, grade, catatan_pembimbing, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id, periode_mulai, periode_selesai,
        kn, kehadiran_keterangan,
        sn, sikap_keterangan,
        kin, kinerja_keterangan,
        jn, jurnal_keterangan,
        ln, laporan_keterangan,
        totalNilai, grade, catatan_pembimbing, status || 'draft', req.user.id
      ]
    );
    
    res.json({
      message: 'Penilaian berhasil ditambahkan',
      id: result.insertId
    });
  } catch (error) {
    console.error('Create penilaian error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ 
        message: 'Penilaian untuk periode ini sudah ada' 
      });
    }
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update penilaian (admin only)
router.put('/:id', verifyAdmin, async (req, res) => {
  try {
    const penilaianId = req.params.id;
    const {
      kehadiran_nilai,
      kehadiran_keterangan,
      sikap_nilai,
      sikap_keterangan,
      kinerja_nilai,
      kinerja_keterangan,
      jurnal_nilai,
      jurnal_keterangan,
      laporan_nilai,
      laporan_keterangan,
      catatan_pembimbing,
      status
    } = req.body;
    
    await pool.query(
      `UPDATE penilaian SET
        kehadiran_nilai = ?, kehadiran_keterangan = ?,
        sikap_nilai = ?, sikap_keterangan = ?,
        kinerja_nilai = ?, kinerja_keterangan = ?,
        jurnal_nilai = ?, jurnal_keterangan = ?,
        laporan_nilai = ?, laporan_keterangan = ?,
        catatan_pembimbing = ?, status = ?
      WHERE id = ?`,
      [
        kehadiran_nilai, kehadiran_keterangan,
        sikap_nilai, sikap_keterangan,
        kinerja_nilai, kinerja_keterangan,
        jurnal_nilai, jurnal_keterangan,
        laporan_nilai, laporan_keterangan,
        catatan_pembimbing, status, penilaianId
      ]
    );
    
    res.json({ message: 'Penilaian berhasil diperbarui' });
  } catch (error) {
    console.error('Update penilaian error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Delete penilaian (admin only)
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const penilaianId = req.params.id;
    
    await pool.query('DELETE FROM penilaian WHERE id = ?', [penilaianId]);
    
    res.json({ message: 'Penilaian berhasil dihapus' });
  } catch (error) {
    console.error('Delete penilaian error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
