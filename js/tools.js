/* ═══════════════════════════════════════════════════════════
   tools.js — All Game Tool Implementations
   Guardians of Gaia
═══════════════════════════════════════════════════════════ */

// ─── Dice Roller ──────────────────────────────────────────
function rollDice(max = 20) {
  const result = Math.floor(Math.random() * max) + 1;
  console.log(`🎲 Rolling d${max}: ${result}`);
  return { type: max, result, display: `d${max} → ${result}` };
}

// ─── Game Rules Bible ─────────────────────────────────────
async function getGameRules() {
  try {
    const response = await fetch('./data/rules_bible.json');
    return await response.json();
  } catch (e) {
    console.error('Failed to load rules bible:', e);
    return null;
  }
}

// ─── Character Sheets ─────────────────────────────────────
function getCharacterSheet(playerName) {
  const sheets = JSON.parse(localStorage.getItem('gog_char_sheets') || '{}');
  return sheets[playerName] || null;
}

function updateCharacterSheet(playerName, data) {
  const sheets = JSON.parse(localStorage.getItem('gog_char_sheets') || '{}');
  sheets[playerName] = { ...sheets[playerName], ...data, lastUpdated: new Date().toISOString() };
  localStorage.setItem('gog_char_sheets', JSON.stringify(sheets));
  return sheets[playerName];
}

function initCharacterSheet(playerName, characterClass = 'Scholar') {
  const existing = getCharacterSheet(playerName);
  if (existing) return existing;
  const stats = { Strength: 10, Dexterity: 12, Intelligence: 14, Wisdom: 11, Charisma: 10 };
  return updateCharacterSheet(playerName, {
    name: playerName,
    class: characterClass,
    hp: 10,
    maxHp: 10,
    ac: 12,
    level: 1,
    stats,
    inventory: [],
    conditions: [],
    notes: '',
    eurekaTokens: 0,
    hasInspiration: false,
    history: []
  });
}

function getAllCharacterSheets() {
  return JSON.parse(localStorage.getItem('gog_char_sheets') || '{}');
}

// ─── Time Check ───────────────────────────────────────────
function checkTime() {
  if (!GoG.game.timerStarted || !GoG.game.timerStart) {
    return { remaining: GoG.session.timeLimitSeconds, fraction: 1.0, warning: false, critical: false };
  }
  const elapsed = (Date.now() - GoG.game.timerStart) / 1000;
  const remaining = Math.max(0, GoG.session.timeLimitSeconds - elapsed);
  const fraction = remaining / GoG.session.timeLimitSeconds;
  return {
    remaining: Math.floor(remaining),
    fraction,
    warning: remaining < 120,   // < 2 minutes
    critical: remaining < 30    // < 30 seconds
  };
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Character Creator ────────────────────────────────────
function createCharacter({ name, traits = [], appearance = '', secrets = '' }) {
  const existing = GoG.game.characters[name];
  if (existing) return existing;

  const npc = {
    name,
    traits,
    appearance,
    secrets,
    createdAt: new Date().toISOString(),
    interactions: []
  };

  GoG.game.characters[name] = npc;
  saveGameState();
  return npc;
}

function logNPCInteraction(npcName, interaction) {
  if (GoG.game.characters[npcName]) {
    GoG.game.characters[npcName].interactions.push({
      ...interaction,
      timestamp: new Date().toISOString()
    });
    saveGameState();
  }
}

// ─── Object Creator ───────────────────────────────────────
function createObject({ name, appearance = '', history = '', interactions = '' }) {
  const existing = GoG.game.objects[name];
  if (existing) return existing;

  const obj = {
    name,
    appearance,
    history,
    interactions,
    createdAt: new Date().toISOString(),
    usages: []
  };

  GoG.game.objects[name] = obj;
  saveGameState();
  return obj;
}

// ─── Worksheet Access ─────────────────────────────────────
function getWorksheet() {
  return {
    text: GoG.session.worksheetText || '',
    name: GoG.session.worksheetName || 'No worksheet uploaded',
    learningGoals: GoG.session.learningGoals || [],
    extraNotes: GoG.session.extraNotes || ''
  };
}

// ─── Wikipedia Fetcher ────────────────────────────────────
async function fetchWikipedia(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Not found');
    const data = await response.json();
    return {
      title: data.title,
      summary: data.extract || '',
      url: data.content_urls?.desktop?.page || ''
    };
  } catch (e) {
    // Try search fallback
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`;
      const res = await fetch(searchUrl);
      const data = await res.json();
      const title = data.query?.search?.[0]?.title;
      if (!title) return { title: query, summary: 'No Wikipedia article found.', url: '' };
      return fetchWikipedia(title);
    } catch (e2) {
      return { title: query, summary: 'Wikipedia lookup failed.', url: '' };
    }
  }
}

// ─── Story Bible ──────────────────────────────────────────
function readStoryBible() {
  if (!GoG.game.storyBible) {
    // Load or init default
    const stored = sessionStorage.getItem('gog_story_bible');
    if (stored) {
      GoG.game.storyBible = JSON.parse(stored);
    } else {
      GoG.game.storyBible = {
        worldName: 'Gaia',
        currentLocation: 'Ashwood Forest Edge',
        timeOfDay: 'Dawn',
        weather: 'Misty',
        establishedFacts: [],
        npcRegistry: [],
        objectRegistry: [],
        playerActionsLog: [],
        scienceTopicsCovered: [],
        completedGoals: [],
        sessionStart: new Date().toISOString()
      };
      sessionStorage.setItem('gog_story_bible', JSON.stringify(GoG.game.storyBible));
    }
  }
  return GoG.game.storyBible;
}

function writeStoryBible(update) {
  const bible = readStoryBible();
  const newBible = { ...bible };

  if (update.new_facts)           newBible.establishedFacts = [...(newBible.establishedFacts || []), ...update.new_facts];
  if (update.npcs_introduced)     newBible.npcRegistry = [...(newBible.npcRegistry || []), ...update.npcs_introduced];
  if (update.objects_discovered)  newBible.objectRegistry = [...(newBible.objectRegistry || []), ...update.objects_discovered];
  if (update.player_action_summary) {
    newBible.playerActionsLog = [...(newBible.playerActionsLog || []), {
      summary: update.player_action_summary,
      timestamp: new Date().toISOString()
    }];
  }
  if (update.science_topic)       newBible.scienceTopicsCovered = [...(newBible.scienceTopicsCovered || []), update.science_topic];
  if (update.currentLocation)     newBible.currentLocation = update.currentLocation;
  if (update.timeOfDay)           newBible.timeOfDay = update.timeOfDay;

  GoG.game.storyBible = newBible;
  sessionStorage.setItem('gog_story_bible', JSON.stringify(newBible));
  return newBible;
}

function clearStoryBible() {
  GoG.game.storyBible = null;
  sessionStorage.removeItem('gog_story_bible');
}

// ─── Tool Registry (used by agents) ──────────────────────
const TOOLS = {
  rollDice,
  getGameRules,
  getCharacterSheet,
  updateCharacterSheet,
  initCharacterSheet,
  getAllCharacterSheets,
  checkTime,
  formatTime,
  createCharacter,
  logNPCInteraction,
  createObject,
  getWorksheet,
  fetchWikipedia,
  readStoryBible,
  writeStoryBible,
  clearStoryBible
};

window.TOOLS = TOOLS;
