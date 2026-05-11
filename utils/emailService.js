const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Generate reset token
const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send reset password email
const sendResetEmail = async (email, resetToken) => {
  try {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Absensi PKL" <noreply@absensi-pkl.com>',
      to: email,
      subject: 'Reset Password - Absensi PKL',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Reset Password</h2>
          <p>Anda menerima email ini karena ada permintaan reset password untuk akun Anda.</p>
          <p>Klik tombol di bawah ini untuk reset password:</p>
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset Password</a>
          <p>Atau copy link ini ke browser:</p>
          <p style="background-color: #f4f4f4; padding: 10px; word-break: break-all;">${resetUrl}</p>
          <p style="color: #666; font-size: 14px;">Link ini akan kadaluarsa dalam 1 jam.</p>
          <p style="color: #666; font-size: 14px;">Jika Anda tidak meminta reset password, abaikan email ini.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[Email] Error sending reset email:', error);
    return false;
  }
};

module.exports = {
  transporter,
  generateResetToken,
  sendResetEmail
};
