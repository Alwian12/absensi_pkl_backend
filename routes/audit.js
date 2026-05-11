const express = require('express');
const { pool } = require('../config/database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

const router = express.Router();

// Create audit_logs table if not exists
router.post('/init', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        admin_name VARCHAR(255) NOT NULL,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INT,
        old_values JSON,
        new_values JSON,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
      )
    `);
    
    // Create index for faster queries
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)');
    
    res.json({ message: 'Audit logs table initialized successfully' });
  } catch (error) {
    console.error('Audit logs init error:', error);
    res.status(500).json({ message: 'Failed to initialize audit logs' });
  }
});

// Log audit action (helper function)
const logAudit = async (adminId, adminName, action, entityType, entityId, oldValues, newValues, ip, userAgent) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (admin_id, admin_name, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminId,
        adminName,
        action,
        entityType,
        entityId,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ip,
        userAgent
      ]
    );
  } catch (error) {
    console.error('[Audit] Error logging action:', error);
  }
};

// Get all audit logs
router.get('/', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { limit = 100, offset = 0, action, entity_type, start_date, end_date } = req.query;
    
    let query = `
      SELECT * FROM audit_logs
      WHERE 1=1
    `;
    const params = [];
    
    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    
    if (entity_type) {
      query += ' AND entity_type = ?';
      params.push(entity_type);
    }
    
    if (start_date) {
      query += ' AND created_at >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      query += ' AND created_at <= ?';
      params.push(end_date);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [logs] = await pool.query(query, params);
    
    res.json(logs);
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ message: 'Failed to get audit logs' });
  }
});

// Get audit logs statistics
router.get('/stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        action,
        entity_type,
        COUNT(*) as count,
        DATE(created_at) as date
      FROM audit_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY action, entity_type, DATE(created_at)
      ORDER BY date DESC, count DESC
    `);
    
    res.json(stats);
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ message: 'Failed to get audit statistics' });
  }
});

module.exports = router;
module.exports.logAudit = logAudit;
