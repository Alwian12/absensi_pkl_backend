const { transporter } = require('./emailService');

// Send journal approval notification
const sendJournalApprovalEmail = async (userEmail, userName, journalKegiatan, feedback) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Absensi PKL" <noreply@absensi-pkl.com>',
      to: userEmail,
      subject: '✅ Jurnal Anda Disetujui',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #22c55e;">Jurnal Disetujui</h2>
          <p>Halo <strong>${userName}</strong>,</p>
          <p>Jurnal Anda telah <strong>disetujui</strong> oleh admin.</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Kegiatan:</strong> ${journalKegiatan}</p>
            ${feedback ? `<p style="margin: 10px 0 0 0;"><strong>Feedback:</strong> ${feedback}</p>` : ''}
          </div>
          <p style="color: #666; font-size: 14px;">Terima kasih atas kerja keras Anda!</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[Email] Error sending journal approval email:', error);
    return false;
  }
};

// Send journal rejection notification
const sendJournalRejectionEmail = async (userEmail, userName, journalKegiatan, feedback) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Absensi PKL" <noreply@absensi-pkl.com>',
      to: userEmail,
      subject: '❌ Jurnal Perlu Revisi',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">Jurnal Perlu Revisi</h2>
          <p>Halo <strong>${userName}</strong>,</p>
          <p>Jurnal Anda memerlukan <strong>revisi</strong>.</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Kegiatan:</strong> ${journalKegiatan}</p>
            <p style="margin: 10px 0 0 0;"><strong>Feedback:</strong></p>
            <p style="margin: 5px 0 0 0; color: #ef4444;">${feedback}</p>
          </div>
          <p style="color: #666; font-size: 14px;">Silakan revisi jurnal Anda dan submit kembali.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[Email] Error sending journal rejection email:', error);
    return false;
  }
};

// Send izin approval notification
const sendIzinApprovalEmail = async (userEmail, userName, izinJenis, izinTanggal) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Absensi PKL" <noreply@absensi-pkl.com>',
      to: userEmail,
      subject: '✅ Pengajuan Izin Disetujui',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #22c55e;">Izin Disetujui</h2>
          <p>Halo <strong>${userName}</strong>,</p>
          <p>Pengajuan izin Anda telah <strong>disetujui</strong>.</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Jenis:</strong> ${izinJenis}</p>
            <p style="margin: 10px 0 0 0;"><strong>Tanggal:</strong> ${izinTanggal}</p>
          </div>
          <p style="color: #666; font-size: 14px;">Terima kasih telah memberitahu.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[Email] Error sending izin approval email:', error);
    return false;
  }
};

// Send izin rejection notification
const sendIzinRejectionEmail = async (userEmail, userName, izinJenis, alasan) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Absensi PKL" <noreply@absensi-pkl.com>',
      to: userEmail,
      subject: '❌ Pengajuan Izin Ditolak',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">Izin Ditolak</h2>
          <p>Halo <strong>${userName}</strong>,</p>
          <p>Pengajuan izin Anda <strong>ditolak</strong>.</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Jenis:</strong> ${izinJenis}</p>
            <p style="margin: 10px 0 0 0;"><strong>Alasan:</strong></p>
            <p style="margin: 5px 0 0 0; color: #ef4444;">${alasan}</p>
          </div>
          <p style="color: #666; font-size: 14px;">Silakan hubungi admin jika ada pertanyaan.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[Email] Error sending izin rejection email:', error);
    return false;
  }
};

// Send weekly report email
const sendWeeklyReportEmail = async (adminEmail, reportData) => {
  try {
    const { totalHadir, totalAlpha, totalIzin, topPerformers } = reportData;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"Absensi PKL" <noreply@absensi-pkl.com>',
      to: adminEmail,
      subject: '📊 Laporan Mingguan Absensi PKL',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3b82f6;">Laporan Mingguan</h2>
          <p>Berikut ringkasan absensi minggu ini:</p>
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>✅ Hadir:</strong> ${totalHadir}</p>
            <p style="margin: 10px 0 0 0;"><strong>❌ Alpha:</strong> ${totalAlpha}</p>
            <p style="margin: 10px 0 0 0;"><strong>📝 Izin:</strong> ${totalIzin}</p>
          </div>
          ${topPerformers && topPerformers.length > 0 ? `
            <h3 style="margin-top: 30px;">Top Performers</h3>
            <ul style="background-color: #f4f4f4; padding: 15px; border-radius: 8px;">
              ${topPerformers.map(p => `<li>${p.nama} - ${p.kehadiran}% kehadiran</li>`).join('')}
            </ul>
          ` : ''}
          <p style="color: #666; font-size: 14px; margin-top: 20px;">Laporan lengkap tersedia di dashboard admin.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[Email] Error sending weekly report email:', error);
    return false;
  }
};

module.exports = {
  sendJournalApprovalEmail,
  sendJournalRejectionEmail,
  sendIzinApprovalEmail,
  sendIzinRejectionEmail,
  sendWeeklyReportEmail
};
