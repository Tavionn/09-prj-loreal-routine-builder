/* =========================================================
   L'Oréal Routine Builder
   - Browse + search + filter products
   - Select products (saved in localStorage)
   - Generate a routine with AI (through your Cloudflare Worker)
   - Ask follow-up questions (the full chat history is sent every time)
   - Web search citations + RTL mode (LevelUps)
   ========================================================= */

/* Your Cloudflare Worker URL (no API key here — the key lives in the Worker) */
const WORKER_URL = "https://loreal-chatbot.tavionb2003.workers.dev/";

/* Keys we use to save things in localStorage */
const SELECTED_KEY = "lorealSelectedProducts";
const DIR_KEY = "lorealTextDirection";

/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const resultsCount = document.getElementById("resultsCount");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedCount = document.getElementById("selectedCount");
const clearAllBtn = document.getElementById("clearAll");
const generateBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const dirToggle = document.getElementById("dirToggle");
const dirToggleLabel = document.getElementById("dirToggleLabel");

/* App state (data the app remembers while it runs) */
let allProducts = []; // every product from products.json
let selectedIds = loadSelectedIds(); // ids of products the user picked

/* The system prompt tells the AI who it is and what it may talk about */
const systemPrompt = `You are "L'Oréal Beauty Advisor", a friendly expert for L'Oréal Groupe brands
(CeraVe, L'Oréal Paris, Garnier, Lancôme, La Roche-Posay, Kiehl's, Maybelline, Redken, etc.).

Rules:
- Only help with: the user's routine, the products they selected, skincare, haircare, makeup,
  fragrance, suncare, men's grooming, and other beauty topics.
- If the user asks about anything unrelated, politely say you can only help with beauty and
  routines, and suggest a beauty question they could ask instead.
- When building a routine, use ONLY the products the user selected. Order them into clear
  steps (e.g. Morning / Evening, or Wash / Treat / Style) and explain briefly why each step matters.
- If an important step is missing (like sunscreen in a morning skincare routine), mention it
  as a tip, but do not invent that it is in their list.
- Keep answers short and easy to scan: use headings, numbered steps, and **bold** product names.
- When you use information from the web, include the source links.
- Never give medical diagnoses; suggest seeing a dermatologist for serious skin concerns.
- Reply in the same language the user writes in.`;

/* The full conversation. We send this whole array to the AI every time,
   because the AI does not remember previous requests on its own. */
let messages = [{ role: "system", content: systemPrompt }];

/* ---------------------------------------------------------
   1. LOAD + DISPLAY PRODUCTS
   --------------------------------------------------------- */

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  // Show a friendly message if nothing matches
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No products match your search. Try another word or category.
      </div>`;
    resultsCount.textContent = "0 products found";
    return;
  }

  resultsCount.textContent = `${products.length} product${products.length === 1 ? "" : "s"} found`;

  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = selectedIds.includes(product.id);
      return `
      <article class="product-card ${isSelected ? "selected" : ""}" data-id="${product.id}">
        <!-- Clicking the main area selects / unselects the product.
             Screen readers read the visible text, and aria-pressed tells them
             whether the product is selected (no extra aria-label needed). -->
        <button class="card-select" type="button" aria-pressed="${isSelected}">
          <span class="check-mark" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
          <!-- width/height save space for the image so the page doesn't jump -->
          <img src="${product.image}" alt="" width="90" height="90" loading="lazy" decoding="async">
          <span class="product-info">
            <span class="product-brand">${product.brand}</span>
            <span class="product-name">${product.name}</span>
            <span class="product-category">${product.category}</span>
          </span>
        </button>

        <!-- The "Details" button shows or hides the description -->
        <button class="details-btn" type="button" aria-expanded="false"
          aria-controls="desc-${product.id}">
          <i class="fa-solid fa-circle-info"></i> Details
        </button>
        <p class="product-description" id="desc-${product.id}" hidden>
          ${product.description}
        </p>
      </article>`;
    })
    .join("");
}

/* Show only the products that match BOTH the category and the search text */
function applyFilters() {
  const category = categoryFilter.value;
  const searchText = productSearch.value.trim().toLowerCase();

  const filtered = allProducts.filter((product) => {
    // Category check ("all" means every category is OK)
    const matchesCategory = category === "all" || product.category === category;

    // Search check: look in the name, brand, category, and description
    const text = `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase();
    const matchesSearch = text.includes(searchText);

    return matchesCategory && matchesSearch;
  });

  displayProducts(filtered);
}

/* Re-filter whenever the category or search text changes */
categoryFilter.addEventListener("change", applyFilters);
productSearch.addEventListener("input", applyFilters);

/* ---------------------------------------------------------
   2. SELECTING PRODUCTS
   --------------------------------------------------------- */

/* One click listener on the grid handles every card (event delegation) */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) return;
  const id = Number(card.dataset.id);

  // Was the "Details" button clicked? Then toggle the description.
  const detailsBtn = e.target.closest(".details-btn");
  if (detailsBtn) {
    const desc = card.querySelector(".product-description");
    const isOpen = detailsBtn.getAttribute("aria-expanded") === "true";
    detailsBtn.setAttribute("aria-expanded", String(!isOpen));
    desc.hidden = isOpen;
    card.classList.toggle("expanded", !isOpen);
    return;
  }

  // Otherwise, if the main card area was clicked, select / unselect it
  if (e.target.closest(".card-select")) {
    toggleProduct(id);
  }
});

/* Add the product if it isn't selected, remove it if it is */
function toggleProduct(id) {
  if (selectedIds.includes(id)) {
    selectedIds = selectedIds.filter((selectedId) => selectedId !== id);
  } else {
    selectedIds.push(id);
  }
  saveSelectedIds();
  updateSelectionUI();
}

/* Update the card highlight + the "Selected Products" list */
function updateSelectionUI() {
  // Update each visible card without rebuilding the grid
  document.querySelectorAll(".product-card").forEach((card) => {
    const id = Number(card.dataset.id);
    const isSelected = selectedIds.includes(id);
    const button = card.querySelector(".card-select");
    card.classList.toggle("selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  renderSelectedList();
}

/* Build the list of selected products, each with a remove button */
function renderSelectedList() {
  const selectedProducts = getSelectedProducts();
  selectedCount.textContent = selectedProducts.length;
  clearAllBtn.hidden = selectedProducts.length === 0;
  generateBtn.disabled = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="empty-selected">No products selected yet. Click a product card to add it.</p>`;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
      <div class="selected-item">
        <img src="${product.image}" alt="" width="30" height="30">
        <span>${product.brand} – ${product.name}</span>
        <button class="remove-btn" type="button" data-id="${product.id}"
          aria-label="Remove ${product.brand} ${product.name}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`
    )
    .join("");
}

/* Remove buttons inside the "Selected Products" list */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-btn");
  if (removeBtn) {
    toggleProduct(Number(removeBtn.dataset.id));
  }
});

/* "Clear all" empties the whole list */
clearAllBtn.addEventListener("click", () => {
  selectedIds = [];
  saveSelectedIds();
  updateSelectionUI();
});

/* Turn the list of ids into full product objects */
function getSelectedProducts() {
  return allProducts.filter((product) => selectedIds.includes(product.id));
}

/* ---------------------------------------------------------
   3. SAVING SELECTIONS WITH localStorage
   --------------------------------------------------------- */

function saveSelectedIds() {
  localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds));
}

function loadSelectedIds() {
  // try/catch in case the saved data is missing or broken
  try {
    const saved = JSON.parse(localStorage.getItem(SELECTED_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------
   4. TALKING TO THE AI (through the Cloudflare Worker)
   --------------------------------------------------------- */

/* Send the whole conversation to the Worker and return the reply */
async function askAI() {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // useWebSearch tells our Worker to use a model that can search the web
    body: JSON.stringify({ messages, useWebSearch: true }),
  });

  const data = await response.json();

  // If OpenAI returned an error, show it so we can debug
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Request failed (${response.status})`);
  }

  const message = data.choices[0].message;
  return {
    content: message.content,
    // Web search models return their sources as "annotations"
    citations: (message.annotations || [])
      .filter((a) => a.type === "url_citation")
      .map((a) => a.url_citation),
  };
}

/* Generate a routine from the selected products */
generateBtn.addEventListener("click", async () => {
  const selectedProducts = getSelectedProducts();
  if (selectedProducts.length === 0) return;

  // Only send the useful product fields (not the image links)
  const productData = selectedProducts.map(({ name, brand, category, description }) => ({
    name,
    brand,
    category,
    description,
  }));

  // Start a fresh conversation for each new routine
  messages = [{ role: "system", content: systemPrompt }];
  chatWindow.innerHTML = "";

  const prompt = `Please build a personalized routine using only these products I selected:\n${JSON.stringify(productData, null, 2)}`;
  messages.push({ role: "user", content: prompt });

  addMessage("user", `Generate a routine with my ${selectedProducts.length} selected product${selectedProducts.length === 1 ? "" : "s"}.`);

  await getAndShowReply(generateBtn);
});

/* Follow-up questions from the chat box */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = userInput.value.trim();
  if (!question) return;

  // Show the question, then add it to the conversation history
  addMessage("user", question);
  messages.push({ role: "user", content: question });
  userInput.value = "";

  await getAndShowReply(sendBtn);
});

/* Shared helper: shows a loading bubble, calls the AI, shows the answer */
async function getAndShowReply(buttonToDisable) {
  buttonToDisable.disabled = true;
  const loadingBubble = addMessage("assistant", "", true);

  try {
    const reply = await askAI();
    // Save the reply so the AI remembers it next time
    messages.push({ role: "assistant", content: reply.content });
    loadingBubble.remove();
    addMessage("assistant", reply.content, false, reply.citations);
  } catch (error) {
    console.error(error);
    // Remove the unanswered question so the history stays valid
    messages.pop();
    loadingBubble.remove();
    addMessage("error", `Sorry, something went wrong: ${error.message}. Please try again.`);
  } finally {
    // Re-enable the button (generate only if something is selected)
    buttonToDisable.disabled =
      buttonToDisable === generateBtn ? selectedIds.length === 0 : false;
  }
}

/* ---------------------------------------------------------
   5. CHAT WINDOW DISPLAY
   --------------------------------------------------------- */

/* Add one message bubble to the chat window */
function addMessage(role, text, isLoading = false, citations = []) {
  const bubble = document.createElement("div");
  bubble.className = `msg msg-${role}`;

  if (isLoading) {
    bubble.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>
      <span class="visually-hidden">Thinking…</span>`;
  } else if (role === "assistant") {
    bubble.innerHTML = formatMarkdown(text) + formatCitations(citations);
  } else {
    bubble.textContent = text; // textContent is safe for user text
  }

  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

/* Make HTML characters safe so AI text can't inject HTML */
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* A tiny Markdown formatter for headings, bold, lists, and links */
function formatMarkdown(text) {
  const lines = escapeHTML(text).split("\n");
  let html = "";
  let listType = null; // "ul", "ol", or null

  const closeList = () => {
    if (listType) html += `</${listType}>`;
    listType = null;
  };

  lines.forEach((line) => {
    const heading = line.match(/^#{1,6}\s+(.*)/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);

    if (heading) {
      closeList();
      html += `<h4>${inline(heading[1])}</h4>`;
    } else if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (listType !== type) {
        closeList();
        html += `<${type}>`;
        listType = type;
      }
      html += `<li>${inline((bullet || numbered)[1])}</li>`;
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  });
  closeList();
  return html;

  // Inline formatting: links, bold, italic
  function inline(str) {
    return str
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      )
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  }
}

/* Show the web sources (if any) under the AI's answer */
function formatCitations(citations) {
  if (!citations.length) return "";

  // Remove duplicate links
  const unique = citations.filter(
    (c, index) => citations.findIndex((other) => other.url === c.url) === index
  );

  return `
    <div class="citations">
      <span class="citations-title"><i class="fa-solid fa-globe"></i> Sources</span>
      <ol>
        ${unique
          .map(
            (c) => `<li><a href="${escapeHTML(c.url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHTML(c.title || c.url)}</a></li>`
          )
          .join("")}
      </ol>
    </div>`;
}

/* ---------------------------------------------------------
   6. RTL / LTR SWITCH (LevelUp)
   --------------------------------------------------------- */

function setDirection(dir) {
  document.documentElement.setAttribute("dir", dir);
  const isRTL = dir === "rtl";
  dirToggle.setAttribute("aria-pressed", String(isRTL));
  dirToggleLabel.textContent = isRTL ? "LTR mode" : "RTL mode";
  localStorage.setItem(DIR_KEY, dir);
}

dirToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("dir");
  setDirection(current === "rtl" ? "ltr" : "rtl");
});

/* ---------------------------------------------------------
   7. START THE APP
   --------------------------------------------------------- */

async function init() {
  setDirection(localStorage.getItem(DIR_KEY) || "ltr");

  allProducts = await loadProducts();

  // Drop any saved ids that no longer exist in products.json
  selectedIds = selectedIds.filter((id) => allProducts.some((p) => p.id === id));

  applyFilters();
  // Products are showing now, so the grid no longer needs its saved space
  productsContainer.classList.remove("is-loading");
  renderSelectedList();

  addMessage(
    "assistant",
    "Hi! 👋 Select some products above and click **Generate Routine**, or ask me any beauty question."
  );
}

init();
