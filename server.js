const express = require('express');
const cors = require('cors');
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT || ROOT;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'messages.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const heicConvert = require('heic-convert');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function formatStatsBytes(bytes) {
  const gb = bytes / 1024 / 1024 / 1024;
  const mb = bytes / 1024 / 1024;

  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function getUploadsStats() {
  const items = readDb();
  const filesOnDisk = fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : [];

  let diskBytes = 0;
  let diskFiles = 0;

  filesOnDisk.forEach((filename) => {
    const filePath = path.join(UPLOADS_DIR, filename);
    const stat = fs.statSync(filePath);

    if (stat.isFile()) {
      diskFiles += 1;
      diskBytes += stat.size;
    }
  });

  const allFiles = items.flatMap((item) => item.files || []);

  const photos = allFiles.filter((file) => file.kind === 'photo');
  const videos = allFiles.filter((file) => file.kind === 'video');

  const dbBytes = allFiles.reduce((sum, file) => {
    return sum + Number(file.size || 0);
  }, 0);

  return {
    totalItems: items.length,
    photos: photos.length,
    videos: videos.length,
    dbBytes,
    diskBytes,
    diskFiles,
    readableDbSize: formatStatsBytes(dbBytes),
    readableDiskSize: formatStatsBytes(diskBytes)
  };
}

function clearUploadsDirectory() {
  if (!fs.existsSync(UPLOADS_DIR)) return { deletedFiles: 0, deletedBytes: 0 };

  let deletedFiles = 0;
  let deletedBytes = 0;

  fs.readdirSync(UPLOADS_DIR).forEach((filename) => {
    const filePath = path.join(UPLOADS_DIR, filename);
    const stat = fs.statSync(filePath);

    if (stat.isFile()) {
      deletedBytes += stat.size;
      fs.unlinkSync(filePath);
      deletedFiles += 1;
    }
  });

  return { deletedFiles, deletedBytes };
}

function safeExt(file) {
  const originalExt = path.extname(file.originalname || '').toLowerCase();

  if (originalExt && originalExt.length <= 12) return originalExt;
  if (file.mimetype.startsWith('image/')) return '.jpg';
  if (file.mimetype.startsWith('video/')) return '.mp4';

  return '.bin';
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${safeExt(file)}`);
  }
});

const startupConfig = readConfig();

const upload = multer({
  storage,
  limits: {
    fileSize: Number(startupConfig.maxFileSizeMb || 150) * 1024 * 1024,
    files: Number(startupConfig.maxFiles || 15)
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      return cb(null, true);
    }

    return cb(new Error('Dozwolone są tylko zdjęcia i filmiki.'));
  }
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

function getAdminToken() {
  return process.env.ADMIN_TOKEN;
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;

  if (!token || token !== getAdminToken()) {
    return res.status(401).json({ error: 'Brak dostępu do panelu organizatora.' });
  }

  next();
}

app.get('/api/config', (_req, res) => {
  const config = readConfig();

  res.json({
    coupleNames: config.coupleNames,
    weddingDate: config.weddingDate,
    welcomeTitle: config.welcomeTitle,
    welcomeText: config.welcomeText,
    thankYouTitle: config.thankYouTitle,
    thankYouText: config.thankYouText,
    maxDurationSeconds: config.maxDurationSeconds,
    backgroundImage: config.backgroundImage,
    maxFiles: config.maxFiles,
    maxFileSizeMb: config.maxFileSizeMb,
    compressImages: config.compressImages,
    imageMaxWidth: config.imageMaxWidth,
    imageQuality: config.imageQuality
  });
});

app.post('/api/upload', upload.array('media', Number(startupConfig.maxFiles || 30)), (req, res) => {
  const guestName = (req.body.guestName || '').trim().slice(0, 80);
  const comment = (req.body.comment || '').trim().slice(0, 240);
  const consent = req.body.consent === 'true';

  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'Brak plików do wysłania.' });
  }

  if (!consent) {
    req.files.forEach((file) => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });

    return res.status(400).json({ error: 'Zgoda jest wymagana.' });
  }

  const items = readDb();

  const memory = {
  id: crypto.randomUUID(),
  guestName: guestName || 'Gość bez podpisu',
  comment,
  createdAt: new Date().toISOString(),
  files: req.files.map((file) => ({
    id: path.parse(file.filename).name,
    kind: file.mimetype.startsWith('image/') ? 'photo' : 'video',
    originalName: file.originalname,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size
  }))
};

writeDb([memory, ...items]);

res.status(201).json({
  ok: true,
  count: memory.files.length,
  id: memory.id
});
});


app.get('/api/storage-stats', requireAdmin, (_req, res) => {
  res.json(getUploadsStats());
});

app.delete('/api/admin/clear-all', requireAdmin, (_req, res) => {
  const before = getUploadsStats();
  const result = clearUploadsDirectory();
  writeDb([]);

  res.json({
    ok: true,
    deletedFiles: result.deletedFiles,
    deletedBytes: result.deletedBytes,
    readableDeletedSize: formatStatsBytes(result.deletedBytes),
    before
  });
});

app.get('/api/messages', requireAdmin, (_req, res) => {
  const items = readDb();

  res.json({ items });
});

app.get('/api/preview/:id', requireAdmin, (req, res) => {
  const memories = readDb();

  let foundFile = null;

  for (const memory of memories) {
    const file = (memory.files || []).find((entry) => entry.id === req.params.id);

    if (file) {
      foundFile = file;
      break;
    }
  }

  if (!foundFile) {
    return res.status(404).json({ error: 'Nie znaleziono pliku.' });
  }

  const filePath = path.join(UPLOADS_DIR, foundFile.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Plik nie istnieje na dysku.' });
  }

  res.setHeader('Content-Type', foundFile.mimetype);
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(filePath);
});


app.get('/api/download-memory/:id', requireAdmin, (req, res) => {
  const memory = readDb().find((entry) => entry.id === req.params.id);

  if (!memory) {
    return res.status(404).json({ error: 'Nie znaleziono pamiątki.' });
  }

  const files = memory.files || [];

  if (!files.length) {
    return res.status(404).json({ error: 'Ta pamiątka nie ma plików.' });
  }

  const cleanGuest = (memory.guestName || 'pamiatka')
    .replace(/[^a-z0-9ąćęłńóśźż -]/gi, '')
    .trim() || 'pamiatka';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${cleanGuest}-${memory.id}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });

  archive.pipe(res);

  archive.append(JSON.stringify(memory, null, 2), {
    name: 'opis-pamiatki.json'
  });

  files.forEach((file) => {
    const filePath = path.join(UPLOADS_DIR, file.filename);

    if (fs.existsSync(filePath)) {
      const folder = file.kind === 'video' ? 'filmy' : 'zdjecia';
      archive.file(filePath, {
        name: `${folder}/${file.filename}`
      });
    }
  });

  archive.finalize();
});

app.get('/api/download-all', requireAdmin, (_req, res) => {
  const items = readDb();

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="wesele-materialy.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });

  archive.pipe(res);
  archive.append(JSON.stringify(items, null, 2), { name: 'lista-materialow.json' });

  items.forEach((memory) => {
  const files = memory.files || [];

  files.forEach((file) => {
    const filePath = path.join(UPLOADS_DIR, file.filename);

    if (fs.existsSync(filePath)) {
      const folder = file.kind === 'video'
        ? 'filmy'
        : 'zdjecia';

      archive.file(filePath, {
        name: `${folder}/${file.filename}`
      });
    }
  });
});

  archive.finalize();
});

app.get('/organizer', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'organizer.html'));
});

app.get('/api/health', (_req, res) => {
  try {
    readDb();

    res.json({
      ok: true,
      uploadsDir: fs.existsSync(UPLOADS_DIR),
      dbFile: fs.existsSync(DB_FILE)
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `Plik jest za duży. Limit to ${readConfig().maxFileSizeMb} MB na plik.`
    });
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({
      error: `Za dużo plików naraz. Limit to ${readConfig().maxFiles} plików.`
    });
  }

  res.status(500).json({ error: err.message || 'Wewnętrzny błąd serwera.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wedding guestbook działa na http://localhost:${PORT}`);
  console.log(`Na telefonie w tym samym Wi-Fi wejdź na http://ADRES-IP-KOMPUTERA:${PORT}`);
});
