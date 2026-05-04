/* ═══════════════════════════════════════════════════════════
   teacher.js — Teacher Settings Page Logic
   Guardians of Gaia
═══════════════════════════════════════════════════════════ */

// ─── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSettingsIntoForm();
  renderGoals();
});

// ─── Load settings from GoG.session into form ────────────
function loadSettingsIntoForm() {
  const s = GoG.session;
  setValue('api-key-input', s.apiKey || '');
  setValue('time-limit', Math.round((s.timeLimitSeconds || 600) / 60));
  setValue('worksheet-text', s.worksheetText || '');
  setValue('intro-text', s.introduction || s.storyIntro || '');
  setValue('extra-notes', s.extraNotes || '');

  if (s.worksheetName) {
    showFileUploadedIndicator(s.worksheetName);
  }
}

// ─── Save settings ────────────────────────────────────────
function saveSettings() {
  GoG.session.apiKey           = getValue('api-key-input');
  GoG.session.timeLimitSeconds = parseInt(getValue('time-limit') || 10) * 60;
  GoG.session.worksheetText    = getValue('worksheet-text');
  GoG.session.introduction     = getValue('intro-text');
  GoG.session.storyIntro       = getValue('intro-text');
  GoG.session.extraNotes       = getValue('extra-notes');
  GoG.session.learningGoals    = collectGoals();

  saveSession();

  const status = document.getElementById('save-status');
  if (status) {
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2500);
  }

  showToast('✓ Settings saved!', 'green');
}

// ─── Goals Editor ─────────────────────────────────────────
function renderGoals() {
  const editor = document.getElementById('goals-editor');
  if (!editor) return;
  editor.innerHTML = '';

  const goals = GoG.session.learningGoals || [];
  goals.forEach((g, i) => addGoalRow(g));
  updateGoalCount();
}

function addGoalRow(value = '') {
  const editor = document.getElementById('goals-editor');
  if (!editor) return;

  const row = document.createElement('div');
  row.className = 'goal-item';
  row.innerHTML = `
    <input type="text" placeholder="e.g. Understand the water cycle" value="${escapeHTMLAttr(value)}" 
           oninput="updateGoalCount()" />
    <button class="goal-remove-btn" onclick="this.parentElement.remove(); updateGoalCount();" title="Remove">✕</button>
  `;
  editor.appendChild(row);
  updateGoalCount();
}

function collectGoals() {
  const inputs = document.querySelectorAll('#goals-editor .goal-item input');
  return Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
}

function updateGoalCount() {
  const count = collectGoals().length;
  const badge = document.getElementById('goals-count');
  if (badge) badge.textContent = `${count} goal${count !== 1 ? 's' : ''}`;
}

// ─── File Upload ──────────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-area')?.classList.add('drag-over');
}

function handleDragLeave(e) {
  document.getElementById('upload-area')?.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-area')?.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) processFile(file);
}

function handleFileUpload(e) {
  const file = e.target.files?.[0];
  if (file) processFile(file);
}

async function processFile(file) {
  const allowed = ['text/plain', 'application/pdf'];
  if (!allowed.includes(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.pdf')) {
    showToast('Please upload a .txt or .pdf file', 'red');
    return;
  }

  GoG.session.worksheetName = file.name;

  if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
    const text = await file.text();
    GoG.session.worksheetText = text;
    setValue('worksheet-text', text);
    showFileUploadedIndicator(file.name);
    showToast('📄 Worksheet loaded!', 'green');
  } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    // Basic PDF handling using FileReader — extract raw text via pdf.js if available
    showToast('📄 PDF uploaded. Please also paste the worksheet text below for AI use.', 'gold', 5000);
    showFileUploadedIndicator(file.name);
  }
}

function showFileUploadedIndicator(name) {
  const indicator = document.getElementById('file-uploaded-indicator');
  if (!indicator) return;
  indicator.className = 'file-uploaded';
  indicator.innerHTML = `
    <span>📄</span>
    <span class="file-uploaded-name">${escapeHTML(name)}</span>
    <button class="btn btn-ghost" style="font-size:0.75rem;padding:4px 10px" onclick="clearFile()">Remove</button>
  `;
}

function clearFile() {
  GoG.session.worksheetName = '';
  GoG.session.worksheetText = '';
  setValue('worksheet-text', '');
  const indicator = document.getElementById('file-uploaded-indicator');
  if (indicator) { indicator.className = 'hidden'; indicator.innerHTML = ''; }
  const fileInput = document.getElementById('worksheet-file');
  if (fileInput) fileInput.value = '';
}

// ─── API key visibility toggle ────────────────────────────
function toggleApiKeyVisibility() {
  const input = document.getElementById('api-key-input');
  const btn = document.getElementById('api-key-toggle');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}

// ─── AI Generate Introduction ─────────────────────────────
async function regenerateIntro() {
  const apiKey = getValue('api-key-input') || GoG.session.apiKey;
  if (!apiKey) {
    showToast('Please enter your API key first!', 'red');
    return;
  }

  // Temporarily set API key so agent can use it
  GoG.session.apiKey = apiKey;
  GoG.session.worksheetText = getValue('worksheet-text');
  GoG.session.learningGoals = collectGoals();

  const btn = document.querySelector('.regen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

  try {
    const narrative = await generateOpeningNarrative();
    if (narrative) {
      setValue('intro-text', narrative);
      showToast('✨ Story introduction generated!', 'green');
    }
  } catch (e) {
    showToast('Failed to generate: ' + e.message, 'red');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI Generate'; }
  }
}

// ─── History Modal ────────────────────────────────────────
function showHistory() {
  const chatLog = GoG.game.chatLog || [];

  if (chatLog.length === 0) {
    openModal('<p class="text-muted text-center" style="padding:24px">No game history yet. Start a game first!</p>', '📜 Game History');
    return;
  }

  const entries = chatLog.map(msg => `
    <div class="history-entry ${msg.type === 'player' ? 'player' : 'ai'}">
      <div class="history-sender">${escapeHTML(msg.sender || 'System')}</div>
      <div class="history-text">${escapeHTML(msg.text || '')}</div>
      <div class="history-time">${msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}</div>
    </div>
  `).join('');

  const content = `
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <span class="badge badge-purple">${chatLog.length} messages</span>
      <button class="btn btn-ghost" style="font-size:0.75rem" onclick="exportHistory()">⬇ Export</button>
    </div>
    <div class="history-log">${entries}</div>
  `;

  openModal(content, '📜 Game History');
}

function exportHistory() {
  const chatLog = GoG.game.chatLog || [];
  const text = chatLog.map(m => `[${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''}] ${m.sender}: ${m.text}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gog-history-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Utility ──────────────────────────────────────────────
function getValue(id) { return document.getElementById(id)?.value || ''; }
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeHTMLAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
