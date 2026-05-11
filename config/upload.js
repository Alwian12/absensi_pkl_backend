const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Image compression function
const compressImage = async (filePath) => {
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    // Only compress if larger than 800px width or height
    if (metadata.width > 800 || metadata.height > 800) {
      await image
        .resize(800, 800, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: 80 })
        .toFile(filePath.replace(/\.(jpg|jpeg|png)$/i, '.webp'));

      // Delete original file
      fs.unlinkSync(filePath);
      
      return filePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    }

    // Convert to WebP for better compression
    await image
      .webp({ quality: 80 })
      .toFile(filePath.replace(/\.(jpg|jpeg|png)$/i, '.webp'));

    fs.unlinkSync(filePath);
    
    return filePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');
  } catch (error) {
    console.error('[Compression] Error:', error);
    return filePath; // Return original if compression fails
  }
};

// Ensure directories exist
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Storage configuration for attendance photos (check-in/check-out)
const attendancePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/absensi';
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `absen-${req.user.id}-${uniqueSuffix}.webp`);
  }
});

// Storage configuration for jurnal photos
const jurnalPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/jurnal/foto';
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `jurnal-${req.user.id}-${uniqueSuffix}.webp`);
  }
});

// Storage configuration for jurnal ttd
const jurnalTTDStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/jurnal/ttd';
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `ttd-jurnal-${req.params.id}-${uniqueSuffix}.png`);
  }
});

// Storage configuration for admin ttd
const adminTTDStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/admin/ttd';
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `ttd-admin-${req.user.id}-${uniqueSuffix}.png`);
  }
});

// Storage configuration for izin attachments (surat izin/sakit)
const izinAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/izin/lampiran';
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `izin-${req.user.id}-${uniqueSuffix}${ext}`);
  }
});

// File filter - images and PDFs for izin
const izinFileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file gambar (JPEG, PNG, GIF, WebP) atau PDF yang diizinkan'), false);
  }
};

// File filter - only images
const imageFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file gambar (JPEG, PNG, GIF, WebP) yang diizinkan'), false);
  }
};

// File size limits
const limits = {
  fileSize: 5 * 1024 * 1024, // 5MB max
  files: 1
};

// Create multer instances
const uploadAttendancePhoto = multer({
  storage: attendancePhotoStorage,
  fileFilter: imageFilter,
  limits
});

const uploadJurnalPhoto = multer({
  storage: jurnalPhotoStorage,
  fileFilter: imageFilter,
  limits
});

const uploadJurnalTTD = multer({
  storage: jurnalTTDStorage,
  fileFilter: (req, file, cb) => {
    // Accept PNG for signature
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Tanda tangan harus format PNG'), false);
    }
  },
  limits
});

const uploadAdminTTD = multer({
  storage: adminTTDStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Tanda tangan harus format PNG'), false);
    }
  },
  limits
});

// Multer instance for izin attachments
const uploadIzinAttachment = multer({
  storage: izinAttachmentStorage,
  fileFilter: izinFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for documents
    files: 1
  }
});

// Error handler middleware
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File terlalu besar. Maksimal 5MB.' });
    }
    return res.status(400).json({ message: err.message });
  }
  if (err) {
    return res.status(400).json({ message: err.message });
  }
  next();
};

// Compression middleware - compress images after upload
const compressAfterUpload = async (req, res, next) => {
  if (req.file) {
    const compressedPath = await compressImage(req.file.path);
    req.file.path = compressedPath;
    req.file.filename = path.basename(compressedPath);
  }
  next();
};

module.exports = {
  uploadAttendancePhoto,
  uploadJurnalPhoto,
  uploadJurnalTTD,
  uploadAdminTTD,
  uploadIzinAttachment,
  handleUploadError,
  compressImage,
  compressAfterUpload
};
