// File Changes viewer — diffs two file manifest snapshots and groups
// added/removed/modified files by area (Maps, Quests, Localization, etc.)

let versions = [];
let diffResult = null;

const versionOldSelect = document.getElementById('version-old');
const versionNewSelect = document.getElementById('version-new');
const runDiffBtn = document.getElementById('run-diff');
const diffLoading = document.getElementById('diff-loading');
const diffSummary = document.getElementById('diff-summary');
const diffFilterBar = document.getElementById('diff-filter-bar');
const diffResults = document.getElementById('diff-results');
const diffSearchInput = document.getElementById('diff-search');
const clearDiffSearchBtn = document.getElementById('clear-diff-search');
const categoryFiltersEl = document.getElementById('category-filters');

// ---------------------------------------------------------------------------
// File classification
//
// Each entry produces { area, description } given a relative path.  Area is
// the broad bucket used by the category filter (Maps, Quests, Localization,
// Entities, AI, Other).  Description is a short human-readable hint about
// what the file does, derived from the path + extension since most game
// formats are opaque binaries.
// ---------------------------------------------------------------------------

const EXT_DESCRIPTIONS = {
    // generic
    'xml':  'XML data',
    'json': 'JSON data',
    'dat':  'Binary data',
    'conf': 'Configuration',
    'ini':  'Configuration',
    'txt':  'Text',
    'md':   'Markdown',
    'manifest': 'Asset bundle manifest',
    'bundle': 'Asset bundle',
    'map':  'Map definition',
    'bm':   'Bookmark',

    // ai
    'aib':     'AI behavior tree',
    'aiPaths': 'AI navigation paths',

    // quests
    'questConnection': 'Quest map placement',

    // map sub-formats (binary, parent dir tells you which map they belong to)
    '_mapa':    'Map area / terrain tile',
    '_sft':     'Map static foliage tile',
    '_sg':      'Map scene graph chunk',
    '_tns':     'Map navmesh segment',
    '_cmp':     'Map compressed chunk',
    '_cmpg':    'Map compressed group',
    '_cmpm':    'Map compressed metadata',
    '_crbin':   'Map compiled binary chunk',
    '_fowmba':  'Fog-of-war block area',
    '___fowmba':'Fog-of-war block area',
    '_fowmw':   'Fog-of-war map width data',
    '_fowos':   'Fog-of-war overlay',
    '__fowm':   'Fog-of-war map data',
    '__deca':   'Map decal data',
    '_dec':     'Map decoration data',
    '_ip':      'Instance placement data',
    '__u':      'Map utility chunk',
    '_ru':      'Map render unit',
    '__ru':     'Map render unit',
    '_scs':     'Scene script chunk',
    '_genObjects': 'Generated object placements',
    'zoc':      'Zone collision data',
};

function fileExtension(path) {
    const base = path.split('/').pop();
    // Some Corepunk formats are like "X_0,0._mapa" — extension is everything
    // after the last dot. Strip leading dot when looking up.
    const dot = base.lastIndexOf('.');
    if (dot < 0) return '';
    return base.substring(dot + 1);
}

function classifyFile(path) {
    const parts = path.split('/');
    const top = parts[0] || '';
    const sub = parts[1] || '';
    const leaf = parts[parts.length - 1];
    const ext = fileExtension(path);
    const extDesc = EXT_DESCRIPTIONS[ext] || EXT_DESCRIPTIONS['_' + ext] || null;

    // ---- World/Maps/<MapName>/...
    if (top === 'World' && sub === 'Maps') {
        const mapName = parts[2] || '(unknown map)';
        if (parts[3] === 'questConnection') {
            const qname = leaf.replace(/\.questConnection$/, '');
            return {
                area: 'Maps',
                description: `Quest placement for "${qname}" on map ${mapName}`,
            };
        }
        if (parts[3] === 'Minimap') {
            return { area: 'Maps', description: `Minimap asset for ${mapName}` };
        }
        if (ext === 'aiPaths') {
            return { area: 'Maps', description: `AI navigation paths for ${mapName}` };
        }
        const what = extDesc || `Map data (.${ext})`;
        return { area: 'Maps', description: `${what} — ${mapName}` };
    }

    // ---- World/Quests/<quest_slug>/...
    if (top === 'World' && sub === 'Quests') {
        const slug = parts[2] || '';
        const pretty = slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (slug === 'QuestTemplates') {
            return { area: 'Quests', description: `Quest template: ${leaf}` };
        }
        if (slug === 'VoiceRequests') {
            return { area: 'Quests', description: `Voice request: ${leaf}` };
        }
        if (slug === 'Drafts') {
            return { area: 'Quests', description: `Quest draft: ${leaf}` };
        }
        if (slug.startsWith('Info_')) {
            return { area: 'Quests', description: `NPC info: ${slug.replace(/^Info_/, '')}` };
        }
        const what = extDesc || `Quest file (.${ext})`;
        return { area: 'Quests', description: `${what} — ${pretty || slug}` };
    }

    // ---- World/AI/...
    if (top === 'World' && sub === 'AI') {
        return {
            area: 'AI',
            description: ext === 'aib' ? `AI behavior tree: ${leaf.replace(/\.aib$/, '')}`
                                        : (extDesc || `AI file (.${ext})`),
        };
    }

    // ---- World/Bookmarks/...
    if (top === 'World' && sub === 'Bookmarks') {
        return { area: 'World', description: `Bookmark: ${leaf}` };
    }

    // ---- World/* misc (e.g. GameConstConfig.xml)
    if (top === 'World') {
        return { area: 'World', description: extDesc ? `${extDesc}: ${leaf}` : leaf };
    }

    // ---- Localization/<Locale>/<File>.xml
    if (top === 'Localization') {
        if (parts.length === 2) {
            return { area: 'Localization', description: `Localization root: ${leaf}` };
        }
        const locale = sub;
        const stem = leaf.replace(/\.xml$/, '');
        return { area: 'Localization', description: `${locale} — ${stem}` };
    }

    // ---- Entities/...
    if (top === 'Entities') {
        if (leaf === 'Entities.dat') {
            return { area: 'Entities', description: 'Game entity database (loot tables, items, NPCs, quests…)' };
        }
        if (leaf === 'ViewModelsDatabase.json') {
            return { area: 'Entities', description: 'Quest / view-model database' };
        }
        return { area: 'Entities', description: extDesc ? `${extDesc}: ${leaf}` : leaf };
    }

    // ---- Fallback
    const what = extDesc || (ext ? `.${ext} file` : 'File');
    return { area: 'Other', description: `${what} (${parts.slice(0, -1).join('/') || 'root'})` };
}

// ---------------------------------------------------------------------------
// Init / data loading
// ---------------------------------------------------------------------------

async function init() {
    try {
        await loadVersionManifest();
        populateDropdowns();
        setupEventListeners();
    } catch (err) {
        console.error('Error initializing:', err);
        diffResults.innerHTML = '<div class="error-message">Failed to load version manifest.</div>';
    }
}

async function loadVersionManifest() {
    const response = await fetch('versions.json');
    if (!response.ok) throw new Error('Failed to load versions.json');
    versions = await response.json();
}

function getAvailableVersions() {
    return versions.filter(v => v.file_manifest_file);
}

function populateDropdowns() {
    versionOldSelect.innerHTML = '';
    versionNewSelect.innerHTML = '';

    const available = getAvailableVersions();

    if (available.length === 0) {
        diffResults.innerHTML =
            '<div class="error-message">No file manifests found. Run <code>ruby parse_file_manifest.rb &lt;version&gt;</code> for at least two releases to enable this view.</div>';
        runDiffBtn.disabled = true;
        return;
    }

    available.forEach(v => {
        versionOldSelect.add(new Option(`v${v.version}`, v.file_manifest_file));
        versionNewSelect.add(new Option(`v${v.version}`, v.file_manifest_file));
    });

    if (available.length >= 2) {
        versionOldSelect.selectedIndex = available.length - 2;
        versionNewSelect.selectedIndex = available.length - 1;
    }
}

function setupEventListeners() {
    runDiffBtn.addEventListener('click', runDiff);

    // Change-type filter buttons (added/removed/modified/all)
    diffFilterBar.querySelectorAll('[data-diff-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            diffFilterBar.querySelectorAll('[data-diff-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDiff();
        });
    });

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

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function computeDiff(oldData, newData) {
    const oldFiles = oldData.files || {};
    const newFiles = newData.files || {};
    const allKeys = new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)]);

    const added = [];
    const removed = [];
    const modified = [];
    let unchanged = 0;

    for (const key of allKeys) {
        const inOld = key in oldFiles;
        const inNew = key in newFiles;
        if (!inOld && inNew) {
            const [size, hash] = newFiles[key];
            added.push({ path: key, size, hash, ...classifyFile(key) });
        } else if (inOld && !inNew) {
            const [size, hash] = oldFiles[key];
            removed.push({ path: key, size, hash, ...classifyFile(key) });
        } else {
            const [oldSize, oldHash] = oldFiles[key];
            const [newSize, newHash] = newFiles[key];
            if (oldSize !== newSize || oldHash !== newHash) {
                modified.push({
                    path: key,
                    oldSize, newSize, oldHash, newHash,
                    delta: newSize - oldSize,
                    ...classifyFile(key),
                });
            } else {
                unchanged++;
            }
        }
    }

    const sortByPath = (a, b) => a.path.localeCompare(b.path);
    added.sort(sortByPath);
    removed.sort(sortByPath);
    modified.sort(sortByPath);

    return { added, removed, modified, unchanged };
}

async function runDiff() {
    const oldFile = versionOldSelect.value;
    const newFile = versionNewSelect.value;

    if (!oldFile || !newFile) return;
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
            fetchVersion(newFile),
        ]);
        diffResult = computeDiff(oldData, newData);
        updateSummary();
        rebuildCategoryFilters();
        renderDiff();
    } catch (err) {
        diffResults.innerHTML = `<div class="error-message">Error: ${err.message}</div>`;
    } finally {
        diffLoading.classList.add('hidden');
    }
}

function updateSummary() {
    document.getElementById('count-added').textContent = diffResult.added.length.toLocaleString();
    document.getElementById('count-removed').textContent = diffResult.removed.length.toLocaleString();
    document.getElementById('count-modified').textContent = diffResult.modified.length.toLocaleString();
    document.getElementById('count-unchanged').textContent = diffResult.unchanged.toLocaleString();
    diffSummary.classList.remove('hidden');
    diffFilterBar.classList.remove('hidden');
}

function rebuildCategoryFilters() {
    // Discover the set of areas that actually appear in this diff so we don't
    // show empty filter buttons.
    const areas = new Set();
    [...diffResult.added, ...diffResult.removed, ...diffResult.modified].forEach(f => areas.add(f.area));
    const ordered = ['Maps', 'Quests', 'AI', 'Localization', 'Entities', 'World', 'Other'].filter(a => areas.has(a));

    categoryFiltersEl.innerHTML = '';
    const all = document.createElement('button');
    all.className = 'filter-btn active';
    all.dataset.catFilter = 'all';
    all.textContent = 'All Areas';
    categoryFiltersEl.appendChild(all);

    ordered.forEach(area => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.catFilter = area;
        btn.textContent = area;
        categoryFiltersEl.appendChild(btn);
    });

    categoryFiltersEl.querySelectorAll('[data-cat-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            categoryFiltersEl.querySelectorAll('[data-cat-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDiff();
        });
    });
}

function getActiveChangeFilter() {
    const active = diffFilterBar.querySelector('[data-diff-filter].active');
    return active ? active.dataset.diffFilter : 'all';
}

function getActiveCategoryFilter() {
    const active = categoryFiltersEl.querySelector('[data-cat-filter].active');
    return active ? active.dataset.catFilter : 'all';
}

function matchesFilters(file, search, cat) {
    if (cat !== 'all' && file.area !== cat) return false;
    if (!search) return true;
    return file.path.toLowerCase().includes(search) ||
           (file.description && file.description.toLowerCase().includes(search));
}

// ---------------------------------------------------------------------------
// Rendering — files are grouped by area to keep huge diffs navigable.
// ---------------------------------------------------------------------------

const RENDER_LIMIT = 500; // hard cap per group to keep the DOM manageable

function renderDiff() {
    if (!diffResult) return;
    diffResults.innerHTML = '';

    const change = getActiveChangeFilter();
    const cat = getActiveCategoryFilter();
    const search = diffSearchInput.value.trim().toLowerCase();

    const groups = []; // [{label, type, files}]

    if (change === 'all' || change === 'added') {
        groupByArea(diffResult.added.filter(f => matchesFilters(f, search, cat)))
            .forEach(g => groups.push({ ...g, type: 'added' }));
    }
    if (change === 'all' || change === 'removed') {
        groupByArea(diffResult.removed.filter(f => matchesFilters(f, search, cat)))
            .forEach(g => groups.push({ ...g, type: 'removed' }));
    }
    if (change === 'all' || change === 'modified') {
        groupByArea(diffResult.modified.filter(f => matchesFilters(f, search, cat)))
            .forEach(g => groups.push({ ...g, type: 'modified' }));
    }

    if (groups.length === 0) {
        diffResults.innerHTML = '<div class="no-tables-message">No file changes match the current filter.</div>';
        return;
    }

    groups.forEach(g => diffResults.appendChild(renderGroup(g)));
}

function groupByArea(files) {
    const map = new Map();
    files.forEach(f => {
        if (!map.has(f.area)) map.set(f.area, []);
        map.get(f.area).push(f);
    });
    return [...map.entries()].map(([area, files]) => ({ label: area, files }));
}

function renderGroup(group) {
    const typeWord = group.type === 'added' ? 'added'
                   : group.type === 'removed' ? 'removed'
                   : 'modified';
    const label = `${group.label} — ${typeWord}`;
    const stat = `${group.files.length.toLocaleString()} file${group.files.length === 1 ? '' : 's'}`;
    const card = createDiffCard(label, group.type, stat);
    const body = card.querySelector('.diff-card-body');

    // Cap initial render; offer a "show more" if necessary.
    const visible = group.files.slice(0, RENDER_LIMIT);
    visible.forEach(f => body.appendChild(renderFileRow(f, group.type)));

    if (group.files.length > RENDER_LIMIT) {
        const more = document.createElement('button');
        more.className = 'view-table-btn';
        more.textContent = `Show ${(group.files.length - RENDER_LIMIT).toLocaleString()} more`;
        more.addEventListener('click', () => {
            more.remove();
            group.files.slice(RENDER_LIMIT).forEach(f => body.appendChild(renderFileRow(f, group.type)));
        });
        body.appendChild(more);
    }
    return card;
}

function renderFileRow(file, type) {
    const row = document.createElement('div');
    row.className = `diff-item diff-item-${type}`;

    const sign = type === 'added' ? '+ ' : type === 'removed' ? '- ' : '~ ';
    const path = document.createElement('div');
    path.className = 'file-path';
    path.textContent = sign + file.path;

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    let metaText = file.description || '';
    if (type === 'modified') {
        const deltaTxt = formatDelta(file.delta);
        metaText += `${metaText ? ' · ' : ''}${formatBytes(file.oldSize)} → ${formatBytes(file.newSize)} (${deltaTxt})`;
    } else {
        metaText += `${metaText ? ' · ' : ''}${formatBytes(file.size)}`;
    }
    meta.textContent = metaText;

    row.appendChild(path);
    row.appendChild(meta);
    return row;
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

function formatBytes(n) {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDelta(delta) {
    if (delta === 0) return '±0';
    const sign = delta > 0 ? '+' : '−';
    return sign + formatBytes(Math.abs(delta));
}

window.addEventListener('DOMContentLoaded', init);
