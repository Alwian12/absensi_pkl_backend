@echo off
echo Testing uploads folder...
if exist "C:\laragon\www\absensi-pkl\backend\uploads\absensi" (
  echo ✅ uploads/absensi folder EXISTS
) else (
  echo ❌ uploads/absensi folder MISSING
  mkdir "C:\laragon\www\absensi-pkl\backend\uploads\absensi" 2>nul
  echo Created folder.
)
echo.
echo Testing file existence...
if exist "C:\laragon\www\absensi-pkl\backend\uploads\absensi\absen-14-1776822672485-112630043.jpg" (
  echo ✅ File exists
) else (
  echo ❌ File NOT FOUND - This is normal for old base64 data
)
echo.
pause
