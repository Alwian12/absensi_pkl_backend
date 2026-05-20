const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { sanitizeInput, validateRequired } = require('../middleware/validator');
const { verifyToken } = require('../middleware/auth');
const { generateResetToken, sendResetEmail } = require('../utils/emailService');

const router = express.Router();

// Apply sanitization to all auth routes
router.use(sanitizeInput);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nama
 *               - password
 *             properties:
 *               nama:
 *                 type: string
 *                 example: "budi"
 *               password:
 *                 type: string
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *       401:
 *         description: Invalid credentials
 */
// Login user
router.post('/login', validateRequired(['nama', 'password']), async (req, res) => {
  try {
    const { nama, password } = req.body;
    
    if (!nama || !password) {
      return res.status(400).json({ message: 'Nama dan password wajib diisi' });
    }
    
    const [rows] = await pool.query(
      'SELECT * FROM users_pkl WHERE nama = ? AND status = "aktif"',
      [nama]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Nama atau password salah' });
    }
    
    const user = rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Nama atau password salah' });
    }
    
    const token = jwt.sign(
      { 
        id: user.id, 
        nama: user.nama, 
        role: 'pkl',
        unit_id: user.unit_id 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    res.json({
      message: 'Login berhasil',
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        asal_sekolah: user.asal_sekolah,
        jurusan: user.jurusan
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Login Admin
router.post('/admin/login', validateRequired(['username', 'password']), async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username dan password wajib diisi' });
    }
    
    const [rows] = await pool.query(
      'SELECT * FROM admins WHERE username = ?',
      [username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Username atau password salah' });
    }
    
    const admin = rows[0];
    const isValidPassword = await bcrypt.compare(password, admin.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Username atau password salah' });
    }
    
    const token = jwt.sign(
      { 
        id: admin.id, 
        nama: admin.nama, 
        role: 'admin',
        unit_id: admin.unit_id 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    res.json({
      message: 'Login berhasil',
      token,
      user: {
        id: admin.id,
        nama: admin.nama,
        username: admin.username,
        role: 'admin'
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get current user profile
router.get('/me', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nama, email, no_hp, asal_sekolah, jurusan, tanggal_mulai, tanggal_selesai, unit_id FROM users_pkl WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { nama, email, no_hp, asal_sekolah, jurusan } = req.body;
    
    // Validation
    if (!nama || nama.trim().length < 3) {
      return res.status(400).json({ message: 'Nama minimal 3 karakter' });
    }
    
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Format email tidak valid' });
    }
    
    if (no_hp && !/^[0-9\-\+\s]{10,15}$/.test(no_hp)) {
      return res.status(400).json({ message: 'Format nomor HP tidak valid' });
    }
    
    await pool.query(
      'UPDATE users_pkl SET nama = ?, email = ?, no_hp = ?, asal_sekolah = ?, jurusan = ? WHERE id = ?',
      [nama.trim(), email || null, no_hp || null, asal_sekolah || null, jurusan || null, req.user.id]
    );
    res.json({ message: 'Profil berhasil diperbarui' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Change password
router.put('/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Password saat ini dan password baru wajib diisi' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password baru minimal 6 karakter' });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Konfirmasi password tidak cocok' });
    }
    
    const [rows] = await pool.query('SELECT password FROM users_pkl WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }
    
    const isValid = await bcrypt.compare(currentPassword, rows[0].password);
    if (!isValid) {
      return res.status(400).json({ message: 'Password saat ini salah' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users_pkl SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
    
    res.json({ message: 'Password berhasil diubah' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Forgot Password - Request reset link
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email wajib diisi' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Format email tidak valid' });
    }
    
    // Check if user exists
    const [users] = await pool.query(
      'SELECT id, nama, email FROM users_pkl WHERE email = ?',
      [email]
    );
    
    if (users.length === 0) {
      // Don't reveal that user doesn't exist
      return res.json({ message: 'Jika email terdaftar, link reset akan dikirim' });
    }
    
    const user = users[0];
    
    // Generate reset token
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
    
    // Save reset token to database (create table if not exists)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users_pkl(id) ON DELETE CASCADE
      )
    `);
    
    // Delete old tokens for this user
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
    
    // Insert new token
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, resetToken, expiresAt]
    );
    
    // Send email
    const emailSent = await sendResetEmail(email, resetToken);
    
    if (emailSent) {
      res.json({ message: 'Link reset password telah dikirim ke email Anda' });
    } else {
      res.status(500).json({ message: 'Gagal mengirim email reset password' });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Reset Password - Reset with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;
    
    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Token dan password baru wajib diisi' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password baru minimal 6 karakter' });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Konfirmasi password tidak cocok' });
    }
    
    // Find valid token
    const [tokens] = await pool.query(
      'SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ? AND expires_at > NOW()',
      [token]
    );
    
    if (tokens.length === 0) {
      return res.status(400).json({ message: 'Token invalid atau kadaluarsa' });
    }
    
    const userId = tokens[0].user_id;
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await pool.query('UPDATE users_pkl SET password = ? WHERE id = ?', [hashedPassword, userId]);
    
    // Delete used token
    await pool.query('DELETE FROM password_reset_tokens WHERE token = ?', [token]);
    
    res.json({ message: 'Password berhasil di-reset' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;
