const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

// Fallback JWT_SECRET if not set in .env
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'absensi_pkl_secure_key_2024_random_string_for_jwt_token_generation';
  console.log('⚠️  Warning: Using default JWT_SECRET. Please set JWT_SECRET in .env file');
}

const { testConnection, pool } = require('./config/database');

// Import auto-alpha cron job
require('./cron/autoAlpha');

// Import auto-backup cron job
require('./cron/autoBackup');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration - MUST be first, before any other middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "http://localhost:3000", "http://localhost:3001"],
      mediaSrc: ["'self'", "data:", "blob:", "http://localhost:3000"],
      connectSrc: ["'self'", "http://localhost:*", "ws://localhost:*"],
      fontSrc: ["'self'", "data:"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// Rate limiting - ENABLED for production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Terlalu banyak request, silakan coba lagi nanti',
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' // Skip for localhost
});
app.use(limiter);

// Auth rate limiting - stricter for login attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Terlalu banyak percobaan login, silakan coba lagi dalam 15 menit'
});

// Static file serving for uploads - MUST BE FIRST before body parsers
const uploadsPath = path.join(__dirname, 'uploads');
console.log('[DEBUG] Uploads path:', uploadsPath);

// Custom static file serving with better error handling
app.use('/uploads', (req, res, next) => {
  const filePath = path.join(uploadsPath, req.path);
  console.log('[STATIC] Request:', req.path);
  console.log('[STATIC] Full path:', filePath);
  
  // Set CORS headers to allow cross-origin requests (spesifik origin untuk credentials)
  const allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Set no-cache headers to prevent browser caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Check if file exists
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      console.log('[STATIC] Serving file:', filePath);
      return res.sendFile(filePath, (err) => {
        if (err) {
          console.error('[STATIC] Error serving file:', err);
          res.status(500).send('Error serving file');
        }
      });
    } else {
      console.log('[STATIC] Not a file:', filePath);
      return res.status(404).send('Not a file');
    }
  } else {
    console.log('[STATIC] File not found:', filePath);
    return res.status(404).send('File not found');
  }
});

// Body parsers (after static files)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure uploads directories exist
const requiredDirs = ['uploads/absensi', 'uploads/jurnal/foto', 'uploads/jurnal/ttd', 'uploads/izin/lampiran', 'uploads/admin/ttd', 'uploads/profile'];
requiredDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`Created directory: ${fullPath}`);
  }
});

// Routes with rate limiting
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/absensi', require('./routes/absensi'));
app.use('/api/jurnal', require('./routes/jurnal'));
app.use('/api/izin', require('./routes/izin'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/export', require('./routes/export'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/audit', require('./routes/audit'));

// Debug route for static files
app.get('/debug/file/:filename(*)', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(uploadsPath, filename);
  console.log('[DEBUG] Checking file:', filepath);
  
  if (fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    res.json({
      exists: true,
      path: filepath,
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    });
  } else {
    res.status(404).json({
      exists: false,
      path: filepath,
      message: 'File not found'
    });
  }
});
app.use('/api/settings', require('./routes/settings'));
app.use('/api/events', require('./routes/events'));
app.use('/api/penilaian', require('./routes/penilaian'));

// Swagger API Documentation
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Absensi PKL API',
      version: '1.0.0',
      description: 'API Documentation for Absensi PKL System',
      contact: {
        name: 'API Support',
        email: 'support@absensi-pkl.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./routes/*.js', './routes/**/*.js']
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
console.log('[SWAGGER] API Documentation available at http://localhost:3001/api-docs');

// Root endpoint - MUST be before error handlers
app.get('/', (req, res) => {
  res.json({
    message: 'Absensi PKL API',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: ['/api/auth', '/api/admin', '/api/health']
  });
});

// Health check endpoint - for Railway healthcheck
app.get('/api/health', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
    connection.release();
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Error handling - 404 handler for static files
app.use((req, res, next) => {
  if (!res.headersSent) {
    res.status(404).json({ message: 'Not found' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Don't send error if headers already sent
  if (res.headersSent) {
    return next(err);
  }
  
  // If it's a 404 error from static files, let it be 404
  if (err.status === 404 || err.statusCode === 404) {
    return res.status(404).json({ message: 'Not found' });
  }
  
  // For other errors, return 500 (not 503)
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize database
const initDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    
    // Create database if not exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'absensi_pkl'}`);
    await connection.query(`USE ${process.env.DB_NAME || 'absensi_pkl'}`);
    
    // Create tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS unit_kantor (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama_unit VARCHAR(100) NOT NULL,
        alamat TEXT,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        radius_meter INT DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama VARCHAR(100) NOT NULL,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        nip VARCHAR(30),
        jabatan VARCHAR(100),
        no_hp VARCHAR(20),
        ttd TEXT,
        is_active TINYINT(1) DEFAULT 1,
        unit_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (unit_id) REFERENCES unit_kantor(id)
      )
    `);
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users_pkl (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE,
        password VARCHAR(255) NOT NULL,
        nis VARCHAR(30),
        nim VARCHAR(30),
        asal_sekolah VARCHAR(100),
        jurusan VARCHAR(50),
        tanggal_mulai DATE,
        tanggal_selesai DATE,
        unit_id INT,
        status ENUM('aktif', 'selesai', 'nonaktif') DEFAULT 'aktif',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (unit_id) REFERENCES unit_kantor(id)
      )
    `);
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS absensi (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        tanggal DATE NOT NULL,
        check_in TIME,
        check_out TIME,
        lat_check_in DECIMAL(10, 8),
        lng_check_in DECIMAL(11, 8),
        lat_check_out DECIMAL(10, 8),
        lng_check_out DECIMAL(11, 8),
        foto_check_in TEXT,
        foto_check_out TEXT,
        status_check_in ENUM('tepat_waktu', 'terlambat', 'tidak_hadir', 'izin') DEFAULT 'tidak_hadir',
        status_check_out ENUM('tepat_waktu', 'pulang_cepat', 'pulang_cepat_izin', 'lewat') DEFAULT 'lewat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users_pkl(id),
        UNIQUE KEY unique_absensi_per_hari (user_id, tanggal)
      )
    `);
    
    // Alter table to add foto columns if they don't exist (for existing tables)
    try {
      await connection.query(`ALTER TABLE absensi ADD COLUMN IF NOT EXISTS foto_check_in TEXT`);
      await connection.query(`ALTER TABLE absensi ADD COLUMN IF NOT EXISTS foto_check_out TEXT`);
    } catch (alterError) {
      // Columns might already exist, ignore error
      console.log('Note: foto columns may already exist');
    }
    
    // Alter table to update ENUMs
    try {
      await connection.query(`
        ALTER TABLE absensi 
        MODIFY COLUMN status_check_out 
        ENUM('tepat_waktu', 'pulang_cepat', 'pulang_cepat_izin', 'lewat') 
        DEFAULT 'lewat'
      `);
      console.log('✅ ENUM status_check_out updated');
    } catch (enumError) {
      console.log('Note: ENUM status_check_out may already be correct');
    }
    
    try {
      await connection.query(`
        ALTER TABLE absensi 
        MODIFY COLUMN status_check_in 
        ENUM('tepat_waktu', 'terlambat', 'tidak_hadir', 'izin') 
        DEFAULT 'tidak_hadir'
      `);
      console.log('✅ ENUM status_check_in updated');
    } catch (enumError) {
      console.log('Note: ENUM status_check_in may already be correct');
    }
    
    // Create security logs table for anti-fake GPS monitoring
    await connection.query(`
      CREATE TABLE IF NOT EXISTS absensi_security_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        tanggal DATE NOT NULL,
        check_type ENUM('checkin', 'checkout') NOT NULL,
        alerts JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users_pkl(id)
      )
    `);
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS jurnal (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        tanggal DATE NOT NULL,
        nomor_kegiatan VARCHAR(10),
        nama_pekerjaan VARCHAR(255),
        kegiatan TEXT NOT NULL,
        deskripsi TEXT,
        tanggal_selesai DATE,
        kompetensi TEXT,
        alat_bahan TEXT,
        uraian_kerja TEXT,
        keterangan TEXT,
        foto TEXT,
        status_pembimbing ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        catatan_pembimbing TEXT,
        pembimbing_id INT,
        ttd_pembimbing TEXT,
        approved_at TIMESTAMP NULL,
        is_draft TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users_pkl(id),
        FOREIGN KEY (pembimbing_id) REFERENCES admins(id)
      )
    `);
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS izin (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        tanggal_mulai DATE NOT NULL,
        tanggal_selesai DATE NOT NULL,
        jenis ENUM('sakit', 'izin', 'cuti', 'pulang_cepat') NOT NULL,
        alasan TEXT NOT NULL,
        lampiran VARCHAR(255),
        status ENUM('pending', 'disetujui', 'ditolak') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users_pkl(id)
      )
    `);
    
    // Create events table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        judul VARCHAR(255) NOT NULL,
        deskripsi TEXT,
        tanggal_mulai DATE NOT NULL,
        tanggal_selesai DATE,
        tipe ENUM('kegiatan', 'libur', 'deadline') DEFAULT 'kegiatan',
        warna VARCHAR(20) DEFAULT 'blue',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create penilaian table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS penilaian (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        periode_mulai DATE NOT NULL,
        periode_selesai DATE NOT NULL,
        kehadiran_nilai DECIMAL(5,2) DEFAULT 0,
        kehadiran_keterangan TEXT,
        sikap_nilai DECIMAL(5,2) DEFAULT 0,
        sikap_keterangan TEXT,
        kinerja_nilai DECIMAL(5,2) DEFAULT 0,
        kinerja_keterangan TEXT,
        jurnal_nilai DECIMAL(5,2) DEFAULT 0,
        jurnal_keterangan TEXT,
        laporan_nilai DECIMAL(5,2) DEFAULT 0,
        laporan_keterangan TEXT,
        total_nilai DECIMAL(5,2) DEFAULT 0,
        grade VARCHAR(5),
        catatan_pembimbing TEXT,
        status ENUM('draft', 'final') DEFAULT 'draft',
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users_pkl(id),
        FOREIGN KEY (created_by) REFERENCES admins(id)
      )
    `);
    
    // Create kriteria_penilaian table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS kriteria_penilaian (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kategori VARCHAR(50) NOT NULL,
        nama_kriteria VARCHAR(100) NOT NULL,
        bobot DECIMAL(5,2) DEFAULT 0,
        deskripsi TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add missing columns to existing tables (safe ALTER)
    const alterIfNotExists = async (table, column, definition) => {
      try {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`✅ Added ${table}.${column}`);
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
          // Column already exists, ignore
        } else {
          console.log(`Note: ${table}.${column} - ${e.message}`);
        }
      }
    };
    
    // Admins missing columns
    await alterIfNotExists('admins', 'nip', 'VARCHAR(30)');
    await alterIfNotExists('admins', 'jabatan', 'VARCHAR(100)');
    await alterIfNotExists('admins', 'no_hp', 'VARCHAR(20)');
    await alterIfNotExists('admins', 'ttd', 'TEXT');
    await alterIfNotExists('admins', 'is_active', 'TINYINT(1) DEFAULT 1');
    
    // Users_pkl missing columns
    await alterIfNotExists('users_pkl', 'nis', 'VARCHAR(30)');
    await alterIfNotExists('users_pkl', 'nim', 'VARCHAR(30)');
    
    // Jurnal missing columns
    await alterIfNotExists('jurnal', 'nomor_kegiatan', 'VARCHAR(10)');
    await alterIfNotExists('jurnal', 'nama_pekerjaan', 'VARCHAR(255)');
    await alterIfNotExists('jurnal', 'tanggal_selesai', 'DATE');
    await alterIfNotExists('jurnal', 'kompetensi', 'TEXT');
    await alterIfNotExists('jurnal', 'alat_bahan', 'TEXT');
    await alterIfNotExists('jurnal', 'uraian_kerja', 'TEXT');
    await alterIfNotExists('jurnal', 'keterangan', 'TEXT');
    await alterIfNotExists('jurnal', 'foto', 'TEXT');
    await alterIfNotExists('jurnal', 'status_pembimbing', "ENUM('pending', 'approved', 'rejected') DEFAULT 'pending'");
    await alterIfNotExists('jurnal', 'catatan_pembimbing', 'TEXT');
    await alterIfNotExists('jurnal', 'pembimbing_id', 'INT');
    await alterIfNotExists('jurnal', 'ttd_pembimbing', 'TEXT');
    await alterIfNotExists('jurnal', 'approved_at', 'TIMESTAMP NULL');
    await alterIfNotExists('jurnal', 'is_draft', 'TINYINT(1) DEFAULT 0');
    
    // Izin missing columns
    await alterIfNotExists('izin', 'lampiran', 'VARCHAR(255)');
    await alterIfNotExists('izin', 'updated_at', 'TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP');
    
    // Fix izin jenis ENUM to include pulang_cepat
    try {
      await connection.query(`
        ALTER TABLE izin 
        MODIFY COLUMN jenis ENUM('sakit', 'izin', 'cuti', 'pulang_cepat') NOT NULL
      `);
      console.log('✅ ENUM izin.jenis updated with pulang_cepat');
    } catch (e) {
      console.log('Note: izin.jenis ENUM may already be correct');
    }
    
    // Insert default data
    const [unitRows] = await connection.query('SELECT COUNT(*) as count FROM unit_kantor');
    if (unitRows[0].count === 0) {
      await connection.query(`
        INSERT INTO unit_kantor (nama_unit, alamat, latitude, longitude, radius_meter) 
        VALUES ('Dinas Kominfo', 'Jl. Contoh No. 123, Kota', -6.2088, 106.8456, 100)
      `);
    }
    
    const [adminRows] = await connection.query('SELECT COUNT(*) as count FROM admins');
    if (adminRows[0].count === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await connection.query(`
        INSERT INTO admins (nama, username, password, unit_id) 
        VALUES ('Administrator', 'admin', ?, 1)
      `, [hashedPassword]);
    }
    
    const [userRows] = await connection.query('SELECT COUNT(*) as count FROM users_pkl');
    if (userRows[0].count === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('pkl123', 10);
      await connection.query(`
        INSERT INTO users_pkl (nama, email, password, asal_sekolah, jurusan, tanggal_mulai, tanggal_selesai, unit_id) 
        VALUES ('Peserta Demo', 'pkl@demo.com', ?, 'SMK Demo', 'RPL', '2024-01-01', '2024-06-30', 1)
      `, [hashedPassword]);
    }
    
    console.log('✅ Database initialized');
    connection.release();
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
  }
};

// Start server
const startServer = async () => {
  await testConnection();
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
};

startServer();
