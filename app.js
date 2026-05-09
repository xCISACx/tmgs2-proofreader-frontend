// TMGS2 Proofreader - Frontend Application

const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = isLocal ? 'http://localhost:3000' : 'https://tmgs2proofreader.revelro.online';

const API = {
  search: (query) => fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`).then(r => r.json()),
  getFile: (path) => fetch(`${API_BASE}/api/file/${encodeURIComponent(path)}`).then(r => r.json()),
  parseDialogue: (content) => fetch(`${API_BASE}/api/parse-dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  }).then(r => r.json()),
  submitCorrection: (data) => fetch(`${API_BASE}/api/submit-correction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json()),
  submitBatchCorrection: (data) => fetch(`${API_BASE}/api/submit-batch-correction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(r => r.json())
};

// State
let currentFile = null;
let currentDialogues = [];
let searchQuery = '';
let currentOpenViewer = null;
// Pending edits: keyed by filePath -> { [dialogueIndex]: { original, corrected, raw, type, rawText, rawOption, speaker } }
let pendingEdits = loadPendingEdits();

// DOM Elements
const elements = {
  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  resultsSection: document.getElementById('results-section'),
  resultsHeading: document.getElementById('results-heading'),
  resultsList: document.getElementById('results-list'),
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loading-text'),
  toastContainer: document.getElementById('toast-container')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
  elements.searchBtn.addEventListener('click', performSearch);
  elements.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close any open edit
      const editing = document.querySelector('.dialogue-item.editing');
      if (editing) {
        const idx = parseInt(editing.dataset.index);
        cancelEdit(idx);
      }
    }
  });
}

// Pending edits persistence
function loadPendingEdits() {
  try {
    return JSON.parse(localStorage.getItem('tmgs2_pendingEdits') || '{}');
  } catch { return {}; }
}

function savePendingEdits() {
  localStorage.setItem('tmgs2_pendingEdits', JSON.stringify(pendingEdits));
}

function getPendingEditsForFile(filePath) {
  return pendingEdits[filePath] || {};
}

function setPendingEdit(filePath, dialogueIndex, editData) {
  if (!pendingEdits[filePath]) pendingEdits[filePath] = {};
  pendingEdits[filePath][dialogueIndex] = editData;
  savePendingEdits();
}

function removePendingEdit(filePath, dialogueIndex) {
  if (pendingEdits[filePath]) {
    delete pendingEdits[filePath][dialogueIndex];
    if (Object.keys(pendingEdits[filePath]).length === 0) {
      delete pendingEdits[filePath];
    }
    savePendingEdits();
  }
}

function getPendingEditCount(filePath) {
  const edits = pendingEdits[filePath];
  return edits ? Object.keys(edits).length : 0;
}

// Search
async function performSearch() {
  const query = elements.searchInput.value.trim();

  if (query.length < 3) {
    showToast('Please enter at least 3 characters', 'warning');
    return;
  }

  searchQuery = query;
  showLoading('Searching...');

  try {
    const data = await API.search(query);

    if (data.error) {
      throw new Error(data.error);
    }

    if (data.loading) {
      showToast(data.message || 'Loading files, please try again in a moment...', 'warning');
      renderResults([], 0);
      return;
    }

    renderResults(data.results, data.total);
  } catch (error) {
    showToast('Search failed: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderResults(results, total) {
  elements.resultsSection.classList.remove('hidden');
  closeFileViewer();

  // Show result count
  if (results.length === 0) {
    elements.resultsHeading.textContent = 'Search Results';
  } else {
    const totalMatches = results.reduce((sum, r) => sum + (r.matchCount || r.matches || 0), 0);
    elements.resultsHeading.textContent = `Search Results — ${totalMatches} match${totalMatches !== 1 ? 'es' : ''} across ${results.length} file${results.length !== 1 ? 's' : ''}`;
  }

  if (results.length === 0) {
    elements.resultsList.innerHTML = `
      <div class="result-item" style="cursor: default;">
        <p style="color: var(--text-muted);">No results found. Try a different search term.</p>
      </div>
    `;
    return;
  }

  elements.resultsList.innerHTML = results.map((result, index) => {
    const editCount = getPendingEditCount(result.path);
    const editBadge = editCount > 0 ? `<span class="edit-badge">${editCount} pending edit${editCount !== 1 ? 's' : ''}</span>` : '';
    const matchCount = result.matchCount || result.matches || 0;
    return `
      <div class="result-item" data-path="${result.path}" data-index="${index}" onclick="openFile('${result.path}', this)">
        <div class="file-path">${result.path} ${editBadge}</div>
        <div class="preview">${matchCount} matching dialogue${matchCount !== 1 ? 's' : ''} — click to view full file</div>
      </div>
    `;
  }).join('');

  if (total > results.length) {
    elements.resultsList.innerHTML += `
      <p style="text-align: center; color: var(--text-muted); padding: 15px;">
        Showing ${results.length} of ${total} results. Refine your search for more specific results.
      </p>
    `;
  }
}

// File Viewer
async function openFile(path, clickedElement) {
  closeFileViewer();
  showLoading('Loading file...');

  try {
    const fileData = await API.getFile(path);
    if (fileData.error) throw new Error(fileData.error);
    currentFile = fileData;

    const parseResult = await API.parseDialogue(fileData.content);
    currentDialogues = parseResult.dialogues;

    renderFileViewer(clickedElement);
  } catch (error) {
    showToast('Failed to load file: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderFileViewer(clickedElement) {
  const viewer = document.createElement('div');
  viewer.className = 'inline-file-viewer';
  viewer.id = 'active-file-viewer';

  const normalizeText = (text) => {
    return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // Determine which dialogues match the search
  const matchingIndices = new Set();
  if (searchQuery) {
    const normalizedQuery = normalizeText(searchQuery).toLowerCase();
    currentDialogues.forEach((d, i) => {
      const normalizedText = normalizeText(d.text).toLowerCase();
      const normalizedSpeaker = d.speaker ? d.speaker.toLowerCase() : '';
      if (normalizedText.includes(normalizedQuery) || normalizedSpeaker.includes(normalizedQuery)) {
        matchingIndices.add(i);
      }
    });
  }

  const fileEdits = getPendingEditsForFile(currentFile.path);
  const editCount = Object.keys(fileEdits).length;

  const countInfo = `<p class="dialogue-count">
    ${matchingIndices.size} match${matchingIndices.size !== 1 ? 'es' : ''} highlighted — ${currentDialogues.length} total dialogues in file
    ${editCount > 0 ? ` — <strong>${editCount} pending edit${editCount !== 1 ? 's' : ''}</strong>` : ''}
  </p>`;

  // Build ALL dialogues, highlighting matches
  const dialogueHtml = currentDialogues.length === 0
    ? `<p style="color: var(--text-muted); text-align: center; padding: 40px;">No dialogue found in this file.</p>`
    : currentDialogues.map((dialogue, index) => {
        const isMatch = matchingIndices.has(index);
        const hasPendingEdit = fileEdits[index] !== undefined;
        const speakerClass = getSpeakerClass(dialogue.speaker);
        const speakerDisplay = dialogue.speaker || '(Narration)';

        const displayText = hasPendingEdit ? fileEdits[index].corrected : (dialogue.textWithNewlines || dialogue.text);
        const displayHtml = escapeHtml(displayText).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');

        const highlightClass = isMatch ? 'highlight' : '';
        const editedClass = hasPendingEdit ? 'edited' : '';

        return `
          <div class="dialogue-item ${highlightClass} ${editedClass}" data-index="${index}" id="dialogue-${index}">
            <div class="dialogue-speaker ${speakerClass}">${escapeHtml(speakerDisplay)}</div>
            <div class="dialogue-text" id="dialogue-text-${index}">${displayHtml}</div>
            <div class="dialogue-actions">
              <button class="btn secondary small" onclick="copyDialogue(${index})">Copy</button>
              ${hasPendingEdit
                ? `<button class="btn secondary small" onclick="revertEdit(${index})">Revert</button>
                   <button class="btn primary small" onclick="startEdit(${index})">Edit Again</button>`
                : `<button class="btn primary small" onclick="startEdit(${index})">Edit</button>`
              }
            </div>
          </div>
        `;
      }).join('');

  // Submitter name from localStorage
  const savedName = localStorage.getItem('proofreaderName') || '';

  viewer.innerHTML = `
    <div class="file-header">
      <div class="file-title">File: <span class="file-name">${currentFile.path}</span></div>
      <div class="file-actions">
        <a href="${currentFile.htmlUrl}" target="_blank" class="btn secondary small">View on GitHub</a>
        <button class="btn secondary small" onclick="closeFileViewer()">Close</button>
      </div>
    </div>
    ${countInfo}
    <div class="dialogue-list" id="dialogue-list">
      ${dialogueHtml}
    </div>
    <div class="batch-submit-bar" id="batch-submit-bar" ${editCount === 0 ? 'style="display:none"' : ''}>
      <div class="batch-info">
        <span id="batch-edit-count">${editCount}</span> correction${editCount !== 1 ? 's' : ''} ready to submit
      </div>
      <div class="batch-actions">
        <input type="text" id="submitter-name" placeholder="Your name (required)" value="${escapeHtml(savedName)}" maxlength="50">
        <input type="text" id="batch-description" placeholder="Description (optional)">
        <button class="btn secondary" onclick="clearAllEdits()">Clear All</button>
        <button class="btn primary" onclick="submitBatch()">Submit Pull Request</button>
      </div>
    </div>
  `;

  clickedElement.insertAdjacentElement('afterend', viewer);
  clickedElement.classList.add('expanded');
  currentOpenViewer = { viewer, resultItem: clickedElement };

  // Scroll to first match
  const firstMatch = viewer.querySelector('.dialogue-item.highlight');
  if (firstMatch) {
    setTimeout(() => firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  } else {
    viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function startEdit(index) {
  // Close any other open edit
  const existing = document.querySelector('.dialogue-item.editing');
  if (existing && parseInt(existing.dataset.index) !== index) {
    cancelEdit(parseInt(existing.dataset.index));
  }

  const dialogue = currentDialogues[index];
  const item = document.getElementById(`dialogue-${index}`);
  if (!item) return;

  const fileEdits = getPendingEditsForFile(currentFile.path);
  const currentText = fileEdits[index] ? fileEdits[index].corrected : (dialogue.textWithNewlines || dialogue.text);

  item.classList.add('editing');

  const textContainer = document.getElementById(`dialogue-text-${index}`);
  const actionsContainer = item.querySelector('.dialogue-actions');

  const yFileClass = currentFile && currentFile.path && currentFile.path.startsWith('y/') ? 'y-file' : '';
  textContainer.innerHTML =
    `<textarea class="inline-edit-textarea" id="edit-textarea-${index}" rows="4">${escapeHtml(currentText)}</textarea>` +
    `<div class="edit-preview-section">` +
      `<label>In-Game Preview:</label>` +
      `<div class="game-preview">` +
        `<div class="game-box ${yFileClass}">` +
          `<div class="game-speaker" id="edit-preview-speaker-${index}">${escapeHtml(dialogue.speaker || '')}</div>` +
          `<div class="game-contents">` +
            `<div class="game-text" id="edit-preview-text-${index}"></div>` +
          `</div>` +
        `</div>` +
      `</div>` +
    `</div>`;

  actionsContainer.innerHTML =
    `<button class="btn secondary small" onclick="cancelEdit(${index})">Cancel</button>` +
    `<button class="btn primary small" onclick="saveEdit(${index})">Save</button>`;

  // Set up live preview
  const textarea = document.getElementById(`edit-textarea-${index}`);
  textarea.focus();
  updateEditPreview(index);
  textarea.addEventListener('input', () => updateEditPreview(index));
}

function updateEditPreview(index) {
  const textarea = document.getElementById(`edit-textarea-${index}`);
  const previewText = document.getElementById(`edit-preview-text-${index}`);
  if (!textarea || !previewText) return;

  const text = textarea.value;
  const allLines = text.split('\n');
  const linesToShow = allLines.slice();
  while (linesToShow.length < 3) {
    linesToShow.push('');
  }

  previewText.innerHTML = '';
  linesToShow.forEach(lineText => {
    const lineEl = document.createElement('div');
    lineEl.className = 'game-line';
    lineEl.textContent = lineText ? lineText.replace(/ /g, '\u00A0') : '\u00A0';
    previewText.appendChild(lineEl);
  });
}

function saveEdit(index) {
  const dialogue = currentDialogues[index];
  const textarea = document.getElementById(`edit-textarea-${index}`);
  if (!textarea) return;

  const correctedText = textarea.value.trim();
  const originalText = dialogue.textWithNewlines || dialogue.text;

  if (correctedText === originalText) {
    // No change — remove any pending edit and revert display
    removePendingEdit(currentFile.path, index);
    cancelEdit(index);
    showToast('No changes — edit removed', 'info');
    return;
  }

  // Build corrected raw line
  const escapedCorrection = correctedText
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n');

  let correctedRaw;
  if (dialogue.type === 'Message_MsgSel' || dialogue.type === 'Message_MsgSelRand') {
    correctedRaw = dialogue.raw.replace(`"${dialogue.rawOption}"`, `"${escapedCorrection}"`);
  } else {
    correctedRaw = dialogue.raw.replace(`"${dialogue.rawText}"`, `"${escapedCorrection}"`);
  }

  setPendingEdit(currentFile.path, index, {
    original: originalText,
    corrected: correctedText,
    originalRaw: dialogue.raw,
    correctedRaw: correctedRaw,
    speaker: dialogue.speaker || ''
  });

  // Update display
  const item = document.getElementById(`dialogue-${index}`);
  item.classList.remove('editing');
  item.classList.add('edited');

  const textContainer = document.getElementById(`dialogue-text-${index}`);
  textContainer.innerHTML = escapeHtml(correctedText).replace(/\n/g, '<br>');

  const actionsContainer = item.querySelector('.dialogue-actions');
  actionsContainer.innerHTML = `
    <button class="btn secondary small" onclick="copyDialogue(${index})">Copy</button>
    <button class="btn secondary small" onclick="revertEdit(${index})">Revert</button>
    <button class="btn primary small" onclick="startEdit(${index})">Edit Again</button>
  `;

  updateBatchBar();
  showToast('Edit saved', 'success');
}

function cancelEdit(index) {
  const item = document.getElementById(`dialogue-${index}`);
  if (!item) return;

  item.classList.remove('editing');

  const dialogue = currentDialogues[index];
  const fileEdits = getPendingEditsForFile(currentFile.path);
  const hasPendingEdit = fileEdits[index] !== undefined;
  const displayText = hasPendingEdit ? fileEdits[index].corrected : (dialogue.textWithNewlines || dialogue.text);
  const displayHtml = escapeHtml(displayText).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');

  const textContainer = document.getElementById(`dialogue-text-${index}`);
  textContainer.innerHTML = displayHtml;

  const actionsContainer = item.querySelector('.dialogue-actions');
  actionsContainer.innerHTML = `
    <button class="btn secondary small" onclick="copyDialogue(${index})">Copy</button>
    ${hasPendingEdit
      ? `<button class="btn secondary small" onclick="revertEdit(${index})">Revert</button>
         <button class="btn primary small" onclick="startEdit(${index})">Edit Again</button>`
      : `<button class="btn primary small" onclick="startEdit(${index})">Edit</button>`
    }
  `;
}

function revertEdit(index) {
  removePendingEdit(currentFile.path, index);

  const item = document.getElementById(`dialogue-${index}`);
  if (!item) return;

  item.classList.remove('edited', 'editing');

  const dialogue = currentDialogues[index];
  const displayText = dialogue.textWithNewlines || dialogue.text;
  const displayHtml = escapeHtml(displayText).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');

  const textContainer = document.getElementById(`dialogue-text-${index}`);
  textContainer.innerHTML = displayHtml;

  const actionsContainer = item.querySelector('.dialogue-actions');
  actionsContainer.innerHTML = `
    <button class="btn secondary small" onclick="copyDialogue(${index})">Copy</button>
    <button class="btn primary small" onclick="startEdit(${index})">Edit</button>
  `;

  updateBatchBar();
  showToast('Edit reverted', 'info');
}

function clearAllEdits() {
  if (!currentFile) return;
  const editCount = getPendingEditCount(currentFile.path);
  if (editCount === 0) return;

  if (!confirm(`Clear all ${editCount} pending edit${editCount !== 1 ? 's' : ''}?`)) return;

  const fileEdits = getPendingEditsForFile(currentFile.path);
  for (const idx of Object.keys(fileEdits)) {
    revertEdit(parseInt(idx));
  }
  showToast('All edits cleared', 'info');
}

function updateBatchBar() {
  if (!currentFile) return;
  const editCount = getPendingEditCount(currentFile.path);
  const bar = document.getElementById('batch-submit-bar');
  const countEl = document.getElementById('batch-edit-count');

  if (bar) {
    bar.style.display = editCount > 0 ? '' : 'none';
  }
  if (countEl) {
    countEl.textContent = editCount;
    // Update the text around it
    countEl.parentElement.innerHTML = `<span id="batch-edit-count">${editCount}</span> correction${editCount !== 1 ? 's' : ''} ready to submit`;
  }

  // Also update the result item badge
  if (currentOpenViewer) {
    const resultItem = currentOpenViewer.resultItem;
    const pathEl = resultItem.querySelector('.file-path');
    if (pathEl) {
      const existingBadge = pathEl.querySelector('.edit-badge');
      if (existingBadge) existingBadge.remove();
      if (editCount > 0) {
        pathEl.insertAdjacentHTML('beforeend', ` <span class="edit-badge">${editCount} pending edit${editCount !== 1 ? 's' : ''}</span>`);
      }
    }
  }
}

async function submitBatch() {
  if (!currentFile) return;

  const fileEdits = getPendingEditsForFile(currentFile.path);
  const editKeys = Object.keys(fileEdits);
  if (editKeys.length === 0) {
    showToast('No pending edits to submit', 'warning');
    return;
  }

  const submitterName = document.getElementById('submitter-name')?.value.trim();
  if (!submitterName || submitterName.length < 2) {
    showToast('Please enter your name for attribution', 'warning');
    document.getElementById('submitter-name')?.focus();
    return;
  }

  localStorage.setItem('proofreaderName', submitterName);

  const description = document.getElementById('batch-description')?.value.trim() || '';

  const corrections = editKeys.map(idx => ({
    originalLine: fileEdits[idx].originalRaw,
    correctedLine: fileEdits[idx].correctedRaw
  }));

  showLoading('Creating pull request...');

  try {
    const result = await API.submitBatchCorrection({
      filePath: currentFile.path,
      corrections,
      description,
      submitterName
    });

    if (result.error) throw new Error(result.error);

    // Clear edits for this file
    delete pendingEdits[currentFile.path];
    savePendingEdits();

    showToast(`Pull request #${result.pullRequest.number} created with ${corrections.length} correction${corrections.length !== 1 ? 's' : ''}!`, 'success');
    window.open(result.pullRequest.url, '_blank');

    // Re-render viewer to clear edit states
    if (currentOpenViewer) {
      const clickedElement = currentOpenViewer.resultItem;
      closeFileViewer();
      await openFile(currentFile?.path || clickedElement.dataset.path, clickedElement);
    }
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

function getSpeakerClass(speaker) {
  if (!speaker) return 'narration';
  if (speaker === '主人公') return 'protagonist';
  return '';
}

function closeFileViewer() {
  if (currentOpenViewer) {
    currentOpenViewer.viewer.remove();
    currentOpenViewer.resultItem.classList.remove('expanded');
    currentOpenViewer = null;
  }
  currentFile = null;
  currentDialogues = [];
}

function copyDialogue(index) {
  const dialogue = currentDialogues[index];
  const fileEdits = getPendingEditsForFile(currentFile.path);
  const text = fileEdits[index] ? fileEdits[index].corrected : dialogue.text;
  navigator.clipboard.writeText(text);
  showToast('Copied to clipboard!', 'success');
}

// Utilities
function showLoading(text = 'Loading...') {
  elements.loadingText.textContent = text;
  elements.loading.classList.remove('hidden');
}

function hideLoading() {
  elements.loading.classList.add('hidden');
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions global for onclick handlers
window.openFile = openFile;
window.copyDialogue = copyDialogue;
window.startEdit = startEdit;
window.saveEdit = saveEdit;
window.cancelEdit = cancelEdit;
window.revertEdit = revertEdit;
window.clearAllEdits = clearAllEdits;
window.submitBatch = submitBatch;
window.closeFileViewer = closeFileViewer;
