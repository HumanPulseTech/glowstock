-- Apply BEFORE deploying the ASVS security changes. Back up the database first.
-- scrypt hashes require more than the 60 characters used by bcrypt.
ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NOT NULL;
