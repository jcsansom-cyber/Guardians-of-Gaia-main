/* ═══════════════════════════════════════════════════════════
   start.js — Start / Lobby Page Logic
   Guardians of Gaia
═══════════════════════════════════════════════════════════ */

let activeMicCheck = null;
const AVATAR_COLORS = ['', '-gold', '-teal', '-red'];
const AVATAR_EMOJIS = ['🧙', '⚔️', '🏹', '🎵'];

// ─── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderLessonPanel();
  renderPlayerList();
  checkApiKey();

  // Allow pressing Enter to add player
  const nameInput = document.getElementById('new-player-name');
  if (nameInput) {
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') addPlayer();
    });
  }
});

function checkApiKey() {
  if (!GoG.session.apiKey) {
    showToast('⚙ No Ollama model set. Visit Teacher Settings first.', 'gold', 5000);
  }
}

// ─── Player Management ────────────────────────────────────
function addPlayer() {
  const input = document.getElementById('new-player-name');
  const name = input.value.trim();
  if (!name) return;

  if (GoG.game.players.length >= 4) {
    showToast('Maximum 4 players!', 'red');
    return;
  }

  if (GoG.game.players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    showToast('That name is already taken!', 'red');
    return;
  }

  GoG.game.players.push({ name, ready: false, class: 'Scholar' });
  TOOLS.initCharacterSheet(name);
  input.value = '';
  renderPlayerList();
  updateStartButton();
}

function removePlayer(index) {
  GoG.game.players.splice(index, 1);
  renderPlayerList();
  updateStartButton();
}

function toggleReady(index) {
  GoG.game.players[index].ready = !GoG.game.players[index].ready;
  renderPlayerList();
  updateStartButton();
}

function renderPlayerList() {
  const list = document.getElementById('player-list');
  if (!list) return;
  list.innerHTML = '';

  const players = GoG.game.players;

  // Show filled slots
  players.forEach((p, i) => {
    const slot = document.createElement('div');
    slot.className = `player-slot filled ${p.ready ? 'ready' : ''}`;
    slot.onclick = (e) => {
      if (!e.target.classList.contains('remove-player-btn')) toggleReady(i);
    };

    slot.innerHTML = `
      <div class="avatar${AVATAR_COLORS[i]}">${AVATAR_EMOJIS[i]}</div>
      <div class="player-slot-info">
        <div class="player-slot-name">${escapeHTML(p.name)}</div>
        <div class="player-slot-status">${p.ready ? '✓ Ready' : 'Click to ready up'}</div>
      </div>
      <div class="ready-indicator ${p.ready ? 'ready' : ''}"></div>
      <button class="remove-player-btn" onclick="removePlayer(${i})" title="Remove">✕</button>
    `;
    list.appendChild(slot);
  });

  // Empty placeholder slots
  const emptyCount = Math.max(0, 4 - players.length);
  for (let i = 0; i < emptyCount; i++) {
    const slot = document.createElement('div');
    slot.className = 'player-slot player-slot-empty';
    slot.innerHTML = `
      <div class="avatar" style="opacity:0.3">👤</div>
      <div class="player-slot-info">
        <div class="player-slot-name">Empty Slot</div>
        <div class="player-slot-status">Add a player above</div>
      </div>
    `;
    list.appendChild(slot);
  }
}

function updateStartButton() {
  const btn = document.getElementById('start-btn');
  if (!btn) return;
  const allReady = GoG.game.players.every(p => p.ready);
  const hasPlayers = GoG.game.players.length > 0;
  btn.disabled = !(hasPlayers && allReady);
  console.log(`[StartPage] Button update: players=${GoG.game.players.length}, ready=${allReady} -> disabled=${btn.disabled}`);
}

// ─── Lesson Panel ─────────────────────────────────────────
function renderLessonPanel() {
  const panel = document.getElementById('lesson-panel');
  if (!panel) return;

  const session = GoG.session;
  const hasConfig = session.worksheetName || session.worksheetText || session.learningGoals?.length > 0 || session.introduction;

  panel.innerHTML = `
    <div class="lesson-header">
      <h1 class="cinzel">📜 Lesson Briefing</h1>
      <p>${(session.worksheetName || session.worksheetText) ? `Worksheet: <strong>${escapeHTML(session.worksheetName || 'Pasted Content')}</strong>` : 'Configure in Teacher Settings'}</p>
    </div>

    <div class="lesson-grid">

      ${session.introduction || session.storyIntro ? `
      <div class="glass-card lesson-card intro-card">
        <div class="lesson-card-title">📖 Introduction</div>
        <div class="lesson-card-content">${escapeHTML(session.introduction || session.storyIntro)}</div>
      </div>` : ''}

      <div class="glass-card lesson-card">
        <div class="lesson-card-title">📄 Worksheet</div>
        <div class="lesson-card-content">
          ${(session.worksheetName || session.worksheetText)
            ? `<span class="badge badge-gold">${escapeHTML(session.worksheetName || 'Pasted Content')}</span>`
            : '<span class="text-muted">No worksheet uploaded</span>'}
        </div>
      </div>

      <div class="glass-card lesson-card">
        <div class="lesson-card-title">🎓 Learning Goals</div>
        <div class="lesson-card-content">
          ${session.learningGoals?.length > 0
            ? `<ul class="goals-list">${session.learningGoals.map((g,i) =>
                `<li><div class="goal-num">${i+1}</div>${escapeHTML(g)}</li>`).join('')}</ul>`
            : '<span class="text-muted">No learning goals set</span>'}
        </div>
      </div>

      <div class="glass-card lesson-card">
        <div class="lesson-card-title">⚔ Quest Goals</div>
        <div class="lesson-card-content">
          ${session.gameGoals?.length > 0
            ? `<ul class="goals-list">${session.gameGoals.map((g,i) =>
                `<li><div class="goal-num">${i+1}</div>${escapeHTML(g)}</li>`).join('')}</ul>`
            : '<span class="text-muted">Will be generated by AI at game start</span>'}
        </div>
      </div>
    </div>

    ${!hasConfig ? `
    <div class="no-config-notice">
      <div class="icon">⚙</div>
      <p>Set up your lesson in <strong>Teacher Settings</strong> to see the lesson briefing here.</p>
      <a href="teacher.html" class="btn btn-purple">Go to Teacher Settings</a>
    </div>` : ''}
  `;
}

// ─── Mic Check ────────────────────────────────────────────
let micCheckStream = null;

function runMicCheck() {
  // Stop existing if any
  if (activeMicCheck) { try { activeMicCheck.stop(); } catch(e){} }

  const dot = document.getElementById('mic-dot');
  const statusText = document.getElementById('mic-status-text');
  const micBtn = document.getElementById('mic-check-btn');

  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    dot.className = 'mic-dot error';
    statusText.textContent = 'Voice not supported';
    showToast('⚠ Your browser does not support voice input. Use Chrome or Edge.', 'red', 5000);
    return;
  }

  micBtn.disabled = true; // Prevent double clicks
  dot.className = 'mic-dot active';
  statusText.textContent = 'Listening… say something!';

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  activeMicCheck = rec;
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
    }
    dot.className = 'mic-dot ready';
    statusText.textContent = `Heard: "${transcript.substring(0, 30)}…"`;
    console.log('[Mic Check Transcript]:', transcript);
  };

  rec.onerror = (e) => {
    console.warn('[Mic Check Error]:', e.error);
    if (e.error === 'no-speech') {
      dot.className = 'mic-dot error';
      statusText.textContent = 'No voice detected. Tested in terminal.';
    } else {
      dot.className = 'mic-dot error';
      statusText.textContent = 'Mic test failed. Printed to terminal.';
    }
  };

  rec.onend = () => {
    activeMicCheck = null;
    micBtn.disabled = false;
    if (dot.className === 'mic-dot active') {
      dot.className = 'mic-dot';
      statusText.textContent = 'No audio detected';
    } else if (dot.className === 'mic-dot ready') {
        showToast('🎤 Mic is working!', 'green');
    }
  };

  rec.start();
  // Auto-stop after 10 seconds to allow time for permission prompts
  setTimeout(() => { if (activeMicCheck === rec) rec.stop(); }, 10000);
}

// ─── Start Game ───────────────────────────────────────────
async function startGame() {
  // Stop mic check if it's still running
  if (activeMicCheck) { try { activeMicCheck.stop(); } catch(e){} }

  const readyPlayers = GoG.game.players.filter(p => p.ready);
  if (readyPlayers.length !== GoG.game.players.length) {
    showToast('All players must be ready to start!', 'red');
    return;
  }

  const btn = document.getElementById('start-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Preparing Adventure…';

  try {
    // Generate game goals from worksheet if we have an API key
    if (GoG.session.apiKey && GoG.session.worksheetText) {
      showToast('✨ AI is generating quest goals…', 'gold', 3000);
      const goals = await generateGameGoals();
      if (goals) {
        GoG.session.gameGoals = goals;
        saveSession();
      }
    }

    saveGameState();
    window.location.href = 'game.html';
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '⚔ Begin Adventure';
    showToast('Error: ' + e.message, 'red');
  }
}

// ─── Utility ──────────────────────────────────────────────
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
