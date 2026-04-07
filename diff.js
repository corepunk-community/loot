// Patch Diff — unified diff viewer for everything we track per game version.
//
// Five modes share this page, each with their own data shape:
//
//   loot      Object<table_name, item_names[]>          (loot_tables_v*.json)
//   quests    Object<quest_name, item_names[]>           (quest_rewards_v*.json)
//   recipes   { crafting_recipes: [], synthesis: [] }    (recipes_v*.json)
//   entities  { entities: { id: name } }                 (entity_index_v*.json)
//   files     { files: { path: [size, hash] } }          (file_manifest_v*.json)
//
// Each mode is implemented as a small ADAPTER object below: { versionKey,
// helpHtml, compute(old, new), bucketsOf(diff), render(diff, opts) }.
// The page scaffolding (version selectors, summary cards, filters) is shared.

// ---------------------------------------------------------------------------
// Shared state + DOM refs
// ---------------------------------------------------------------------------

let versions = [];
let diffResult = null;
let activeMode = 'loot';

const dataTypeSelect   = document.getElementById('diff-data-type');
const versionOldSelect = document.getElementById('version-old');
const versionNewSelect = document.getElementById('version-new');
const runDiffBtn       = document.getElementById('run-diff');
const diffLoading      = document.getElementById('diff-loading');
const diffSummary      = document.getElementById('diff-summary');
const diffFilterBar    = document.getElementById('diff-filter-bar');
const diffResults      = document.getElementById('diff-results');
const diffSearchInput  = document.getElementById('diff-search');
const clearDiffSearchBtn = document.getElementById('clear-diff-search');
const diffModeHelp     = document.getElementById('diff-mode-help');
const bucketFiltersEl  = document.getElementById('diff-bucket-filters');

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

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

// Diff two flat objects with array values, like {table_name: [item, ...]}.
// Used by loot and quests.
function diffObjectOfArrays(oldData, newData, { skipPrefix } = {}) {
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    const added = [], removed = [], modified = [];
    let unchanged = 0;

    for (const key of [...allKeys].sort()) {
        if (skipPrefix && key.startsWith(skipPrefix)) continue;
        const inOld = key in oldData;
        const inNew = key in newData;
        if (!inOld && inNew) {
            added.push({ name: key, items: newData[key] });
        } else if (inOld && !inNew) {
            removed.push({ name: key, items: oldData[key] });
        } else {
            const oldItems = new Set(oldData[key]);
            const newItems = new Set(newData[key]);
            const addedItems = [...newItems].filter(i => !oldItems.has(i)).sort();
            const removedItems = [...oldItems].filter(i => !newItems.has(i)).sort();
            if (addedItems.length || removedItems.length) {
                modified.push({
                    name: key,
                    addedItems, removedItems,
                    oldItems: [...oldData[key]].sort(),
                    newItems: [...newData[key]].sort(),
                });
            } else {
                unchanged++;
            }
        }
    }
    return { added, removed, modified, unchanged };
}

// Render an "added X items" or "removed X items" card for an entire table/quest.
function renderItemListCard(entry, type) {
    const sign = type === 'added' ? '+' : '-';
    const card = createDiffCard(entry.name, type, `${sign}${entry.items.length} items`);
    const body = card.querySelector('.diff-card-body');
    [...entry.items].sort().forEach(item => {
        const div = document.createElement('div');
        div.className = `diff-item diff-item-${type}`;
        div.textContent = `${sign} ${item}`;
        body.appendChild(div);
    });
    return card;
}

function renderModifiedItemListCard(entry) {
    const summary = `+${entry.addedItems.length} / -${entry.removedItems.length} items`;
    const card = createDiffCard(entry.name, 'modified', summary);
    const header = card.querySelector('.diff-card-header');
    const body = card.querySelector('.diff-card-body');

    const fullToggle = document.createElement('button');
    fullToggle.className = 'view-table-btn';
    fullToggle.textContent = 'Full Table';
    fullToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullItemListView(body, entry, fullToggle);
    });
    header.insertBefore(fullToggle, header.querySelector('.diff-card-chevron'));

    entry.removedItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item diff-item-removed';
        div.textContent = `- ${item}`;
        body.appendChild(div);
    });
    entry.addedItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item diff-item-added';
        div.textContent = `+ ${item}`;
        body.appendChild(div);
    });
    return card;
}

function toggleFullItemListView(body, entry, button) {
    const existing = body.querySelector('.full-table-view');
    if (existing) {
        existing.remove();
        button.textContent = 'Full Table';
        return;
    }
    button.textContent = 'Hide Full Table';

    const fullView = document.createElement('div');
    fullView.className = 'full-table-view';
    const removedSet = new Set(entry.removedItems);
    const addedSet   = new Set(entry.addedItems);

    const oldCol = document.createElement('div');
    oldCol.className = 'full-table-col';
    oldCol.innerHTML = '<h4>Old Version</h4>';
    entry.oldItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'diff-item';
        if (removedSet.has(item)) div.classList.add('diff-item-removed');
        div.textContent = item;
        oldCol.appendChild(div);
    });

    const newCol = document.createElement('div');
    newCol.className = 'full-table-col';
    newCol.innerHTML = '<h4>New Version</h4>';
    entry.newItems.forEach(item => {
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

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

const ADAPTERS = {

    // ========================================================== Loot Tables
    loot: {
        versionKey: 'file',
        searchPlaceholder: 'Search tables or items...',
        helpHtml: '',
        compute(oldData, newData) {
            return diffObjectOfArrays(oldData, newData, { skipPrefix: 'Camp Chest' });
        },
        renderItem(entry, type) {
            return type === 'modified' ? renderModifiedItemListCard(entry)
                                       : renderItemListCard(entry, type);
        },
        matches(entry, type, search) {
            if (!search) return true;
            if (entry.name.toLowerCase().includes(search)) return true;
            const items = type === 'modified'
                ? [...entry.addedItems, ...entry.removedItems]
                : entry.items;
            return items.some(i => i.toLowerCase().includes(search));
        },
    },

    // ========================================================== Quest Rewards
    quests: {
        versionKey: 'quest_rewards_file',
        searchPlaceholder: 'Search quests or items...',
        helpHtml: '',
        compute(oldData, newData) { return diffObjectOfArrays(oldData, newData); },
        renderItem(entry, type) {
            return type === 'modified' ? renderModifiedItemListCard(entry)
                                       : renderItemListCard(entry, type);
        },
        matches(entry, type, search) {
            if (!search) return true;
            if (entry.name.toLowerCase().includes(search)) return true;
            const items = type === 'modified'
                ? [...entry.addedItems, ...entry.removedItems]
                : entry.items;
            return items.some(i => i.toLowerCase().includes(search));
        },
    },

    // ========================================================== Recipes
    recipes: {
        versionKey: 'recipes_file',
        searchPlaceholder: 'Search recipe names or items...',
        helpHtml: 'Diffs both crafting recipes (Recipe_*) and synthesis blueprints (syn_*) by name. A recipe is "modified" if its referenced item list changed.',
        compute(oldData, newData) {
            // Flatten both halves into one keyed object: each recipe is keyed
            // by "<kind>:<name>" with items being the resolved entity names.
            const flatten = (d) => {
                const out = {};
                (d.crafting_recipes || []).forEach(r => {
                    out[`crafting:${r.name}`] = {
                        kind: 'crafting',
                        display: r.display_name || r.name,
                        items: r.items || [],
                    };
                });
                (d.synthesis || []).forEach(r => {
                    out[`synthesis:${r.name}`] = {
                        kind: 'synthesis',
                        display: r.display_name || r.name,
                        items: r.items || [],
                    };
                });
                return out;
            };
            const oldFlat = flatten(oldData);
            const newFlat = flatten(newData);
            const allKeys = new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]);
            const added = [], removed = [], modified = [];
            let unchanged = 0;

            for (const key of [...allKeys].sort()) {
                const inOld = key in oldFlat;
                const inNew = key in newFlat;
                if (!inOld && inNew) {
                    const r = newFlat[key];
                    added.push({ name: r.display, kind: r.kind, items: r.items });
                } else if (inOld && !inNew) {
                    const r = oldFlat[key];
                    removed.push({ name: r.display, kind: r.kind, items: r.items });
                } else {
                    const oldItems = new Set(oldFlat[key].items);
                    const newItems = new Set(newFlat[key].items);
                    const addedItems = [...newItems].filter(i => !oldItems.has(i)).sort();
                    const removedItems = [...oldItems].filter(i => !newItems.has(i)).sort();
                    if (addedItems.length || removedItems.length) {
                        modified.push({
                            name: newFlat[key].display,
                            kind: newFlat[key].kind,
                            addedItems, removedItems,
                            oldItems: [...oldFlat[key].items].sort(),
                            newItems: [...newFlat[key].items].sort(),
                        });
                    } else {
                        unchanged++;
                    }
                }
            }
            return { added, removed, modified, unchanged };
        },
        renderItem(entry, type) {
            const card = type === 'modified'
                ? renderModifiedItemListCard(entry)
                : renderItemListCard(entry, type);
            // Tag each card with its kind so the bucket filter can hide it.
            card.dataset.bucket = entry.kind;
            const header = card.querySelector('.diff-card-header');
            const tag = document.createElement('span');
            tag.className = 'diff-card-tag';
            tag.textContent = entry.kind === 'crafting' ? 'Crafting' : 'Synthesis';
            header.insertBefore(tag, header.querySelector('.diff-card-stat'));
            return card;
        },
        buckets: ['crafting', 'synthesis'],
        bucketLabels: { crafting: 'Crafting', synthesis: 'Synthesis' },
        matches(entry, type, search) {
            if (!search) return true;
            if (entry.name.toLowerCase().includes(search)) return true;
            const items = type === 'modified'
                ? [...entry.addedItems, ...entry.removedItems]
                : entry.items;
            return items.some(i => i.toLowerCase().includes(search));
        },
    },

    // ========================================================== Entities (raw)
    entities: {
        versionKey: 'entity_index_file',
        searchPlaceholder: 'Search entity names or IDs...',
        helpHtml: 'Compares the raw <code>id → name</code> records inside Entities.dat. Use this when a patch changed bytes but the loot/quest/recipe parsers showed nothing — added entities reveal what new content the dev team is wiring up. Entities are grouped by name prefix so you can spot trends (e.g. "12 new <code>syn_*</code>").',
        compute(oldData, newData) {
            const oldE = oldData.entities || {};
            const newE = newData.entities || {};
            const allIds = new Set([...Object.keys(oldE), ...Object.keys(newE)]);
            const added = [], removed = [], modified = [];
            let unchanged = 0;

            for (const id of allIds) {
                const inOld = id in oldE;
                const inNew = id in newE;
                if (!inOld && inNew) {
                    added.push({ id, name: newE[id], bucket: prefixBucket(newE[id]) });
                } else if (inOld && !inNew) {
                    removed.push({ id, name: oldE[id], bucket: prefixBucket(oldE[id]) });
                } else if (oldE[id] !== newE[id]) {
                    modified.push({
                        id,
                        oldName: oldE[id],
                        newName: newE[id],
                        bucket: prefixBucket(newE[id]),
                    });
                } else {
                    unchanged++;
                }
            }
            return { added, removed, modified, unchanged };
        },
        // Group rows by prefix bucket and render one collapsible card per bucket.
        render(diff, { changeFilter, bucketFilter, search }) {
            diffResults.innerHTML = '';
            const types = changeFilter === 'all'
                ? ['added', 'removed', 'modified']
                : [changeFilter];

            const cards = [];

            types.forEach(type => {
                const items = (diff[type] || []).filter(e => {
                    if (bucketFilter !== 'all' && e.bucket !== bucketFilter) return false;
                    if (!search) return true;
                    return e.id.toLowerCase().includes(search) ||
                           (e.name && e.name.toLowerCase().includes(search)) ||
                           (e.oldName && e.oldName.toLowerCase().includes(search)) ||
                           (e.newName && e.newName.toLowerCase().includes(search));
                });
                if (items.length === 0) return;

                const byBucket = new Map();
                items.forEach(it => {
                    if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, []);
                    byBucket.get(it.bucket).push(it);
                });

                [...byBucket.entries()]
                    .sort((a, b) => b[1].length - a[1].length)
                    .forEach(([bucket, list]) => {
                        const label = `${bucket}_*  —  ${type}`;
                        const stat = `${list.length.toLocaleString()} ${list.length === 1 ? 'entity' : 'entities'}`;
                        const card = createDiffCard(label, type, stat);
                        const body = card.querySelector('.diff-card-body');
                        list.sort((a, b) => (a.name || a.newName || '').localeCompare(b.name || b.newName || ''));
                        list.forEach(it => {
                            const row = document.createElement('div');
                            row.className = `diff-item diff-item-${type}`;
                            if (type === 'modified') {
                                row.innerHTML = `<div>~ ${it.oldName} → ${it.newName}</div><div class="file-meta">${it.id}</div>`;
                            } else {
                                const sign = type === 'added' ? '+' : '-';
                                row.innerHTML = `<div>${sign} ${it.name}</div><div class="file-meta">${it.id}</div>`;
                            }
                            body.appendChild(row);
                        });
                        cards.push(card);
                    });
            });

            if (cards.length === 0) {
                diffResults.innerHTML = '<div class="no-tables-message">No entity changes match the current filter.</div>';
                return;
            }
            cards.forEach(c => diffResults.appendChild(c));
        },
        bucketsOf(diff) {
            const set = new Set();
            ['added', 'removed', 'modified'].forEach(t => {
                (diff[t] || []).forEach(e => set.add(e.bucket));
            });
            return [...set].sort();
        },
    },

    // ========================================================== Files
    files: {
        versionKey: 'file_manifest_file',
        searchPlaceholder: 'Search file paths...',
        helpHtml: 'Compares every file under <code>Game/Content</code> by size + hash. Cards are grouped by area (Maps, Quests, Localization, Entities, World). Useful for spotting changes that don\'t live in the parsed game data.',
        compute(oldData, newData) {
            const oldFiles = oldData.files || {};
            const newFiles = newData.files || {};
            const all = new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)]);
            const added = [], removed = [], modified = [];
            let unchanged = 0;

            for (const path of all) {
                const inOld = path in oldFiles;
                const inNew = path in newFiles;
                if (!inOld && inNew) {
                    const [size] = newFiles[path];
                    added.push({ path, size, ...classifyFile(path) });
                } else if (inOld && !inNew) {
                    const [size] = oldFiles[path];
                    removed.push({ path, size, ...classifyFile(path) });
                } else {
                    const [oldSize, oldHash] = oldFiles[path];
                    const [newSize, newHash] = newFiles[path];
                    if (oldSize !== newSize || oldHash !== newHash) {
                        modified.push({
                            path,
                            oldSize, newSize,
                            delta: newSize - oldSize,
                            ...classifyFile(path),
                        });
                    } else {
                        unchanged++;
                    }
                }
            }
            return { added, removed, modified, unchanged };
        },
        render(diff, { changeFilter, bucketFilter, search }) {
            diffResults.innerHTML = '';
            const types = changeFilter === 'all'
                ? ['added', 'removed', 'modified']
                : [changeFilter];

            const cards = [];
            const RENDER_LIMIT = 500;

            types.forEach(type => {
                const items = (diff[type] || []).filter(f => {
                    if (bucketFilter !== 'all' && f.area !== bucketFilter) return false;
                    if (!search) return true;
                    return f.path.toLowerCase().includes(search) ||
                           (f.description && f.description.toLowerCase().includes(search));
                });
                if (items.length === 0) return;

                const byArea = new Map();
                items.forEach(f => {
                    if (!byArea.has(f.area)) byArea.set(f.area, []);
                    byArea.get(f.area).push(f);
                });

                [...byArea.entries()]
                    .sort((a, b) => b[1].length - a[1].length)
                    .forEach(([area, files]) => {
                        files.sort((a, b) => a.path.localeCompare(b.path));
                        const label = `${area}  —  ${type}`;
                        const stat = `${files.length.toLocaleString()} ${files.length === 1 ? 'file' : 'files'}`;
                        const card = createDiffCard(label, type, stat);
                        const body = card.querySelector('.diff-card-body');
                        const visible = files.slice(0, RENDER_LIMIT);
                        visible.forEach(f => body.appendChild(renderFileRow(f, type)));
                        if (files.length > RENDER_LIMIT) {
                            const more = document.createElement('button');
                            more.className = 'view-table-btn';
                            more.textContent = `Show ${(files.length - RENDER_LIMIT).toLocaleString()} more`;
                            more.addEventListener('click', () => {
                                more.remove();
                                files.slice(RENDER_LIMIT).forEach(f => body.appendChild(renderFileRow(f, type)));
                            });
                            body.appendChild(more);
                        }
                        cards.push(card);
                    });
            });

            if (cards.length === 0) {
                diffResults.innerHTML = '<div class="no-tables-message">No file changes match the current filter.</div>';
                return;
            }
            cards.forEach(c => diffResults.appendChild(c));
        },
        bucketsOf(diff) {
            const set = new Set();
            ['added', 'removed', 'modified'].forEach(t => {
                (diff[t] || []).forEach(f => set.add(f.area));
            });
            return [...set].sort();
        },
    },
};

// ---------------------------------------------------------------------------
// Entity-prefix bucket helper
// ---------------------------------------------------------------------------

function prefixBucket(name) {
    if (!name) return 'other';
    const m = name.match(/^([A-Za-z][A-Za-z0-9]*?)(?:_|$)/);
    if (!m) return 'other';
    return m[1].toLowerCase();
}

// ---------------------------------------------------------------------------
// File classification (moved from files.js)
// ---------------------------------------------------------------------------

const EXT_DESCRIPTIONS = {
    xml: 'XML data', json: 'JSON data', dat: 'Binary data',
    conf: 'Configuration', ini: 'Configuration', txt: 'Text', md: 'Markdown',
    manifest: 'Asset bundle manifest', bundle: 'Asset bundle',
    map: 'Map definition', bm: 'Bookmark',
    aib: 'AI behavior tree', aiPaths: 'AI navigation paths',
    questConnection: 'Quest map placement',
    _mapa: 'Map area / terrain tile', _sft: 'Map static foliage tile',
    _sg: 'Map scene graph chunk', _tns: 'Map navmesh segment',
    _cmp: 'Map compressed chunk', _cmpg: 'Map compressed group',
    _cmpm: 'Map compressed metadata', _crbin: 'Map compiled binary chunk',
    _fowmba: 'Fog-of-war block area', ___fowmba: 'Fog-of-war block area',
    _fowmw: 'Fog-of-war map width data', _fowos: 'Fog-of-war overlay',
    __fowm: 'Fog-of-war map data', __deca: 'Map decal data',
    _dec: 'Map decoration data', _ip: 'Instance placement data',
    __u: 'Map utility chunk', _ru: 'Map render unit', __ru: 'Map render unit',
    _scs: 'Scene script chunk', _genObjects: 'Generated object placements',
    zoc: 'Zone collision data',
};

function fileExtension(path) {
    const base = path.split('/').pop();
    const dot = base.lastIndexOf('.');
    return dot < 0 ? '' : base.substring(dot + 1);
}

function classifyFile(path) {
    const parts = path.split('/');
    const top = parts[0] || '', sub = parts[1] || '';
    const leaf = parts[parts.length - 1];
    const ext = fileExtension(path);
    const extDesc = EXT_DESCRIPTIONS[ext] || EXT_DESCRIPTIONS['_' + ext] || null;

    if (top === 'World' && sub === 'Maps') {
        const mapName = parts[2] || '(unknown map)';
        if (parts[3] === 'questConnection') {
            const qname = leaf.replace(/\.questConnection$/, '');
            return { area: 'Maps', description: `Quest placement for "${qname}" on map ${mapName}` };
        }
        if (parts[3] === 'Minimap') return { area: 'Maps', description: `Minimap asset for ${mapName}` };
        if (ext === 'aiPaths') return { area: 'Maps', description: `AI navigation paths for ${mapName}` };
        return { area: 'Maps', description: `${extDesc || `Map data (.${ext})`} — ${mapName}` };
    }
    if (top === 'World' && sub === 'Quests') {
        const slug = parts[2] || '';
        const pretty = slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (slug === 'QuestTemplates') return { area: 'Quests', description: `Quest template: ${leaf}` };
        if (slug === 'VoiceRequests') return { area: 'Quests', description: `Voice request: ${leaf}` };
        if (slug === 'Drafts') return { area: 'Quests', description: `Quest draft: ${leaf}` };
        if (slug.startsWith('Info_')) return { area: 'Quests', description: `NPC info: ${slug.replace(/^Info_/, '')}` };
        return { area: 'Quests', description: `${extDesc || `Quest file (.${ext})`} — ${pretty || slug}` };
    }
    if (top === 'World' && sub === 'AI') {
        return { area: 'AI', description: ext === 'aib' ? `AI behavior tree: ${leaf.replace(/\.aib$/, '')}` : (extDesc || `AI file (.${ext})`) };
    }
    if (top === 'World' && sub === 'Bookmarks') return { area: 'World', description: `Bookmark: ${leaf}` };
    if (top === 'World') return { area: 'World', description: extDesc ? `${extDesc}: ${leaf}` : leaf };
    if (top === 'Localization') {
        if (parts.length === 2) return { area: 'Localization', description: `Localization root: ${leaf}` };
        return { area: 'Localization', description: `${sub} — ${leaf.replace(/\.xml$/, '')}` };
    }
    if (top === 'Entities') {
        if (leaf === 'Entities.dat') return { area: 'Entities', description: 'Game entity database (loot tables, items, NPCs, quests…)' };
        if (leaf === 'ViewModelsDatabase.json') return { area: 'Entities', description: 'Quest / view-model database' };
        return { area: 'Entities', description: extDesc ? `${extDesc}: ${leaf}` : leaf };
    }
    return { area: 'Other', description: `${extDesc || (ext ? `.${ext} file` : 'File')} (${parts.slice(0, -1).join('/') || 'root'})` };
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
        metaText += `${metaText ? ' · ' : ''}${formatBytes(file.oldSize)} → ${formatBytes(file.newSize)} (${formatDelta(file.delta)})`;
    } else {
        metaText += `${metaText ? ' · ' : ''}${formatBytes(file.size)}`;
    }
    meta.textContent = metaText;
    row.appendChild(path);
    row.appendChild(meta);
    return row;
}

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------

async function init() {
    try {
        const res = await fetch('versions.json');
        if (!res.ok) throw new Error('Failed to load versions.json');
        versions = await res.json();
        populateDropdowns();
        setupEventListeners();
        applyModeChrome();
    } catch (err) {
        console.error('Init failed', err);
        diffResults.innerHTML = '<div class="error-message">Failed to load version manifest.</div>';
    }
}

function getAdapter() { return ADAPTERS[activeMode]; }

function getAvailableVersions() {
    const key = getAdapter().versionKey;
    return versions.filter(v => v[key]);
}

function populateDropdowns() {
    versionOldSelect.innerHTML = '';
    versionNewSelect.innerHTML = '';
    const available = getAvailableVersions();
    const key = getAdapter().versionKey;

    if (available.length === 0) {
        runDiffBtn.disabled = true;
        diffResults.innerHTML = `<div class="error-message">No data available for this mode yet. Run the corresponding parser for at least two versions.</div>`;
        diffSummary.classList.add('hidden');
        diffFilterBar.classList.add('hidden');
        return;
    }
    runDiffBtn.disabled = false;

    available.forEach(v => {
        versionOldSelect.add(new Option(`v${v.version}`, v[key]));
        versionNewSelect.add(new Option(`v${v.version}`, v[key]));
    });
    if (available.length >= 2) {
        versionOldSelect.selectedIndex = available.length - 2;
        versionNewSelect.selectedIndex = available.length - 1;
    }

    diffResult = null;
    diffResults.innerHTML = '';
    diffSummary.classList.add('hidden');
    diffFilterBar.classList.add('hidden');
}

function applyModeChrome() {
    const adapter = getAdapter();
    diffSearchInput.placeholder = adapter.searchPlaceholder || 'Search...';
    diffModeHelp.innerHTML = adapter.helpHtml ? `<p>${adapter.helpHtml}</p>` : '';
    diffModeHelp.classList.toggle('hidden', !adapter.helpHtml);
}

function setupEventListeners() {
    runDiffBtn.addEventListener('click', runDiff);
    dataTypeSelect.addEventListener('change', () => {
        activeMode = dataTypeSelect.value;
        applyModeChrome();
        populateDropdowns();
    });

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
    const r = await fetch(file);
    if (!r.ok) throw new Error(`Failed to load ${file}`);
    return r.json();
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
        const [oldData, newData] = await Promise.all([fetchVersion(oldFile), fetchVersion(newFile)]);
        diffResult = getAdapter().compute(oldData, newData);
        updateSummary();
        rebuildBucketFilters();
        renderDiff();
    } catch (err) {
        diffResults.innerHTML = `<div class="error-message">Error: ${err.message}</div>`;
    } finally {
        diffLoading.classList.add('hidden');
    }
}

function updateSummary() {
    document.getElementById('count-added').textContent     = (diffResult.added.length || 0).toLocaleString();
    document.getElementById('count-removed').textContent   = (diffResult.removed.length || 0).toLocaleString();
    document.getElementById('count-modified').textContent  = (diffResult.modified.length || 0).toLocaleString();
    document.getElementById('count-unchanged').textContent = (diffResult.unchanged || 0).toLocaleString();
    diffSummary.classList.remove('hidden');
    diffFilterBar.classList.remove('hidden');
}

function rebuildBucketFilters() {
    bucketFiltersEl.innerHTML = '';
    const adapter = getAdapter();

    let buckets = [];
    if (typeof adapter.bucketsOf === 'function') {
        buckets = adapter.bucketsOf(diffResult);
    } else if (Array.isArray(adapter.buckets)) {
        buckets = adapter.buckets;
    }
    if (buckets.length === 0) return;

    const all = document.createElement('button');
    all.className = 'filter-btn active';
    all.dataset.bucketFilter = 'all';
    all.textContent = 'All';
    bucketFiltersEl.appendChild(all);

    buckets.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.bucketFilter = b;
        btn.textContent = (adapter.bucketLabels && adapter.bucketLabels[b]) || b;
        bucketFiltersEl.appendChild(btn);
    });
    bucketFiltersEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            bucketFiltersEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDiff();
        });
    });
}

function getActiveChangeFilter() {
    const a = diffFilterBar.querySelector('[data-diff-filter].active');
    return a ? a.dataset.diffFilter : 'all';
}

function getActiveBucketFilter() {
    const a = bucketFiltersEl.querySelector('[data-bucket-filter].active');
    return a ? a.dataset.bucketFilter : 'all';
}

function renderDiff() {
    if (!diffResult) return;
    const adapter = getAdapter();
    const changeFilter = getActiveChangeFilter();
    const bucketFilter = getActiveBucketFilter();
    const search = diffSearchInput.value.trim().toLowerCase();

    // Adapters with their own renderer (entities, files) take over completely.
    if (typeof adapter.render === 'function') {
        adapter.render(diffResult, { changeFilter, bucketFilter, search });
        return;
    }

    // Default rendering: per-entry cards from renderItem(), filtered.
    diffResults.innerHTML = '';
    const types = changeFilter === 'all' ? ['added', 'removed', 'modified'] : [changeFilter];

    types.forEach(type => {
        (diffResult[type] || [])
            .filter(entry => {
                if (bucketFilter !== 'all' && entry.kind && entry.kind !== bucketFilter) return false;
                return adapter.matches ? adapter.matches(entry, type, search) : true;
            })
            .forEach(entry => diffResults.appendChild(adapter.renderItem(entry, type)));
    });

    if (diffResults.children.length === 0) {
        diffResults.innerHTML = '<div class="no-tables-message">No changes match the current filter.</div>';
    }
}

window.addEventListener('DOMContentLoaded', init);
