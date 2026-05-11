const express = require('express');
const { pool } = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { uploadIzinAttachment, handleUploadError } = require('../config/upload');
const { sendIzinApprovalEmail, sendIzinRejectionEmail } = require('../utils/notificationEmails');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Create izin request with file upload
router.post('/', verifyToken, uploadIzinAttachment.single('lampiran'), handleUploadError, async (req, res) => {
  try {
    const { tanggal_mulai, tanggal_selesai, jenis, alasan } = req.body;
    const userId = req.user.id;
    
    if (!tanggal_mulai || !tanggal_selesai || !jenis || !alasan) {
      // Delete uploaded file if validation fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: 'Semua field wajib diisi' });
    }
    
    // Validate dates
    if (new Date(tanggal_mulai) > new Date(tanggal_selesai)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Tanggal mulai harus sebelum tanggal selesai' });
    }
    
    // Validate jenis enum
    const validJenis = ['sakit', 'izin', 'cuti', 'pulang_cepat'];
    if (!validJenis.includes(jenis)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Jenis izin tidak valid' });
    }
    
    // Validate alasan length
    if (alasan.trim().length < 10) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Alasan minimal 10 karakter' });
    }
    
    // Get file path if uploaded
    const lampiranPath = req.file ? `/uploads/izin/lampiran/${req.file.filename}` : null;
    
    const [result] = await pool.query(
      'INSERT INTO izin (user_id, tanggal_mulai, tanggal_selesai, jenis, alasan, lampiran) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, tanggal_mulai, tanggal_selesai, jenis, alasan, lampiranPath]
    );
    
    res.json({ 
      message: 'Pengajuan izin berhasil dikirim',
      izin_id: result.insertId,
      lampiran: lampiranPath
    });
  } catch (error) {
    // Delete uploaded file if error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Create izin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get user's izin history
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [rows] = await pool.query(
      `SELECT * FROM izin 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Get izin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get izin by ID
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const [rows] = await pool.query(
      'SELECT * FROM izin WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Data izin tidak ditemukan' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Get izin by ID error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Cancel izin (only if still pending)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const [rows] = await pool.query(
      'SELECT status FROM izin WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Data izin tidak ditemukan' });
    }
    
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Izin yang sudah diproses tidak dapat dibatalkan' });
    }
    
    await pool.query(
      'DELETE FROM izin WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    res.json({ message: 'Pengajuan izin berhasil dibatalkan' });
  } catch (error) {
    console.error('Delete izin error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Download/view lampiran
router.get('/:id/lampiran', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const [rows] = await pool.query(
      'SELECT lampiran, user_id FROM izin WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Data izin tidak ditemukan' });
    }
    
    // Check if user owns this izin or is admin
    const izin = rows[0];
    if (izin.user_id !== userId && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Tidak memiliki akses' });
    }
    
    if (!izin.lampiran) {
      return res.status(404).json({ message: 'Tidak ada lampiran' });
    }
    
    const filePath = path.join(__dirname, '..', izin.lampiran);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File tidak ditemukan' });
    }
    
    res.sendFile(filePath);
  } catch (error) {
    console.error('Download lampiran error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
