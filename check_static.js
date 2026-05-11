const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Check current directory
console.log('Current directory:', __dirname);
console.log('Process cwd:', process.cwd());

// Check uploads folder
const uploadsPath = path.join(__dirname, 'uploads');
console.log('Uploads path:', uploadsPath);
console.log('Uploads exists:', fs.existsSync(uploadsPath));

// List files in uploads
if (fs.existsSync(uploadsPath)) {
  console.log('Uploads contents:', fs.readdirSync(uploadsPath));
  
  const absensiPath = path.join(uploadsPath, 'absensi');
  if (fs.existsSync(absensiPath)) {
    console.log('Absensi contents:', fs.readdirSync(absensiPath));
  }
}

// Setup static file serving
app.use('/uploads', express.static(uploadsPath));
console.log('Static server configured at /uploads');

// Test route
app.get('/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    uploadsPath, 
    exists: fs.existsSync(uploadsPath) 
  });
});

app.listen(3001, () => {
  console.log('Test server running on port 3001');
});
