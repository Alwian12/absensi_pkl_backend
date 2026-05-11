const express = require('express');
const { pool } = require('../config/database');
const { verifyAdmin, verifyToken } = require('../middleware/auth');

const router = express.Router();

// Get server time (public endpoint for device time validation)
router.get('/', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT NOW() as serverTime');
    res.json({
      serverTime: result[0].serverTime,
      timezone: 'Asia/Jakarta'
    });
  } catch (error) {
    console.error('Get server time error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get office location (public - for geofencing validation)
router.get('/office-location-public', async (req, res) => {
  try {
    // Get the default/first office location
    const [rows] = await pool.query(
      'SELECT nama_unit, alamat, latitude, longitude, radius_meter FROM unit_kantor LIMIT 1'
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Lokasi kantor tidak ditemukan' });
    }
    
    res.json({
      nama_unit: rows[0].nama_unit,
      alamat: rows[0].alamat,
      latitude: rows[0].latitude,
      longitude: rows[0].longitude,
      radius: rows[0].radius_meter
    });
  } catch (error) {
    console.error('Get office location error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get office location
router.get('/office-location', verifyAdmin, async (req, res) => {
  try {
    const unitId = req.user.unit_id;
    
    const [rows] = await pool.query(
      'SELECT nama_unit, alamat, latitude, longitude, radius_meter FROM unit_kantor WHERE id = ?',
      [unitId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Lokasi kantor tidak ditemukan' });
    }
    
    res.json({
      nama_unit: rows[0].nama_unit,
      alamat: rows[0].alamat,
      latitude: rows[0].latitude,
      longitude: rows[0].longitude,
      radius: rows[0].radius_meter
    });
  } catch (error) {
    console.error('Get office location error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update office location
router.put('/office-location', verifyAdmin, async (req, res) => {
  try {
    const unitId = req.user.unit_id;
    const { nama_unit, alamat, latitude, longitude, radius_meter } = req.body;
    
    await pool.query(
      `UPDATE unit_kantor 
       SET nama_unit = ?, alamat = ?, latitude = ?, longitude = ?, radius_meter = ?
       WHERE id = ?`,
      [nama_unit, alamat, latitude, longitude, radius_meter, unitId]
    );
    
    res.json({ message: 'Pengaturan lokasi berhasil diperbarui' });
  } catch (error) {
    console.error('Update office location error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
