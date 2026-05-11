const express = require('express');
const { pool } = require('../config/database');
const { verifyAdmin, verifyToken } = require('../middleware/auth');

const router = express.Router();

// Get all events (public for all authenticated users)
router.get('/', verifyToken, async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    
    console.log('[DEBUG] Get events - bulan:', bulan, 'tahun:', tahun);
    
    let query = `
      SELECT id, judul, deskripsi, tanggal_mulai, tanggal_selesai, 
             tipe, warna, created_at
      FROM events
      WHERE 1=1
    `;
    const params = [];
    
    if (bulan && tahun) {
      query += ` AND (
        (MONTH(tanggal_mulai) = ? AND YEAR(tanggal_mulai) = ?)
        OR (MONTH(tanggal_selesai) = ? AND YEAR(tanggal_selesai) = ?)
        OR (? BETWEEN MONTH(tanggal_mulai) AND MONTH(tanggal_selesai))
      )`;
      params.push(parseInt(bulan), parseInt(tahun), parseInt(bulan), parseInt(tahun), parseInt(bulan));
    }
    
    query += ' ORDER BY tanggal_mulai ASC';
    
    console.log('[DEBUG] Events query:', query);
    console.log('[DEBUG] Events params:', params);
    
    const [rows] = await pool.query(query, params);
    console.log('[DEBUG] Events result count:', rows.length);
    console.log('[DEBUG] Events:', rows.map(r => ({ tgl: r.tanggal_mulai, judul: r.judul })));
    
    res.json(rows);
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get events for specific date range
router.get('/range', verifyToken, async (req, res) => {
  try {
    const { start, end } = req.query;
    
    const [rows] = await pool.query(
      `SELECT id, judul, deskripsi, tanggal_mulai, tanggal_selesai, 
              tipe, warna
       FROM events
       WHERE tanggal_mulai <= ? AND tanggal_selesai >= ?
       ORDER BY tanggal_mulai ASC`,
      [end, start]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Get events range error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get holidays for specific date (for checking if today is holiday)
router.get('/holidays', verifyToken, async (req, res) => {
  try {
    const { date } = req.query;
    
    let query = `
      SELECT id, judul, deskripsi, tanggal_mulai, tanggal_selesai, 
             tipe, warna
      FROM events
      WHERE tipe = 'libur'
    `;
    const params = [];
    
    if (date) {
      query += ` AND (? BETWEEN tanggal_mulai AND tanggal_selesai)`;
      params.push(date);
    }
    
    query += ' ORDER BY tanggal_mulai ASC';
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get holidays for specific date (for checking if today is holiday)
router.get('/holidays', verifyToken, async (req, res) => {
  try {
    const { date, tahun } = req.query;
    
    let query = `
      SELECT id, judul, deskripsi, tanggal_mulai, tanggal_selesai, 
             tipe, warna
      FROM events
      WHERE tipe = 'libur'
    `;
    const params = [];
    
    if (date) {
      query += ` AND (? BETWEEN tanggal_mulai AND tanggal_selesai)`;
      params.push(date);
    }
    
    if (tahun) {
      query += ` AND YEAR(tanggal_mulai) = ?`;
      params.push(parseInt(tahun));
    }
    
    query += ' ORDER BY tanggal_mulai ASC';
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Create new event (admin only)
router.post('/', verifyAdmin, async (req, res) => {
  try {
    const { judul, deskripsi, tanggal_mulai, tanggal_selesai, tipe, warna } = req.body;
    
    if (!judul || !tanggal_mulai) {
      return res.status(400).json({ message: 'Judul dan tanggal mulai wajib diisi' });
    }
    
    const [result] = await pool.query(
      `INSERT INTO events (judul, deskripsi, tanggal_mulai, tanggal_selesai, tipe, warna)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [judul, deskripsi, tanggal_mulai, tanggal_selesai || tanggal_mulai, tipe || 'kegiatan', warna || 'blue']
    );
    
    res.json({
      message: 'Event berhasil ditambahkan',
      id: result.insertId
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update event (admin only)
router.put('/:id', verifyAdmin, async (req, res) => {
  try {
    const eventId = req.params.id;
    const { judul, deskripsi, tanggal_mulai, tanggal_selesai, tipe, warna } = req.body;
    
    if (!judul || !tanggal_mulai) {
      return res.status(400).json({ message: 'Judul dan tanggal mulai wajib diisi' });
    }
    
    await pool.query(
      `UPDATE events 
       SET judul = ?, deskripsi = ?, tanggal_mulai = ?, tanggal_selesai = ?, 
           tipe = ?, warna = ?
       WHERE id = ?`,
      [judul, deskripsi, tanggal_mulai, tanggal_selesai || tanggal_mulai, tipe || 'kegiatan', warna || 'blue', eventId]
    );
    
    res.json({ message: 'Event berhasil diperbarui' });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Delete event (admin only)
router.delete('/:id', verifyAdmin, async (req, res) => {
  try {
    const eventId = req.params.id;
    
    await pool.query('DELETE FROM events WHERE id = ?', [eventId]);
    
    res.json({ message: 'Event berhasil dihapus' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
