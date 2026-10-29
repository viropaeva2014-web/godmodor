const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const DEFAULT_SETTINGS = { path: 'Godomodoro/mods', verify: true };

const state = {
  catalog: [],
  installed: JSON.parse(localStorage.getItem('installed') || '[]'),
  logs: JSON.parse(localStorage.getItem('logs') || '[]'),
  settings: {
    ...DEFAULT_SETTINGS,
    ...JSON.parse(localStorage.getItem('settings') || '{}')
  }
};

function saveAll() {
  localStorage.setItem('installed', JSON.stringify(state.installed));
  localStorage.setItem('logs', JSON.stringify(state.logs));
  localStorage.setItem('settings', JSON.stringify(state.settings));
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('ru-RU')}] ${msg}`;
  state.logs.unshift(line);
  if (state.logs.length > 300) state.logs.pop();
  saveAll();
  renderLogs();
  console.log(line);
}

function toast(msg, isError = false) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2600);
}

async function sha256Hex(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function b64FromArrayBuffer(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function saveFile(filename, arrayBuffer) {
  const FS = window.Capacitor?.Plugins?.Filesystem;

  if (FS) {
    const base64 = b64FromArrayBuffer(arrayBuffer);
    await FS.writeFile({
      path: `${state.settings.path}/${filename}`,
      data: base64,
      directory: 'DOCUMENTS',
      recursive: true
    });
    return `Документы/${state.settings.path}/${filename}`;
  }

  // Fallback для браузера
  const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

async function loadCatalog() {
  const statusEl = $('#home-status');
  if (statusEl) statusEl.textContent = 'Загрузка каталога…';

  try {
    const r = await fetch('catalog.json?t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    state.catalog = data.mods || [];
    log(`Каталог загружен: ${state.catalog.length} модов`);
    if (statusEl) {
      statusEl.textContent = `Каталог: ${state.catalog.length} модов, обновлён ${new Date(data.updated || Date.now()).toLocaleString('ru-RU')}`;
    }
    renderCatalog();
  } catch (e) {
    log('Ошибка загрузки каталога: ' + e.message);
    if (statusEl) statusEl.textContent = 'Сервер недоступен — показан локальный кэш';
    const cached = localStorage.getItem('catalogCache');
    if (cached) {
      state.catalog = JSON.parse(cached).mods || [];
      renderCatalog();
    }
  }
}

function renderCatalog() {
  localStorage.setItem('catalogCache', JSON.stringify({ mods: state.catalog }));

  const q = ($('#search')?.value || '').toLowerCase().trim();
  const list = $('#catalog-list');
  if (!list) return;
  list.innerHTML = '';

  const items = state.catalog.filter(m =>
    !q ||
    m.name.toLowerCase().includes(q) ||
    m.author.toLowerCase().includes(q)
  );

  if (!items.length) {
    list.innerHTML = '<p class="muted">Ничего не найдено.</p>';
    return;
  }

  for (const m of items) {
    const card = document.createElement('div');
    card.className = 'mod';
    card.innerHTML = `
      <h3>${m.name}<span class="badge">v${m.version}</span></h3>
      <div class="meta">Автор: ${m.author} · Игра: ${m.game || '2.2.2091'}</div>
      <p class="desc">${m.description || ''}</p>
      <div class="actions">
        <button class="btn primary" data-install="${m.id}">Установить</button>
      </div>
    `;
    list.appendChild(card);
  }

  $$('[data-install]', list).forEach(btn => {
    btn.addEventListener('click', () => {
      const mod = state.catalog.find(x => x.id === btn.dataset.install);
      if (mod) installMod(mod, btn);
    });
  });
}

async function installMod(mod, btn) {
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Скачиваем…';
  log(`Установка: ${mod.name} v${mod.version}`);

  try {
    const res = await fetch(mod.file);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();

    if (state.settings.verify && mod.sha256) {
      btn.textContent = 'Проверяем…';
      const hex = await sha256Hex(buf);
      if (hex.toLowerCase() !== mod.sha256.toLowerCase()) {
        throw new Error('SHA-256 не совпал');
      }
      log('SHA-256 совпал');
    }

    btn.textContent = 'Сохраняем…';
    const filename = `${mod.id}-${mod.version}.gdmod`;
    const where = await saveFile(filename, buf);

    state.installed = state.installed.filter(x => x.id !== mod.id);
    state.installed.push({
      id: mod.id,
      name: mod.name,
      version: mod.version,
      where,
      date: new Date().toISOString()
    });
    saveAll();
    renderInstalled();
    log(`Сохранено: ${where}`);
    toast('Мод сохранён: ' + mod.name);
  } catch (e) {
    log('Ошибка установки: ' + e.message);
    toast('Ошибка: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function renderInstalled() {
  const list = $('#installed-list');
  if (!list) return;
  list.innerHTML = '';

  if (!state.installed.length) {
    list.innerHTML = '<p class="muted">Пока ничего не установлено.</p>';
    return;
  }

  [...state.installed].reverse().forEach(m => {
    const card = document.createElement('div');
    card.className = 'mod';
    card.innerHTML = `
      <h3>${m.name}<span class="badge">v${m.version}</span></h3>
      <div class="meta">${m.where}</div>
      <div class="meta">Установлен: ${new Date(m.date).toLocaleString('ru-RU')}</div>
      <div class="actions">
        <button class="btn danger" data-remove="${m.id}">Забыть</button>
      </div>
    `;
    list.appendChild(card);
  });

  $$('[data-remove]', list).forEach(btn => {
    btn.addEventListener('click', () => {
      state.installed = state.installed.filter(x => x.id !== btn.dataset.remove);
      saveAll();
      renderInstalled();
      log('Запись удалена из списка');
    });
  });
}

function renderLogs() {
  const el = $('#logs');
  if (!el) return;
  el.textContent = state.logs.length ? state.logs.join('\n') : 'Журнал пуст.';
}

function switchView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const v = $('#view-' + name);
  if (v) v.classList.add('active');
  $$('.tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name)
  );
}

function bind() {
  $$('.tabs button').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view))
  );

  $('#btn-refresh')?.addEventListener('click', loadCatalog);

  $('#btn-refresh-home')?.addEventListener('click', () => {
    loadCatalog();
    switchView('catalog');
  });

  $('#search')?.addEventListener('input', renderCatalog);

  if ($('#set-path')) $('#set-path').value = state.settings.path;
  if ($('#set-verify')) $('#set-verify').checked = state.settings.verify;

  $('#btn-save-settings')?.addEventListener('click', () => {
    state.settings.path = ($('#set-path').value || '').trim() || DEFAULT_SETTINGS.path;
    state.settings.verify = $('#set-verify').checked;
    saveAll();
    log('Настройки сохранены');
    toast('Настройки сохранены');
  });

  $('#btn-clear-logs')?.addEventListener('click', () => {
    state.logs = [];
    saveAll();
    renderLogs();
  });
}

function init() {
  bind();
  switchView('home');
  renderInstalled();
  renderLogs();
  log('Годомодор Инсталлер запущен');
  loadCatalog();
}

document.addEventListener('DOMContentLoaded', init);