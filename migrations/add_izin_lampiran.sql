-- Add lampiran column to izin table for file attachments
ALTER TABLE izin ADD COLUMN lampiran VARCHAR(255) NULL AFTER alasan;
