// Runs once, on install/update — not every time the worker wakes.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "makeFlashcard",
    title: "Make flashcard",
    contexts: ["selection"]
  });
});

// Fires when any of this extension's menu items is clicked.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "makeFlashcard") return;

  const card = {
    id: Date.now(),
    question: info.selectionText.trim(),
    answer: "",
    source: info.pageUrl,
    created: new Date().toISOString()
  };

  const { cards = [] } = await chrome.storage.local.get("cards");
  cards.push(card);
  await chrome.storage.local.set({ cards });

  console.log("Saved:", card);
});