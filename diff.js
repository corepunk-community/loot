// State
let versions = [];
let diffResult = null;

// DOM elements
const versionOldSelect = document.getElementById('version-old');
const versionNewSelect = document.getElementById('version-new');
const runDiffBtn = document.getElementById('run-diff');
const diffLoading = document.getElementById('diff-loading');
const diffSummary = document.getElementById('diff-summary');
const diffFilterBar = document.getElementById('diff-filter-bar');
const diffResults = document.getElementById('diff-results');
const diffSearchInput = document.getElementById('diff-search');
const clearDiffSearchBtn = document.getElementById('clear-diff-search');

// Initialize
async function init() {
    try {
        await loadVersionManifest();
        populateDropdowns();
        setupEventListeners();
    } catch (error) {
        console.error('Error initializing:', error);
        diffResults.innerHTML = '<div class="error-message">Failed to load version manifest.</div>';
    }
}

async function loadVersionManifest() {
    const response = await fetch('versions.json');
    if (!response.ok) throw new Error('Failed to load versions.json');
    versions = await response.json();
}

function populateDropdowns() {
    versionOldSelect.innerHTML = '';
    versionNewSelect.innerHTML = '';

    versions.forEach((v, i) => {
        versionOldSelect.add(new Option(`v${v.version}`, v.file));
        versionNewSelect.add(new Option(`v${v.version}`, v.file));
    });

    // Auto-select: second-to-last as old, last as new
    if (versions.length >= 2) {
        versionOldSelect.selectedIndex = versions.length - 2;
        versionNewSelect.selectedIndex = versions.length - 1;
    }
}

function setupEventListeners() {
    runDiffBtn.addEventListener('click', runDiff);

    // Filter buttons
    diffFilterBar.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            diffFilterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDiff();
        });
    });

    // Search
    diffSearchInput.addEventListener('input', renderDiff);
    clearDiffSearchBtn.addEventListener('click', () => {
        diffSearchInput.value = '';
        renderDiff();
    });
}

async function fetchVersion(file) {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Failed to load ${file}`);
    return response.json();
}

function computeDiff(oldTables, newTables) {
    const allKeys = new Set([...Object.keys(oldTables), ...Object.keys(newTables)]);

    const added = [];
    const removed = [];
    const modified = [];
    const unchanged = [];

    for (const key of [...allKeys].sort().filter(k => !k.startsWith('Camp Chest'))) {
        const inOld = key in oldTables;
        const inNew = key in newTables;

        if (!inOld && inNew) {
            added.push({ name: key, items: newTables[key] });
        } else if (inOld && !inNew) {
            removed.push({ name: key, items: oldTables[key] });
        } else {
            const oldItems = new Set(oldTables[key]);
            const newItems = new Set(newTables[key]);

            const addedItems = [...newItems].filter(i => !oldItems.has(i)).sort();
            const removedItems = [...oldItems].filter(i => !newItems.has(i)).sort();

            if (addedItems.length > 0 || removedItems.length > 0) {
                modified.push({
                    name: key,
                    addedItems,
                    removedItems,
                    oldItems: [...oldTables[key]].sort(),
                    newItems: [...newTables[key]].sort()
                });
            } else {
                unchanged.push(key);
            }
        }
    }

    return { added, removed, modified, unchanged };
}

async function runDiff() {
    const oldFile = versionOldSelect.value;
    const newFile = versionNewSelect.value;

    if (oldFile === newFile) {
        diffResults.innerHTML = '<div class="error-message">Please select two different versions.</div>';
        return;
    }

    diffLoading.classList.remove('hidden');
    diffResults.innerHTML = '';
    diffSummary.classList.add('hidden');
    diffFilterBar.classList.add('hidden');

    try {
        const [oldData, newData] = await Promise.all([
            fetchVersion(oldFile),
            fetchVersion(newFile)
        ]);

        diffResult = computeDiff(oldData, newData);
        updateSummary();
        renderDiff();
    } catch (err) {
        diffResults.innerHTML = `<div class="error-message">Error: ${err.message}</div>`;
    } finally {
        diffLoading.classList.add('hidden');
    }
}

function updateSummary() {
    document.getElementById('count-added').textContent = diffResult.added.length;
    document.getElementById('count-removed').textContent = diffResult.removed.length;
    document.getElementById('count-modified').textContent = diffResult.modified.length;
    document.getElementById('count-unchanged').textContent = diffResult.unchanged.length;
    diffSummary.classList.remove('hidden');
    diffFilterBar.classList.remove('hidden');
}

function getActiveFilter() {
    const active = diffFilterBar.querySelector('.filter-btn.active');
    return active ? active.dataset.diffFilter : 'all';
}

function matchesSearch(table, searchTerm, type) {
    if (!searchTerm) return true;
    if (table.name.toLowerCase().includes(searchTerm)) return true;

    const items = type === 'modified'
        ? [...table.addedItems, ...table.removedItems]
        : table.items;
    return items.some(i => i.toLowerCase().includes(searchTerm));
}

function renderDiff() {
    if (!diffResult) return;

    diffResults.innerHTML = '';
    const activeFilter = getActiveFilter();
    const searchTerm = diffSearchInput.value.trim().toLowerCase();

    if (activeFilter === 'all' || activeFilter === 'added') {
        diffResult.added
            .filter(t => matchesSearch(t, searchTerm, 'added'))
            .forEach(t => diffResults.appendChild(renderAddedTable(t)));
    }

    if (activeFilter === 'all' || activeFilter === 'removed') {
        diffResult.removed
            .filter(t => matchesSearch(t, searchTerm, 'removed'))
            .forEach(t => diffResults.appendChild(renderRemovedTable(t)));
    }

    if (activeFilter === 'all' || activeFilter === 'modified') {
        diffResult.modified
            .filter(t => matchesSearch(t, searchTerm, 'modified'))
            .forEach(t => diffResults.appendChild(renderModifiedTable(t)));
    }

    if (diffResults.children.length === 0) {
        diffResults.innerHTML = '<div class="no-tables-message">No changes match the current filter.</div>';
    }
}

function createDiffCard(name, type, statText) {
    const card = document.createElement('div');
    card.className = `diff-card diff-card-${type}`;

    const header = document.createElement('div');
    header.className = 'diff-card-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'diff-card-name';
    nameSpan.textContent = name;

    const statSpan = document.createElement('span');
    statSpan.className = 'diff-card-stat';
    statSpan.textContent = statText;

    const chevron = document.createElement('span');
    chevron.className = 'diff-card-chevron expanded';
    chevron.innerHTML = '&#x25B6;';

    header.appendChild(nameSpan);
    header.appendChild(statSpan);
    header.appendChild(chevron);

    const body = document.createElement('div');
    body.className = 'diff-card-body';

    header.addEventListener('click', () => {
        body.classList.toggle('hidden');
        chevron.classList.toggle('expanded');
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
}

function renderAddedTable(table) {
    const card = createDiffCard(table.name, 'added', `+${table.items.length} items`);
    const body = card.querySelector('.diff-card-body');
    table.items.sort().forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item diff-item-added';
        div.textContent = `+ ${item}`;
        body.appendChild(div);
    });
    return card;
}

function renderRemovedTable(table) {
    const card = createDiffCard(table.name, 'removed', `-${table.items.length} items`);
    const body = card.querySelector('.diff-card-body');
    table.items.sort().forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item diff-item-removed';
        div.textContent = `- ${item}`;
        body.appendChild(div);
    });
    return card;
}

function renderModifiedTable(table) {
    const summary = `+${table.addedItems.length} / -${table.removedItems.length} items`;
    const card = createDiffCard(table.name, 'modified', summary);
    const header = card.querySelector('.diff-card-header');
    const body = card.querySelector('.diff-card-body');

    // "Show Full Table" button
    const fullToggle = document.createElement('button');
    fullToggle.className = 'view-table-btn';
    fullToggle.textContent = 'Full Table';
    fullToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullTable(body, table, fullToggle);
    });
    header.insertBefore(fullToggle, header.querySelector('.diff-card-chevron'));

    // Removed items
    table.removedItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item diff-item-removed';
        div.textContent = `- ${item}`;
        body.appendChild(div);
    });

    // Added items
    table.addedItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item diff-item-added';
        div.textContent = `+ ${item}`;
        body.appendChild(div);
    });

    return card;
}

function toggleFullTable(body, table, button) {
    const existing = body.querySelector('.full-table-view');
    if (existing) {
        existing.remove();
        button.textContent = 'Full Table';
        return;
    }

    button.textContent = 'Hide Full Table';

    const fullView = document.createElement('div');
    fullView.className = 'full-table-view';

    const removedSet = new Set(table.removedItems);
    const addedSet = new Set(table.addedItems);

    // Old version column
    const oldCol = document.createElement('div');
    oldCol.className = 'full-table-col';
    oldCol.innerHTML = '<h4>Old Version</h4>';
    table.oldItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item';
        if (removedSet.has(item)) div.classList.add('diff-item-removed');
        div.textContent = item;
        oldCol.appendChild(div);
    });

    // New version column
    const newCol = document.createElement('div');
    newCol.className = 'full-table-col';
    newCol.innerHTML = '<h4>New Version</h4>';
    table.newItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item';
        if (addedSet.has(item)) div.classList.add('diff-item-added');
        div.textContent = item;
        newCol.appendChild(div);
    });

    fullView.appendChild(oldCol);
    fullView.appendChild(newCol);
    body.appendChild(fullView);
}

// Start
window.addEventListener('DOMContentLoaded', init);
