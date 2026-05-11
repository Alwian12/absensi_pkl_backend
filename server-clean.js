const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'],
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));

// Ensure directories exist
const requiredDirs = ['uploads/absensi', 'uploads/jurnal/foto', 'uploads/izin', 'uploads/profile'];
requiredDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`Created: ${fullPath}`);
  }
});

// JWT Secret fallback
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'absensi_pkl_secure_key_2024_random_string_for_jwt_token_generation';
  console.log('⚠️ Using fallback JWT_SECRET');
}

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/absensi', require('./routes/absensi'));
app.use('/api/jurnal', require('./routes/jurnal'));
app.use('/api/izin', require('./routes/izin'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/export', require('./routes/export'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/events', require('./routes/events'));
app.use('/api/penilaian', require('./routes/penilaian'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
