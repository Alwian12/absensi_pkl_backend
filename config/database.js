const mysql = require('mysql2/promise');
require('dotenv').config();

// Support Railway MySQL URL format
const getDbConfig = () => {
  // If Railway provides MYSQL_URL
  if (process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL) {
    const dbUrl = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;
    console.log('🚂 Using Railway MySQL URL');
    return dbUrl;
  }
  
  // Otherwise use individual env vars
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'absensi_pkl',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
};

const pool = mysql.createPool(getDbConfig());

// Test connection
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    connection.release();
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
  }
};

module.exports = { pool, testConnection };
