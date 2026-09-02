/* ============================================================
   Quick Sticky Note & Flashcard Maker — popup
   ------------------------------------------------------------
   Structure:
     1. Element references
     2. State
     3. Init
     4. Utilities
     5. Render (list view)
     6. Event listeners
     7. Entry actions (create / save / delete / undo)
     8. Source actions
     9. Import & export
    10. Challenge mode
   ============================================================ */


/* ---------- 1. Element references ---------- */

const header = document.querySelector("header");
const title = document.getElementById("title");
const setTitle = document.getElementById("setTitle");
const list = document.getElementById("list");
const challengeView = document.getElementById("challenge");

const addBtn = document.getElementById("addBtn");
const importBtn = document.getElementById("importBtn");
const challengeBtn = document.getElementById("challengeBtn");
const undoBtn = document.getElementById("undoBtn");
const deleteAllBtn = document.getElementById("deleteAllBtn");
const fileInput = document.getElementById("fileInput");


/* ---------- 2. State ---------- */

let cards = [];          // every entry, persisted to chrome.storage.local
let editingId = null;    // id of the entry currently open for editing
let undoStack = [];      // in-memory only: dies when the popup closes
let titleSaveTimer = null;

// Challenge mode
let deck = [];
let deckIndex = 0;
let flipped = false;
let inChallenge = false;


/* ---------- 3. Init ---------- */

init();

async function init() {
  const stored = await chrome.storage.local.get(["cards", "setTitle"]);
  cards = stored.cards || [];
  setTitle.value = stored.setTitle || "";
  render();
}


/* ---------- 4. Utilities ---------- */

// Entry text comes from arbitrary web pages — escape before it touches innerHTML.
function escapeHTML(str) {
  return (str || "").replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// Tabs and newlines are TSV's delimiters — they cannot survive inside a field.
function clean(text) {
  return (text || "").replace(/[\t\n\r]+/g, " ").trim();
}

// / \ : * ? " < > | are illegal in filenames on Windows and/or macOS.
function safeFilename(name) {
  const stripped = (name || "").replace(/[/\\:*?"<>|]/g, "-").trim();
  return stripped || `entries-${new Date().toISOString().slice(0, 10)}`;
}


/* ---------- 5. Render ---------- */

function render() {
  title.textContent = `ENTRIES: ${cards.length}`;
  undoBtn.disabled = undoStack.length === 0;
  challengeBtn.disabled = !cards.some(c => c.question && c.answer);
  deleteAllBtn.disabled = cards.length === 0;

  if (cards.length === 0) {
    list.innerHTML = `
      <p class="empty">
        No entries yet.<br>
        Highlight text on any page, right-click → Make flashcard...
        or hit + to write your own.
      </p>`;
    return;
  }

  // Editing card floats to the top; then unanswered; then answered.
  const editing = cards.filter(c => c.id === editingId);
  const rest = cards.filter(c => c.id !== editingId);
  const ordered = [
    ...editing,
    ...rest.filter(c => !c.answer),
    ...rest.filter(c => c.answer)
  ];

  list.innerHTML = ordered.map(renderCard).join("");
}

function renderCard(card) {
  if (card.id === editingId) {
    return `
      <div class="card editing">
        <div class="row">
          <textarea class="q-input" placeholder="Question or note title…">${escapeHTML(card.question)}</textarea>
          <button class="del-btn" data-id="${card.id}" title="Delete entry">×</button>
        </div>
        <textarea class="answer-input" placeholder="Answer or note…">${escapeHTML(card.answer)}</textarea>
        <div class="hint">Save: Ctrl+Enter</div>
        <button class="save-btn" data-id="${card.id}">Save</button>
      </div>`;
  }

  // source === null marks a custom entry — no source buttons to show.
  const sourceButtons = card.source
    ? `<button class="src-btn" data-src="${escapeHTML(card.source)}">Copy source</button>
       <button class="src-btn rm" data-id="${card.id}">Remove source</button>`
    : "";

  const body = card.answer
    ? `<div class="a">${escapeHTML(card.answer)}</div>`
    : `<div class="hint">Click to add answer</div>`;

  return `
    <div class="card ${card.answer ? "done" : ""}" data-id="${card.id}">
      <div class="row">
        <div class="q">${escapeHTML(card.question) || "<em>Untitled</em>"}</div>
        <button class="del-btn" data-id="${card.id}" title="Delete entry">×</button>
      </div>
      ${body}
      ${sourceButtons}
    </div>`;
}


/* ---------- 6. Event listeners ---------- */

/* One delegated listener on #list survives every re-render.
   ORDER MATTERS: checks run most-specific first, because every button
   sits inside a .card and would otherwise match the wrong branch.
   .src-btn.rm → .src-btn → .del-btn → .save-btn → .card              */
list.addEventListener("click", (e) => {
  const rmBtn = e.target.closest(".src-btn.rm");
  if (rmBtn) { removeSource(Number(rmBtn.dataset.id)); return; }

  const srcBtn = e.target.closest(".src-btn");
  if (srcBtn) { copySource(srcBtn); return; }

  const delBtn = e.target.closest(".del-btn");
  if (delBtn) { deleteCard(Number(delBtn.dataset.id)); return; }

  const saveBtn = e.target.closest(".save-btn");
  if (saveBtn) { saveAnswer(Number(saveBtn.dataset.id)); return; }

  const cardEl = e.target.closest(".card");
  if (cardEl && !cardEl.classList.contains("editing")) {
    editingId = Number(cardEl.dataset.id);
    render();
    list.querySelector(".answer-input").focus();
  }
});

list.addEventListener("keydown", (e) => {
  const inField = e.target.matches(".answer-input") || e.target.matches(".q-input");
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && inField) {
    e.preventDefault();
    saveAnswer(editingId);
  }
});

addBtn.addEventListener("click", addCustomEntry);
undoBtn.addEventListener("click", undo);
deleteAllBtn.addEventListener("click", deleteAll);
importBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", handleImport);

challengeBtn.addEventListener("click", () => {
  inChallenge ? exitChallenge() : startChallenge();
});

// Debounced — one storage write per pause, not one per keystroke.
setTitle.addEventListener("input", () => {
  clearTimeout(titleSaveTimer);
  titleSaveTimer = setTimeout(() => {
    chrome.storage.local.set({ setTitle: setTitle.value });
  }, 400);
});

// Enter in the title field is the only export trigger.
setTitle.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (cards.length === 0) return;

  clearTimeout(titleSaveTimer);
  chrome.storage.local.set({ setTitle: setTitle.value });
  exportCards(setTitle.value);
  setTitle.blur();
});

// Challenge keyboard control. The inChallenge guard must come first —
// without it, space would be swallowed while typing in a textarea.
document.addEventListener("keydown", (e) => {
  if (!inChallenge) return;

  if (e.key === "Escape") { exitChallenge(); return; }
  if (e.key !== " ") return;

  e.preventDefault();   // space would otherwise scroll

  if (deckIndex >= deck.length) { startChallenge(); return; }

  if (flipped) {
    deckIndex++;
    flipped = false;
  } else {
    flipped = true;
  }
  renderChallenge();
});


/* ---------- 7. Entry actions ---------- */

async function addCustomEntry() {
  const card = {
    id: Date.now(),
    question: "",
    answer: "",
    source: null,        // the only thing marking this as custom
    created: new Date().toISOString()
  };

  cards.unshift(card);
  editingId = card.id;

  await chrome.storage.local.set({ cards });
  render();
  list.querySelector(".q-input").focus();
}

async function saveAnswer(id) {
  const qInput = list.querySelector(".q-input");
  const aInput = list.querySelector(".answer-input");
  const card = cards.find(c => c.id === id);
  if (!card) return;

  card.question = qInput.value.trim();
  card.answer = aInput.value.trim();

  // A blank-on-both custom entry was never really created — drop it.
  if (!card.question && !card.answer && card.source === null) {
    cards = cards.filter(c => c.id !== id);
  }

  editingId = null;
  await chrome.storage.local.set({ cards });
  render();
}

async function deleteCard(id) {
  const index = cards.findIndex(c => c.id === id);
  if (index === -1) return;

  undoStack.push({ card: cards[index], index });
  cards.splice(index, 1);
  if (editingId === id) editingId = null;   // don't leave a dangling reference

  await chrome.storage.local.set({ cards });
  render();
}

// Title survives Delete All — it names the set, not the contents.
async function deleteAll() {
  if (cards.length === 0) return;

  const count = cards.length;
  undoStack.push({ bulk: cards, index: 0 });   // reference survives reassignment
  cards = [];
  editingId = null;

  await chrome.storage.local.set({ cards });
  render();

  deleteAllBtn.textContent = `-${count}`;
  deleteAllBtn.disabled = false;   // render() just disabled it — keep it readable
  setTimeout(() => {
    deleteAllBtn.textContent = "Delete All";
    render();
  }, 3000);
}

// Handles three undo shapes: single delete, bulk delete, source removal.
async function undo() {
  const last = undoStack.pop();
  if (!last) return;

  if (last.sourceEdit) {
    const card = cards.find(c => c.id === last.sourceEdit.id);
    if (card) card.source = last.sourceEdit.oldSource;   // card may be gone
  } else if (last.bulk) {
    cards = [...last.bulk, ...cards];
  } else {
    const at = Math.min(last.index, cards.length);       // array may have shrunk
    cards.splice(at, 0, last.card);
  }

  await chrome.storage.local.set({ cards });
  render();
}


/* ---------- 8. Source actions ---------- */

async function copySource(btn) {
  await navigator.clipboard.writeText(btn.dataset.src);

  btn.textContent = "Copied!";
  setTimeout(() => { btn.textContent = "Copy source"; }, 1200);
}

async function removeSource(id) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  undoStack.push({ sourceEdit: { id, oldSource: card.source } });
  card.source = null;

  await chrome.storage.local.set({ cards });
  render();
}


/* ---------- 9. Import & export ---------- */

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  const imported = parseTSV(text);

  // Identity is question + answer. \u0000 separates them so that
  // {q:"ab", a:"c"} and {q:"a", a:"bc"} don't collide.
  const seen = new Set(cards.map(c => `${c.question}\u0000${c.answer}`));
  const fresh = imported.filter(c => !seen.has(`${c.question}\u0000${c.answer}`));

  cards = [...fresh, ...cards];
  await chrome.storage.local.set({ cards });
  render();

  // Reset, or re-selecting the same file fires no change event.
  fileInput.value = "";

  const skipped = imported.length - fresh.length;
  importBtn.textContent = `+${fresh.length}${skipped ? ` (${skipped} dup)` : ""}`;
  setTimeout(() => { importBtn.textContent = "Import"; }, 2000);
}

function parseTSV(text) {
  let counter = 0;

  return text
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => {
      const [question = "", answer = "", source = ""] = line.split("\t");
      return {
        // Date.now() alone collides — the whole loop runs inside one millisecond.
        id: Date.now() + Math.floor(Math.random() * 1000) + (counter++),
        question: question.trim(),
        answer: answer.trim(),
        source: source.trim() || null,
        created: new Date().toISOString()
      };
    })
    .filter(c => c.question || c.answer);
}

function exportCards(name) {
  const tsv = cards
    .map(c => [c.question, c.answer, c.source].map(clean).join("\t"))
    .join("\n");

  const blob = new Blob([tsv], { type: "text/tab-separated-values" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(name)}.tsv`;
  a.click();

  URL.revokeObjectURL(url);
}


/* ---------- 10. Challenge mode ---------- */

function startChallenge() {
  // A card with no answer has no back — nothing to review.
  deck = cards.filter(c => c.question && c.answer);
  if (deck.length === 0) return;

  setTitle.blur();

  // Fisher-Yates shuffle.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  deckIndex = 0;
  flipped = false;
  inChallenge = true;

  list.hidden = true;
  challengeView.hidden = false;
  challengeBtn.textContent = "Exit";
  header.classList.add("in-challenge");   // CSS locks the other controls

  renderChallenge();
}

function exitChallenge() {
  inChallenge = false;

  list.hidden = false;
  challengeView.hidden = true;
  challengeBtn.textContent = "Challenge";
  header.classList.remove("in-challenge");

  render();   // re-derives all data-driven button states
}

function renderChallenge() {
  if (deckIndex >= deck.length) {
    challengeView.innerHTML = `
      <div class="ch-done">
        ${deck.length} reviewed.<br>
        <span class="ch-hint">Space to restart</span>
      </div>`;
    return;
  }

  const card = deck[deckIndex];
  challengeView.innerHTML = `
    <div class="ch-progress">${deckIndex + 1} / ${deck.length}</div>
    <div class="ch-card">
      <div class="ch-front">${escapeHTML(card.question)}</div>
      ${flipped ? `<div class="ch-back">${escapeHTML(card.answer)}</div>` : ""}
    </div>
    <div class="ch-hint">Space to ${flipped ? "next card" : "reveal answer"}</div>`;
}
