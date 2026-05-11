const { pool } = require('./config/database');

async function cekIzinLutfhi() {
  try {
    // Cari user LUTFHI
    const [users] = await pool.query(
      'SELECT id, nama FROM users_pkl WHERE nama LIKE ?',
      ['%LUTFHI%']
    );
    
    if (users.length === 0) {
      console.log('❌ User LUTFHI tidak ditemukan');
      return;
    }
    
    const userId = users[0].id;
    console.log(`User: ${users[0].nama} (ID: ${userId})`);
    console.log('');
    
    // Cek semua izin user
    const [izinList] = await pool.query(
      'SELECT * FROM izin WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    
    console.log(`Total izin: ${izinList.length}`);
    console.log('');
    
    for (const izin of izinList) {
      console.log(`ID: ${izin.id}`);
      console.log(`  Jenis: ${izin.jenis}`);
      console.log(`  Tanggal: ${izin.tanggal_mulai} s/d ${izin.tanggal_selesai}`);
      console.log(`  Alasan: ${izin.alasan}`);
      console.log(`  Status: ${izin.status}`);
      console.log(`  Dibuat: ${izin.created_at}`);
      console.log('');
    }
    
    // Cek izin yang aktif hari ini
    const [izinToday] = await pool.query(
      `SELECT * FROM izin 
       WHERE user_id = ? 
       AND status = 'disetujui'
       AND CURDATE() BETWEEN tanggal_mulai AND tanggal_selesai`,
      [userId]
    );
    
    console.log(`Izin aktif hari ini: ${izinToday.length}`);
    if (izinToday.length > 0) {
      console.log('✅ Ada izin yang aktif, check-out seharusnya BERHASIL');
    } else {
      console.log('❌ Tidak ada izin aktif hari ini');
      console.log('   Solusi: Admin harus approve izin dulu');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

cekIzinLutfhi();
