/* ═══════════════════════════════════════════════════════════
   app.js — Global State Manager & Utilities
   Guardians of Gaia
═══════════════════════════════════════════════════════════ */

// ─── Global Application State ────────────────────────────
window.GoG = {
  // Session config (loaded from/saved to localStorage)
  session: {
    apiKey: '',
    worksheetText: '',
    worksheetName: '',
    learningGoals: [],
    introduction: '',
    extraNotes: '',
    timeLimitSeconds: 600,
    storyIntro: '',
    gameGoals: []
  },

  // Game runtime state
  game: {
    players: [],
    chatLog: [],
    storyBible: null,
    characters: {},
    objects: {},
    timerStarted: false,
    timerStart: null,
    timerInterval: null,
    goalsCompleted: [],
    isProcessing: false
  },

  // Agent configs loaded from YAML
  agents: {
    rulesLawyer: null,
    storyteller: null,
    expert: null,
    historian: null
  }
};

// ─── Particle Canvas ──────────────────────────────────────
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  const particles = Array.from({ length: 60 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.5 + 0.3,
    dx: (Math.random() - 0.5) * 0.3,
    dy: -Math.random() * 0.4 - 0.1,
    alpha: Math.random() * 0.4 + 0.1,
    color: Math.random() > 0.6 ? '#c9963a' : '#6c3fa5'
  }));

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.floor(p.alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();
      p.x += p.dx;
      p.y += p.dy;
      if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width; }
      if (p.x < -5 || p.x > canvas.width + 5) { p.x = Math.random() * canvas.width; }
    });
    requestAnimationFrame(animate);
  }
  animate();
}

// ─── Toast Notifications ──────────────────────────────────
function showToast(message, type = 'default', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── localStorage helpers ─────────────────────────────────
function saveSession() {
  localStorage.setItem('gog_session', JSON.stringify(GoG.session));
}

function loadSession() {
  try {
    const stored = localStorage.getItem('gog_session');
    if (stored) {
      const parsed = JSON.parse(stored);
      GoG.session = { ...GoG.session, ...parsed };
    }
  } catch (e) {
    console.warn('Could not load session:', e);
  }
}

function saveGameState() {
  try {
    const state = {
      chatLog: GoG.game.chatLog,
      storyBible: GoG.game.storyBible,
      characters: GoG.game.characters,
      objects: GoG.game.objects,
      goalsCompleted: GoG.game.goalsCompleted,
      players: GoG.game.players
    };
    sessionStorage.setItem('gog_game_state', JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save game state:', e);
  }
}

function loadGameState() {
  try {
    const stored = sessionStorage.getItem('gog_game_state');
    if (stored) {
      const state = JSON.parse(stored);
      GoG.game = { ...GoG.game, ...state };
    }
  } catch (e) {
    console.warn('Could not load game state:', e);
  }
}

// ─── Modal Helper ─────────────────────────────────────────
function openModal(contentHTML, title = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="flex justify-between items-center" style="margin-bottom:16px">
        <h2>${title}</h2>
        <button class="btn btn-ghost btn-icon" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="modal-content">${contentHTML}</div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

// ─── Inline Agent Defaults (always available, even on file://) ───
const DEFAULT_AGENT_CONFIGS = {
  rules_lawyer: {
    name: 'Rules Lawyer', role: 'rules_lawyer', enabled: true,
    temperature: 0.2, max_tokens: 400,
    persona: `You are the Rules Lawyer, a strict but fair arbiter of the Guardians of Gaia game rules.
Your job is to:
1. Validate whether the player's proposed action is legal within the game rules.
2. Determine if a dice roll is needed and what type (d4, d6, d8, d10, d12, d20, d100).
3. Check the time remaining and note if the game should begin wrapping up (< 2 minutes left).
4. Output a structured JSON ruling for the next agent to use.`,
    output_format: `Always respond with valid JSON in this exact format:
{"action_valid":true,"ruling":"Brief explanation","dice_roll_needed":true,"dice_type":20,"dice_result":null,"stat_check":"Intelligence","dc":12,"time_warning":false,"time_remaining_seconds":480}`,
    tools: ['rollDice', 'getGameRules', 'getCharacterSheet', 'checkTime']
  },
  storyteller: {
    name: 'Storyteller', role: 'storyteller', enabled: true,
    temperature: 0.85, max_tokens: 600,
    persona: `You are the Storyteller, the creative heart of Guardians of Gaia.
Your job is to:
1. Take the Rules Lawyer's ruling and craft the narrative consequence.
2. Describe what happens to the player based on their action and the dice result.
3. Introduce interesting NPCs, objects, and environments that heavily feature and focus on the worksheet topic. Make the worksheet content central to the plot.
4. Keep the story immersive, exciting, and age-appropriate.
5. If time_warning is true, begin steering the story toward a satisfying conclusion.`,
    style_notes: `Write in second person ("You see...", "You attempt to..."). Be vivid but concise (2-4 sentences). Weave science topics prominently into the narrative. CRITICAL: At the end of your response, ALWAYS explicitly prompt another specific player by name to ask what they do next (e.g. "What do you do, [Player Name]?"). NEVER directly tell players the science answers.`,
    output_format: `Respond ONLY with a valid JSON object in this format: {"narrative": "Your narrative here. No conversational filler or prefixes."}`,
    tools: ['createCharacter', 'createObject']
  },
  expert: {
    name: 'Expert', role: 'expert', enabled: true,
    temperature: 0.4, max_tokens: 500,
    persona: `You are the Expert, the educational guardian of Guardians of Gaia.
Your job is to:
1. Review the Storyteller's narrative and embed accurate science content.
2. Fact-check any scientific claims against the worksheet and teacher notes.
3. Add one educational element—a question, fact, or challenge—related to the worksheet's learning goals.
4. Track which learning goals have been addressed and flag completions.`,
    style_notes: `Keep educational content natural—use "A wise sage says..." or "You recall from your studies...". Pose open-ended questions. Do not make science feel like a quiz.`,
    output_format: `Respond ONLY with a valid JSON object: {"narrative": "Refined narrative...", "goals_completed": [], "science_topic_mentioned": "topic"}`,
    tools: ['getWorksheet', 'fetchWikipedia']
  },
  historian: {
    name: 'Historian', role: 'historian', enabled: true,
    temperature: 0.1, max_tokens: 300,
    persona: `You are the Historian, keeper of the Story Bible for Guardians of Gaia.
Your job is to:
1. Receive the latest narrative update.
2. Update the Story Bible with new facts, NPCs, objects, and player actions.`,
    style_notes: `Be concise. Only extract meaningful facts that should be remembered for future turns.`,
    output_format: `Output ONLY a JSON block: <!--STORY_UPDATE: {"new_facts":[],"npcs_introduced":[],"objects_discovered":[],"player_action_summary":"brief summary"} -->`,
    tools: ['readStoryBible', 'writeStoryBible']
  }
};

// ─── YAML Loader — tries fetch first, falls back to inline ───────
async function loadAgentConfig(roleName) {
  // Try YAML fetch (works on http://, not file://)
  try {
    if (window.location.protocol !== 'file:' && typeof jsyaml !== 'undefined') {
      const response = await fetch(`./agents/${roleName}.yaml`);
      if (response.ok) {
        const text = await response.text();
        const config = jsyaml.load(text);
        if (config) return config;
      }
    }
  } catch (e) {
    // Will fall through to default
  }
  // Return inline default
  return DEFAULT_AGENT_CONFIGS[roleName] || null;
}

async function loadAllAgents() {
  const [rl, st, ex, hi] = await Promise.all([
    loadAgentConfig('rules_lawyer'),
    loadAgentConfig('storyteller'),
    loadAgentConfig('expert'),
    loadAgentConfig('historian')
  ]);
  GoG.agents.rulesLawyer = rl;
  GoG.agents.storyteller = st;
  GoG.agents.expert = ex;
  GoG.agents.historian = hi;
  console.log('✅ All agent configs loaded');
}

// ─── Page Navigation ──────────────────────────────────────
function navigateTo(page) {
  window.location.href = page;
}

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  initParticles();
  loadAllAgents().catch(console.warn);
});
