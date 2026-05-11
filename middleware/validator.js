// Input validation and sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Sanitize string inputs to prevent XSS
  const sanitize = (value) => {
    if (typeof value === 'string') {
      return value
        .replace(/[<>]/g, '') // Remove < and > to prevent HTML tags
        .trim();
    }
    return value;
  };

  // Sanitize body
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      req.body[key] = sanitize(req.body[key]);
    });
  }

  // Sanitize query params
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      req.query[key] = sanitize(req.query[key]);
    });
  }

  next();
};

// Validate required fields
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

// Validate email format
const validateEmail = (req, res, next) => {
  const email = req.body.email;
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Format email tidak valid' });
    }
  }
  next();
};

// Validate password strength
const validatePasswordStrength = (req, res, next) => {
  const password = req.body.password;
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({
        message: 'Password minimal 6 karakter'
      });
    }
  }
  next();
};

module.exports = {
  sanitizeInput,
  validateRequired,
  validateEmail,
  validatePasswordStrength
};
