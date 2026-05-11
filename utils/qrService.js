const QRCode = require('qrcode');

/**
 * Generate QR Code untuk verifikasi dokumen
 * @param {Object} data - Data yang akan di-encode
 * @param {Object} options - Options untuk QR generation
 * @returns {Promise<string>} - Base64 string dari QR code
 */
const generateQRCode = async (data, options = {}) => {
  try {
    const defaultOptions = {
      width: 200,
      margin: 2,
      type: 'image/png',
      errorCorrectionLevel: 'H', // High error correction
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    };

    const mergedOptions = { ...defaultOptions, ...options };
    
    console.log('[QR Service] Generating QR with data:', JSON.stringify(data));
    
    // Generate QR as data URL
    const dataUrl = await QRCode.toDataURL(JSON.stringify(data), mergedOptions);
    
    // Extract base64 only
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    
    console.log('[QR Service] Generated successfully, length:', base64.length);
    
    return base64;
  } catch (error) {
    console.error('[QR Service] Error generating QR:', error);
    throw error;
  }
};

/**
 * Generate QR Code untuk laporan jurnal
 * @param {Object} user - Data user
 * @param {string} periode_mulai - Tanggal mulai
 * @param {string} periode_selesai - Tanggal selesai
 * @returns {Promise<string>} - Base64 string dari QR code
 */
const generateJurnalQR = async (user, periode_mulai, periode_selesai) => {
  const data = {
    type: 'laporan_jurnal',
    user: user.nama,
    userId: user.id,
    periode: `${periode_mulai || 'all'} - ${periode_selesai || 'all'}`,
    timestamp: new Date().toISOString(),
    verified: true,
    verificationUrl: `https://absensi-pkl.com/verify/${user.id}/${Date.now()}`
  };
  
  return generateQRCode(data, { width: 300 });
};

/**
 * Generate QR Code sederhana dengan ukuran kecil
 * @param {string} text - Text untuk QR
 * @returns {Promise<string>} - Base64 string
 */
const generateSimpleQR = async (text) => {
  return generateQRCode({ text }, { width: 150, margin: 1 });
};

module.exports = {
  generateQRCode,
  generateJurnalQR,
  generateSimpleQR
};
