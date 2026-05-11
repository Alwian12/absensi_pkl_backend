const bcrypt = require('bcryptjs');
const { pool } = require('./config/database');

async function resetPasswords() {
  try {
    // Hash dengan bcryptjs (sama dengan yang di auth.js)
    const adminHash = await bcrypt.hash('admin123', 10);
    const pklHash = await bcrypt.hash('pkl123', 10);
    
    console.log('Admin hash:', adminHash);
    console.log('PKL hash:', pklHash);
    
    // Update admin password
    await pool.query(
      'UPDATE admins SET password = ? WHERE username = ?',
      [adminHash, 'admin']
    );
    console.log('✅ Admin password reset: admin123');
    
    // Update PKL password
    await pool.query(
      'UPDATE users_pkl SET password = ? WHERE nama = ?',
      [pklHash, 'Peserta Demo']
    );
    console.log('✅ PKL password reset: pkl123');
    
    console.log('\n🎉 Password berhasil direset!');
    console.log('Login:');
    console.log('  Admin: username=admin, password=admin123');
    console.log('  PKL: nama=Peserta Demo, password=pkl123');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

resetPasswords();
