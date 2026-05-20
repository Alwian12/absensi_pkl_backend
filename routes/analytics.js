const express = require('express');
const { pool } = require('../config/database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

const getDefaultRange = (startDate, endDate) => [
  startDate || `${new Date().getFullYear()}-01-01`,
  endDate || `${new Date().getFullYear()}-12-31`
];

// Get user attendance statistics
router.get('/user-stats/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const [startDate, endDate] = getDefaultRange(req.query.startDate, req.query.endDate);

    if (req.user.role !== 'admin' && Number(req.user.id) !== Number(userId)) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses ke data ini' });
    }

    const [attendanceStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_days,
        SUM(CASE WHEN status_check_in IN ('tepat_waktu', 'terlambat') THEN 1 ELSE 0 END) as hadir_count,
        SUM(CASE WHEN status_check_in = 'tepat_waktu' THEN 1 ELSE 0 END) as tepat_waktu_count,
        SUM(CASE WHEN status_check_in = 'terlambat' THEN 1 ELSE 0 END) as terlambat_count,
        SUM(CASE WHEN status_check_in = 'izin' THEN 1 ELSE 0 END) as izin_count,
        SUM(CASE WHEN status_check_in = 'tidak_hadir' THEN 1 ELSE 0 END) as alpha_count,
        AVG(CASE WHEN check_in IS NOT NULL AND check_out IS NOT NULL THEN 
          TIMESTAMPDIFF(MINUTE, check_in, check_out) / 60.0 
          ELSE NULL END) as avg_work_hours
      FROM absensi 
      WHERE user_id = ? AND tanggal BETWEEN ? AND ?`,
      [userId, startDate, endDate]
    );

    const [dailyStats] = await pool.execute(
      `SELECT 
        tanggal,
        check_in,
        check_out,
        status_check_in,
        status_check_out,
        TIMESTAMPDIFF(MINUTE, check_in, check_out) / 60.0 as work_hours
      FROM absensi 
      WHERE user_id = ? AND tanggal BETWEEN ? AND ?
      ORDER BY tanggal DESC`,
      [userId, startDate, endDate]
    );

    res.json({
      attendance: attendanceStats[0],
      daily: dailyStats
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get admin dashboard stats
router.get('/admin-stats', verifyAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [overallStats] = await pool.execute(
      `SELECT 
        (SELECT COUNT(*) FROM users_pkl WHERE status = 'aktif') as total_pegawai,
        (SELECT COUNT(*) FROM absensi WHERE tanggal = ? AND check_in IS NOT NULL) as attendance_today,
        (SELECT COUNT(*) FROM izin WHERE status = 'pending') as pending_izin`,
      [today]
    );

    const [todayAttendance] = await pool.execute(
      `SELECT 
        status_check_in as status,
        COUNT(*) as count
      FROM absensi 
      WHERE tanggal = ?
      GROUP BY status_check_in`,
      [today]
    );

    const [weeklyTrend] = await pool.execute(
      `SELECT 
        tanggal,
        COUNT(*) as total,
        SUM(CASE WHEN status_check_in IN ('tepat_waktu', 'terlambat') THEN 1 ELSE 0 END) as hadir
      FROM absensi 
      WHERE tanggal >= DATE_SUB(?, INTERVAL 7 DAY)
      GROUP BY tanggal
      ORDER BY tanggal ASC`,
      [today]
    );

    const [topPerformers] = await pool.execute(
      `SELECT 
        u.nama,
        COUNT(*) as attendance_count,
        AVG(CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN 
          TIMESTAMPDIFF(MINUTE, a.check_in, a.check_out) / 60.0 
          ELSE NULL END) as avg_hours
      FROM users_pkl u
      JOIN absensi a ON u.id = a.user_id
      WHERE a.tanggal BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND ?
        AND u.status = 'aktif'
        AND a.status_check_in IN ('tepat_waktu', 'terlambat')
      GROUP BY u.id, u.nama
      ORDER BY attendance_count DESC, avg_hours DESC
      LIMIT 5`,
      [today, today]
    );

    res.json({
      overall: overallStats[0],
      todayAttendance,
      weeklyTrend,
      topPerformers
    });
  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get attendance heatmap data
router.get('/attendance-heatmap/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;

    if (req.user.role !== 'admin' && Number(req.user.id) !== Number(userId)) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses ke data ini' });
    }

    const [heatmapData] = await pool.execute(
      `SELECT 
        tanggal,
        status_check_in,
        check_in,
        check_out
      FROM absensi 
      WHERE user_id = ? 
        AND YEAR(tanggal) = ? 
        AND MONTH(tanggal) = ?
      ORDER BY tanggal ASC`,
      [userId, year || new Date().getFullYear(), month || new Date().getMonth() + 1]
    );

    res.json(heatmapData);
  } catch (error) {
    console.error('Heatmap error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
