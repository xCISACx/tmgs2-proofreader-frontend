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
  }).then(r => r.json())
};

// State
let currentFile = null;
let currentDialogues = [];
let selectedDialogue = null;
let searchQuery = '';
let currentOpenViewer = null; // Track the currently open inline viewer

// DOM Elements
const elements = {
  searchInput: document.getElementById('search-input'),
  searchBtn: document.getElementById('search-btn'),
  resultsSection: document.getElementById('results-section'),
  resultsList: document.getElementById('results-list'),
  correctionModal: document.getElementById('correction-modal'),
  originalText: document.getElementById('original-text'),
  correctedText: document.getElementById('corrected-text'),
  submitterName: document.getElementById('submitter-name'),
  correctionDescription: document.getElementById('correction-description'),
  cancelCorrection: document.getElementById('cancel-correction'),
  submitCorrection: document.getElementById('submit-correction'),
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loading-text'),
  toastContainer: document.getElementById('toast-container'),
  // In-game preview elements
  previewSpeaker: document.getElementById('preview-speaker'),
  previewText: document.getElementById('preview-text'),
  previewHint: document.getElementById('preview-hint')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  
  // Load saved name from localStorage
  const savedName = localStorage.getItem('proofreaderName');
  if (savedName && elements.submitterName) {
    elements.submitterName.value = savedName;
  }
});

// Event Listeners
function setupEventListeners() {
  // Search
  elements.searchBtn.addEventListener('click', performSearch);
  elements.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  
  // Correction modal
  elements.cancelCorrection.addEventListener('click', closeModal);
  elements.submitCorrection.addEventListener('click', submitCorrection);
  
  // Update in-game preview when corrected text changes
  elements.correctedText.addEventListener('input', updateGamePreview);
  
  // Close modal on outside click
  elements.correctionModal.addEventListener('click', (e) => {
    if (e.target === elements.correctionModal) closeModal();
  });
  
  // Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
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
    
    // Handle loading state (files being preloaded)
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
  
  if (results.length === 0) {
    elements.resultsList.innerHTML = `
      <div class="result-item" style="cursor: default;">
        <p style="color: var(--text-muted);">No results found. Try a different search term.</p>
      </div>
    `;
    return;
  }
  
  elements.resultsList.innerHTML = results.map((result, index) => `
    <div class="result-item" data-path="${result.path}" data-index="${index}" onclick="openFile('${result.path}', this)">
      <div class="file-path">${result.path}</div>
      <div class="preview">Click to view matching dialogues</div>
    </div>
  `).join('');
  
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
  // Close any existing viewer first
  closeFileViewer();
  
  showLoading('Loading file...');
  
  try {
    const fileData = await API.getFile(path);
    
    if (fileData.error) {
      throw new Error(fileData.error);
    }
    
    currentFile = fileData;
    
    // Parse dialogues
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
  // Create inline viewer element
  const viewer = document.createElement('div');
  viewer.className = 'inline-file-viewer';
  viewer.id = 'active-file-viewer';
  
  // Helper to normalize text the same way as server-side
  const normalizeText = (text) => {
    return text
      .replace(/\r?\n/g, ' ')  // Normalize newlines
      .replace(/\s+/g, ' ')    // Collapse whitespace
      .trim();
  };
  
  // Filter dialogues to only those matching search query
  let dialoguesToShow = currentDialogues;
  if (searchQuery) {
    // Normalize the search query the same way dialogue text is normalized
    const normalizedQuery = normalizeText(searchQuery).toLowerCase();
    dialoguesToShow = currentDialogues.filter(d => {
      // Normalize dialogue text before comparison too
      const normalizedText = normalizeText(d.text).toLowerCase();
      const normalizedSpeaker = d.speaker ? d.speaker.toLowerCase() : '';
      return normalizedText.includes(normalizedQuery) || 
             normalizedSpeaker.includes(normalizedQuery);
    });
  }
  
  // Count info
  const countInfo = dialoguesToShow.length > 0
    ? `<p class="dialogue-count">Showing ${dialoguesToShow.length} matching dialogue${dialoguesToShow.length !== 1 ? 's' : ''} (${currentDialogues.length} total in file)</p>`
    : '';
  
  const dialogueHtml = dialoguesToShow.length === 0 
    ? `<p style="color: var(--text-muted); text-align: center; padding: 40px;">No matching dialogue found in this file.</p>`
    : dialoguesToShow.map((dialogue) => {
        const speakerClass = getSpeakerClass(dialogue.speaker);
        const speakerDisplay = dialogue.speaker || '(Narration)';
        const originalIndex = currentDialogues.indexOf(dialogue);
        
        // Use textWithNewlines to show original formatting, convert newlines to <br> for display
        const displayText = (dialogue.textWithNewlines || dialogue.text);
        // Normalize line endings (\r\n -> \n, \r -> \n) then convert to <br>
        const displayHtml = escapeHtml(displayText).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
        
        return `
          <div class="dialogue-item highlight" data-index="${originalIndex}">
            <div class="dialogue-speaker ${speakerClass}">${escapeHtml(speakerDisplay)}</div>
            <div class="dialogue-text">${displayHtml}</div>
            <div class="dialogue-actions">
              <button class="btn secondary small" onclick="copyDialogue(${originalIndex})">Copy</button>
              <button class="btn primary small" onclick="openCorrectionModal(${originalIndex})">
                Suggest Correction
              </button>
            </div>
          </div>
        `;
      }).join('');
  
  viewer.innerHTML = `
    <div class="file-header">
      <div class="file-title">File: <span class="file-name">${currentFile.path}</span></div>
      <div class="file-actions">
        <a href="${currentFile.htmlUrl}" target="_blank" class="btn secondary small">View on GitHub</a>
        <button class="btn secondary small" onclick="closeFileViewer()">Close</button>
      </div>
    </div>
    ${countInfo}
    <div class="dialogue-list">
      ${dialogueHtml}
    </div>
  `;
  
  // Insert after the clicked element
  clickedElement.insertAdjacentElement('afterend', viewer);
  
  // Mark the clicked item as expanded
  clickedElement.classList.add('expanded');
  
  // Store reference
  currentOpenViewer = { viewer, resultItem: clickedElement };
  
  // Scroll into view smoothly
  viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  navigator.clipboard.writeText(dialogue.text);
  showToast('Copied to clipboard!', 'success');
}

// Correction Modal
function openCorrectionModal(index) {
  selectedDialogue = currentDialogues[index];
  // Use textWithNewlines if available (preserves original line breaks), fallback to text
  const editableText = selectedDialogue.textWithNewlines || selectedDialogue.text;
  elements.originalText.textContent = editableText;
  elements.correctedText.value = editableText;
  elements.correctionDescription.value = '';
  
  // Apply Y file styling (larger font) if this is a Y file
  const gameBox = document.querySelector('.game-box');
  if (gameBox) {
    if (currentFile && currentFile.path && currentFile.path.startsWith('y/')) {
      gameBox.classList.add('y-file');
    } else {
      gameBox.classList.remove('y-file');
    }
  }
  
  elements.correctionModal.classList.remove('hidden');
  elements.correctedText.focus();
  
  // Initialize in-game preview
  updateGamePreview();
}

// Update the in-game preview based on corrected text
function updateGamePreview() {
  if (!selectedDialogue) return;
  
  // Check if this is a Y file (supports unlimited lines)
  const isYFile = currentFile && currentFile.path && currentFile.path.startsWith('y/');
  
  const text = elements.correctedText.value;
  const allLines = text.split('\n');
  const speaker = selectedDialogue.speaker || '';
  
  // Update speaker
  elements.previewSpeaker.textContent = speaker;
  
  // For Y files show all lines, for regular files limit to 3
  const linesToShow = isYFile ? allLines : allLines.slice(0, 3);
  const minLines = isYFile ? allLines.length : 3;
  
  // Ensure we have enough lines for display
  while (linesToShow.length < minLines) {
    linesToShow.push('');
  }
  
  // Clear existing lines and rebuild for Y files (dynamic line count)
  elements.previewText.innerHTML = '';
  linesToShow.forEach((lineText, i) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'game-line';
    // Replace spaces with non-breaking spaces for accurate display
    lineEl.textContent = lineText ? lineText.replace(/ /g, '\u00A0') : '\u00A0';
    elements.previewText.appendChild(lineEl);
  });
  
  // Update hint based on line count (Y files support unlimited lines)
  if (allLines.length > 3 && !isYFile) {
    elements.previewHint.innerHTML = `<span style="color: #ff6600;">Warning: ${allLines.length} lines! Only 3 fit per text box.</span>`;
  } else if (isYFile) {
    elements.previewHint.textContent = `${allLines.length} lines (Y file - no limit)`;
    elements.previewHint.style.color = '';
  } else {
    elements.previewHint.textContent = `${allLines.length}/3 lines`;
    elements.previewHint.style.color = '';
  }
}

function closeModal() {
  elements.correctionModal.classList.add('hidden');
  selectedDialogue = null;
}

async function submitCorrection() {
  if (!selectedDialogue || !currentFile) return;
  
  const correctedText = elements.correctedText.value.trim();
  const description = elements.correctionDescription.value.trim();
  const submitterName = elements.submitterName.value.trim();
  
  if (!submitterName || submitterName.length < 2) {
    showToast('Please enter your name for attribution', 'warning');
    elements.submitterName.focus();
    return;
  }
  
  // Save name for next time
  localStorage.setItem('proofreaderName', submitterName);
  
  // Use textWithNewlines for comparison if available
  const originalEditableText = selectedDialogue.textWithNewlines || selectedDialogue.text;
  if (correctedText === originalEditableText) {
    showToast('No changes made to the text', 'warning');
    return;
  }
  
  // Build the corrected raw line based on dialogue type
  const originalRaw = selectedDialogue.raw;
  let correctedRaw;
  
  // Escape the corrected text for use in C string
  // Escape backslashes and quotes, but keep actual newlines as-is (file format uses real newlines)
  const escapedCorrection = correctedText
    .replace(/\\/g, '\\\\')   // Escape backslashes first
    .replace(/"/g, '\\"');    // Escape quotes
  
  if (selectedDialogue.type === 'MsgSel' || selectedDialogue.type === 'MsgSelRand') {
    // For MsgSel/MsgSelRand, replace just the specific option within the raw string
    // The rawOption contains the original text with escapes as it appears in the file
    correctedRaw = originalRaw.replace(`"${selectedDialogue.rawOption}"`, `"${escapedCorrection}"`);
  } else {
    // For MsgDisp, replace the text portion within the original raw string
    // This preserves the original structure (including any newlines that remain)
    // rawText contains the original escaped text as it appears in the file
    correctedRaw = originalRaw.replace(`"${selectedDialogue.rawText}"`, `"${escapedCorrection}"`);
  }
  
  showLoading('Creating pull request...');
  elements.submitCorrection.disabled = true;
  
  try {
    const result = await API.submitCorrection({
      filePath: currentFile.path,
      originalLine: originalRaw,
      correctedLine: correctedRaw,
      description,
      submitterName
    });
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    closeModal();
    showToast(`Pull request created! #${result.pullRequest.number}`, 'success');
    
    // Open PR in new tab
    window.open(result.pullRequest.url, '_blank');
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  } finally {
    hideLoading();
    elements.submitCorrection.disabled = false;
  }
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
  
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions global for onclick handlers
window.openFile = openFile;
window.copyDialogue = copyDialogue;
window.openCorrectionModal = openCorrectionModal;
window.closeFileViewer = closeFileViewer;
