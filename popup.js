const list = document.getElementById("list");
const undoBtn = document.getElementById("undoBtn");
const exportBtn = document.getElementById("exportBtn");
const addBtn = document.getElementById("addBtn");

let cards = [];
let editingId = null;
let deletedStack = [];

init();

async function init() {
  const stored = await chrome.storage.local.get("cards");
  cards = stored.cards || [];
  render();
}

function escapeHTML(str) {
  return str.replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function render() {
  undoBtn.disabled = deletedStack.length === 0;
  exportBtn.disabled = cards.length === 0;

  if (cards.length === 0) {
    list.innerHTML = `<p class="empty">No entries yet.<br>Highlight text on any page,
      right-click → Make flashcard — or hit + to write your own.</p>`;
    return;
  }

  // The card being edited floats to the top; then unanswered, then done.
  const editing = cards.filter(c => c.id === editingId);
  const rest = cards.filter(c => c.id !== editingId);
  const ordered = [
    ...editing,
    ...rest.filter(c => !c.answer),
    ...rest.filter(c => c.answer)
  ];

  list.innerHTML = ordered.map(card => {
    if (card.id === editingId) {
      return `
        <div class="card editing">
          <div class="row">
            <textarea class="q-input" placeholder="Question or note title…">${escapeHTML(card.question)}</textarea>
            <button class="del-btn" data-id="${card.id}" title="Delete entry">×</button>
          </div>
          <textarea class="answer-input" placeholder="Answer or note…">${escapeHTML(card.answer)}</textarea>
          <div class="hint">Ctrl+Enter to save</div>
          <button class="save-btn" data-id="${card.id}">Save</button>
        </div>`;
    }

    const sourceBtn = card.source
      ? `<button class="src-btn" data-src="${escapeHTML(card.source)}">Copy source</button>`
      : "";

    return `
      <div class="card ${card.answer ? "done" : ""}" data-id="${card.id}">
        <div class="row">
          <div class="q">${escapeHTML(card.question) || "<em>Untitled</em>"}</div>
          <button class="del-btn" data-id="${card.id}" title="Delete entry">×</button>
        </div>
        ${card.answer
          ? `<div class="a">${escapeHTML(card.answer)}</div>`
          : `<div class="hint">Click to add answer</div>`}
        ${sourceBtn}
      </div>`;
  }).join("");
}

list.addEventListener("click", (e) => {
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
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)
      && (e.target.matches(".answer-input") || e.target.matches(".q-input"))) {
    e.preventDefault();
    saveAnswer(editingId);
  }
});

undoBtn.addEventListener("click", undoDelete);
exportBtn.addEventListener("click", exportCards);
addBtn.addEventListener("click", addCustomEntry);

async function addCustomEntry() {
  const card = {
    id: Date.now(),
    question: "",
    answer: "",
    source: null,          // ← the only thing marking this as custom
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

  deletedStack.push({ card: cards[index], index });
  cards.splice(index, 1);
  if (editingId === id) editingId = null;

  await chrome.storage.local.set({ cards });
  render();
}

async function undoDelete() {
  const last = deletedStack.pop();
  if (!last) return;

  const at = Math.min(last.index, cards.length);
  cards.splice(at, 0, last.card);

  await chrome.storage.local.set({ cards });
  render();
}

async function copySource(btn) {
  await navigator.clipboard.writeText(btn.dataset.src);
  btn.textContent = "Copied!";
  setTimeout(() => { btn.textContent = "Copy source"; }, 1200);
}

function exportCards() {
  const tsv = cards
    .map(c => [c.question, c.answer, c.source].map(clean).join("\t"))
    .join("\n");

  const blob = new Blob([tsv], { type: "text/tab-separated-values" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `entries-${new Date().toISOString().slice(0, 10)}.tsv`;
  a.click();

  URL.revokeObjectURL(url);
}

function clean(text) {
  return (text || "").replace(/[\t\n\r]+/g, " ").trim();
}