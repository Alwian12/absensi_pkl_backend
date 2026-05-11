const cron = require('node-cron');
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * AUTO-BACKUP CRON JOB
 * Jalan setiap hari jam 00:00 (tengah malam)
 * Backup database ke file SQL
 */

console.log('[BACKUP] Initializing auto-backup scheduler...');

// Jalan setiap hari jam 00:00 (tengah malam)
cron.schedule('0 0 * * *', async () => {
  console.log('========================================');
  console.log('[BACKUP] Database backup started at 00:00');
  console.log('========================================');

  try {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timestamp = date.toISOString().replace(/[:.]/g, '-');
    
    // Create backup directory
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFile = path.join(backupDir, `backup_${timestamp}.sql`);
    
    console.log(`[BACKUP] Creating backup: ${backupFile}`);

    // Get all tables
    const [tables] = await pool.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);

    let sqlContent = `-- Database Backup\n`;
    sqlContent += `-- Date: ${dateStr}\n`;
    sqlContent += `-- Time: ${date.toISOString()}\n\n`;
    sqlContent += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

    for (const table of tableNames) {
      console.log(`[BACKUP] Backing up table: ${table}`);
      
      // Get table structure
      const [structure] = await pool.query(`SHOW CREATE TABLE ${table}`);
      sqlContent += `-- Table: ${table}\n`;
      sqlContent += `DROP TABLE IF EXISTS ${table};\n`;
      sqlContent += `${structure[0]['Create Table']};\n\n`;

      // Get table data
      const [rows] = await pool.query(`SELECT * FROM ${table}`);
      
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]);
        sqlContent += `-- Data: ${table}\n`;
        sqlContent += `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`;
        
        const values = rows.map(row => {
          const escapedValues = columns.map(col => {
            const val = row[col];
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "\\'")}'`;
            if (typeof val === 'number') return val;
            if (typeof val === 'boolean') return val ? 1 : 0;
            if (val instanceof Date) return `'${val.toISOString()}'`;
            return `'${val}'`;
          });
          return `(${escapedValues.join(', ')})`;
        });
        
        sqlContent += values.join(',\n');
        sqlContent += ';\n\n';
      }
    }

    sqlContent += `SET FOREIGN_KEY_CHECKS = 1;\n`;

    // Write to file
    fs.writeFileSync(backupFile, sqlContent);
    
    const stats = fs.statSync(backupFile);
    console.log(`[BACKUP] ✓ Backup completed: ${backupFile}`);
    console.log(`[BACKUP] File size: ${(stats.size / 1024).toFixed(2)} KB`);

    // Clean old backups (keep last 30 days)
    const files = fs.readdirSync(backupDir);
    const backupFiles = files.filter(f => f.startsWith('backup_') && f.endsWith('.sql'));
    
    if (backupFiles.length > 30) {
      backupFiles.sort().slice(0, backupFiles.length - 30).forEach(file => {
        const filePath = path.join(backupDir, file);
        fs.unlinkSync(filePath);
        console.log(`[BACKUP] Deleted old backup: ${file}`);
      });
    }

    console.log('========================================');
    console.log('[BACKUP] Database backup completed successfully');
    console.log('========================================');

  } catch (error) {
    console.error('[BACKUP] Error in database backup:', error);
  }
}, {
  timezone: 'Asia/Jakarta'
});

console.log('[BACKUP] ✓ Auto-backup scheduler started - Will run daily at 00:00 (tengah malam) WIB');
console.log('[BACKUP] Backups will be saved in: /backend/backups/');
console.log('[BACKUP] Last 30 backups will be retained');

module.exports = cron;
