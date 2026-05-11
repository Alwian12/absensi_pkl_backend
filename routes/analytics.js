const express = require('express');
const { pool } = require('../config/database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const router = express.Router();

// Get user statistics
router.get('/user-stats/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;
    
    // Get attendance stats
    const [attendanceStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_days,
        SUM(CASE WHEN status = 'hadir' THEN 1 ELSE 0 END) as hadir_count,
        SUM(CASE WHEN status = 'izin' THEN 1 ELSE 0 END) as izin_count,
        SUM(CASE WHEN status = 'sakit' THEN 1 ELSE 0 END) as sakit_count,
        SUM(CASE WHEN status = 'alpha' THEN 1 ELSE 0 END) as alpha_count,
        AVG(CASE WHEN jam_pulang IS NOT NULL THEN 
          TIMESTAMPDIFF(MINUTE, jam_masuk, jam_pulang) / 60.0 
          ELSE NULL END) as avg_work_hours
      FROM absensi 
      WHERE user_id = ? AND tanggal BETWEEN ? AND ?`,
      [userId, startDate || '2024-01-01', endDate || '2024-12-31']
    );
    
    // Get journal stats
    const [journalStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_journals,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
      FROM jurnal 
      WHERE user_id = ? AND tanggal BETWEEN ? AND ?`,
      [userId, startDate || '2024-01-01', endDate || '2024-12-31']
    );
    
    // Get daily breakdown
    const [dailyStats] = await pool.execute(
      `SELECT 
        tanggal,
        status,
        TIMESTAMPDIFF(MINUTE, jam_masuk, jam_pulang) / 60.0 as work_hours
      FROM absensi 
      WHERE user_id = ? AND tanggal BETWEEN ? AND ?
      ORDER BY tanggal DESC`,
      [userId, startDate || '2024-01-01', endDate || '2024-12-31']
    );
    
    res.json({
      attendance: attendanceStats[0],
      journals: journalStats[0],
      daily: dailyStats
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get admin dashboard stats
router.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const today = new Date().toISOString().split('T')[0];
    
    // Overall stats
    const [overallStats] = await pool.execute(
      `SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'pkl') as total_peserta,
        (SELECT COUNT(*) FROM absensi WHERE tanggal = ?) as attendance_today,
        (SELECT COUNT(*) FROM jurnal WHERE status = 'pending') as pending_journals,
        (SELECT COUNT(*) FROM izin WHERE status = 'pending') as pending_izin`
      , [today]
    );
    
    // Attendance breakdown for today
    const [todayAttendance] = await pool.execute(
      `SELECT 
        status,
        COUNT(*) as count
      FROM absensi 
      WHERE tanggal = ?
      GROUP BY status`,
      [today]
    );
    
    // Weekly attendance trend
    const [weeklyTrend] = await pool.execute(
      `SELECT 
        tanggal,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'hadir' THEN 1 ELSE 0 END) as hadir
      FROM absensi 
      WHERE tanggal >= DATE_SUB(?, INTERVAL 7 DAY)
      GROUP BY tanggal
      ORDER BY tanggal ASC`,
      [today]
    );
    
    // Top performers (most consistent attendance)
    const [topPerformers] = await pool.execute(
      `SELECT 
        u.nama,
        COUNT(*) as attendance_count,
        AVG(CASE WHEN a.jam_pulang IS NOT NULL THEN 
          TIMESTAMPDIFF(MINUTE, a.jam_masuk, a.jam_pulang) / 60.0 
          ELSE NULL END) as avg_hours
      FROM users u
      JOIN absensi a ON u.id = a.user_id
      WHERE a.tanggal BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND ?
        AND u.role = 'pkl'
      GROUP BY u.id
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
    res.status(500).json({ message: 'Server error' });
  }
});

// Get attendance heatmap data
router.get('/attendance-heatmap/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;
    
    const [heatmapData] = await pool.execute(
      `SELECT 
        tanggal,
        status,
        jam_masuk,
        jam_pulang
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
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
