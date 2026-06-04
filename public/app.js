const state = {
  config: null,
  selectedFiles: []
};

const qs = (id) => document.getElementById(id);

const screens = {
  home: qs('home-screen'),
  upload: qs('upload-screen'),
  thankyou: qs('thankyou-screen')
};

const els = {
  coupleNames: qs('coupleNames'),
  weddingDate: qs('weddingDate'),
  welcomeTitle: qs('welcomeTitle'),
  welcomeText: qs('welcomeText'),
  thankYouTitle: qs('thankYouTitle'),
  thankYouText: qs('thankYouText'),

  goGalleryBtn: qs('goGalleryBtn'),
  chooseGalleryBtn: qs('chooseGalleryBtn'),

  uploadGuestName: qs('uploadGuestName'),
  uploadComment: qs('uploadComment'),
  uploadConsent: qs('uploadConsent'),
  mediaFile: qs('mediaFile'),
  compressionInfo: qs('compressionInfo'),
  fileSummary: qs('fileSummary'),
  fileList: qs('fileList'),
  sendUploadBtn: qs('sendUploadBtn'),
  uploadStatus: qs('uploadStatus'),
  resetBtn: qs('resetBtn'),
  goUploadBtn: qs('goUploadBtn'),
};

function switchScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.remove('active'));
  screens[name].classList.add('active');
}

function setStatus(message = '', type = '') {
  els.uploadStatus.textContent = message;
  els.uploadStatus.className = `status ${type}`.trim();
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isPhoto(file) {
  return file.type.startsWith('image/');
}

function isVideo(file) {
  return file.type.startsWith('video/');
}

async function compressImage(file) {
  const config = state.config || {};
  const shouldCompress = config.compressImages !== false;

  if (!shouldCompress || !isPhoto(file)) return file;

  // HEIC/HEIF często nie kompresuje się stabilnie w canvasie na każdym telefonie.
  if (file.type.includes('heic') || file.type.includes('heif')) return file;

  const maxWidth = Number(config.imageMaxWidth || 2000);
  const quality = Number(config.imageQuality || 0.82);

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

  bitmap.close?.();

  if (!blob) return file;

  // Jeżeli kompresja przypadkiem zrobi większy plik, zostawiamy oryginał.
  if (blob.size >= file.size) return file;

  const baseName = file.name.replace(/\.[^/.]+$/, '');
  return new File([blob], `${baseName}-compressed.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now()
  });
}

async function prepareFiles(fileList) {
  const incoming = Array.from(fileList || []);
  const maxFiles = Number(state.config?.maxFiles || 30);
  const maxFileSizeMb = Number(state.config?.maxFileSizeMb || 150);

  if (!incoming.length) return;

  const accepted = [];
  const rejected = [];

  setStatus('Przygotowywanie plików...', '');

  for (const file of incoming) {
    const allowed = isPhoto(file) || isVideo(file);

    if (!allowed) {
      rejected.push(`${file.name}: to nie jest zdjęcie ani film.`);
      continue;
    }

    let finalFile = file;

    try {
      finalFile = await compressImage(file);
    } catch {
      finalFile = file;
    }

    if (finalFile.size > maxFileSizeMb * 1024 * 1024) {
      rejected.push(`${file.name}: plik ma ponad ${maxFileSizeMb} MB.`);
      continue;
    }

    accepted.push({
      file: finalFile,
      originalName: file.name,
      originalSize: file.size,
      compressed: finalFile.size < file.size && isPhoto(file)
    });
  }

  const merged = [...state.selectedFiles, ...accepted];

  if (merged.length > maxFiles) {
    setStatus(`Za dużo plików naraz. Limit to ${maxFiles}.`, 'error');
    return;
  }

  state.selectedFiles = merged;
  renderSelectedFiles();

  if (rejected.length) {
    setStatus(rejected.join('\n'), 'error');
  } else {
    setStatus('');
  }

  els.mediaFile.value = '';
}

function removeFile(indexToRemove) {
  state.selectedFiles = state.selectedFiles.filter((_, index) => index !== indexToRemove);
  renderSelectedFiles();
}

function renderSelectedFiles() {
  const items = state.selectedFiles;

  if (!items.length) {
    els.fileSummary.textContent = 'Nie wybrano plików.';
    els.fileList.innerHTML = '';
    return;
  }

  const photos = items.filter((item) =>
    item.file.type.startsWith('image/')
  );

  const videos = items.filter((item) =>
    item.file.type.startsWith('video/')
  );

  const totalSize = items.reduce(
    (sum, item) => sum + item.file.size,
    0
  );

  els.fileSummary.textContent =
    `Wybrano ${photos.length} zdjęć i ${videos.length} filmików`;

  els.fileList.innerHTML = `
    <div class="selected-summary glass">
      <h3>Gotowe do wysłania: </h3>

      ${photos.length > 0 ? `
      <p>
    📸 Zdjęcia: <strong>${photos.length}</strong>
      </p>
    ` : ''}

      ${videos.length > 0 ? `
      <p>
    🎥 Filmiki: <strong>${videos.length}</strong>
      /p>
    ` : ''}

      <button id="clearFilesBtn" class="btn btn-ghost">
        Usuń wszystkie
      </button>
    </div>
  `;

  document
    .getElementById('clearFilesBtn')
    ?.addEventListener('click', () => {
      state.selectedFiles = [];
      renderSelectedFiles();
    });
}

async function loadConfig() {
  const response = await fetch('/api/config');
  state.config = await response.json();

  els.coupleNames.textContent = state.config.coupleNames;
  els.weddingDate.textContent = state.config.weddingDate || '';
  els.welcomeTitle.textContent = state.config.welcomeTitle;
  els.welcomeText.textContent = state.config.welcomeText;
  els.thankYouTitle.textContent = state.config.thankYouTitle;
  els.thankYouText.textContent = state.config.thankYouText;

  if (state.config.backgroundImage) {
    document.querySelector('.app-shell').style.backgroundImage =
      `linear-gradient(rgba(22,17,20,.30), rgba(22,17,20,.72)), url('${state.config.backgroundImage}')`;
  }
}

function openUploadScreen() {
  switchScreen('upload');
  setStatus('');
}

async function submitUpload() {
  if (!state.selectedFiles.length) {
    setStatus('Najpierw wybierz zdjęcie albo film.', 'error');
    return;
  }

  if (!els.uploadConsent.checked) {
    setStatus('Zaznacz zgodę przed wysłaniem.', 'error');
    return;
  }

  const formData = new FormData();

  state.selectedFiles.forEach((item) => {
    formData.append('media', item.file);
  });

  formData.append('guestName', els.uploadGuestName.value.trim());
  formData.append('comment', els.uploadComment.value.trim());
  formData.append('consent', String(els.uploadConsent.checked));

  els.sendUploadBtn.disabled = true;
  setStatus('Wysyłanie... Nie zamykaj tej strony.', '');

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Nie udało się wysłać materiałów.');
    }

    state.selectedFiles = [];
    renderSelectedFiles();
    els.uploadGuestName.value = '';
    els.uploadComment.value = '';
    els.uploadConsent.checked = false;

    switchScreen('thankyou');
  } catch (error) {
    setStatus(error.message || 'Nie udało się wysłać materiałów.', 'error');
  } finally {
    els.sendUploadBtn.disabled = false;
  }
}

function resetForm() {
  state.selectedFiles = [];
  renderSelectedFiles();
  els.uploadGuestName.value = '';
  els.uploadComment.value = '';
  els.uploadConsent.checked = false;
  setStatus('');
  switchScreen('home');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();

  els.goUploadBtn.addEventListener('click', () => {
    openUploadScreen();
  });

  els.chooseGalleryBtn.addEventListener('click', () => els.mediaFile.click());

  els.mediaFile.addEventListener('change', (event) => prepareFiles(event.target.files));

  els.sendUploadBtn.addEventListener('click', submitUpload);
  els.resetBtn.addEventListener('click', resetForm);

  document.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', resetForm);
  });

  renderSelectedFiles();
});

