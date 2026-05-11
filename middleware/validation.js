const Joi = require('joi');

// Validation schemas
const schemas = {
  // Auth schemas
  login: Joi.object({
    nama: Joi.string().min(3).max(100).required(),
    password: Joi.string().min(6).required()
  }),

  adminLogin: Joi.object({
    username: Joi.string().min(3).max(50).required(),
    password: Joi.string().min(6).required()
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required()
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().min(6).required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required()
  }),

  // Absensi schemas
  checkIn: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required()
  }),

  checkOut: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required()
  }),

  // Jurnal schemas
  createJurnal: Joi.object({
    kegiatan: Joi.string().min(5).max(255).required(),
    deskripsi: Joi.string().min(10).required()
  }),

  updateJurnal: Joi.object({
    kegiatan: Joi.string().min(5).max(255),
    deskripsi: Joi.string().min(10)
  }),

  // Izin schemas
  createIzin: Joi.object({
    jenis: Joi.string().valid('sakit', 'cuti', 'pulang_cepat', 'lainnya').required(),
    tanggal_mulai: Joi.date().required(),
    tanggal_selesai: Joi.date().min(Joi.ref('tanggal_mulai')).required(),
    keterangan: Joi.string().min(10).required()
  }),

  // User schemas
  createUser: Joi.object({
    nama: Joi.string().min(3).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    no_hp: Joi.string().pattern(/^[0-9\-\+\s]{10,15}$/),
    asal_sekolah: Joi.string().max(255),
    jurusan: Joi.string().max(100)
  }),

  updateUser: Joi.object({
    nama: Joi.string().min(3).max(100),
    email: Joi.string().email(),
    no_hp: Joi.string().pattern(/^[0-9\-\+\s]{10,15}$/),
    asal_sekolah: Joi.string().max(255),
    jurusan: Joi.string().max(100)
  }),

  // Penilaian schemas
  createPenilaian: Joi.object({
    userId: Joi.number().integer().required(),
    kehadiran: Joi.number().min(0).max(100).required(),
    tanggung_jawab: Joi.number().min(0).max(100).required(),
    kualitas_kerja: Joi.number().min(0).max(100).required(),
    kerjasama: Joi.number().min(0).max(100).required(),
    catatan: Joi.string().max(1000)
  }),

  // Settings schemas
  updateSettings: Joi.object({
    jam_masuk: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    jam_pulang: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    radius: Joi.number().min(0).max(10000),
    latitude: Joi.number().min(-90).max(90),
    longitude: Joi.number().min(-180).max(180)
  }),

  // Kalender schemas
  createEvent: Joi.object({
    title: Joi.string().min(3).max(255).required(),
    start: Joi.date().required(),
    end: Joi.date().min(Joi.ref('start')).required(),
    type: Joi.string().valid('libur', 'event', 'cuti').required(),
    description: Joi.string().max(1000)
  })
};

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        message: 'Validasi gagal',
        errors
      });
    }

    req.body = value;
    next();
  };
};

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim();
      }
    }
  }
  next();
};

// Required fields checker
const validateRequired = (fields) => {
  return (req, res, next) => {
    const missing = fields.filter(field => !req.body[field]);
    
    if (missing.length > 0) {
      return res.status(400).json({
        message: `Field berikut wajib diisi: ${missing.join(', ')}`
      });
    }
    
    next();
  };
};

module.exports = {
  schemas,
  validate,
  sanitizeInput,
  validateRequired
};
