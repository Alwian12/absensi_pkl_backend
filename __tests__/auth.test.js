const request = require('supertest');
const app = require('../server');
const { pool } = require('../config/database');

afterAll(async () => {
  await pool.end();
});

describe('Auth API Tests', () => {
  describe('POST /api/auth/login', () => {
    it('should return 400 if nama is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'password123' });
      
      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('message');
    });

    it('should return 400 if password is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ nama: 'budi' });
      
      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('message');
    });

    it('should return 401 for invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ nama: 'invalid', password: 'invalid' });
      
      expect(res.statusCode).toEqual(401);
      expect(res.body).toHaveProperty('message', 'Nama atau password salah');
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should return 400 if email is missing', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({});
      
      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('message', 'Email wajib diisi');
    });

    it('should return 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'invalid-email' });
      
      expect(res.statusCode).toEqual(400);
    });
  });
});

describe('Validation Tests', () => {
  test('should validate email format', () => {
    const validEmail = 'test@example.com';
    const invalidEmail = 'invalid-email';
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    expect(emailRegex.test(validEmail)).toBe(true);
    expect(emailRegex.test(invalidEmail)).toBe(false);
  });

  test('should validate password length', () => {
    const shortPassword = '123';
    const validPassword = 'password123';
    
    expect(shortPassword.length).toBeLessThan(6);
    expect(validPassword.length).toBeGreaterThanOrEqual(6);
  });
});
