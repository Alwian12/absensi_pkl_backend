const express = require('express');
const { pool } = require('../config/database');
const { verifyAdmin, verifyToken } = require('../middleware/auth');
const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable');
const XLSX = require('xlsx');
const { generateJurnalQR } = require('../utils/qrService');

const router = express.Router();

// Export absensi to Excel
router.get('/excel', verifyAdmin, async (req, res) => {
  try {
    const { bulan, tahun, user_id } = req.query;
    
    const targetBulan = parseInt(bulan) || new Date().getMonth() + 1;
    const targetTahun = parseInt(tahun) || new Date().getFullYear();
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                       'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    // Get attendance data with izin status
    let query = `
      SELECT 
        u.nama as 'Nama',
        u.asal_sekolah as 'Sekolah',
        a.tanggal as 'Tanggal',
        DATE_FORMAT(a.check_in, '%H:%i') as 'Jam Masuk',
        DATE_FORMAT(a.check_out, '%H:%i') as 'Jam Pulang',
        a.status_check_in as 'Status Masuk',
        a.status_check_out as 'Status Pulang',
        CASE 
          WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN 'Hadir'
          WHEN a.check_in IS NOT NULL THEN 'Check In Saja'
          WHEN i.status = 'disetujui' THEN 'Izin'
          WHEN e.id IS NOT NULL THEN e.title
          WHEN WEEKDAY(a.tanggal) IN (5,6) THEN 'Libur Akhir Pekan'
          ELSE 'Tidak Hadir'
        END as 'Keterangan'
      FROM absensi a 
      LEFT JOIN users_pkl u ON a.user_id = u.id 
      LEFT JOIN izin i ON a.user_id = i.user_id 
        AND i.status = 'disetujui'
        AND a.tanggal BETWEEN i.tanggal_mulai AND i.tanggal_selesai
      LEFT JOIN events e ON a.tanggal = e.tanggal AND e.tipe = 'holiday'
      WHERE MONTH(a.tanggal) = ? AND YEAR(a.tanggal) = ?
    `;
    const params = [targetBulan, targetTahun];
    
    if (user_id) {
      query += ' AND a.user_id = ?';
      params.push(user_id);
    }
    
    query += ' ORDER BY a.tanggal DESC, u.nama ASC';
    
    const [absensiRows] = await pool.query(query, params);
    
    // Get holidays for this month
    const [holidays] = await pool.query(
      `SELECT tanggal, title FROM events 
       WHERE tipe = 'holiday' 
       AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?
       ORDER BY tanggal`,
      [targetBulan, targetTahun]
    );
    
    // Get izin summary
    const [izinSummary] = await pool.query(
      `SELECT 
        COUNT(*) as total_izin,
        COUNT(DISTINCT user_id) as peserta_izin
       FROM izin 
       WHERE status = 'disetujui'
       AND MONTH(tanggal_mulai) = ? AND YEAR(tanggal_mulai) = ?`,
      [targetBulan, targetTahun]
    );
    
    // Get statistics
    const [stats] = await pool.query(
      `SELECT 
        COUNT(DISTINCT tanggal) as total_hari,
        COUNT(*) as total_kehadiran,
        COUNT(CASE WHEN status_check_in = 'terlambat' THEN 1 END) as total_terlambat,
        COUNT(CASE WHEN check_out IS NULL THEN 1 END) as belum_pulang
       FROM absensi 
       WHERE MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
      [targetBulan, targetTahun]
    );
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Sheet 1: Summary/Rangkuman
    const summaryData = [
      ['LAPORAN ABSENSI PKL'],
      ['Dinas Kominfo Kabupaten Batu Bara'],
      [`Periode: ${monthNames[targetBulan - 1]} ${targetTahun}`],
      [],
      ['RANGKUMAN KEHADIRAN'],
      ['Total Hari Kerja', stats[0].total_hari || 0],
      ['Total Kehadiran', stats[0].total_kehadiran || 0],
      ['Total Terlambat', stats[0].total_terlambat || 0],
      ['Belum Check Out', stats[0].belum_pulang || 0],
      ['Total Izin', izinSummary[0].total_izin || 0],
      ['Peserta Izin', izinSummary[0].peserta_izin || 0],
      [],
      ['HARI LIBUR DAN CUTI BERSAMA'],
      ...holidays.map(h => [formatDate(h.tanggal), h.title])
    ];
    
    if (holidays.length === 0) {
      summaryData.push(['Tidak ada hari libur nasional di bulan ini']);
    }
    
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Rangkuman');
    
    // Sheet 2: Detail Absensi
    const wsDetail = XLSX.utils.json_to_sheet(absensiRows);
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail Absensi');
    
    // Sheet 3: Data Izin
    const [izinDetail] = await pool.query(
      `SELECT 
        u.nama as 'Nama',
        i.tanggal_mulai as 'Tanggal Mulai',
        i.tanggal_selesai as 'Tanggal Selesai',
        i.alasan as 'Alasan',
        i.status as 'Status'
       FROM izin i
       JOIN users_pkl u ON i.user_id = u.id
       WHERE i.status = 'disetujui'
       AND MONTH(i.tanggal_mulai) = ? AND YEAR(i.tanggal_mulai) = ?
       ORDER BY i.tanggal_mulai DESC`,
      [targetBulan, targetTahun]
    );
    
    const wsIzin = XLSX.utils.json_to_sheet(izinDetail);
    XLSX.utils.book_append_sheet(wb, wsIzin, 'Data Izin');
    
    // Generate buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename="laporan-absensi-${monthNames[targetBulan-1]}-${targetTahun}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Helper function to format date in Indonesian
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Helper untuk format tanggal pendek
function formatDateShort(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  return `${days[date.getDay()]}, ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

// Export absensi to PDF
router.get('/pdf', verifyAdmin, async (req, res) => {
  try {
    const { bulan, tahun, user_id } = req.query;
    
    const targetBulan = parseInt(bulan) || new Date().getMonth() + 1;
    const targetTahun = parseInt(tahun) || new Date().getFullYear();
    
    const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                       'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    // Get attendance data with izin status
    let query = `
      SELECT 
        u.nama,
        u.asal_sekolah,
        a.tanggal,
        DATE_FORMAT(a.check_in, '%H:%i') as jam_masuk,
        DATE_FORMAT(a.check_out, '%H:%i') as jam_pulang,
        a.status_check_in,
        a.status_check_out,
        CASE 
          WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN 'Hadir'
          WHEN a.check_in IS NOT NULL THEN 'Check In Saja'
          WHEN i.status = 'disetujui' THEN 'Izin'
          WHEN e.id IS NOT NULL THEN e.title
          WHEN WEEKDAY(a.tanggal) IN (5,6) THEN 'Libur Akhir Pekan'
          ELSE 'Tidak Hadir'
        END as keterangan
      FROM absensi a 
      LEFT JOIN users_pkl u ON a.user_id = u.id 
      LEFT JOIN izin i ON a.user_id = i.user_id 
        AND i.status = 'disetujui'
        AND a.tanggal BETWEEN i.tanggal_mulai AND i.tanggal_selesai
      LEFT JOIN events e ON a.tanggal = e.tanggal AND e.tipe = 'holiday'
      WHERE MONTH(a.tanggal) = ? AND YEAR(a.tanggal) = ?
    `;
    const params = [targetBulan, targetTahun];
    
    if (user_id) {
      query += ' AND a.user_id = ?';
      params.push(user_id);
    }
    
    query += ' ORDER BY a.tanggal DESC, u.nama ASC';
    
    const [absensiRows] = await pool.query(query, params);
    
    // Get holidays for this month
    const [holidays] = await pool.query(
      `SELECT tanggal, title FROM events 
       WHERE tipe = 'holiday' 
       AND MONTH(tanggal) = ? AND YEAR(tanggal) = ?
       ORDER BY tanggal`,
      [targetBulan, targetTahun]
    );
    
    // Get statistics
    const [stats] = await pool.query(
      `SELECT 
        COUNT(DISTINCT tanggal) as total_hari,
        COUNT(*) as total_kehadiran,
        COUNT(CASE WHEN status_check_in = 'terlambat' THEN 1 END) as total_terlambat,
        COUNT(CASE WHEN check_out IS NULL THEN 1 END) as belum_pulang
       FROM absensi 
       WHERE MONTH(tanggal) = ? AND YEAR(tanggal) = ?`,
      [targetBulan, targetTahun]
    );
    
    // Get izin summary
    const [izinSummary] = await pool.query(
      `SELECT 
        COUNT(*) as total_izin,
        COUNT(DISTINCT user_id) as peserta_izin
       FROM izin 
       WHERE status = 'disetujui'
       AND MONTH(tanggal_mulai) = ? AND YEAR(tanggal_mulai) = ?`,
      [targetBulan, targetTahun]
    );
    
    // Create PDF
    const doc = new jsPDF();
    
    // Helper untuk format tanggal Indonesia
    const formatTanggal = (tgl) => {
      if (!tgl) return '-';
      const date = new Date(tgl);
      const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][date.getDay()];
      const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'][date.getMonth()];
      return `${hari}, ${date.getDate()} ${bulan} ${date.getFullYear()}`;
    };
    
    // === PAGE 1: RANGKUMAN ===
    doc.setFontSize(16);
    doc.text('LAPORAN ABSENSI PKL', 105, 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.text('Dinas Kominfo Kabupaten Batu Bara', 105, 22, { align: 'center' });
    doc.text(`Periode: ${monthNames[targetBulan - 1]} ${targetTahun}`, 105, 28, { align: 'center' });
    
    // Box Rangkuman Kehadiran - Abu-abu
    doc.setFillColor(230, 230, 230);
    doc.setDrawColor(100, 100, 100);
    doc.rect(10, 35, 90, 45, 'FD');
    
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('RANGKUMAN KEHADIRAN', 15, 42);
    
    doc.setFontSize(9);
    doc.text(`Total Hari Kerja  : ${stats[0].total_hari || 0}`, 15, 50);
    doc.text(`Total Kehadiran   : ${stats[0].total_kehadiran || 0}`, 15, 57);
    doc.text(`Total Terlambat   : ${stats[0].total_terlambat || 0}`, 15, 64);
    doc.text(`Belum Check Out   : ${stats[0].belum_pulang || 0}`, 15, 71);
    doc.text(`Total Izin        : ${izinSummary[0].total_izin || 0}`, 15, 78);
    
    // Box Hari Libur - Kuning
    doc.setFillColor(255, 245, 200);
    doc.setDrawColor(200, 150, 50);
    doc.rect(105, 35, 95, 45, 'FD');
    
    doc.setFontSize(10);
    doc.text('HARI LIBUR', 110, 42);
    
    doc.setFontSize(8);
    let yLibur = 48;
    if (holidays.length === 0) {
      doc.text('Tidak ada hari libur', 110, yLibur);
    } else {
      holidays.slice(0, 5).forEach((h, idx) => {
        doc.text(`${idx + 1}. ${formatTanggal(h.tanggal)}`, 110, yLibur);
        yLibur += 6;
      });
      if (holidays.length > 5) {
        doc.text(`... dan ${holidays.length - 5} libur lainnya`, 110, yLibur);
      }
    }
    
    // === PAGE 2+: DETAIL ABSENSI DENGAN TABEL ===
    doc.addPage();
    
    doc.setFontSize(14);
    doc.text('DETAIL ABSENSI', 105, 15, { align: 'center' });
    doc.text(`${monthNames[targetBulan - 1]} ${targetTahun}`, 105, 22, { align: 'center' });
    
    // Siapkan data untuk tabel
    const tableData = absensiRows.map((row, index) => [
      index + 1,
      row.nama || '-',
      row.asal_sekolah || '-',
      formatTanggal(row.tanggal),
      row.jam_masuk || '-',
      row.jam_pulang || '-',
      row.keterangan || '-'
    ]);
    
    // Gunakan autoTable untuk tabel
    try {
      autoTable(doc, {
        startY: 30,
        head: [['No', 'Nama', 'Sekolah', 'Tanggal', 'Masuk', 'Pulang', 'Status']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [200, 200, 200], textColor: 0, fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 45 },
          4: { cellWidth: 20 },
          5: { cellWidth: 20 },
          6: { cellWidth: 25 }
        },
        alternateRowStyles: { fillColor: [245, 245, 245] }
      });
    } catch (tableError) {
      console.error('Error creating table:', tableError);
      // Fallback: tambahkan text sederhana
      doc.setFontSize(10);
      doc.text('Data tabel tidak dapat ditampilkan', 10, 30);
    }
    
    // Footer
    doc.setFontSize(8);
    doc.text(`Dicetak pada: ${new Date().toLocaleString('id-ID')}`, 10, 290);
    
    // Send PDF
    const pdfBuffer = doc.output('arraybuffer');
    
    res.setHeader('Content-Disposition', `attachment; filename="laporan-absensi-${monthNames[targetBulan-1]}-${targetTahun}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Export PDF error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server: ' + error.message });
  }
});

// Get rekap per peserta
router.get('/rekap', verifyAdmin, async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    
    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();
    
    const [rows] = await pool.query(
      `SELECT 
        u.id,
        u.nama,
        u.asal_sekolah,
        COUNT(DISTINCT CASE WHEN a.status_check_in != 'izin' AND a.check_in IS NOT NULL THEN a.tanggal END) as total_hadir,
        COUNT(DISTINCT CASE WHEN a.status_check_in = 'terlambat' THEN a.tanggal END) as total_terlambat,
        COUNT(DISTINCT CASE WHEN a.status_check_in = 'izin' THEN a.tanggal END) as total_izin
       FROM users_pkl u
       LEFT JOIN absensi a ON u.id = a.user_id 
                          AND MONTH(a.tanggal) = ? 
                          AND YEAR(a.tanggal) = ?
       WHERE u.status = 'aktif'
       GROUP BY u.id, u.nama, u.asal_sekolah`,
      [targetBulan, targetTahun]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Get rekap error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Export daily absensi (harian)
router.get('/daily', verifyAdmin, async (req, res) => {
  try {
    const { tanggal } = req.query;
    const targetDate = tanggal || new Date().toISOString().split('T')[0];
    
    const [rows] = await pool.query(
      `SELECT 
        u.nama as 'Nama',
        u.asal_sekolah as 'Sekolah',
        a.tanggal as 'Tanggal',
        a.check_in as 'Check In',
        a.check_out as 'Check Out',
        a.status_check_in as 'Status Masuk',
        a.status_check_out as 'Status Pulang',
        CASE 
          WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN 'Hadir'
          WHEN i.status = 'disetujui' THEN 'Izin'
          ELSE 'Tidak Hadir'
        END as 'Kehadiran'
      FROM users_pkl u
      LEFT JOIN absensi a ON u.id = a.user_id AND a.tanggal = ?
      LEFT JOIN izin i ON u.id = i.user_id 
        AND i.status = 'disetujui' 
        AND ? BETWEEN i.tanggal_mulai AND i.tanggal_selesai
      WHERE u.status = 'aktif'
      ORDER BY u.nama ASC`,
      [targetDate, targetDate]
    );
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    
    XLSX.utils.book_append_sheet(wb, ws, `Absensi_${targetDate}`);
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename="absensi_harian_${targetDate}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Export daily error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Export daily to PDF
router.get('/daily/pdf', verifyAdmin, async (req, res) => {
  try {
    const { tanggal } = req.query;
    const targetDate = tanggal || new Date().toISOString().split('T')[0];
    
    const [rows] = await pool.query(
      `SELECT 
        u.nama,
        u.asal_sekolah,
        a.check_in,
        a.check_out,
        a.status_check_in,
        a.status_check_out,
        CASE 
          WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN 'Hadir'
          WHEN i.status = 'disetujui' THEN 'Izin'
          ELSE 'Tidak Hadir'
        END as kehadiran
      FROM users_pkl u
      LEFT JOIN absensi a ON u.id = a.user_id AND a.tanggal = ?
      LEFT JOIN izin i ON u.id = i.user_id 
        AND i.status = 'disetujui' 
        AND ? BETWEEN i.tanggal_mulai AND i.tanggal_selesai
      WHERE u.status = 'aktif'
      ORDER BY u.nama ASC`,
      [targetDate, targetDate]
    );
    
    const doc = new jsPDF();
    
    // Title
    doc.setFontSize(16);
    doc.text('LAPORAN ABSENSI HARIAN', 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text(`Tanggal: ${targetDate}`, 105, 30, { align: 'center' });
    doc.text('Dinas Kominfo Kabupaten Batu Bara', 105, 38, { align: 'center' });
    
    // Table
    const headers = [['No', 'Nama', 'Sekolah', 'Check In', 'Check Out', 'Status']];
    const data = rows.map((row, index) => [
      index + 1,
      row.nama,
      row.asal_sekolah || '-',
      row.check_in || '-',
      row.check_out || '-',
      row.kehadiran
    ]);
    
    doc.autoTable({
      head: headers,
      body: data,
      startY: 50,
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 10 }
    });
    
    // Summary
    const hadir = rows.filter(r => r.kehadiran === 'Hadir').length;
    const izin = rows.filter(r => r.kehadiran === 'Izin').length;
    const tidakHadir = rows.filter(r => r.kehadiran === 'Tidak Hadir').length;
    
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.text(`Ringkasan: Hadir: ${hadir}, Izin: ${izin}, Tidak Hadir: ${tidakHadir}`, 14, finalY);
    
    res.setHeader('Content-Disposition', `attachment; filename="absensi_harian_${targetDate}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    
    // Generate PDF buffer properly
    const pdfBuffer = doc.output('arraybuffer');
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Export daily PDF error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Terjadi kesalahan saat membuat PDF', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Export penilaian to Excel
router.get('/penilaian/excel', verifyAdmin, async (req, res) => {
  try {
    const { periode_mulai, periode_selesai } = req.query;
    
    let query = `
      SELECT 
        u.nama as 'Nama Peserta',
        u.asal_sekolah as 'Sekolah',
        DATE_FORMAT(p.periode_mulai, '%d/%m/%Y') as 'Periode Mulai',
        DATE_FORMAT(p.periode_selesai, '%d/%m/%Y') as 'Periode Selesai',
        p.kehadiran_nilai as 'Nilai Kehadiran',
        p.sikap_nilai as 'Nilai Sikap',
        p.kinerja_nilai as 'Nilai Kinerja',
        p.jurnal_nilai as 'Nilai Jurnal',
        p.laporan_nilai as 'Nilai Laporan',
        p.total_nilai as 'Total Nilai',
        p.grade as 'Grade',
        p.status as 'Status',
        p.catatan_pembimbing as 'Catatan Pembimbing'
      FROM penilaian p
      JOIN users_pkl u ON p.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (periode_mulai && periode_selesai) {
      query += ' AND p.periode_mulai >= ? AND p.periode_selesai <= ?';
      params.push(periode_mulai, periode_selesai);
    }
    
    query += ' ORDER BY u.nama, p.periode_mulai DESC';
    
    const [rows] = await pool.query(query, params);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    
    XLSX.utils.book_append_sheet(wb, ws, 'Penilaian PKL');
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const filename = periode_mulai 
      ? `penilaian_${periode_mulai}_sampai_${periode_selesai}.xlsx`
      : `penilaian_all.xlsx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Export penilaian Excel error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Export penilaian to PDF
router.get('/penilaian/pdf', verifyAdmin, async (req, res) => {
  try {
    const { periode_mulai, periode_selesai } = req.query;
    
    let query = `
      SELECT 
        u.nama,
        u.asal_sekolah,
        p.periode_mulai,
        p.periode_selesai,
        p.kehadiran_nilai,
        p.sikap_nilai,
        p.kinerja_nilai,
        p.jurnal_nilai,
        p.laporan_nilai,
        p.total_nilai,
        p.grade,
        p.catatan_pembimbing
      FROM penilaian p
      JOIN users_pkl u ON p.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (periode_mulai && periode_selesai) {
      query += ' AND p.periode_mulai >= ? AND p.periode_selesai <= ?';
      params.push(periode_mulai, periode_selesai);
    }
    
    query += ' ORDER BY u.nama';
    
    const [rows] = await pool.query(query, params);
    
    const doc = new jsPDF({ orientation: 'landscape' });
    
    // Title
    doc.setFontSize(16);
    doc.text('LAPORAN PENILAIAN PKL', 148, 20, { align: 'center' });
    
    doc.setFontSize(12);
    if (periode_mulai) {
      doc.text(`Periode: ${periode_mulai} s/d ${periode_selesai}`, 148, 30, { align: 'center' });
    }
    doc.text('Dinas Kominfo Kabupaten Batu Bara', 148, 38, { align: 'center' });
    
    // Table
    const headers = [['Nama', 'Sekolah', 'Kehadiran', 'Sikap', 'Kinerja', 'Jurnal', 'Laporan', 'Total', 'Grade']];
    const data = rows.map(row => [
      row.nama,
      row.asal_sekolah || '-',
      row.kehadiran_nilai,
      row.sikap_nilai,
      row.kinerja_nilai,
      row.jurnal_nilai,
      row.laporan_nilai,
      row.total_nilai,
      row.grade
    ]);
    
    doc.autoTable({
      head: headers,
      body: data,
      startY: 50,
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 9 }
    });
    
    res.setHeader('Content-Disposition', `attachment; filename="penilaian_${periode_mulai || 'all'}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(doc.output('arraybuffer')));
  } catch (error) {
    console.error('Export penilaian PDF error:', error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Export Jurnal Laporan untuk USER (export laporan sendiri)
router.get('/my-jurnal-laporan', verifyToken, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { periode_mulai, periode_selesai } = req.query;
    
    console.log(`[USER EXPORT] Starting export for user_id: ${user_id}`);
    
    // Get user info (without pembimbing join - kolom tidak ada)
    const [userData] = await pool.query(
      'SELECT * FROM users_pkl WHERE id = ?',
      [user_id]
    );
    
    console.log(`[USER EXPORT] User data found: ${userData.length > 0}`);
    
    if (userData.length === 0) {
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    }
    
    const user = userData[0];
    console.log(`[USER EXPORT] User: ${user.nama}`);
    
    // Get approved jurnals for period
    let jurnalQuery = `
      SELECT j.*, a.nama as nama_approver, a.nip as nip_approver, a.jabatan as jabatan_approver
      FROM jurnal j
      LEFT JOIN admins a ON j.pembimbing_id = a.id
      WHERE j.user_id = ? AND j.status_pembimbing = 'approved' AND j.is_draft = 0
    `;
    const jurnalParams = [user_id];
    
    if (periode_mulai && periode_selesai) {
      jurnalQuery += ' AND j.tanggal BETWEEN ? AND ?';
      jurnalParams.push(periode_mulai, periode_selesai);
    }
    
    jurnalQuery += ' ORDER BY j.tanggal ASC';
    
    const [jurnals] = await pool.query(jurnalQuery, jurnalParams);
    console.log(`[USER EXPORT] Found ${jurnals.length} approved jurnals`);
    
    if (jurnals.length === 0) {
      return res.status(400).json({ message: 'Belum ada jurnal yang disetujui untuk diexport' });
    }
    
    // Create PDF
    console.log(`[USER EXPORT] Creating PDF...`);
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    console.log(`[USER EXPORT] PDF created, pageWidth: ${pageWidth}`);
    
    // Header
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('LAPORAN KEGIATAN PRAKERIN', pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text('(DIISI OLEH SISWA)', pageWidth / 2, 27, { align: 'center' });
    
    console.log('[USER EXPORT] Drawing table...');
    let yPos = 40;
    
    // Tabel Identitas
    const colWidth1 = 40;
    const colWidth2 = 60;
    const colWidth3 = 40;
    const colWidth4 = 50;
    const startX = margin;
    
    // Header tabel
    doc.setFillColor(220, 220, 220);
    doc.rect(startX, yPos, colWidth1, 10, 'F');
    doc.rect(startX + colWidth1, yPos, colWidth2, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2, yPos, colWidth3, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2 + colWidth3, yPos, colWidth4, 10, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Nomor Kegiatan', startX + 2, yPos + 6);
    doc.text('01 s/d ' + String(jurnals.length).padStart(2, '0'), startX + colWidth1 + 2, yPos + 6);
    doc.text('Dikerjakan tanggal', startX + colWidth1 + colWidth2 + 2, yPos + 6);
    
    let tanggalText = periode_mulai || '';
    if (!tanggalText && jurnals[0] && jurnals[0].tanggal) {
      tanggalText = new Date(jurnals[0].tanggal).toISOString().split('T')[0];
    }
    doc.text(tanggalText, startX + colWidth1 + colWidth2 + colWidth3 + 2, yPos + 6);
    
    yPos += 10;
    
    // Baris nama pekerjaan
    doc.setFillColor(220, 220, 220);
    doc.rect(startX, yPos, colWidth1, 10, 'F');
    doc.rect(startX + colWidth1, yPos, colWidth2, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2, yPos, colWidth3, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2 + colWidth3, yPos, colWidth4, 10, 'F');
    
    doc.text('Nama Pekerjaan', startX + 2, yPos + 6);
    doc.text('Sesuai jurnal harian', startX + colWidth1 + 2, yPos + 6);
    doc.text('Selesai tanggal', startX + colWidth1 + colWidth2 + 2, yPos + 6);
    doc.text(periode_selesai || new Date(jurnals[jurnals.length - 1].tanggal).toISOString().split('T')[0] || '', startX + colWidth1 + colWidth2 + colWidth3 + 2, yPos + 6);
    
    yPos += 20;
    
    // Kompetensi
    doc.setFont('helvetica', 'bold');
    doc.text('Kompetensi', startX, yPos);
    yPos += 7;
    
    const kompetensiList = [...new Set(jurnals.map(j => j.kompetensi).filter(k => k))];
    doc.setFont('helvetica', 'normal');
    kompetensiList.forEach((kompetensi, idx) => {
      const lines = doc.splitTextToSize(`${idx + 1}. ${kompetensi || '-'}`, pageWidth - 2 * margin);
      doc.text(lines, startX, yPos);
      yPos += lines.length * 5;
    });
    
    if (kompetensiList.length === 0) {
      doc.text('1. Kompetensi sesuai kegiatan prakerin', startX, yPos);
      yPos += 5;
    }
    
    yPos += 10;
    
    // Alat dan Bahan
    doc.setFont('helvetica', 'bold');
    doc.text('Alat dan Bahan', startX, yPos);
    yPos += 7;
    
    doc.setFont('helvetica', 'normal');
    jurnals.forEach((j, idx) => {
      if (j.alat_bahan) {
        const lines = doc.splitTextToSize(`${idx + 1}. ${j.alat_bahan}`, pageWidth - 2 * margin);
        doc.text(lines, startX, yPos);
        yPos += lines.length * 5;
      }
    });
    
    yPos += 10;
    
    // Langkah Kerja/Uraian Kerja
    doc.setFont('helvetica', 'bold');
    doc.text('Langkah Kerja/Uraian Kerja', startX, yPos);
    yPos += 7;
    
    doc.setFont('helvetica', 'normal');
    jurnals.forEach((j, idx) => {
      const uraian = j.uraian_kerja || j.deskripsi || '-';
      const lines = doc.splitTextToSize(`${idx + 1}. ${uraian}`, pageWidth - 2 * margin);
      doc.text(lines, startX, yPos);
      yPos += lines.length * 5;
      
      if (yPos > 250) {
        doc.addPage();
        yPos = 30;
      }
    });
    
    yPos += 15;
    
    // Gambar Kerja
    doc.setFont('helvetica', 'bold');
    doc.text('Gambar Kerja :', startX, yPos);
    yPos += 10;
    
    const photoWidth = 80;
    const photoHeight = 50;
    doc.setDrawColor(0);
    doc.rect(startX, yPos, photoWidth, photoHeight);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('(Foto Dokumentasi)', startX + 5, yPos + photoHeight/2);
    
    doc.rect(startX + photoWidth + 10, yPos, photoWidth, photoHeight);
    doc.text('(Foto Dokumentasi)', startX + photoWidth + 15, yPos + photoHeight/2);
    
    yPos += photoHeight + 20;
    
    if (yPos > 220) {
      doc.addPage();
      yPos = 40;
    }
    
    console.log('[USER EXPORT] Drawing signature...');
    // Tanda Tangan Section
    const signColWidth = (pageWidth - 2 * margin) / 2;
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Pembimbing DU/DI', startX + signColWidth/2, yPos, { align: 'center' });
    doc.text('Siswa', startX + signColWidth + signColWidth/2, yPos, { align: 'center' });
    
    yPos += 10;
    
    doc.rect(startX, yPos, signColWidth, 40);
    doc.rect(startX + signColWidth, yPos, signColWidth, 40);
    
    yPos += 45;
    
    // Nama pembimbing (dari jurnal pertama yang di-approve)
    const approverName = jurnals[0]?.nama_approver || '..................................';
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(approverName, startX + signColWidth/2, yPos, { align: 'center' });
    doc.text(user.nama || '..................................', startX + signColWidth + signColWidth/2, yPos, { align: 'center' });
    
    yPos += 5;
    
    doc.text(`NIP. ${jurnals[0]?.nip_approver || '......................'}`, startX + signColWidth/2, yPos, { align: 'center' });
    doc.text(`NIS/NIM. ${user.nis || user.nim || '......................'}`, startX + signColWidth + signColWidth/2, yPos, { align: 'center' });
    
    doc.setFontSize(8);
    doc.text(`Dokumen ini dicetak pada: ${new Date().toLocaleDateString('id-ID')}`, pageWidth / 2, 290, { align: 'center' });
    
    console.log(`[USER EXPORT] Generating PDF buffer...`);
    const pdfBuffer = doc.output('arraybuffer');
    console.log(`[USER EXPORT] PDF buffer generated, size: ${pdfBuffer.byteLength}`);
    
    res.setHeader('Content-Disposition', `attachment; filename="laporan_jurnal_${user.nama}_${periode_mulai || 'all'}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBuffer));
    console.log(`[USER EXPORT] PDF sent successfully`);
    
  } catch (error) {
    console.error('[USER EXPORT ERROR]', error);
    console.error('[USER EXPORT ERROR] Message:', error.message);
    console.error('[USER EXPORT ERROR] Stack:', error.stack);
    res.status(500).json({ 
      message: 'Terjadi kesalahan server', 
      error: error.message,
      stack: error.stack 
    });
  }
});

// Export Jurnal Laporan Prakerin - Format Formal dengan TTD (ADMIN)
router.get('/jurnal-laporan/:user_id', verifyAdmin, async (req, res) => {
  try {
    const { user_id } = req.params;
    const { periode_mulai, periode_selesai } = req.query;
    
    console.log(`Export laporan for user_id: ${user_id}`);
    
    // Get user info
    const [userData] = await pool.query(
      'SELECT u.*, a.nama as nama_pembimbing, a.nip as nip_pembimbing, a.jabatan as jabatan_pembimbing, a.ttd as ttd_pembimbing FROM users_pkl u LEFT JOIN admins a ON u.pembimbing_id = a.id WHERE u.id = ?',
      [user_id]
    );
    
    if (userData.length === 0) {
      return res.status(404).json({ message: 'Peserta tidak ditemukan' });
    }
    
    const user = userData[0];
    console.log(`User found: ${user.nama}, pembimbing: ${user.nama_pembimbing}`);
    
    // Get approved jurnals for period
    let jurnalQuery = `
      SELECT j.*, a.nama as nama_approver, a.nip as nip_approver, a.jabatan as jabatan_approver
      FROM jurnal j
      LEFT JOIN admins a ON j.pembimbing_id = a.id
      WHERE j.user_id = ? AND j.status_pembimbing = 'approved' AND j.is_draft = 0
    `;
    const jurnalParams = [user_id];
    
    if (periode_mulai && periode_selesai) {
      jurnalQuery += ' AND j.tanggal BETWEEN ? AND ?';
      jurnalParams.push(periode_mulai, periode_selesai);
    }
    
    jurnalQuery += ' ORDER BY j.tanggal ASC';
    
    const [jurnals] = await pool.query(jurnalQuery, jurnalParams);
    console.log(`Found ${jurnals.length} approved jurnals`);
    
    // Create PDF
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    
    // Header
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('LAPORAN KEGIATAN PRAKERIN', pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text('(DIISI OLEH SISWA)', pageWidth / 2, 27, { align: 'center' });
    
    let yPos = 40;
    
    // Tabel Identitas
    const colWidth1 = 40;
    const colWidth2 = 60;
    const colWidth3 = 40;
    const colWidth4 = 50;
    const startX = margin;
    
    // Header tabel
    doc.setFillColor(220, 220, 220);
    doc.rect(startX, yPos, colWidth1, 10, 'F');
    doc.rect(startX + colWidth1, yPos, colWidth2, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2, yPos, colWidth3, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2 + colWidth3, yPos, colWidth4, 10, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Nomor Kegiatan', startX + 2, yPos + 6);
    doc.text('01 s/d ' + String(jurnals.length).padStart(2, '0'), startX + colWidth1 + 2, yPos + 6);
    doc.text('Dikerjakan tanggal', startX + colWidth1 + colWidth2 + 2, yPos + 6);
    doc.text(periode_mulai || new Date(jurnals[0].tanggal).toISOString().split('T')[0] || '', startX + colWidth1 + colWidth2 + colWidth3 + 2, yPos + 6);
    
    yPos += 10;
    
    // Baris nama pekerjaan
    doc.setFillColor(220, 220, 220);
    doc.rect(startX, yPos, colWidth1, 10, 'F');
    doc.rect(startX + colWidth1, yPos, colWidth2, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2, yPos, colWidth3, 10, 'F');
    doc.rect(startX + colWidth1 + colWidth2 + colWidth3, yPos, colWidth4, 10, 'F');
    
    doc.text('Nama Pekerjaan', startX + 2, yPos + 6);
    doc.text('Sesuai jurnal harian', startX + colWidth1 + 2, yPos + 6);
    doc.text('Selesai tanggal', startX + colWidth1 + colWidth2 + 2, yPos + 6);
    doc.text(periode_selesai || new Date(jurnals[jurnals.length - 1].tanggal).toISOString().split('T')[0] || '', startX + colWidth1 + colWidth2 + colWidth3 + 2, yPos + 6);
    
    yPos += 20;
    
    // Kompetensi
    doc.setFont('helvetica', 'bold');
    doc.text('Kompetensi', startX, yPos);
    yPos += 7;
    
    // Extract unique competencies
    const kompetensiList = [...new Set(jurnals.map(j => j.kompetensi).filter(k => k))];
    doc.setFont('helvetica', 'normal');
    kompetensiList.forEach((kompetensi, idx) => {
      const lines = doc.splitTextToSize(`${idx + 1}. ${kompetensi || '-'}`, pageWidth - 2 * margin);
      doc.text(lines, startX, yPos);
      yPos += lines.length * 5;
    });
    
    if (kompetensiList.length === 0) {
      doc.text('1. Kompetensi sesuai kegiatan prakerin', startX, yPos);
      yPos += 5;
    }
    
    yPos += 10;
    
    // Alat dan Bahan
    doc.setFont('helvetica', 'bold');
    doc.text('Alat dan Bahan', startX, yPos);
    yPos += 7;
    
    doc.setFont('helvetica', 'normal');
    jurnals.forEach((j, idx) => {
      if (j.alat_bahan) {
        const lines = doc.splitTextToSize(`${idx + 1}. ${j.alat_bahan}`, pageWidth - 2 * margin);
        doc.text(lines, startX, yPos);
        yPos += lines.length * 5;
      }
    });
    
    yPos += 10;
    
    // Langkah Kerja/Uraian Kerja
    doc.setFont('helvetica', 'bold');
    doc.text('Langkah Kerja/Uraian Kerja', startX, yPos);
    yPos += 7;
    
    doc.setFont('helvetica', 'normal');
    jurnals.forEach((j, idx) => {
      const uraian = j.uraian_kerja || j.deskripsi || '-';
      const lines = doc.splitTextToSize(`${idx + 1}. ${uraian}`, pageWidth - 2 * margin);
      doc.text(lines, startX, yPos);
      yPos += lines.length * 5;
      
      // Page break if needed
      if (yPos > 250) {
        doc.addPage();
        yPos = 30;
      }
    });
    
    yPos += 15;
    
    // Gambar Kerja
    doc.setFont('helvetica', 'bold');
    doc.text('Gambar Kerja :', startX, yPos);
    yPos += 10;
    
    // Space for photos (simulated with boxes)
    const photoWidth = 80;
    const photoHeight = 50;
    doc.setDrawColor(0);
    doc.rect(startX, yPos, photoWidth, photoHeight);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('(Foto Dokumentasi)', startX + 5, yPos + photoHeight/2);
    
    doc.rect(startX + photoWidth + 10, yPos, photoWidth, photoHeight);
    doc.text('(Foto Dokumentasi)', startX + photoWidth + 15, yPos + photoHeight/2);
    
    yPos += photoHeight + 20;
    
    // Page break if needed for signature
    if (yPos > 200) {
      doc.addPage();
      yPos = 40;
    }
    
    // Tanda Tangan Section - NEW LAYOUT: QR as Digital Signature
    const signColWidth = (pageWidth - 2 * margin) / 2;
    
    // Header tanda tangan
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Digital Signature / QR Verifikasi', startX + signColWidth/2, yPos, { align: 'center' });
    doc.text('Siswa', startX + signColWidth + signColWidth/2, yPos, { align: 'center' });
    
    yPos += 10;
    
    // Box tanda tangan
    doc.rect(startX, yPos, signColWidth, 50); // Box untuk QR (lebih tinggi)
    doc.rect(startX + signColWidth, yPos, signColWidth, 50); // Box untuk siswa
    
    // QR Code sebagai pengganti TTD Pembimbing - akan diisi nanti
    // Simpan posisi untuk QR
    const qrBoxX = startX;
    const qrBoxY = yPos;
    const qrBoxWidth = signColWidth;
    const qrBoxHeight = 50;
    
    yPos += 55;
    
    // Nama pembimbing & QR info
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(user.nama_pembimbing || '..................................', startX + signColWidth/2, yPos, { align: 'center' });
    doc.text(user.nama || '..................................', startX + signColWidth + signColWidth/2, yPos, { align: 'center' });
    
    yPos += 5;
    
    // NIP pembimbing & NIS siswa
    doc.text(`NIP. ${user.nip_pembimbing || '......................'}`, startX + signColWidth/2, yPos, { align: 'center' });
    doc.text(`NIS/NIM. ${user.nis || user.nim || '......................'}`, startX + signColWidth + signColWidth/2, yPos, { align: 'center' });
    
    // QR Code Digital Signature - Generate dengan service
    try {
      console.log('[Export] Generating QR Code for:', user.nama);
      
      // Generate QR menggunakan service
      const qrBase64 = await generateJurnalQR(user, periode_mulai, periode_selesai);
      
      // Posisi: Center dalam box Digital Signature
      const qrSize = 35; // mm
      const qrX = qrBoxX + (qrBoxWidth - qrSize) / 2;
      const qrY = qrBoxY + (qrBoxHeight - qrSize) / 2;
      
      // Background putih
      doc.setFillColor(255, 255, 255);
      doc.rect(qrX - 1, qrY - 1, qrSize + 2, qrSize + 2, 'F');
      
      // Tambah QR code ke PDF
      doc.addImage(qrBase64, 'PNG', qrX, qrY, qrSize, qrSize);
      
      console.log('[Export] ✓ QR Code added to PDF (size:', qrBase64.length, 'chars)');
    } catch (qrError) {
      console.error('[Export] QR generation failed:', qrError.message);
      
      // Placeholder error
      doc.setDrawColor(200, 0, 0);
      doc.setFillColor(255, 220, 220);
      doc.rect(qrBoxX + 5, qrBoxY + 5, qrBoxWidth - 10, qrBoxHeight - 10, 'FD');
      doc.setFontSize(8);
      doc.setTextColor(200, 0, 0);
      doc.text('QR GENERATION FAILED', qrBoxX + qrBoxWidth/2, qrBoxY + qrBoxHeight/2, { align: 'center' });
    }
    
    // Footer
    doc.setFontSize(8);
    doc.text(`Dokumen ini dicetak pada: ${new Date().toLocaleDateString('id-ID')}`, pageWidth / 2, 290, { align: 'center' });
    
    // Send response
    const pdfBuffer = doc.output('arraybuffer');
    res.setHeader('Content-Disposition', `attachment; filename="laporan_jurnal_${user.nama}_${periode_mulai || 'all'}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBuffer));
    
  } catch (error) {
    console.error('Export jurnal laporan error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Terjadi kesalahan server', 
      error: error.message,
      stack: error.stack 
    });
  }
});

module.exports = router;
