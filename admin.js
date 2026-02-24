// TMGS2 Proofreader - Admin Portal

const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE = isLocal ? 'http://localhost:3000' : 'https://tmgs2proofreader.revelro.online';

// Get admin key from URL
const urlParams = new URLSearchParams(window.location.search);
const ADMIN_KEY = urlParams.get('key');

// State
let pullRequests = [];
let selectedPRs = new Set();

// DOM Elements
const prListEl = document.getElementById('prList');
const refreshBtn = document.getElementById('refreshBtn');
const mergeSelectedBtn = document.getElementById('mergeSelectedBtn');
const closeSelectedBtn = document.getElementById('closeSelectedBtn');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const filterInput = document.getElementById('filterInput');
const prCountEl = document.getElementById('prCount');
const selectedCountEl = document.getElementById('selectedCount');

// Modal elements
const mergeModal = document.getElementById('mergeModal');
const mergeCountEl = document.getElementById('mergeCount');
const mergeProgress = document.getElementById('mergeProgress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const mergeResults = document.getElementById('mergeResults');
const cancelMergeBtn = document.getElementById('cancelMergeBtn');
const confirmMergeBtn = document.getElementById('confirmMergeBtn');

const closeModal = document.getElementById('closeModal');
const closeCountEl = document.getElementById('closeCount');
const closeProgress = document.getElementById('closeProgress');
const closeProgressFill = document.getElementById('closeProgressFill');
const closeProgressText = document.getElementById('closeProgressText');
const closeResults = document.getElementById('closeResults');
const cancelCloseBtn = document.getElementById('cancelCloseBtn');
const confirmCloseBtn = document.getElementById('confirmCloseBtn');

const diffModal = document.getElementById('diffModal');
const diffModalTitle = document.getElementById('diffModalTitle');
const diffContent = document.getElementById('diffContent');
const closeDiffModal = document.getElementById('closeDiffModal');

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (!ADMIN_KEY) {
    showAuthPrompt();
    return;
  }
  
  // Verify key
  const valid = await verifyKey();
  if (!valid) {
    showAuthPrompt('Invalid admin key');
    return;
  }
  
  loadPullRequests();
  setupEventListeners();
}

function showAuthPrompt(error = null) {
  document.querySelector('.admin-container').innerHTML = `
    <div class="auth-screen">
      <div class="auth-box">
        <h2>🔐 TMGS2 Admin Portal</h2>
        <p style="color: #888; margin-bottom: 20px;">Enter admin key to continue</p>
        ${error ? `<p class="auth-error" style="display:block">${error}</p>` : ''}
        <input type="password" id="adminKeyInput" placeholder="Admin Key" autofocus>
        <button class="btn btn-primary" style="width:100%" onclick="submitKey()">Enter</button>
      </div>
    </div>
  `;
  
  document.getElementById('adminKeyInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitKey();
  });
}

function submitKey() {
  const key = document.getElementById('adminKeyInput').value;
  if (key) {
    window.location.href = `?key=${encodeURIComponent(key)}`;
  }
}

async function verifyKey() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/verify`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function setupEventListeners() {
  refreshBtn.addEventListener('click', loadPullRequests);
  mergeSelectedBtn.addEventListener('click', showMergeModal);
  closeSelectedBtn.addEventListener('click', showCloseModal);
  selectAllCheckbox.addEventListener('change', toggleSelectAll);
  filterInput.addEventListener('input', filterPRs);
  
  cancelMergeBtn.addEventListener('click', hideMergeModal);
  confirmMergeBtn.addEventListener('click', executeBatchMerge);
  cancelCloseBtn.addEventListener('click', hideCloseModal);
  confirmCloseBtn.addEventListener('click', executeBatchClose);
  confirmMergeBtn.addEventListener('click', executeBatchMerge);
  closeDiffModal.addEventListener('click', () => diffModal.classList.add('hidden'));
  
  // Close modals on backdrop click
  mergeModal.addEventListener('click', (e) => {
    if (e.target === mergeModal) hideMergeModal();
  });
  closeModal.addEventListener('click', (e) => {
    if (e.target === closeModal) hideCloseModal();
  });
  diffModal.addEventListener('click', (e) => {
    if (e.target === diffModal) diffModal.classList.add('hidden');
  });
}

async function loadPullRequests() {
  prListEl.innerHTML = '<div class="loading">Loading pull requests...</div>';
  selectedPRs.clear();
  updateSelectedCount();
  
  try {
    const res = await fetch(`${API_BASE}/api/admin/prs`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    
    if (!res.ok) throw new Error('Failed to load PRs');
    
    const data = await res.json();
    pullRequests = data.prs || [];
    renderPullRequests();
    prCountEl.textContent = `${pullRequests.length} open pull requests`;
  } catch (e) {
    prListEl.innerHTML = `<div class="empty-state"><h3>Error loading PRs</h3><p>${e.message}</p></div>`;
  }
}

function renderPullRequests(filter = '') {
  const filtered = filter 
    ? pullRequests.filter(pr => 
        pr.title.toLowerCase().includes(filter.toLowerCase()) ||
        pr.filePath?.toLowerCase().includes(filter.toLowerCase()) ||
        pr.body?.toLowerCase().includes(filter.toLowerCase())
      )
    : pullRequests;
  
  if (filtered.length === 0) {
    prListEl.innerHTML = '<div class="empty-state"><h3>No pull requests</h3><p>All caught up!</p></div>';
    return;
  }
  
  prListEl.innerHTML = filtered.map(pr => renderPRCard(pr)).join('');
  
  // Attach event listeners
  document.querySelectorAll('.pr-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => togglePRSelection(parseInt(e.target.dataset.prNumber)));
  });
  
  document.querySelectorAll('.merge-single-btn').forEach(btn => {
    btn.addEventListener('click', (e) => mergeSinglePR(parseInt(e.target.dataset.prNumber)));
  });
  
  document.querySelectorAll('.close-single-btn').forEach(btn => {
    btn.addEventListener('click', (e) => closeSinglePR(parseInt(e.target.dataset.prNumber)));
  });
}

function renderPRCard(pr) {
  const isSelected = selectedPRs.has(pr.number);
  const createdDate = new Date(pr.created_at).toLocaleDateString();
  
  return `
    <div class="pr-card ${isSelected ? 'selected' : ''}" data-pr-number="${pr.number}">
      <div class="pr-card-header">
        <input type="checkbox" class="pr-checkbox" data-pr-number="${pr.number}" ${isSelected ? 'checked' : ''}>
        <div class="pr-info">
          <div class="pr-title">#${pr.number}: ${escapeHtml(pr.title)}</div>
          <div class="pr-meta">
            <span>by ${pr.submitter ? escapeHtml(pr.submitter) : escapeHtml(pr.user)}</span>
            <span>${createdDate}</span>
            ${pr.filePath ? `<span class="file-path">${escapeHtml(pr.filePath)}</span>` : ''}
            <a href="${pr.html_url}" target="_blank" class="github-link">GitHub →</a>
          </div>
        </div>
        <div class="pr-actions">
          <button class="btn btn-danger btn-small close-single-btn" data-pr-number="${pr.number}">Close</button>
          <button class="btn btn-primary btn-small merge-single-btn" data-pr-number="${pr.number}">Merge</button>
        </div>
      </div>
      <div class="pr-diff">
        <div class="diff-lines">
          <div class="diff-side diff-original">
            <div class="diff-label">ORIGINAL</div>
            <pre>${pr.originalLine ? escapeHtml(pr.originalLine) : '<span class="no-data">No original text</span>'}</pre>
          </div>
          <div class="diff-side diff-corrected">
            <div class="diff-label">CORRECTED</div>
            <pre>${pr.correctedLine ? escapeHtml(pr.correctedLine) : '<span class="no-data">No corrected text</span>'}</pre>
          </div>
        </div>
      </div>
    </div>
  `;
}

function togglePRSelection(prNumber) {
  if (selectedPRs.has(prNumber)) {
    selectedPRs.delete(prNumber);
  } else {
    selectedPRs.add(prNumber);
  }
  updateSelectedCount();
  
  // Update card visual state
  const card = document.querySelector(`.pr-card[data-pr-number="${prNumber}"]`);
  if (card) {
    card.classList.toggle('selected', selectedPRs.has(prNumber));
  }
}

function toggleSelectAll() {
  const checked = selectAllCheckbox.checked;
  if (checked) {
    pullRequests.forEach(pr => selectedPRs.add(pr.number));
  } else {
    selectedPRs.clear();
  }
  updateSelectedCount();
  
  document.querySelectorAll('.pr-checkbox').forEach(cb => {
    cb.checked = checked;
  });
  document.querySelectorAll('.pr-card').forEach(card => {
    card.classList.toggle('selected', checked);
  });
}

function updateSelectedCount() {
  selectedCountEl.textContent = `${selectedPRs.size} selected`;
  mergeSelectedBtn.textContent = `Merge Selected (${selectedPRs.size})`;
  mergeSelectedBtn.disabled = selectedPRs.size === 0;
  closeSelectedBtn.textContent = `Close Selected (${selectedPRs.size})`;
  closeSelectedBtn.disabled = selectedPRs.size === 0;
}

function filterPRs() {
  renderPullRequests(filterInput.value);
}

async function viewPRDiff(prNumber) {
  const pr = pullRequests.find(p => p.number === prNumber);
  if (!pr) return;
  
  diffModalTitle.textContent = `PR #${prNumber}: ${pr.title}`;
  diffContent.innerHTML = '<div class="loading">Loading diff...</div>';
  diffModal.classList.remove('hidden');
  
  try {
    const res = await fetch(`${API_BASE}/api/admin/pr/${prNumber}/diff`, {
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    
    if (!res.ok) throw new Error('Failed to load diff');
    
    const data = await res.json();
    diffContent.innerHTML = `
      <div class="pr-diff">
        <div class="diff-header">${escapeHtml(data.filePath || pr.filePath || 'Unknown file')}</div>
        <div class="diff-lines">
          <div class="diff-side diff-original">
            <div class="diff-label">Original</div>
            ${escapeHtml(data.originalLine || pr.originalLine || 'N/A')}
          </div>
          <div class="diff-side diff-corrected">
            <div class="diff-label">Corrected</div>
            ${escapeHtml(data.correctedLine || pr.correctedLine || 'N/A')}
          </div>
        </div>
      </div>
      ${data.description ? `<p style="margin-top:15px;color:#aaa;"><strong>Description:</strong> ${escapeHtml(data.description)}</p>` : ''}
      <p style="margin-top:10px;color:#888;"><strong>Submitter:</strong> ${escapeHtml(data.submitter || pr.user)}</p>
      <p style="color:#888;"><a href="${pr.html_url}" target="_blank" style="color:#4DBBCF;">View on GitHub →</a></p>
    `;
  } catch (e) {
    diffContent.innerHTML = `<p style="color:#ff6b6b;">Error: ${e.message}</p>`;
  }
}

async function mergeSinglePR(prNumber) {
  if (!confirm(`Merge PR #${prNumber}?`)) return;
  
  const btn = document.querySelector(`.merge-single-btn[data-pr-number="${prNumber}"]`);
  btn.disabled = true;
  btn.textContent = 'Merging...';
  
  try {
    const res = await fetch(`${API_BASE}/api/admin/pr/${prNumber}/merge`, {
      method: 'POST',
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Merge failed');
    }
    
    // Remove from list
    pullRequests = pullRequests.filter(pr => pr.number !== prNumber);
    selectedPRs.delete(prNumber);
    renderPullRequests(filterInput.value);
    updateSelectedCount();
    prCountEl.textContent = `${pullRequests.length} open pull requests`;
  } catch (e) {
    alert(`Failed to merge: ${e.message}`);
    btn.disabled = false;
    btn.textContent = 'Merge';
  }
}

async function closeSinglePR(prNumber) {
  if (!confirm(`Close PR #${prNumber} without merging?`)) return;
  
  const btn = document.querySelector(`.close-single-btn[data-pr-number="${prNumber}"]`);
  btn.disabled = true;
  btn.textContent = 'Closing...';
  
  try {
    const res = await fetch(`${API_BASE}/api/admin/pr/${prNumber}/close`, {
      method: 'POST',
      headers: { 'X-Admin-Key': ADMIN_KEY }
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Close failed');
    }
    
    // Remove from list
    pullRequests = pullRequests.filter(pr => pr.number !== prNumber);
    selectedPRs.delete(prNumber);
    renderPullRequests(filterInput.value);
    updateSelectedCount();
    prCountEl.textContent = `${pullRequests.length} open pull requests`;
  } catch (e) {
    alert(`Failed to close: ${e.message}`);
    btn.disabled = false;
    btn.textContent = 'Close';
  }
}

function showMergeModal() {
  mergeCountEl.textContent = selectedPRs.size;
  mergeProgress.classList.add('hidden');
  mergeResults.classList.add('hidden');
  mergeResults.innerHTML = '';
  confirmMergeBtn.disabled = false;
  confirmMergeBtn.textContent = 'Merge All';
  cancelMergeBtn.disabled = false;
  mergeModal.classList.remove('hidden');
}

function hideMergeModal() {
  mergeModal.classList.add('hidden');
}

async function executeBatchMerge() {
  const prNumbers = Array.from(selectedPRs);
  const total = prNumbers.length;
  let completed = 0;
  let successes = 0;
  let failures = 0;
  
  confirmMergeBtn.disabled = true;
  cancelMergeBtn.disabled = true;
  mergeProgress.classList.remove('hidden');
  mergeResults.classList.remove('hidden');
  
  for (const prNumber of prNumbers) {
    progressText.textContent = `Merging PR #${prNumber} (${completed + 1}/${total})...`;
    
    try {
      const res = await fetch(`${API_BASE}/api/admin/pr/${prNumber}/merge`, {
        method: 'POST',
        headers: { 'X-Admin-Key': ADMIN_KEY }
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Merge failed');
      }
      
      successes++;
      mergeResults.innerHTML += `<div class="merge-result-item success">✓ PR #${prNumber} merged successfully</div>`;
      
      // Remove from local state
      pullRequests = pullRequests.filter(pr => pr.number !== prNumber);
      selectedPRs.delete(prNumber);
    } catch (e) {
      failures++;
      mergeResults.innerHTML += `<div class="merge-result-item error">✗ PR #${prNumber}: ${escapeHtml(e.message)}</div>`;
    }
    
    completed++;
    progressFill.style.width = `${(completed / total) * 100}%`;
  }
  
  progressText.textContent = `Done! ${successes} merged, ${failures} failed.`;
  confirmMergeBtn.textContent = 'Done';
  confirmMergeBtn.disabled = false;
  confirmMergeBtn.onclick = () => {
    hideMergeModal();
    renderPullRequests(filterInput.value);
    updateSelectedCount();
    prCountEl.textContent = `${pullRequests.length} open pull requests`;
    confirmMergeBtn.onclick = executeBatchMerge;
  };
  cancelMergeBtn.disabled = false;
}

function showCloseModal() {
  closeCountEl.textContent = selectedPRs.size;
  closeProgress.classList.add('hidden');
  closeResults.classList.add('hidden');
  closeResults.innerHTML = '';
  confirmCloseBtn.disabled = false;
  confirmCloseBtn.textContent = 'Close All';
  cancelCloseBtn.disabled = false;
  closeModal.classList.remove('hidden');
}

function hideCloseModal() {
  closeModal.classList.add('hidden');
}

async function executeBatchClose() {
  const prNumbers = Array.from(selectedPRs);
  const total = prNumbers.length;
  let completed = 0;
  let successes = 0;
  let failures = 0;
  
  confirmCloseBtn.disabled = true;
  cancelCloseBtn.disabled = true;
  closeProgress.classList.remove('hidden');
  closeResults.classList.remove('hidden');
  
  for (const prNumber of prNumbers) {
    closeProgressText.textContent = `Closing PR #${prNumber} (${completed + 1}/${total})...`;
    
    try {
      const res = await fetch(`${API_BASE}/api/admin/pr/${prNumber}/close`, {
        method: 'POST',
        headers: { 'X-Admin-Key': ADMIN_KEY }
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Close failed');
      }
      
      successes++;
      closeResults.innerHTML += `<div class="merge-result-item success">✓ PR #${prNumber} closed</div>`;
      
      // Remove from local state
      pullRequests = pullRequests.filter(pr => pr.number !== prNumber);
      selectedPRs.delete(prNumber);
    } catch (e) {
      failures++;
      closeResults.innerHTML += `<div class="merge-result-item error">✗ PR #${prNumber}: ${escapeHtml(e.message)}</div>`;
    }
    
    completed++;
    closeProgressFill.style.width = `${(completed / total) * 100}%`;
  }
  
  closeProgressText.textContent = `Done! ${successes} closed, ${failures} failed.`;
  confirmCloseBtn.textContent = 'Done';
  confirmCloseBtn.disabled = false;
  confirmCloseBtn.onclick = () => {
    hideCloseModal();
    renderPullRequests(filterInput.value);
    updateSelectedCount();
    prCountEl.textContent = `${pullRequests.length} open pull requests`;
    confirmCloseBtn.onclick = executeBatchClose;
  };
  cancelCloseBtn.disabled = false;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
