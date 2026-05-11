# SYSTEM DIAGNOSTIC & REPAIR GUIDE

## 🚨 CRITICAL ISSUES DETECTED

### LOGIN FAILURES (Admin & User)

## STEP 1: CHECK DATABASE CONNECTION

Jalankan di terminal backend:
```bash
cd C:\laragon\www\absensi-pkl\backend
node -e "const {pool} = require('./config/database'); pool.query('SELECT 1').then(() => console.log('✅ DB OK')).catch(e => console.log('❌ DB ERROR:', e.message))"
```

## STEP 2: CHECK DEFAULT DATA

Jalankan di phpMyAdmin:
```sql
-- Check admin exists
SELECT id, nama, username FROM admins WHERE username = 'admin';

-- Check if foto columns exist
SHOW COLUMNS FROM absensi LIKE '%foto%';

-- Check default unit
SELECT * FROM unit_kantor WHERE id = 1;
```

## STEP 3: CHECK ENVIRONMENT VARIABLES

File `.env` harus ada di `backend/` dengan isi:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=absensi_pkl
JWT_SECRET=your_jwt_secret_key_here_min_32_chars
PORT=3000
```

## STEP 4: CHECK SERVER RUNNING

```bash
curl http://localhost:3000/
# Should return: {"message":"API is running"}
```

## STEP 5: CHECK LOGIN API

```bash
# Test admin login
curl -X POST http://localhost:3000/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Test user login  
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"userpassword"}'
```

## STEP 6: FIX COMMON ISSUES

### Issue: JWT_SECRET not set
```bash
cd C:\laragon\www\absensi-pkl\backend
echo "JWT_SECRET=absensi_pkl_secret_key_2024_secure_random_string" > .env
echo "PORT=3000" >> .env
echo "DB_HOST=localhost" >> .env
echo "DB_USER=root" >> .env
echo "DB_PASSWORD=" >> .env
echo "DB_NAME=absensi_pkl" >> .env
```

### Issue: Database not initialized
Jalankan `database.sql` di phpMyAdmin

### Issue: foto columns missing
```sql
ALTER TABLE absensi 
ADD COLUMN IF NOT EXISTS foto_check_in VARCHAR(255) NULL,
ADD COLUMN IF NOT EXISTS foto_check_out VARCHAR(255) NULL;
```

### Issue: Port conflict
Edit `backend/server.js`:
```javascript
const PORT = process.env.PORT || 5000;  // Change to 5000 if 3000 is taken
```

Then update frontend `api.js`:
```javascript
baseURL: 'http://localhost:5000'  // Match backend port
```

## STEP 7: RESTART EVERYTHING

1. Stop backend (Ctrl+C)
2. Stop frontend (Ctrl+C)
3. Start backend: `npm run dev`
4. Start frontend: `npm run dev`
5. Hard refresh browser

## COMPLETE SYSTEM RESET

If all else fails:

```bash
# 1. Clear node_modules
rd /s /q C:\laragon\www\absensi-pkl\backend\node_modules
rd /s /q C:\laragon\www\absensi-pkl\frontend\node_modules

# 2. Reinstall
cd C:\laragon\www\absensi-pkl\backend && npm install
cd C:\laragon\www\absensi-pkl\frontend && npm install

# 3. Reset database
# Jalankan database.sql di phpMyAdmin

# 4. Create .env
echo "JWT_SECRET=absensi_pkl_secure_key_2024_random_string_for_jwt_token_generation" > C:\laragon\www\absensi-pkl\backend\.env

# 5. Start servers
cd C:\laragon\www\absensi-pkl\backend && npm run dev
cd C:\laragon\www\absensi-pkl\frontend && npm run dev
```

## TESTING CHECKLIST

- [ ] Backend server running on port 3000/5000
- [ ] Database connected
- [ ] Admin login works
- [ ] User login works
- [ ] Check-in with photo works
- [ ] Check-out with photo works
- [ ] Admin can view photos
- [ ] All pages load without errors
