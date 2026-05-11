const cron = require('node-cron');
const { pool } = require('../config/database');

/**
 * AUTO-ALPHA CRON JOB
 * Jalan setiap hari jam 18:00 (6 sore)
 * Auto-mark user yang belum absen sebagai alpha (tidak_hadir)
 */

console.log('[CRON] Initializing auto-alpha scheduler...');

// Jalan setiap hari jam 18:00 (6 sore)
cron.schedule('0 18 * * *', async () => {
  console.log('========================================');
  console.log('[CRON] Auto-alpha check started at 18:00');
  console.log('========================================');

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[CRON] Checking date: ${today}`);

    // Get semua user PKL
    const [users] = await pool.query(
      'SELECT id, nama FROM users WHERE role = "pkl"'
    );

    console.log(`[CRON] Found ${users.length} PKL users`);

    let alphaCount = 0;
    let alreadyMarkedCount = 0;

    for (const user of users) {
      // Cek apakah sudah ada record absensi hari ini
      const [absensi] = await pool.query(
        'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
        [user.id, today]
      );

      // Jika tidak ada record → Insert alpha
      if (absensi.length === 0) {
        await pool.query(
          `INSERT INTO absensi (user_id, tanggal, status_check_in, check_in, check_out, created_at, updated_at)
           VALUES (?, ?, 'tidak_hadir', NULL, NULL, NOW(), NOW())`,
          [user.id, today]
        );
        
        alphaCount++;
        console.log(`[CRON] ✓ Marked user ${user.nama} (ID: ${user.id}) as ALPHA for ${today}`);
      } else {
        alreadyMarkedCount++;
        console.log(`[CRON] - User ${user.nama} (ID: ${user.id}) already has attendance record`);
      }
    }

    console.log('========================================');
    console.log(`[CRON] Auto-alpha check completed`);
    console.log(`[CRON] Total users checked: ${users.length}`);
    console.log(`[CRON] Marked as ALPHA: ${alphaCount}`);
    console.log(`[CRON] Already marked: ${alreadyMarkedCount}`);
    console.log('========================================');

  } catch (error) {
    console.error('[CRON] Error in auto-alpha check:', error);
  }
}, {
  timezone: 'Asia/Jakarta' // WIB
});

console.log('[CRON] ✓ Auto-alpha scheduler started - Will run daily at 18:00 (6 sore) WIB');
console.log('[CRON] All users who haven\'t checked in by 18:00 will be auto-marked as ALPHA');

module.exports = cron;
