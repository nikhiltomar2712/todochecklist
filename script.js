/**
 * TaskFlow — script.js
 *
 * Architecture overview:
 *   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 *   │    State    │────▶│   Storage   │────▶│   Render    │
 *   │ (tasks[])   │     │ (localStorage)    │  (DOM update)│
 *   └─────────────┘     └─────────────┘     └─────────────┘
 *          ▲                                       │
 *          └───────────── Events ◀─────────────────┘
 *
 * Data shape:
 *   {
 *     id:          string   — crypto.randomUUID()
 *     text:        string   — task description (sanitised)
 *     completed:   boolean  — true when marked done
 *     createdAt:   number   — Date.now() timestamp
 *   }
 */

/* ─────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────── */
const STORAGE_KEY = 'taskflow_v1';
const MAX_LENGTH  = 200;

/* ─────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────── */

/** @type {Array<{id:string, text:string, completed:boolean, createdAt:number}>} */
let tasks         = [];
let currentFilter = 'all'; // 'all' | 'active' | 'completed'

/* ─────────────────────────────────────────────────────
   STORAGE HELPERS
   Auto-save on every mutation; never let state diverge
   from localStorage.
───────────────────────────────────────────────────── */

/**
 * Load the tasks array from localStorage.
 * Returns [] on any failure (missing key, JSON parse error).
 * @returns {typeof tasks}
 */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    // Validate: must be an array of objects with expected keys
    if (!Array.isArray(data)) return [];
    return data.filter(
      t => t && typeof t.id === 'string'
             && typeof t.text === 'string'
             && typeof t.completed === 'boolean'
             && typeof t.createdAt === 'number'
    );
  } catch {
    return [];
  }
}

/**
 * Persist the current tasks array to localStorage.
 * Called after every mutation.
 */
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    // Gracefully handle QuotaExceededError on storage-restricted environments
    console.warn('TaskFlow: could not save to localStorage.', err);
  }
}

/* ─────────────────────────────────────────────────────
   TASK OPERATIONS
   Every operation mutates `tasks`, calls saveToStorage(),
   then calls render() to sync the DOM.
───────────────────────────────────────────────────── */

/**
 * Add a new task to the top of the list.
 * Silently ignores blank input.
 * @param {string} rawText - Raw user input.
 */
function addTask(rawText) {
  const text = rawText.trim();
  if (!text) return;

  const task = {
    id:        crypto.randomUUID(),
    text,
    completed: false,
    createdAt: Date.now(),
  };

  tasks.unshift(task);      // prepend so newest appears first
  saveToStorage();
  render();
  showToast('Task added ✦');
}

/**
 * Toggle the completed state of a task by ID.
 * @param {string} id
 */
function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveToStorage();
  render();
}

/**
 * Delete a task by ID.
 * Plays a CSS exit animation on the list item before removing from state.
 * @param {string} id
 */
function deleteTask(id) {
  const itemEl = document.querySelector(`.task-item[data-id="${CSS.escape(id)}"]`);

  const removeFromState = () => {
    tasks = tasks.filter(t => t.id !== id);
    saveToStorage();
    render();
  };

  if (itemEl) {
    itemEl.classList.add('removing');
    // Use animationend rather than a raw timeout to stay in sync with CSS
    itemEl.addEventListener('animationend', removeFromState, { once: true });
  } else {
    // Fallback: item not in DOM (e.g. different filter active)
    removeFromState();
  }
}

/**
 * Delete all completed tasks at once.
 * Shows a toast with the count of removed tasks.
 */
function clearCompleted() {
  const completed = tasks.filter(t => t.completed);
  if (completed.length === 0) return;

  tasks = tasks.filter(t => !t.completed);
  saveToStorage();
  render();

  const n    = completed.length;
  const noun = n === 1 ? 'task' : 'tasks';
  showToast(`Removed ${n} completed ${noun}`);
}

/* ─────────────────────────────────────────────────────
   FILTERING
───────────────────────────────────────────────────── */

/**
 * Return the subset of tasks matching the current filter.
 * @returns {typeof tasks}
 */
function getFilteredTasks() {
  switch (currentFilter) {
    case 'active':    return tasks.filter(t => !t.completed);
    case 'completed': return tasks.filter(t =>  t.completed);
    default:          return [...tasks];
  }
}

/* ─────────────────────────────────────────────────────
   DATE FORMATTING
───────────────────────────────────────────────────── */

/**
 * Convert a Unix ms timestamp to a concise human-readable string.
 * Uses relative labels for recent times, then falls back to a short date.
 * @param {number} ts
 * @returns {string}
 */
function formatDate(ts) {
  const now  = Date.now();
  const diff = now - ts;

  const MINUTE = 60_000;
  const HOUR   = 3_600_000;
  const DAY    = 86_400_000;
  const WEEK   = 7 * DAY;

  if (diff < MINUTE)      return 'Just now';
  if (diff < HOUR)        return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY)         return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY)     return 'Yesterday';
  if (diff < WEEK)        return `${Math.floor(diff / DAY)}d ago`;

  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day:   'numeric',
    year:  new Date(ts).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

/* ─────────────────────────────────────────────────────
   SECURITY — XSS PREVENTION
───────────────────────────────────────────────────── */

/**
 * Escape the five dangerous HTML characters.
 * Must be called on every user-supplied string before inserting into innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;');
}

/* ─────────────────────────────────────────────────────
   RENDER
   Single render function rebuilds the entire task list.
   Kept intentionally simple: no virtual DOM, no diffing.
   Performance is fine for typical to-do list sizes.
───────────────────────────────────────────────────── */

/** Cache frequently-accessed DOM references */
const DOM = {};

function cacheDOMRefs() {
  DOM.taskList      = document.getElementById('taskList');
  DOM.emptyState    = document.getElementById('emptyState');
  DOM.statsTotal    = document.getElementById('statsTotal');
  DOM.statsCompleted = document.getElementById('statsCompleted');
  DOM.footerCount   = document.getElementById('footerCount');
  DOM.clearBtn      = document.getElementById('clearBtn');
  DOM.emptyTitle    = document.querySelector('#emptyState .empty-title');
  DOM.emptySub      = document.querySelector('#emptyState .empty-sub');
}

/**
 * Main render function.
 * Rebuilds the task list HTML and syncs all stat / counter elements.
 */
function render() {
  const filtered     = getFilteredTasks();
  const totalCount   = tasks.length;
  const doneCount    = tasks.filter(t => t.completed).length;
  const activeCount  = totalCount - doneCount;

  /* ── Update stats ── */
  DOM.statsTotal.textContent     = totalCount;
  DOM.statsCompleted.textContent = doneCount;

  /* ── Footer task count ── */
  DOM.footerCount.textContent =
    activeCount === 1 ? '1 task remaining' : `${activeCount} tasks remaining`;

  /* ── Clear button state ── */
  DOM.clearBtn.disabled = doneCount === 0;

  /* ── Empty state ── */
  if (filtered.length === 0) {
    DOM.taskList.innerHTML = '';
    DOM.emptyState.classList.add('visible');

    // Contextual empty-state message
    if (currentFilter === 'active') {
      DOM.emptyTitle.textContent = 'Nothing active!';
      DOM.emptySub.textContent   = 'All tasks are complete — great work.';
    } else if (currentFilter === 'completed') {
      DOM.emptyTitle.textContent = 'No completed tasks yet';
      DOM.emptySub.textContent   = 'Finish a task and it will appear here.';
    } else {
      DOM.emptyTitle.textContent = 'All clear!';
      DOM.emptySub.textContent   = 'Add a task above to get started.';
    }
    return;
  }

  DOM.emptyState.classList.remove('visible');

  /* ── Build task items ── */
  // We keep any items currently mid-remove-animation to avoid interrupting them.
  const animatingIds = new Set(
    [...document.querySelectorAll('.task-item.removing')].map(el => el.dataset.id)
  );

  DOM.taskList.innerHTML = filtered
    .filter(task => !animatingIds.has(task.id))
    .map(task => buildTaskItemHTML(task))
    .join('');
}

/**
 * Build the HTML string for a single task list item.
 * @param {{ id: string, text: string, completed: boolean, createdAt: number }} task
 * @returns {string}
 */
function buildTaskItemHTML(task) {
  const completedClass = task.completed ? 'completed' : '';
  const checkedAttr    = task.completed ? 'checked'   : '';
  const ariaLabel      = task.completed
    ? 'Mark as incomplete'
    : 'Mark as complete';

  // Clock icon inline SVG for the timestamp
  const clockSVG = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.2"/>
    <path d="M6 3.5V6l1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;

  return `
    <li class="task-item ${completedClass}" data-id="${escapeHTML(task.id)}" role="listitem">
      <input
        type="checkbox"
        class="task-checkbox"
        ${checkedAttr}
        aria-label="${ariaLabel}"
        data-action="toggle"
        title="${ariaLabel}"
      />
      <div class="task-body">
        <p class="task-text">${escapeHTML(task.text)}</p>
        <span class="task-meta">
          ${clockSVG}
          ${escapeHTML(formatDate(task.createdAt))}
        </span>
      </div>
      <button
        class="delete-btn"
        data-action="delete"
        aria-label="Delete task"
        title="Delete task"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
        </svg>
      </button>
    </li>
  `;
}

/* ─────────────────────────────────────────────────────
   TOAST NOTIFICATION
───────────────────────────────────────────────────── */

let _toastEl    = null;
let _toastTimer = null;

/**
 * Show a brief dismissible toast at the bottom of the screen.
 * Calling this while a toast is visible will reset the timer.
 * @param {string} message
 */
function showToast(message) {
  // Lazily create the toast element once
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.className = 'toast';
    _toastEl.setAttribute('role', 'status');
    _toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(_toastEl);
  }

  _toastEl.textContent = message;
  _toastEl.classList.add('show');

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    _toastEl.classList.remove('show');
  }, 2200);
}

/* ─────────────────────────────────────────────────────
   CHARACTER COUNTER
───────────────────────────────────────────────────── */

/**
 * Update the character counter hint below the input field.
 * @param {number} length - Current input length.
 */
function updateCharCount(length) {
  const hint = document.getElementById('charCount');
  if (!hint) return;

  if (length === 0) {
    hint.textContent = '';
    hint.classList.remove('warn');
    return;
  }

  const remaining = MAX_LENGTH - length;
  hint.textContent = `${remaining} characters remaining`;
  hint.classList.toggle('warn', remaining <= 20);
}

/* ─────────────────────────────────────────────────────
   EVENT LISTENERS
───────────────────────────────────────────────────── */

function initEvents() {
  const input      = document.getElementById('taskInput');
  const addBtn     = document.getElementById('addBtn');
  const taskList   = document.getElementById('taskList');
  const clearBtn   = document.getElementById('clearBtn');
  const filterTabs = document.querySelectorAll('.filter-tab');

  /* ── Add task: button click ── */
  addBtn.addEventListener('click', () => {
    addTask(input.value);
    input.value = '';
    updateCharCount(0);
    input.focus();
  });

  /* ── Add task: Enter key in input ── */
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addTask(input.value);
      input.value = '';
      updateCharCount(0);
    }
    // Escape clears the input
    if (e.key === 'Escape') {
      input.value = '';
      updateCharCount(0);
      input.blur();
    }
  });

  /* ── Character counter on input ── */
  input.addEventListener('input', () => {
    updateCharCount(input.value.length);
  });

  /* ── Task list interactions (event delegation) ──
     A single listener on the <ul> handles all task
     actions, avoiding per-item listener overhead.     */
  taskList.addEventListener('click', e => {
    const item = e.target.closest('.task-item');
    if (!item) return;

    const id = item.dataset.id;

    if (e.target.closest('[data-action="toggle"]')) {
      toggleTask(id);
    } else if (e.target.closest('[data-action="delete"]')) {
      deleteTask(id);
    }
  });

  /* ── Keyboard: delete task with Backspace/Delete ── */
  taskList.addEventListener('keydown', e => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const btn = e.target.closest('[data-action="delete"]');
    if (btn) {
      const item = btn.closest('.task-item');
      if (item) deleteTask(item.dataset.id);
    }
  });

  /* ── Clear completed tasks ── */
  clearBtn.addEventListener('click', clearCompleted);

  /* ── Filter tabs ── */
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update active tab styling & ARIA
      filterTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      currentFilter = tab.dataset.filter;
      render();
    });
  });

  /* ── Refresh relative timestamps every 60 s ── */
  setInterval(render, 60_000);
}

/* ─────────────────────────────────────────────────────
   BOOTSTRAP
───────────────────────────────────────────────────── */

/**
 * Entry point — called once when the page loads.
 * Order matters: cache DOM refs → load state → attach events → render.
 */
function init() {
  cacheDOMRefs();
  tasks = loadFromStorage();
  initEvents();
  render();

  // Auto-focus the input on desktop (skip on mobile to avoid unwanted keyboard pop-up)
  if (window.matchMedia('(pointer: fine)').matches) {
    document.getElementById('taskInput').focus();
  }
}

// Kick off after DOM is fully parsed
document.addEventListener('DOMContentLoaded', init);
