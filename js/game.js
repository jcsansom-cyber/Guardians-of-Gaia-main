/* ═══════════════════════════════════════════════════════════
   game.js — Main Game Logic
   Guardians of Gaia
═══════════════════════════════════════════════════════════ */

const AGENT_COLORS = {
  'Rules Lawyer': 'agent-rules-lawyer',
  'Storyteller': 'agent-storyteller',
  'Expert': 'agent-expert',
  'Game Master': 'agent-historian',
};

const AGENT_BADGES = {
  'Rules Lawyer': 'badge-gold',
  'Storyteller': 'badge-purple',
  'Expert': 'badge-teal',
  'Game Master': 'badge-red',
};

const AVATAR_COLORS = ['', '-gold', '-teal', '-red'];
const AVATAR_EMOJIS = ['🧙', '⚔️', '🏹', '🎵'];

let speechRecognizer = null;
let isRecording = false;
let isMuted = false;
let persistentAudioStream = null;

function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('mute-btn');
  if (isMuted) {
    if (btn) btn.textContent = '🔇';
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } else {
    if (btn) btn.textContent = '🔊';
  }
}

// ─── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadGameState();

  if (!GoG.game.players || GoG.game.players.length === 0) {
    addSystemMessage('No players found — returning to lobby…');
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
    return;
  }

  renderSidebarPlayers();
  renderGoalsList();
  populateSpeakerSelect();
  startTimer();
  initVoiceInput();

  // Show the opening narrative
  await showOpeningNarrative();
});

// ─── Opening Narrative ────────────────────────────────────
async function showOpeningNarrative() {
  showTypingIndicator('Storyteller');

  let narrative;
  try {
    if (GoG.session.apiKey) {
      narrative = await generateOpeningNarrative();
    } else {
      narrative = GoG.session.introduction || GoG.session.storyIntro
        || 'Welcome, brave adventurers, to the world of Gaia! A great mystery threatens these lands. Your knowledge and courage are the only hope. What do you do?';
    }
  } catch(e) {
    narrative = 'The adventure begins... What do you do?';
  }

  removeTypingIndicator();
  addAIMessage('Storyteller', narrative);

  // Log it
  logMessage('Storyteller', narrative, 'ai');
  speakText(narrative);
}

// ─── Timer ────────────────────────────────────────────────
function startTimer() {
  if (!GoG.game.timerStarted) {
    GoG.game.timerStart = Date.now();
    GoG.game.timerStarted = true;
    saveGameState();
  }

  GoG.game.timerInterval = setInterval(updateTimerUI, 1000);
  updateTimerUI();
}

function updateTimerUI() {
  const status = TOOLS.checkTime();
  const display = document.getElementById('timer-display');
  const fill = document.getElementById('timer-bar-fill');

  if (!display) return;

  display.textContent = TOOLS.formatTime(status.remaining);
  display.className = 'timer-display' +
    (status.critical ? ' critical' : status.warning ? ' warning' : '');

  if (fill) {
    const pct = Math.max(0, status.fraction * 100);
    fill.style.width = pct + '%';
    if (status.critical) {
      fill.style.background = 'var(--red)';
    } else if (status.warning) {
      fill.style.background = 'linear-gradient(90deg, var(--red), var(--gold))';
    }
  }

  if (status.remaining <= 0) {
    clearInterval(GoG.game.timerInterval);
    addSystemMessage('⏰ Time is up! The adventure concludes…');
    document.getElementById('send-btn').disabled = true;
    document.getElementById('mic-btn').disabled = true;
  }
}

// ─── Sidebar Rendering ────────────────────────────────────
function renderSidebarPlayers() {
  const container = document.getElementById('sidebar-players');
  if (!container) return;

  container.innerHTML = GoG.game.players.map((p, i) => {
    const sheet = TOOLS.getCharacterSheet(p.name) || {};
    const hp = sheet.hp || 10;
    const maxHp = sheet.maxHp || 10;
    const hpPct = Math.round((hp / maxHp) * 100);
    const hpClass = hpPct > 60 ? '' : hpPct > 30 ? 'low' : 'critical';

    return `
      <div class="sidebar-player">
        <div class="avatar${AVATAR_COLORS[i]}" style="font-size:0.9rem">${AVATAR_EMOJIS[i]}</div>
        <div class="sidebar-player-info">
          <div class="sidebar-player-name">${escapeHTML(p.name)}</div>
          <div class="sidebar-player-class">${escapeHTML(sheet.class || 'Scholar')} · ❤ ${hp}/${maxHp}</div>
          <div class="hp-bar-mini"><div class="hp-bar-fill ${hpClass}" style="width:${hpPct}%"></div></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderGoalsList() {
  const container = document.getElementById('goals-list');
  if (!container) return;

  const goals = GoG.session.gameGoals || GoG.session.learningGoals || [];
  if (goals.length === 0) {
    container.innerHTML = '<p class="text-muted" style="font-size:0.78rem">Goals will appear here…</p>';
    return;
  }

  container.innerHTML = goals.map((g, i) => {
    const done = GoG.game.goalsCompleted?.includes(g);
    return `
      <div class="goal-item-game">
        <div class="custom-checkbox ${done ? 'checked' : ''}" id="goal-cb-${i}"></div>
        <div class="goal-text ${done ? 'done' : ''}">${escapeHTML(g)}</div>
      </div>
    `;
  }).join('');
}

function updateGoalsUI() {
  const goals = GoG.session.gameGoals || GoG.session.learningGoals || [];
  goals.forEach((g, i) => {
    const done = GoG.game.goalsCompleted?.includes(g);
    const cb = document.getElementById(`goal-cb-${i}`);
    const text = cb?.nextElementSibling;
    if (cb) cb.className = `custom-checkbox ${done ? 'checked' : ''}`;
    if (text) text.className = `goal-text ${done ? 'done' : ''}`;
  });
}

// ─── Speaker Select ───────────────────────────────────────
function populateSpeakerSelect() {
  const select = document.getElementById('speaker-select');
  if (!select) return;
  select.innerHTML = GoG.game.players.map((p, i) =>
    `<option value="${i}">${escapeHTMLAttr(p.name)}</option>`
  ).join('');
}

function getActiveSpeaker() {
  const select = document.getElementById('speaker-select');
  const idx = parseInt(select?.value || '0');
  return GoG.game.players[idx] || GoG.game.players[0] || { name: 'Player' };
}

// ─── Chat ─────────────────────────────────────────────────
function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || GoG.game.isProcessing) return;

  const speaker = getActiveSpeaker();
  input.value = '';
  GoG.game.isProcessing = true;
  setInputsDisabled(true);

  // Show player message
  addPlayerMessage(speaker.name, text);
  logMessage(speaker.name, text, 'player');

  // Check Model
  if (!GoG.session.apiKey) {
    showToast('⚠ No Ollama model set. Visit Teacher Settings.', 'red', 5000);
    GoG.game.isProcessing = false;
    setInputsDisabled(false);
    return;
  }

  // Show typing indicators with agent pipeline
  showTypingIndicator('Rules Lawyer');

  try {
    let finalNarrative = '';

    await runAgentPipeline(text, speaker.name, {
      onDice: ({ type, result }) => {
        removeTypingIndicator();
        addDiceMessage(speaker.name, type, result);
        showTypingIndicator('Storyteller');
      },
      onRuling: (ruling) => {
        // Ruling is internal, just swap indicator
        removeTypingIndicator();
        showTypingIndicator('Storyteller');
      },
      onNarrative: (narrative) => {
        removeTypingIndicator();
        showTypingIndicator('Expert');
      },
      onExpert: (result) => {
        removeTypingIndicator();
        if (result.goalsCompleted?.length > 0) {
          result.goalsCompleted.forEach(g => {
            if (!GoG.game.goalsCompleted.includes(g)) {
              GoG.game.goalsCompleted.push(g);
              addSystemMessage(`✨ Goal Complete: "${g}"`);
            }
          });
          updateGoalsUI();
        }
        showTypingIndicator('Game Master');
      },
      onFinal: (narrative) => {
        finalNarrative = narrative;
        removeTypingIndicator();
        addAIMessage('Game Master', narrative);
        logMessage('Game Master', narrative, 'ai');
        renderSidebarPlayers();
        speakText(narrative);
      },
      onError: (msg) => {
        removeTypingIndicator();
        addSystemMessage(`⚠ Agent error: ${msg}`);
        showToast('Agent error: ' + msg, 'red');
      }
    });

  } catch (e) {
    removeTypingIndicator();
    addSystemMessage('⚠ Something went wrong. Check your Ollama model and make sure Ollama is running, then try again.');
  } finally {
    GoG.game.isProcessing = false;
    setInputsDisabled(false);
    document.getElementById('chat-input')?.focus();
  }
}

function setInputsDisabled(disabled) {
  const ids = ['chat-input', 'send-btn', 'mic-btn', 'speaker-select'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

// ─── Message Rendering ────────────────────────────────────
function addPlayerMessage(name, text) {
  const chatMessages = document.getElementById('chat-messages');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const idx = GoG.game.players.findIndex(p => p.name === name);
  const avatarColor = AVATAR_COLORS[Math.max(0, idx)] || '';
  const avatarEmoji = AVATAR_EMOJIS[Math.max(0, idx)] || '👤';

  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper player-msg';
  wrapper.innerHTML = `
    <div class="avatar${avatarColor}" style="font-size:0.85rem">${avatarEmoji}</div>
    <div>
      <div class="message-meta" style="flex-direction:row-reverse">
        <span class="message-sender" style="color:var(--text-primary)">${escapeHTML(name)}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-bubble">${escapeHTML(text)}</div>
    </div>
  `;
  chatMessages.appendChild(wrapper);
  scrollToBottom();
}

function addAIMessage(agentName, text) {
  const chatMessages = document.getElementById('chat-messages');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const colorClass = AGENT_COLORS[agentName] || '';
  const badgeClass = AGENT_BADGES[agentName] || 'badge-purple';

  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper ai-msg';
  wrapper.innerHTML = `
    <div class="avatar" style="background:linear-gradient(135deg,#1e1628,#3d1f6b);border-color:var(--border-purple);font-size:0.85rem">✦</div>
    <div>
      <div class="message-meta">
        <span class="message-sender ${colorClass}">${escapeHTML(agentName)}</span>
        <span class="badge ${badgeClass} message-agent-tag">AI</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-bubble">${formatNarrativeText(text)}</div>
    </div>
  `;
  chatMessages.appendChild(wrapper);
  scrollToBottom();
}

function addDiceMessage(playerName, diceType, result) {
  const chatMessages = document.getElementById('chat-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper ai-msg dice-msg';
  wrapper.innerHTML = `
    <div>
      <div class="message-meta">
        <span class="message-sender agent-rules-lawyer">Rules Lawyer</span>
        <span class="badge badge-gold message-agent-tag">DICE</span>
      </div>
      <div class="message-bubble">
        <span class="dice-icon">🎲</span>
        ${escapeHTML(playerName)} rolls a <strong>d${diceType}</strong> → <strong style="font-size:1.1em">${result}</strong>
      </div>
    </div>
  `;
  chatMessages.appendChild(wrapper);
  scrollToBottom();
}

function addSystemMessage(text) {
  const chatMessages = document.getElementById('chat-messages');
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper system-msg';
  wrapper.innerHTML = `<div class="message-bubble">${escapeHTML(text)}</div>`;
  chatMessages.appendChild(wrapper);
  scrollToBottom();
}

let typingEl = null;

function showTypingIndicator(agentName) {
  removeTypingIndicator();
  const chatMessages = document.getElementById('chat-messages');
  const colorClass = AGENT_COLORS[agentName] || '';
  typingEl = document.createElement('div');
  typingEl.className = 'message-wrapper ai-msg';
  typingEl.id = 'typing-indicator';
  typingEl.innerHTML = `
    <div class="avatar" style="background:linear-gradient(135deg,#1e1628,#3d1f6b);border-color:var(--border-purple);font-size:0.85rem">✦</div>
    <div>
      <div class="message-meta">
        <span class="message-sender ${colorClass}">${escapeHTML(agentName)}</span>
      </div>
      <div class="message-bubble" style="padding:6px 14px">
        <div class="typing-wrapper">
          <div class="typing-indicator"><span></span><span></span><span></span></div>
          <span class="typing-label">${escapeHTML(agentName)} is processing…</span>
        </div>
      </div>
    </div>
  `;
  chatMessages.appendChild(typingEl);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
  typingEl = null;
}

function scrollToBottom() {
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function formatNarrativeText(text) {
  if (!text) return '';
  return escapeHTML(text).replace(/\n/g, '<br>');
}

// ─── Voice Input (Web Speech API) ────────────────────────
function initVoiceInput() {
  const btn = document.getElementById('mic-btn');
  if (!btn) return;

  const hasVoice = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  if (!hasVoice) {
    btn.title = 'Voice not supported in this browser';
    btn.disabled = true;
    btn.style.opacity = '0.35';
    return;
  }

  btn.title = 'Click to speak';
}

function toggleVoice(e) {
  if (e?.preventDefault) e.preventDefault();
  if (isRecording) {
    stopVoice();
  } else {
    startVoice();
  }
}

function startVoice(e) {
  if (e?.preventDefault) e.preventDefault();
  if (isRecording || GoG.game.isProcessing) return;

  const hasVoice = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  if (!hasVoice) return;

  // The request was to cancel speech when mic is pressed.
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  const btn = document.getElementById('mic-btn');
  btn?.classList.add('recording');
  isRecording = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = true;
  speechRecognizer.interimResults = true;
  speechRecognizer.lang = 'en-US';

  const input = document.getElementById('chat-input');

  speechRecognizer.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (input) input.value = transcript;
    console.log('[Mic Input Transcript]:', transcript);
  };

  speechRecognizer.onerror = (e) => {
    console.warn('[Mic Error]:', e.error);
    // Suppress ui toasts and print to terminal instead as requested
  };

  speechRecognizer.onend = () => {
    if (isRecording) {
      isRecording = false;
      const b = document.getElementById('mic-btn');
      b?.classList.remove('recording');
      
      // Auto-send if there's content like stopVoice used to
      const input = document.getElementById('chat-input');
      if (input?.value.trim()) {
        setTimeout(() => sendMessage(), 300);
      }
    }
  };

  try {
    speechRecognizer.start();
  } catch(e) {
    isRecording = false;
    btn?.classList.remove('recording');
  }
}

function stopVoice(e) {
  if (e?.preventDefault) e.preventDefault();
  if (!isRecording) return;

  isRecording = false;
  const btn = document.getElementById('mic-btn');
  btn?.classList.remove('recording');

  try { speechRecognizer?.stop(); } catch(ex) {}
  // the onend event will fire and send the message, so we don't need to do it here
}

function speakText(text) {
  if (isMuted || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const msg = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(msg);
}

// ─── Exit Confirmation ────────────────────────────────────
function confirmExit() {
  openModal(`
    <p style="margin-bottom:20px;color:var(--text-secondary)">
      Are you sure you want to exit the game? Your session data will be preserved.
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Stay</button>
      <button class="btn btn-danger" onclick="exitGame()">Exit Game</button>
    </div>
  `, 'Exit Adventure?');
}

function exitGame() {
  clearInterval(GoG.game.timerInterval);
  saveGameState();
  window.location.href = 'index.html';
}

// ─── Chat Log ─────────────────────────────────────────────
function logMessage(sender, text, type = 'ai') {
  if (!GoG.game.chatLog) GoG.game.chatLog = [];
  GoG.game.chatLog.push({ sender, text, type, timestamp: new Date().toISOString() });
  saveGameState();
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

function escapeHTMLAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
