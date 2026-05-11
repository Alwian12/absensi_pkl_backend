-- Migration: Add new fields to jurnal table for complete prakerin report format
-- Date: 2026-04-24

ALTER TABLE jurnal 
ADD COLUMN nomor_kegiatan VARCHAR(10) AFTER tanggal,
ADD COLUMN nama_pekerjaan VARCHAR(255) AFTER nomor_kegiatan,
ADD COLUMN tanggal_selesai DATE AFTER nama_pekerjaan,
ADD COLUMN kompetensi TEXT AFTER deskripsi,
ADD COLUMN alat_bahan TEXT AFTER kompetensi,
ADD COLUMN uraian_kerja TEXT AFTER alat_bahan,
ADD COLUMN keterangan TEXT AFTER uraian_kerja,
ADD COLUMN is_draft TINYINT(1) DEFAULT 0 AFTER status_pembimbing;

-- Update existing records (copy kegiatan to nama_pekerjaan for backward compatibility)
UPDATE jurnal SET nama_pekerjaan = kegiatan WHERE nama_pekerjaan IS NULL;

-- Set existing records as not draft
UPDATE jurnal SET is_draft = 0 WHERE is_draft IS NULL;

-- Add index for better performance on new fields
CREATE INDEX idx_jurnal_nomor ON jurnal(user_id, nomor_kegiatan);
CREATE INDEX idx_jurnal_draft ON jurnal(user_id, is_draft);
