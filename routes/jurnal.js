const express = require('express');
const { pool } = require('../config/database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { format } = require('date-fns');
const { uploadJurnalPhoto, uploadJurnalTTD, handleUploadError } = require('../config/upload');
const { sendJournalApprovalEmail, sendJournalRejectionEmail } = require('../utils/notificationEmails');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Create/Update jurnal with photo upload - ENHANCED with new fields
// SUPPORTS: Manual date, draft mode, multiple jurnals per day, edit existing
router.post('/', verifyToken, uploadJurnalPhoto.single('foto'), handleUploadError, async (req, res) => {
  try {
    const { 
      jurnal_id, // for editing existing
      tanggal, // manual date selection
      is_draft, // draft mode flag
      nomor_kegiatan, 
      nama_pekerjaan, 
      kegiatan, // backward compatibility
      deskripsi,
      tanggal_selesai,
      kompetensi,
      alat_bahan,
      uraian_kerja,
      keterangan
    } = req.body;
    
    const userId = req.user.id;
    const selectedDate = tanggal || format(new Date(), 'yyyy-MM-dd'); // Use provided date or today
    const fotoPath = req.file ? `/uploads/jurnal/foto/${req.file.filename}` : null;
    const draftMode = is_draft === '1' || is_draft === 'true';
    
    // Use nama_pekerjaan if provided, otherwise fall back to kegiatan
    const finalNamaPekerjaan = nama_pekerjaan || kegiatan;
    
    if (!finalNamaPekerjaan || finalNamaPekerjaan.trim().length < 5) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Nama pekerjaan minimal 5 karakter' });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(selectedDate)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Format tanggal tidak valid (YYYY-MM-DD)' });
    }
    
    // Validate tanggal_selesai if provided
    if (tanggal_selesai && !dateRegex.test(tanggal_selesai)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Format tanggal selesai tidak valid' });
    }
    
    // Validate tanggal_selesai >= tanggal
    if (tanggal_selesai && new Date(tanggal_selesai) < new Date(selectedDate)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Tanggal selesai harus setelah tanggal mulai' });
    }
    
    // If jurnal_id provided, UPDATE existing (edit mode)
    if (jurnal_id) {
      const [existing] = await pool.query('SELECT * FROM jurnal WHERE id = ? AND user_id = ?', [jurnal_id, userId]);
      
      if (existing.length === 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: 'Jurnal tidak ditemukan' });
      }
      
      // Update existing jurnal
      let updateQuery = `UPDATE jurnal SET 
        nomor_kegiatan = ?, nama_pekerjaan = ?, kegiatan = ?, deskripsi = ?, 
        tanggal = ?, tanggal_selesai = ?, kompetensi = ?, alat_bahan = ?, 
        uraian_kerja = ?, keterangan = ?, is_draft = ?`;
      let updateParams = [
        nomor_kegiatan, finalNamaPekerjaan, finalNamaPekerjaan, deskripsi,
        selectedDate, tanggal_selesai || selectedDate, kompetensi, alat_bahan, 
        uraian_kerja, keterangan, draftMode ? 1 : 0
      ];
      
      if (fotoPath) {
        updateQuery += `, foto = ?`;
        updateParams.push(fotoPath);
        // Delete old foto if exists
        if (existing[0].foto) {
          const oldPath = path.join(__dirname, '..', existing[0].foto);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      }
      
      // Only update status to pending if submitting (not draft)
      if (!draftMode) {
        updateQuery += `, status_pembimbing = 'pending'`;
      }
      
      updateQuery += ` WHERE id = ?`;
      updateParams.push(jurnal_id);
      
      await pool.query(updateQuery, updateParams);
      
      return res.json({ 
        message: draftMode ? 'Draft berhasil diperbarui' : 'Jurnal berhasil diperbarui dan dikirim',
        jurnal_id: jurnal_id,
        is_draft: draftMode
      });
    }
    
    // INSERT new jurnal - allow multiple per day by checking all fields match
    // (prevent exact duplicates only)
    const [duplicateCheck] = await pool.query(
      `SELECT * FROM jurnal WHERE user_id = ? AND tanggal = ? AND nama_pekerjaan = ? AND uraian_kerja = ?`,
      [userId, selectedDate, finalNamaPekerjaan, uraian_kerja]
    );
    
    if (duplicateCheck.length > 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Jurnal dengan kegiatan ini sudah ada untuk tanggal tersebut' });
    }
    
    // Insert new jurnal
    const [result] = await pool.query(
      `INSERT INTO jurnal (
        user_id, tanggal, nomor_kegiatan, nama_pekerjaan, kegiatan, deskripsi,
        tanggal_selesai, kompetensi, alat_bahan, uraian_kerja, keterangan,
        foto, status_pembimbing, is_draft
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, selectedDate, nomor_kegiatan, finalNamaPekerjaan, finalNamaPekerjaan, deskripsi,
        tanggal_selesai || selectedDate, kompetensi, alat_bahan, uraian_kerja, keterangan,
        fotoPath, draftMode ? null : 'pending', draftMode ? 1 : 0
      ]
    );
    
    res.json({ 
      message: draftMode ? 'Draft jurnal berhasil disimpan' : 'Jurnal berhasil disimpan dan dikirim',
      jurnal_id: result.insertId,
      is_draft: draftMode,
      foto: fotoPath
    });
  } catch (error) {
    console.error('Create jurnal error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get user's jurnal history with pembimbing info
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 30 } = req.query;
    
    const [rows] = await pool.query(
      `SELECT j.*, 
              a.nama as nama_pembimbing, 
              a.nip as nip_pembimbing,
              a.jabatan as jabatan_pembimbing,
              a.ttd as ttd_pembimbing_path
       FROM jurnal j
       LEFT JOIN admins a ON j.pembimbing_id = a.id
       WHERE j.user_id = ? 
       ORDER BY j.tanggal DESC 
       LIMIT ?`,
      [userId, parseInt(limit)]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Get jurnal error:', error.message);
    console.error('SQL Error:', error.sqlMessage || error.message);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.sqlMessage || error.message });
  }
});

// Get today's jurnal
router.get('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = format(new Date(), 'yyyy-MM-dd');
    
    const [rows] = await pool.query(
      `SELECT j.*, 
              a.nama as nama_pembimbing,
              a.nip as nip_pembimbing,
              a.jabatan as jabatan_pembimbing
       FROM jurnal j
       LEFT JOIN admins a ON j.pembimbing_id = a.id
       WHERE j.user_id = ? AND j.tanggal = ?`,
      [userId, today]
    );
    
    res.json({
      hasJurnal: rows.length > 0,
      jurnal: rows[0] || null
    });
  } catch (error) {
    console.error('Get today jurnal error:', error.message);
    console.error('SQL Error:', error.sqlMessage || error.message);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.sqlMessage || error.message });
  }
});

// Get user's draft jurnals - MUST BE BEFORE /:id route
router.get('/drafts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [rows] = await pool.query(
      `SELECT j.*, 
              a.nama as nama_pembimbing, 
              a.nip as nip_pembimbing,
              a.jabatan as jabatan_pembimbing
       FROM jurnal j
       LEFT JOIN admins a ON j.pembimbing_id = a.id
       WHERE j.user_id = ? AND j.is_draft = 1
       ORDER BY j.tanggal DESC`,
      [userId]
    );
    
    res.json({
      count: rows.length,
      drafts: rows
    });
  } catch (error) {
    console.error('Get drafts error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Submit draft endpoints - MUST BE BEFORE /:id route
// Submit draft jurnal to pembimbing
router.put('/:id/submit', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const [draftCheck] = await pool.query(
      'SELECT * FROM jurnal WHERE id = ? AND user_id = ? AND is_draft = 1',
      [id, userId]
    );
    
    if (draftCheck.length === 0) {
      return res.status(404).json({ message: 'Draft tidak ditemukan atau sudah dikirim' });
    }
    
    await pool.query(
      `UPDATE jurnal SET is_draft = 0, status_pembimbing = 'pending' WHERE id = ?`,
      [id]
    );
    
    res.json({ 
      message: 'Jurnal berhasil dikirim ke pembimbing',
      jurnal_id: id
    });
  } catch (error) {
    console.error('Submit draft error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Submit all drafts
router.post('/submit-all', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as count FROM jurnal WHERE user_id = ? AND is_draft = 1',
      [userId]
    );
    
    const count = countResult[0].count;
    
    if (count === 0) {
      return res.json({ message: 'Tidak ada draft untuk dikirim', submitted: 0 });
    }
    
    await pool.query(
      `UPDATE jurnal SET is_draft = 0, status_pembimbing = 'pending' 
       WHERE user_id = ? AND is_draft = 1`,
      [userId]
    );
    
    res.json({ 
      message: `${count} jurnal berhasil dikirim ke pembimbing`,
      submitted: count
    });
  } catch (error) {
    console.error('Submit all error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get jurnal by ID - MUST BE AFTER specific routes
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const [rows] = await pool.query(
      `SELECT j.*, 
              a.nama as nama_pembimbing,
              a.nip as nip_pembimbing,
              a.jabatan as jabatan_pembimbing,
              a.ttd as ttd_pembimbing_path
       FROM jurnal j
       LEFT JOIN admins a ON j.pembimbing_id = a.id
       WHERE j.id = ? AND j.user_id = ?`,
      [id, userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Jurnal tidak ditemukan' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Get jurnal by ID error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Submit all drafts
router.post('/submit-all', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get count first
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as count FROM jurnal WHERE user_id = ? AND is_draft = 1',
      [userId]
    );
    
    const count = countResult[0].count;
    
    if (count === 0) {
      return res.json({ message: 'Tidak ada draft untuk dikirim', submitted: 0 });
    }
    
    // Update all drafts
    await pool.query(
      `UPDATE jurnal SET is_draft = 0, status_pembimbing = 'pending' 
       WHERE user_id = ? AND is_draft = 1`,
      [userId]
    );
    
    res.json({ 
      message: `${count} jurnal berhasil dikirim ke pembimbing`,
      submitted: count
    });
  } catch (error) {
    console.error('Submit all error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Delete jurnal
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Get foto path first
    const [jurnalRows] = await pool.query(
      'SELECT foto FROM jurnal WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    if (jurnalRows.length === 0) {
      return res.status(404).json({ message: 'Jurnal tidak ditemukan' });
    }
    
    // Delete foto file if exists
    if (jurnalRows[0].foto) {
      const fotoPath = path.join(__dirname, '..', jurnalRows[0].foto);
      if (fs.existsSync(fotoPath)) {
        fs.unlinkSync(fotoPath);
      }
    }
    
    const [result] = await pool.query(
      'DELETE FROM jurnal WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    res.json({ message: 'Jurnal berhasil dihapus' });
  } catch (error) {
    console.error('Delete jurnal error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// ==========================================
// ADMIN ENDPOINTS FOR JURNAL MANAGEMENT
// ==========================================

// Get all jurnal for admin (with filter) - EXCLUDE DRAFTS
router.get('/admin/all', verifyAdmin, async (req, res) => {
  try {
    const { user_id, status, tanggal, limit = 50 } = req.query;
    
    let query = `
      SELECT j.*, 
             u.nama as nama_peserta,
             u.asal_sekolah,
             a.nama as nama_pembimbing,
             a.nip as nip_pembimbing,
             a.jabatan as jabatan_pembimbing
      FROM jurnal j
      JOIN users_pkl u ON j.user_id = u.id
      LEFT JOIN admins a ON j.pembimbing_id = a.id
      WHERE j.is_draft = 0
    `;
    const params = [];
    
    if (user_id) {
      query += ' AND j.user_id = ?';
      params.push(user_id);
    }
    
    if (status) {
      query += ' AND j.status_pembimbing = ?';
      params.push(status);
    }
    
    if (tanggal) {
      query += ' AND j.tanggal = ?';
      params.push(tanggal);
    }
    
    query += ' ORDER BY j.tanggal DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Get all jurnal error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Admin approve/reject jurnal with signature
router.post('/:id/approve', verifyAdmin, uploadJurnalTTD.single('ttd'), handleUploadError, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, catatan } = req.body; // status: 'approved' atau 'rejected'
    const adminId = req.user.id;
    const ttdPath = req.file ? `/uploads/jurnal/ttd/${req.file.filename}` : null;
    
    if (!status || !['approved', 'rejected'].includes(status)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Status harus approved atau rejected' });
    }
    
    // Get current jurnal data
    const [jurnalRows] = await pool.query(
      'SELECT ttd_pembimbing FROM jurnal WHERE id = ?',
      [id]
    );
    
    if (jurnalRows.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'Jurnal tidak ditemukan' });
    }
    
    // Delete old TTD if exists
    if (jurnalRows[0].ttd_pembimbing) {
      const oldTTDPath = path.join(__dirname, '..', jurnalRows[0].ttd_pembimbing);
      if (fs.existsSync(oldTTDPath)) {
        fs.unlinkSync(oldTTDPath);
      }
    }
    
    // Update jurnal
    const updateQuery = ttdPath
      ? `UPDATE jurnal SET 
           status_pembimbing = ?, 
           catatan_pembimbing = ?,
           pembimbing_id = ?,
           ttd_pembimbing = ?,
           approved_at = NOW()
         WHERE id = ?`
      : `UPDATE jurnal SET 
           status_pembimbing = ?, 
           catatan_pembimbing = ?,
           pembimbing_id = ?,
           approved_at = NOW()
         WHERE id = ?`;
    
    const updateParams = ttdPath
      ? [status, catatan || null, adminId, ttdPath, id]
      : [status, catatan || null, adminId, id];
    
    await pool.query(updateQuery, updateParams);
    
    // Get user info for email notification
    const [userRows] = await pool.query(
      `SELECT u.nama, u.email, j.kegiatan 
       FROM jurnal j
       JOIN users_pkl u ON j.user_id = u.id
       WHERE j.id = ?`,
      [id]
    );
    
    if (userRows.length > 0) {
      const user = userRows[0];
      if (user.email) {
        if (status === 'approved') {
          await sendJournalApprovalEmail(user.email, user.nama, user.kegiatan, catatan);
        } else {
          await sendJournalRejectionEmail(user.email, user.nama, user.kegiatan, catatan);
        }
      }
    }
    
    res.json({
      message: `Jurnal berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}`,
      status,
      catatan: catatan || null
    });
  } catch (error) {
    console.error('Approve jurnal error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get pending jurnal count for admin dashboard
router.get('/admin/pending-count', verifyAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) as count 
       FROM jurnal 
       WHERE status_pembimbing = 'pending'`
    );
    
    res.json({ count: rows[0].count });
  } catch (error) {
    console.error('Get pending count error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
