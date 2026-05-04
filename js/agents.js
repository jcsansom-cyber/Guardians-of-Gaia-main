/* ═══════════════════════════════════════════════════════════
   agents.js — Feed-Forward AI Agent Pipeline
   Guardians of Gaia
═══════════════════════════════════════════════════════════ */

const OLLAMA_API_BASE = 'http://localhost:11434/api/generate';

// ─── Core Ollama Call ────────────────────────────────────
async function callGemini(systemPrompt, userMessage, temperature = 0.7, maxTokens = 800) {
  const modelName = GoG.session.apiKey;
  if (!modelName) throw new Error('No Ollama model set. Please configure in Teacher Settings.');

  const body = {
    model: modelName,
    system: systemPrompt,
    prompt: userMessage,
    stream: false,
    options: {
      temperature: temperature,
      num_predict: -1,  // -1 = no limit; model stops at its natural EOS token
      num_ctx: 8192     // large enough for verbose prompts + full response
    }
  };

  const response = await fetch(OLLAMA_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.error || `API error ${response.status}`);
  }

  const data = await response.json();
  let fullText = data.response || '';

  // Strip markdown code fences — some models wrap output in ```json ... ```
  const fenceMatch = fullText.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    fullText = fenceMatch[1].trim();
  } else {
    fullText = fullText.replace(/^\s*```[a-zA-Z]*\s*/, '').trim();
  }

  return fullText;
}

// ─── JSON Repair Helper ───────────────────────────────────
// Small models (e.g. gemma4:e2b) sometimes cut off mid-JSON when they hit
// the token limit. This tries to auto-close open strings/arrays/objects
// so JSON.parse can still recover useful partial data.
function repairJson(raw) {
  if (!raw) return null;

  // Grab the first '{' to end
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let s = raw.slice(start);

  // Quick pass: if it already parses, return immediately
  try { return JSON.parse(s); } catch (_) { }

  // Close any open string by appending a quote if odd number of unescaped quotes
  const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) s += '"';

  // Count unclosed braces / brackets and close them
  let braces = 0, brackets = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && (i === 0 || s[i - 1] !== '\\')) inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  // Remove any trailing comma before closing
  s = s.trimEnd().replace(/,\s*$/, '');
  s += ']'.repeat(Math.max(0, brackets)) + '}'.repeat(Math.max(0, braces));

  try { return JSON.parse(s); } catch (_) { return null; }
}

// Same as repairJson but for top-level JSON arrays (e.g. game goals).
function repairJsonArray(raw) {
  if (!raw) return null;
  const start = raw.indexOf('[');
  if (start === -1) return null;
  let s = raw.slice(start);
  try { return JSON.parse(s); } catch (_) { }
  const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) s += '"';
  let braces = 0, brackets = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && (i === 0 || s[i - 1] !== '\\')) inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  s = s.trimEnd().replace(/,\s*$/, '');
  s += '}'.repeat(Math.max(0, braces)) + ']'.repeat(Math.max(0, brackets));
  try { return JSON.parse(s); } catch (_) { return null; }
}

// ─── Context Builder ──────────────────────────────────────
function buildContext() {
  const bible = TOOLS.readStoryBible();
  const worksheet = TOOLS.getWorksheet();
  const timeStatus = TOOLS.checkTime();
  const charSheets = TOOLS.getAllCharacterSheets();
  const recentChat = (GoG.game.chatLog || []).slice(-10).map(m =>
    `[${m.sender}]: ${m.text}`
  ).join('\n');

  return {
    storyBible: JSON.stringify(bible, null, 2),
    recentChat: recentChat,
    worksheet: worksheet.text,
    worksheetName: worksheet.name,
    learningGoals: worksheet.learningGoals.join('\n- '),
    extraNotes: worksheet.extraNotes,
    timeFraction: timeStatus.fraction,
    timeRemaining: timeStatus.remaining,
    timeWarning: timeStatus.warning,
    timeCritical: timeStatus.critical,
    timeDisplay: TOOLS.formatTime(timeStatus.remaining),
    players: GoG.game.players.map(p => p.name).join(', '),
    charSheets: JSON.stringify(charSheets, null, 2),
    sessionGoals: GoG.session.gameGoals.join('\n'),
    completedGoals: GoG.game.goalsCompleted.join('\n')
  };
}

// ─── Context Trimmer ─────────────────────────────────────
// Keep large context fields within a character budget so the model
// has room to generate a full response on small-context models.
function trimContext(ctx) {
  const BIBLE_LIMIT = 600;  // chars of story bible JSON
  const WORKSHEET_LIMIT = 800; // chars of worksheet text
  return {
    ...ctx,
    storyBible: ctx.storyBible?.length > BIBLE_LIMIT ? ctx.storyBible.slice(0, BIBLE_LIMIT) + '…' : ctx.storyBible,
    worksheet: ctx.worksheet?.length > WORKSHEET_LIMIT ? ctx.worksheet.slice(0, WORKSHEET_LIMIT) + '…' : ctx.worksheet,
  };
}

// ─── Agent 1: Rules Lawyer ────────────────────────────────
async function runRulesLawyer(playerMessage, playerName, ctx) {
  const cfg = GoG.agents.rulesLawyer;
  if (!cfg || !cfg.enabled) return getDefaultRuling(playerMessage);

  // Perform a dice roll if action seems to need one (detected later in prompt)
  const diceRoll = TOOLS.rollDice(20);
  const charSheet = TOOLS.getCharacterSheet(playerName);

  const systemPrompt = `${cfg.persona}

GAME RULES SUMMARY:
The game uses d20 checks. DC 5=Very Easy, 10=Easy, 15=Medium, 20=Hard, 25=Very Hard.
Players have ability stats: Strength, Dexterity, Intelligence, Wisdom, Charisma.

PLAYER CHARACTER SHEET:
${JSON.stringify(charSheet, null, 2)}

TIME STATUS:
- Remaining: ${ctx.timeDisplay} (${ctx.timeRemaining}s)
- Warning Mode: ${ctx.timeWarning}
- Critical Mode: ${ctx.timeCritical}

DICE ALREADY ROLLED: d20 → ${diceRoll.result} (use this result if needed)

${cfg.output_format}`;

  const userMessage = `Player "${playerName}" says: "${playerMessage}"
Determine if this action is valid and what ability check applies.`;

  try {
    const raw = await callGemini(systemPrompt, userMessage, cfg.temperature || 0.2, cfg.max_tokens || 400);
    console.log(`\n--- RULES LAWYER RAW OUTPUT ---\n${raw}\n-------------------------------\n`);

    // Try to extract and repair JSON
    const jsonMatch = raw.match(/\{[\s\S]*/);
    if (jsonMatch) {
      const ruling = repairJson(jsonMatch[0]);
      if (ruling) {
        ruling.dice_result = diceRoll.result;
        ruling.dice_type = ruling.dice_type || 20;
        return ruling;
      }
    }
    return getDefaultRuling(playerMessage, diceRoll.result);
  } catch (e) {
    console.warn('Rules Lawyer failed:', e);
    return getDefaultRuling(playerMessage, diceRoll.result);
  }
}

function getDefaultRuling(playerMessage, diceResult = null) {
  const roll = diceResult || TOOLS.rollDice(20).result;
  return {
    action_valid: true,
    ruling: 'Action accepted.',
    dice_roll_needed: true,
    dice_type: 20,
    dice_result: roll,
    stat_check: 'Intelligence',
    dc: 12,
    time_warning: TOOLS.checkTime().warning,
    time_remaining_seconds: TOOLS.checkTime().remaining
  };
}

// ─── Agent 2: Storyteller ─────────────────────────────────
async function runStoryteller(playerMessage, playerName, ruling, ctx) {
  const cfg = GoG.agents.storyteller;
  if (!cfg || !cfg.enabled) return `The game world reacts to ${playerName}'s action...`;

  const systemPrompt = `${cfg.persona}

STORY BIBLE (current world state):
${ctx.storyBible}

PLAYERS IN GAME: ${ctx.players}

WORKSHEET TOPIC: ${ctx.worksheetName}
WORKSHEET CONTENT: ${ctx.worksheet || 'None provided.'}
LEARNING GOALS:
- ${ctx.learningGoals}

EXTRA TEACHER NOTES: ${ctx.extraNotes}

TIME CONTEXT:
- Time Remaining: ${ctx.timeDisplay}
- Should wrap up story: ${ctx.timeWarning}

${cfg.style_notes}
${cfg.output_format}`;

  const userMessage = `Player "${playerName}" said: "${playerMessage}"

Rules Lawyer ruling:
- Action Valid: ${ruling.action_valid}
- Ruling: ${ruling.ruling}
- Dice Roll: d${ruling.dice_type} → ${ruling.dice_result} (vs DC ${ruling.dc} for ${ruling.stat_check})
- Success: ${ruling.dice_result >= (ruling.dc || 12)}

${ctx.timeWarning ? '⚠️ TIME IS RUNNING LOW — begin steering toward a conclusion.' : ''}

Continue the story narrative based on this outcome.`;

  try {
    let raw = await callGemini(systemPrompt, userMessage, cfg.temperature || 0.85, cfg.max_tokens || 900);
    console.log(`\n--- STORYTELLER RAW OUTPUT ---\n${raw}\n------------------------------\n`);

    let narrative = '';

    // gemma4:e2b often outputs JSON despite plain-text instructions — try that first
    const jsonMatch = raw.match(/\{[\s\S]*/);
    if (jsonMatch) {
      const parsed = repairJson(jsonMatch[0]);
      if (parsed?.narrative) narrative = parsed.narrative;
    }

    // Fallback: treat the whole response as plain text, stripping any JSON fragments
    if (!narrative) {
      narrative = raw
        .replace(/\{[\s\S]*?\}/g, '')              // strip any JSON objects
        .replace(/^(Narrative|Response|Story):\s*/i, '') // strip label prefixes
        .trim();
    }

    if (!narrative) narrative = `The consequences of ${playerName}'s actions hang in the air...`;
    return narrative;
  } catch (e) {
    console.warn('Storyteller failed:', e);
    return `Despite best efforts, the path forward is obscured by mist. (${e.message})`;
  }
}

// ─── Agent 3: Expert ──────────────────────────────────────
async function runExpert(narrative, playerMessage, playerName, ruling, ctx) {
  const cfg = GoG.agents.expert;
  if (!cfg || !cfg.enabled) return { narrative, goalsCompleted: [], scienceTopic: '' };

  // Optionally fetch Wikipedia if topic suggests it
  let wikiContext = '';
  if (ctx.learningGoals && ctx.learningGoals.length > 3) {
    const topicGuess = ctx.learningGoals.split('\n')[0]?.replace(/^[-*\d.]+\s*/, '').trim();
    if (topicGuess) {
      const wiki = await TOOLS.fetchWikipedia(topicGuess).catch(() => null);
      if (wiki?.summary) wikiContext = `\nWikipedia context on "${wiki.title}": ${wiki.summary.substring(0, 300)}`;
    }
  }

  const systemPrompt = `${cfg.persona}

WORKSHEET CONTENT:
${ctx.worksheet || 'No worksheet uploaded — use general science enrichment.'}

LEARNING GOALS:
- ${ctx.learningGoals || 'General scientific curiosity and reasoning'}

EXTRA TEACHER NOTES:
${ctx.extraNotes || 'None'}

ALREADY COMPLETED GOALS:
${ctx.completedGoals || 'None yet'}

${wikiContext}

${cfg.style_notes}
${cfg.output_format}`;

  const userMessage = `Current narrative to enrich:
"${narrative}"

Player action: "${playerMessage}"
Player name: ${playerName}
Dice result: ${ruling.dice_result}/${ruling.dc} (${ruling.dice_result >= (ruling.dc || 12) ? 'success' : 'failure'})

Embed one science learning element and check if any goal is now complete.`;

  try {
    const raw = await callGemini(systemPrompt, userMessage, cfg.temperature || 0.4, cfg.max_tokens || 800);
    console.log(`\n--- EXPERT RAW OUTPUT ---\n${raw}\n-------------------------\n`);

    let goalsCompleted = [];
    let scienceTopic = '';
    let cleanNarrative = '';

    // 1. Try JSON first — gemma4:e2b outputs JSON regardless of instructions
    const jsonMatch = raw.match(/\{[\s\S]*/);
    if (jsonMatch) {
      const parsed = repairJson(jsonMatch[0]);
      if (parsed) {
        cleanNarrative = parsed.narrative || parsed.text || parsed.response || '';
        goalsCompleted = parsed.goals_completed || [];
        scienceTopic = parsed.science_topic_mentioned || '';
      }
    }

    // 2. Fallback: plain text + optional METADATA: tag
    if (!cleanNarrative) {
      const metaSplit = raw.split(/\bMETADATA:\s*/);
      cleanNarrative = metaSplit[0]
        .replace(/^(Narrative|Response|Story):\s*/i, '')
        .replace(/\{[\s\S]*?\}/g, '') // strip any stray JSON fragments
        .trim();
      if (metaSplit[1]) {
        const meta = repairJson(metaSplit[1]);
        if (meta) {
          goalsCompleted = meta.goals_completed || [];
          scienceTopic = meta.science_topic_mentioned || '';
        }
      }
    }

    // 3. Last resort — keep the Storyteller's narrative unchanged
    if (!cleanNarrative) cleanNarrative = narrative;

    return { narrative: cleanNarrative, goalsCompleted, scienceTopic };
  } catch (e) {
    console.warn('Expert failed:', e);
    return { narrative, goalsCompleted: [], scienceTopic: '' };
  }
}


// ─── Agent 4: Historian ───────────────────────────────────
async function runHistorian(narrative, playerMessage, playerName, expertResult, ctx) {
  const cfg = GoG.agents.historian;
  if (!cfg || !cfg.enabled) {
    // Still update story bible with minimal data
    TOOLS.writeStoryBible({ player_action_summary: `${playerName}: ${playerMessage.substring(0, 60)}` });
    return narrative;
  }

  const currentBible = TOOLS.readStoryBible();

  const systemPrompt = `${cfg.persona}

CURRENT STORY BIBLE:
${JSON.stringify(currentBible, null, 2)}

IMPORTANT: You must maintain consistency with all established facts above.
${cfg.style_notes}
${cfg.output_format}`;

  const userMessage = `Draft narrative from Expert:
"${expertResult.narrative}"

Player: ${playerName}
Action: "${playerMessage}"

Please output ONLY the JSON <!--STORY_UPDATE: {...} --> block to log new facts, NPCs, objects, and action summary. Do not output the narrative text!`;

  try {
    const raw = await callGemini(systemPrompt, userMessage, cfg.temperature || 0.1, cfg.max_tokens || 300);
    console.log(`\n--- HISTORIAN RAW OUTPUT ---\n${raw}\n----------------------------\n`);

    // Extract story update (tolerate missing closing comment for small models)
    const updateMatch = raw.match(/<!--STORY_UPDATE:\s*({[\s\S]*?)(?:-->|$)/);
    if (updateMatch) {
      const update = repairJson(updateMatch[1]);
      if (update) {
        TOOLS.writeStoryBible(update);
      } else {
        TOOLS.writeStoryBible({ player_action_summary: `${playerName}: ${playerMessage.substring(0, 60)}` });
      }
    } else {
      // Minimal update
      TOOLS.writeStoryBible({ player_action_summary: `${playerName}: ${playerMessage.substring(0, 60)}` });
    }

    return expertResult.narrative;
  } catch (e) {
    console.warn('Historian failed:', e);
    TOOLS.writeStoryBible({ player_action_summary: `${playerName}: ${playerMessage.substring(0, 60)}` });
    return expertResult.narrative;
  }
}

// ─── Main Pipeline ────────────────────────────────────────
async function runAgentPipeline(playerMessage, playerName, callbacks = {}) {
  const { onRuling, onNarrative, onExpert, onFinal, onError, onDice } = callbacks;

  try {
    const ctx = trimContext(buildContext());

    // Step 1: Rules Lawyer
    const ruling = await runRulesLawyer(playerMessage, playerName, ctx);
    console.log('\n====================================');
    console.log(`[Agent: Rules Lawyer] Ruling:`, ruling);

    if (ruling.dice_roll_needed && onDice) {
      onDice({ type: ruling.dice_type, result: ruling.dice_result });
    }
    if (onRuling) onRuling(ruling);

    // Step 2: Storyteller
    const narrative = await runStoryteller(playerMessage, playerName, ruling, ctx);
    console.log(`\n[Agent: Storyteller] Narrative Output:\n${narrative}`);

    if (onNarrative) onNarrative(narrative);

    // Step 3: Expert
    const expertResult = await runExpert(narrative, playerMessage, playerName, ruling, ctx);
    console.log(`\n[Agent: Expert] Enhanced Narrative:\n${expertResult.narrative}`);
    console.log(`[Agent: Expert] Metadata: goalsCompleted=${expertResult.goalsCompleted.length}, scienceTopic=${expertResult.scienceTopic}`);

    if (expertResult.goalsCompleted.length > 0) {
      GoG.game.goalsCompleted.push(...expertResult.goalsCompleted);
    }
    if (onExpert) onExpert(expertResult);

    // SHOW UI IMMEDIATELY
    if (onFinal) onFinal(expertResult.narrative);

    // Step 4: Historian (Async Background Task)
    runHistorian(expertResult.narrative, playerMessage, playerName, expertResult, ctx)
      .then(() => console.log(`\n[Agent: Historian] Background story bible update completed.`))
      .catch(e => console.warn('Historian async error:', e));

    console.log('====================================\n');

    // Save state
    saveGameState();

    return { ruling, narrative, expertResult, finalNarrative: expertResult.narrative };
  } catch (e) {
    console.error('Agent pipeline error:', e);
    if (onError) onError(e.message);
    throw e;
  }
}

// ─── Generate opening story ───────────────────────────────
async function generateOpeningNarrative() {
  const session = GoG.session;
  const apiKey = session.apiKey;
  if (!apiKey) return null;

  const prompt = `You are the Storyteller for an educational D&D game called "Guardians of Gaia".
Create a vivid, exciting 3-4 sentence opening narrative for a game session.

Context:
- Worksheet topic: ${session.worksheetName || 'Science'}
- Learning goals: ${(session.learningGoals || []).join(', ') || 'general science exploration'}
- Teacher's story setting: ${session.storyIntro || 'A mysterious forest with an ecological crisis'}
- Players: ${GoG.game.players.map(p => p.name).join(', ')}

Write an immersive D&D-style opening that naturally connects to the science topic.
End with a clear call to action for the players.`;

  try {
    const narrative = await callGemini(
      'You are a master storyteller for an educational D&D game.',
      prompt, 0.9, 600
    );
    console.log(`\n[Agent: Opening Narrator] Generated Intro:\n${narrative}\n`);
    return narrative;
  } catch (e) {
    console.warn('Failed to generate opening:', e);
    return session.introduction || `Welcome, brave adventurers, to the world of Gaia. A great mystery threatens the land, and only your knowledge and courage can save it. Your journey begins at the edge of the Ashwood Forest, where a strange blight has begun to spread...`;
  }
}

// ─── Generate game goals from worksheet ──────────────────
async function generateGameGoals() {
  const session = GoG.session;
  const apiKey = session.apiKey;
  if (!apiKey || !session.worksheetText) return null;

  const prompt = `Based on this science worksheet, generate 3 game goals for a D&D educational game.
Make each goal a specific in-game quest objective that teaches a learning concept.
Format: return only a JSON array of strings, max 12 words each.

Learning Goals: ${(session.learningGoals || []).join(', ')}
Worksheet excerpt: ${session.worksheetText.substring(0, 500)}`;

  try {
    const raw = await callGemini(
      'You are an educational game designer. Return only valid JSON.',
      prompt, 0.7, 400
    );
    // Try full array match first, then repair partial output
    const match = raw.match(/\[[\s\S]*/);
    if (match) {
      // Attempt to repair and parse a possibly truncated array
      const repaired = repairJsonArray(match[0]);
      if (repaired) {
        console.log(`\n[Agent: Objectives] Generated Goals:`, repaired, '\n');
        return repaired;
      }
    }
    return null;
  } catch (e) {
    console.warn('Could not generate game goals:', e);
    return null;
  }
}

window.runAgentPipeline = runAgentPipeline;
window.generateOpeningNarrative = generateOpeningNarrative;
window.generateGameGoals = generateGameGoals;
