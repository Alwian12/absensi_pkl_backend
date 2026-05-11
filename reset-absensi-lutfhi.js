const { pool } = require('./config/database');
const { format } = require('date-fns');

async function resetAbsensiLutfhi() {
  try {
    const today = format(new Date(), 'yyyy-MM-dd');
    
    console.log('Mencari user LUTFHI ALFADHILLAH...');
    
    // Cari user
    const [users] = await pool.query(
      'SELECT id, nama FROM users_pkl WHERE nama LIKE ?',
      ['%LUTFHI%']
    );
    
    if (users.length === 0) {
      console.log('❌ User LUTFHI ALFADHILLAH tidak ditemukan');
      process.exit(1);
    }
    
    const userId = users[0].id;
    const userName = users[0].nama;
    
    console.log(`✅ User ditemukan: ${userName} (ID: ${userId})`);
    
    // Cek data absensi hari ini
    const [absensi] = await pool.query(
      'SELECT * FROM absensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );
    
    if (absensi.length === 0) {
      console.log('❌ Tidak ada data absensi untuk hari ini');
      process.exit(1);
    }
    
    const data = absensi[0];
    console.log('Data absensi saat ini:');
    console.log(`  - Check-in: ${data.check_in || 'Belum'}`);
    console.log(`  - Check-out: ${data.check_out || 'Belum'}`);
    console.log(`  - Status check-out: ${data.status_check_out || '-'}`);
    
    // Reset check-out (hapus data check-out)
    await pool.query(
      `UPDATE absensi 
       SET check_out = NULL, 
           lat_check_out = NULL, 
           lng_check_out = NULL, 
           status_check_out = 'lewat',
           foto_check_out = NULL
       WHERE user_id = ? AND tanggal = ?`,
      [userId, today]
    );
    
    console.log('✅ Berhasil reset check-out!');
    console.log('User sekarang bisa check-out lagi dengan normal.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

resetAbsensiLutfhi();
