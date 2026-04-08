// Global variables
let lootTables = {};               // table name → items[] (lazy-populated)
let lootIndex = null;              // { version, chunks, tables: { name → chunkKey } }
let chunkBaseDir = "";             // url prefix for chunk files (set per version)
const chunkCache = {};             // chunkKey → fetched chunk JSON
const chunkPromises = {};          // chunkKey → in-flight fetch promise
let currentTable = null;
let secondTable = null;
let compareMode = false;
let globalSearchActive = false;
let currentCategoryFilter = "all";
// "all" or a 0-indexed rarity tier; filters items in the currently-shown
// table to only that tier. Items with no rarity field always pass through.
let currentRarityFilter = 'all';

// DOM elements
const tablesList = document.getElementById('tables-list');
const itemsList = document.getElementById('items-list');
const selectedTableHeading = document.getElementById('selected-table');
const tableSearchInput = document.getElementById('table-search');
const itemSearchInput = document.getElementById('item-search');
const clearTableSearchBtn = document.getElementById('clear-table-search');
const clearItemSearchBtn = document.getElementById('clear-item-search');

// Tables selection for comparison
const tablesSelectionView = document.getElementById('tables-selection-view');
const compareTablesList = document.getElementById('compare-tables-list');
const compareTableSearchInput = document.getElementById('compare-table-search');
const clearCompareTableSearchBtn = document.getElementById('clear-compare-table-search');

// Comparison elements
const table1ItemSearch = document.getElementById('table1-item-search');
const table2ItemSearch = document.getElementById('table2-item-search');
const clearTable1SearchBtn = document.getElementById('clear-table1-search');
const clearTable2SearchBtn = document.getElementById('clear-table2-search');

// Global search elements
const globalItemSearchInput = document.getElementById('global-item-search');
const clearGlobalSearchBtn = document.getElementById('clear-global-search');
const toggleGlobalSearchBtn = document.getElementById('toggle-global-search');
const globalSearchView = document.getElementById('global-search-view');
const globalResults = document.getElementById('global-results');
const searchTermDisplay = document.getElementById('search-term-display');

// Compare view elements
const compareToggleBtn = document.getElementById('compare-mode-toggle');
const exitCompareBtn = document.getElementById('exit-compare');
const normalView = document.getElementById('normal-view');
const compareView = document.getElementById('compare-view');
const comparisonInfo = document.getElementById('comparison-info');
const table1Heading = document.getElementById('table1-heading');
const table2Heading = document.getElementById('table2-heading');
const table1Name = document.getElementById('table1-name');
const table2Name = document.getElementById('table2-name');
const table1Items = document.getElementById('table1-items');
const table2Items = document.getElementById('table2-items');

// Category filter elements
const filterButtons = document.querySelectorAll('.filter-btn');

// Fetch loot tables index. The full data is split into per-category chunks
// to keep page load fast; we only fetch a chunk when the user opens a table
// in it (or when global search needs everything). The index maps every
// table name to its chunk so we can build the table list immediately.
async function fetchLootTables() {
    try {
        const versionsResponse = await fetch('versions.json');
        if (!versionsResponse.ok) throw new Error('Failed to load versions manifest');
        const versions = await versionsResponse.json();
        const latestVersion = versions[versions.length - 1];

        const response = await fetch(latestVersion.file);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();

        if (data && data.chunks && data.tables) {
            // New chunked format: { version, chunks, tables: { name → chunkKey } }
            lootIndex = data;
            chunkBaseDir = '';
            // Filter out Camp Chest entries (no longer dropping loot) at the
            // index level so they don't appear in the table list at all.
            lootIndex.tables = Object.fromEntries(
                Object.entries(lootIndex.tables).filter(([k]) => !k.startsWith('Camp Chest'))
            );
            // lootTables starts empty — items get hydrated on demand.
            lootTables = {};
        } else {
            // Legacy flat format: { tableName: [item, item, ...] }
            lootIndex = null;
            lootTables = Object.fromEntries(
                Object.entries(data).filter(([k]) => !k.startsWith('Camp Chest'))
            );
        }

        populateTablesList();
    } catch (error) {
        console.error('Error fetching loot tables:', error);
        showError('Failed to load loot tables data. Please try again later.');
    }
}

// Fetch a single chunk file and merge its tables into `lootTables`. Returns
// a promise that resolves when the chunk is loaded. Multiple callers asking
// for the same chunk share one in-flight request.
function loadChunk(chunkKey) {
    if (!lootIndex) return Promise.resolve();
    if (chunkCache[chunkKey]) return Promise.resolve();
    if (chunkPromises[chunkKey]) return chunkPromises[chunkKey];
    const meta = lootIndex.chunks[chunkKey];
    if (!meta) return Promise.resolve();
    const url = chunkBaseDir + meta.file;
    chunkPromises[chunkKey] = fetch(url)
        .then(r => {
            if (!r.ok) throw new Error(`Failed to fetch chunk ${chunkKey}: ${r.status}`);
            return r.json();
        })
        .then(json => {
            chunkCache[chunkKey] = json;
            Object.assign(lootTables, json);
        })
        .catch(err => {
            console.error(`Error loading chunk ${chunkKey}:`, err);
            delete chunkPromises[chunkKey];
            throw err;
        });
    return chunkPromises[chunkKey];
}

// Ensure a single table is loaded (loads its chunk if needed).
async function ensureTableLoaded(tableName) {
    if (lootTables[tableName]) return;
    if (!lootIndex) return;
    const chunkKey = lootIndex.tables[tableName];
    if (!chunkKey) return;
    await loadChunk(chunkKey);
}

// Load every chunk. Used by global search. Returns a promise that resolves
// once all chunks are merged into lootTables.
async function loadAllChunks() {
    if (!lootIndex) return;
    const keys = Object.keys(lootIndex.chunks);
    await Promise.all(keys.map(k => loadChunk(k)));
}

// Render an item entry. Items are objects of shape:
//   { name, qty_min, qty_max, weight, chance, rarity, group, group_chance }
// as of v0.103. The `chance` field is now a computed *real* drop probability
// (group_chance × weight / sum_of_group_weights), not a raw weight. Older
// format files used plain strings, so we still handle that for backwards
// compat.
function itemDisplayName(item) {
    if (typeof item === 'string') return item;
    return item.name || '';
}

function formatQtyRange(item) {
    if (typeof item === 'string') return '';
    if (item.qty_min == null) return '';
    if (item.qty_min === item.qty_max) return `${item.qty_min}× `;
    return `${item.qty_min}–${item.qty_max}× `;
}

// Format a probability for display. Drop chances span ~9 orders of magnitude
// (from <0.0001% T3 Epic upgrade kits to 100% guaranteed coins) so we adapt
// the precision. For sub-0.0001% values we drop into scientific notation
// rather than showing "0.0000%", which the user correctly pointed out hides
// the fact that the item CAN drop, just very rarely.
function formatPct(p) {
    if (p == null || p === 0) return '0%';
    const pct = p * 100;
    if (pct >= 100) return '100%';
    if (pct >= 10)  return `${pct.toFixed(0)}%`;
    if (pct >= 1)   return `${pct.toFixed(1)}%`;
    if (pct >= 0.1) return `${pct.toFixed(2)}%`;
    if (pct >= 0.01) return `${pct.toFixed(3)}%`;
    if (pct >= 0.0001) return `${pct.toFixed(5)}%`;
    // Below 0.0001% switch to scientific notation so the magnitude is visible.
    return `${pct.toExponential(1)}%`;
}

function formatChance(item) {
    if (typeof item === 'string' || item.chance == null) return '';
    return ` (${formatPct(item.chance)})`;
}

// The rarity field is a 0-indexed quality tier. Across the full v0.103 data
// it only ever takes values 0–3, which matches the four standard Corepunk
// quality colors. (PvE arena / Prison Island tables technically use the
// same field for a 1–3 level-tier axis, but we don't have a way to tell
// the two interpretations apart, so we always show colors.)
const RARITY_NAMES   = ['Common', 'Uncommon', 'Rare', 'Epic'];
const RARITY_SHORT   = ['C', 'U', 'R', 'E'];

function rarityLabel(item) {
    if (typeof item === 'string' || item.rarity == null) return null;
    return RARITY_NAMES[item.rarity] || `T${item.rarity}`;
}

function rarityShort(item) {
    if (typeof item === 'string' || item.rarity == null) return null;
    return RARITY_SHORT[item.rarity] || `${item.rarity}`;
}

// Build the formatted display string for an item entry: "1–3× Item (50%)".
function formatItemEntry(item) {
    if (typeof item === 'string') return item;
    return `${formatQtyRange(item)}${item.name}${formatChance(item)}`;
}

// Returns a stable comparison key for ordering items in display: name first,
// then qty range, then chance descending.
function itemSortKey(item) {
    if (typeof item === 'string') return [item, 0, 0, 0];
    return [item.name || '', item.qty_min || 0, item.qty_max || 0, -(item.chance || 0)];
}

// Tables list helper: returns the list of table names (sorted alphabetically),
// preferring the index when available so the list is built before any items
// are fetched.
function allTableNames() {
    if (lootIndex) return Object.keys(lootIndex.tables);
    return Object.keys(lootTables);
}

// Returns the items array for a table, or empty array if not loaded yet.
function getTableItems(tableName) {
    return lootTables[tableName] || [];
}

// Determine category based on table name
function getTableCategory(tableName) {
    const lowerName = tableName.toLowerCase();
    
    if (lowerName.includes('camp chest')) return 'camp chest';
    if (lowerName.includes('creeps')) return 'creeps';
    if (lowerName.includes('destroyable')) return 'destroyable';
    if (lowerName.includes('dungeon boss')) return 'dungeon boss';
    if (lowerName.includes('gathering')) return 'gathering';
    if (lowerName.includes('monster')) return 'monster';
    if (lowerName.includes('poi chest')) return 'poi chest';
    if (lowerName.includes('reactive')) return 'reactive';
    if (lowerName.includes('searchable')) return 'searchable';
    
    return 'other';
}

// Apply category and search filters
function applyFilters() {
    const searchTerm = tableSearchInput.value.trim().toLowerCase();
    
    // Get all table elements
    const tableItems = document.querySelectorAll('#tables-list li');
    
    let visibleCount = 0;
    
    tableItems.forEach(item => {
        const tableName = item.textContent;
        const category = getTableCategory(tableName);
        const matchesCategory = currentCategoryFilter === 'all' || category === currentCategoryFilter;
        const matchesSearch = !searchTerm || tableName.toLowerCase().includes(searchTerm);
        
        // Show/hide based on both filters
        if (matchesCategory && matchesSearch) {
            item.classList.remove('hidden-table');
            visibleCount++;
        } else {
            item.classList.add('hidden-table');
        }
    });
    
    // Check if no tables are visible and show a message if needed
    if (visibleCount === 0) {
        let noResultsMsg = document.getElementById('no-results-msg');
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('li');
            noResultsMsg.id = 'no-results-msg';
            noResultsMsg.textContent = 'No matching tables found';
            noResultsMsg.style.cursor = 'default';
            noResultsMsg.classList.add('no-tables-message');
            tablesList.appendChild(noResultsMsg);
        }
    } else {
        const noResultsMsg = document.getElementById('no-results-msg');
        if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }
}

// Apply filters for comparison table list
function applyCompareFilters() {
    const searchTerm = compareTableSearchInput.value.trim().toLowerCase();
    
    // Get all table elements
    const tableItems = document.querySelectorAll('#compare-tables-list li');
    
    let visibleCount = 0;
    
    tableItems.forEach(item => {
        const tableName = item.textContent;
        const matchesSearch = !searchTerm || tableName.toLowerCase().includes(searchTerm);
        
        // Show/hide based on search term
        if (matchesSearch) {
            item.classList.remove('hidden-table');
            visibleCount++;
        } else {
            item.classList.add('hidden-table');
        }
    });
    
    // Check if no tables are visible and show a message if needed
    if (visibleCount === 0) {
        let noResultsMsg = document.getElementById('compare-no-results-msg');
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('li');
            noResultsMsg.id = 'compare-no-results-msg';
            noResultsMsg.textContent = 'No matching tables found';
            noResultsMsg.style.cursor = 'default';
            noResultsMsg.classList.add('no-tables-message');
            compareTablesList.appendChild(noResultsMsg);
        }
    } else {
        const noResultsMsg = document.getElementById('compare-no-results-msg');
        if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }
}

// Populate tables list
function populateTablesList() {
    tablesList.innerHTML = '';

    // Sort table names alphabetically
    const sortedTableNames = allTableNames().sort();
    
    sortedTableNames.forEach(tableName => {
        const li = document.createElement('li');
        li.textContent = tableName;
        li.dataset.table = tableName;
        li.dataset.category = getTableCategory(tableName);
        
        // Add class if this is one of the selected tables
        if (tableName === currentTable) {
            li.classList.add('active');
        } else if (tableName === secondTable) {
            li.classList.add('active-second');
        }
        
        // Apply current filters
        const category = getTableCategory(tableName);
        if (currentCategoryFilter !== 'all' && category !== currentCategoryFilter) {
            li.classList.add('hidden-table');
        }
        
        li.addEventListener('click', () => {
            // Always handle as normal table selection in this view
            // Remove active class from all list items
            document.querySelectorAll('#tables-list li').forEach(item => {
                item.classList.remove('active');
            });
            
            // Add active class to clicked item
            li.classList.add('active');
            
            // Display items for this table
            displayTableItems(tableName);
        });
        
        tablesList.appendChild(li);
    });
    
    // Apply search filter if there's already a term
    if (tableSearchInput.value.trim()) {
        applyFilters();
    }
}

// Populate tables list for comparison mode
function populateCompareTablesList() {
    compareTablesList.innerHTML = '';

    // Sort table names alphabetically
    const sortedTableNames = allTableNames().sort();
    
    sortedTableNames.forEach(tableName => {
        const li = document.createElement('li');
        li.textContent = tableName;
        li.dataset.table = tableName;
        
        // Add class if this is one of the selected tables
        if (tableName === currentTable) {
            li.classList.add('active');
        } else if (tableName === secondTable) {
            li.classList.add('active-second');
        }
        
        li.addEventListener('click', () => {
            handleCompareTableSelection(tableName);
        });
        
        compareTablesList.appendChild(li);
    });
    
    // Apply search filter if there's already a term
    if (compareTableSearchInput.value.trim()) {
        applyCompareFilters();
    }
}

// Handle table selection in compare mode
function handleCompareTableSelection(tableName) {
    // If no primary table selected yet
    if (!currentTable) {
        currentTable = tableName;
        
        // Update the UI
        updateTableSelectionUI();
        
        // If we now have both tables, move to compare view
        if (currentTable && secondTable) {
            showCompareView();
        }
        return;
    }
    
    // If primary table is selected but no secondary
    if (!secondTable) {
        // Don't allow selecting the same table twice
        if (tableName === currentTable) {
            return;
        }
        
        secondTable = tableName;
        
        // Update the UI
        updateTableSelectionUI();
        
        // Now we have both tables, move to compare view
        showCompareView();
        return;
    }
    
    // If both tables are already selected, allow changing second table
    if (tableName !== currentTable) {
        secondTable = tableName;
        updateTableSelectionUI();
        displayCompareTables();
    }
}

// Show the compare view with both tables
function showCompareView() {
    // Hide tables selection view
    tablesSelectionView.classList.add('hidden');
    
    // Show compare view
    compareView.classList.remove('hidden');
    
    // Update button text
    compareToggleBtn.textContent = 'Compare Mode';
    
    // Show comparison info
    comparisonInfo.classList.remove('hidden');
    
    // Display the tables comparison
    displayCompareTables();
}

// Update the UI to reflect current table selections
function updateTableSelectionUI() {
    // Update selection list highlighting
    document.querySelectorAll('#compare-tables-list li').forEach(item => {
        item.classList.remove('active', 'active-second');
        
        const tableName = item.dataset.table;
        if (tableName === currentTable) {
            item.classList.add('active');
        } else if (tableName === secondTable) {
            item.classList.add('active-second');
        }
    });
    
    // Update comparison info section
    if (currentTable) {
        table1Name.textContent = currentTable;
        table1Heading.textContent = currentTable;
    }
    
    if (secondTable) {
        table2Name.textContent = secondTable;
        table2Heading.textContent = secondTable;
    } else {
        table2Heading.textContent = 'Select second table';
    }
    
    // Clear comparison search inputs
    table1ItemSearch.value = '';
    table2ItemSearch.value = '';
}

// Build a single item-row element. Used by filterItems and the compare
// view. Includes a rarity color badge when the item carries a rarity field.
function buildItemRow(item) {
    const li = document.createElement('li');
    li.textContent = formatItemEntry(item);

    if (typeof item === 'object') {
        const label = rarityLabel(item);
        if (label) {
            const badge = document.createElement('span');
            badge.className = `rarity-badge rarity-${item.rarity}`;
            badge.textContent = rarityShort(item);
            badge.title = label;
            li.prepend(badge);
        }
        if (item.group) {
            li.dataset.group = item.group;
            li.title = `Group: ${item.group}` +
                (item.group_chance != null
                    ? ` · group roll ${formatPct(Math.min(item.group_chance, 1))}`
                    : '') +
                (item.weight != null ? ` · weight ${item.weight}` : '');
        }
    }
    return li;
}

// Build the group section header row.
function buildGroupHeader(group, groupChance, count) {
    const header = document.createElement('li');
    header.className = 'loot-group-header';
    const left = document.createElement('span');
    left.className = 'loot-group-name';
    left.textContent = group;
    const right = document.createElement('span');
    right.className = 'loot-group-meta';
    let metaParts = [];
    if (groupChance != null) {
        metaParts.push(groupChance > 1
            ? `${groupChance.toFixed(2)}× draws`
            : `${formatPct(groupChance)} group roll`);
    }
    metaParts.push(`${count} ${count === 1 ? 'item' : 'items'}`);
    right.textContent = metaParts.join(' · ');
    header.appendChild(left);
    header.appendChild(right);
    return header;
}

// Filter items in a list based on search term + active rarity filter.
// Items with the new structured shape (`{ name, qty_min, qty_max, weight,
// chance, rarity, group, group_chance }`) are organized into per-group
// sections; legacy plain-string items still render as a flat list.
function filterItems(items, searchTerm, containerElement) {
    containerElement.innerHTML = '';

    if (!items || items.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items in this loot table';
        containerElement.appendChild(li);
        return;
    }

    const term = (searchTerm || '').toLowerCase();
    const rarity = currentRarityFilter;

    // Apply search + rarity filter first.
    const matched = items.filter(item => {
        const display = itemDisplayName(item);
        if (term && !display.toLowerCase().includes(term)) return false;
        if (rarity !== 'all' && typeof item === 'object' && item.rarity != null) {
            if (item.rarity !== rarity) return false;
        }
        return true;
    });

    if (matched.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No matching items found';
        li.classList.add('no-items-message');
        containerElement.appendChild(li);
        return;
    }

    // Group by `group` field if items have one. Falls back to a single
    // unnamed bucket for legacy string items.
    const groups = new Map();
    matched.forEach(item => {
        const key = (typeof item === 'object' && item.group) || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    });

    // Sort groups by their highest group_chance descending (most likely
    // groups first), then alphabetically as a tiebreaker.
    const sortedGroups = [...groups.entries()].sort((a, b) => {
        const ga = a[1][0]?.group_chance ?? -1;
        const gb = b[1][0]?.group_chance ?? -1;
        if (gb !== ga) return gb - ga;
        return a[0].localeCompare(b[0]);
    });

    sortedGroups.forEach(([groupName, groupItems]) => {
        if (groupName) {
            containerElement.appendChild(
                buildGroupHeader(groupName, groupItems[0]?.group_chance, groupItems.length)
            );
        }
        // Within a group, sort by chance desc, then name.
        groupItems.sort((a, b) => {
            const ca = (typeof a === 'object' && a.chance) || 0;
            const cb = (typeof b === 'object' && b.chance) || 0;
            if (cb !== ca) return cb - ca;
            return itemDisplayName(a).localeCompare(itemDisplayName(b));
        });
        groupItems.forEach(item => containerElement.appendChild(buildItemRow(item)));
    });
}

// Recompute the list of rarity tiers present in the current table and
// rebuild the rarity filter button bar accordingly. Called whenever a new
// table is selected.
function rebuildRarityFilter(tableName) {
    const bar = document.getElementById('rarity-filters');
    if (!bar) return;
    const items = getTableItems(tableName);
    const tiers = new Set();
    items.forEach(i => {
        if (typeof i === 'object' && i.rarity != null) tiers.add(i.rarity);
    });

    bar.innerHTML = '';
    if (tiers.size <= 1) {
        bar.classList.add('hidden');
        currentRarityFilter = 'all';
        return;
    }
    bar.classList.remove('hidden');

    const mkBtn = (label, value) => {
        const b = document.createElement('button');
        b.className = 'rarity-btn';
        if (value === currentRarityFilter) b.classList.add('active');
        b.textContent = label;
        b.dataset.tier = value;
        b.addEventListener('click', () => {
            currentRarityFilter = value;
            bar.querySelectorAll('.rarity-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            if (currentTable) displayTableItems(currentTable, itemSearchInput.value.trim());
        });
        return b;
    };

    bar.appendChild(mkBtn('All Rarities', 'all'));
    [...tiers].sort((a, b) => a - b).forEach(t => {
        bar.appendChild(mkBtn(RARITY_NAMES[t] || `Tier ${t}`, t));
    });
}

// Display items for a specific table. Loads the table's chunk if needed.
async function displayTableItems(tableName, searchTerm = '') {
    const previousTable = currentTable;
    currentTable = tableName;
    selectedTableHeading.textContent = tableName;

    if (lootIndex && !lootTables[tableName]) {
        itemsList.innerHTML = '';
        const li = document.createElement('li');
        li.textContent = 'Loading items…';
        li.classList.add('no-items-message');
        itemsList.appendChild(li);
        try {
            await ensureTableLoaded(tableName);
        } catch (e) {
            itemsList.innerHTML = '';
            const err = document.createElement('li');
            err.textContent = 'Failed to load items for this table';
            err.classList.add('no-items-message');
            itemsList.appendChild(err);
            return;
        }
        // If the user has clicked another table since we started loading,
        // bail out so we don't overwrite the newer view.
        if (currentTable !== tableName) return;
    }

    // Rebuild the rarity filter when switching tables (different tables
    // expose different rarity tiers). Reset the filter to "all" so a
    // narrowing choice from the previous table doesn't hide everything.
    if (previousTable !== tableName) {
        currentRarityFilter = 'all';
        rebuildRarityFilter(tableName);
    }

    filterItems(getTableItems(tableName), searchTerm, itemsList);
}

// Display comparison between two tables. Both tables' chunks are loaded
// (in parallel) before rendering so the diff highlighting is accurate.
async function displayCompareTables() {
    if (!currentTable) return;

    // Show a loading indicator while we fetch any missing chunks.
    table1Items.innerHTML = '';
    table2Items.innerHTML = '';
    if (lootIndex && (!lootTables[currentTable] || (secondTable && !lootTables[secondTable]))) {
        const placeholder = (parent, msg) => {
            const li = document.createElement('li');
            li.textContent = msg;
            li.classList.add('no-items-message');
            parent.appendChild(li);
        };
        placeholder(table1Items, 'Loading items…');
        if (secondTable) placeholder(table2Items, 'Loading items…');
        try {
            await Promise.all([
                ensureTableLoaded(currentTable),
                secondTable ? ensureTableLoaded(secondTable) : Promise.resolve(),
            ]);
        } catch (e) {
            // Fall through to render whatever we have.
        }
        table1Items.innerHTML = '';
        table2Items.innerHTML = '';
    }

    const items1 = getTableItems(currentTable);
    const items2 = secondTable ? getTableItems(secondTable) : [];

    // Compare by display name only — qty/chance differences within the same
    // item still show up in both lists, but the "unique" highlight is about
    // which items appear in one table but not the other.
    const namesIn = list => new Set(list.map(itemDisplayName));
    const names2 = namesIn(items2);
    const names1 = namesIn(items1);
    const isUnique1 = item => secondTable && !names2.has(itemDisplayName(item));
    const isUnique2 = item => !names1.has(itemDisplayName(item));

    const renderInto = (parent, items, searchTerm, uniquePred, emptyMsg) => {
        if (items.length === 0) {
            const li = document.createElement('li');
            li.textContent = emptyMsg;
            li.classList.add('no-items-message');
            parent.appendChild(li);
            return;
        }
        const sorted = [...items].sort((a, b) => {
            const ca = (typeof a === 'object' && a.chance) || 0;
            const cb = (typeof b === 'object' && b.chance) || 0;
            if (cb !== ca) return cb - ca;
            return itemDisplayName(a).localeCompare(itemDisplayName(b));
        });
        const term = (searchTerm || '').toLowerCase();
        let found = 0;
        sorted.forEach(item => {
            const display = itemDisplayName(item);
            if (term && !display.toLowerCase().includes(term)) return;
            found++;
            const li = buildItemRow(item);
            if (uniquePred(item)) li.classList.add('unique-item');
            parent.appendChild(li);
        });
        if (found === 0) {
            const li = document.createElement('li');
            li.textContent = 'No matching items found';
            li.classList.add('no-items-message');
            parent.appendChild(li);
        }
    };

    renderInto(table1Items, items1, table1ItemSearch.value.trim(), isUnique1, 'No items in this loot table');
    if (!secondTable) {
        const li = document.createElement('li');
        li.textContent = 'Please select a second table for comparison';
        li.classList.add('no-items-message');
        table2Items.appendChild(li);
    } else {
        renderInto(table2Items, items2, table2ItemSearch.value.trim(), isUnique2, 'No items in this loot table');
    }
}

// Global search across all loot tables. With the chunked format we have to
// fetch every chunk before we can search them; we do that on the first
// global search and let the chunkCache hang on to results.
async function performGlobalSearch(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        return;
    }

    searchTerm = searchTerm.trim().toLowerCase();
    searchTermDisplay.textContent = `"${searchTerm}"`;
    globalResults.innerHTML = '<div class="no-results">Searching…</div>';

    if (lootIndex) {
        try {
            await loadAllChunks();
        } catch (e) {
            globalResults.innerHTML = '<div class="no-results">Failed to load loot data</div>';
            return;
        }
    }

    globalResults.innerHTML = '';

    // Find all tables containing the search term in their items
    const matchingTables = {};

    Object.entries(lootTables).forEach(([tableName, items]) => {
        const matchingItems = items.filter(item =>
            itemDisplayName(item).toLowerCase().includes(searchTerm)
        );

        if (matchingItems.length > 0) {
            matchingTables[tableName] = matchingItems;
        }
    });
    
    // Display results
    if (Object.keys(matchingTables).length === 0) {
        globalResults.innerHTML = '<div class="no-results">No matches found</div>';
        return;
    }
    
    // Sort table names alphabetically
    const sortedTableNames = Object.keys(matchingTables).sort();
    
    // Create result elements
    sortedTableNames.forEach(tableName => {
        const tableResult = document.createElement('div');
        tableResult.className = 'result-table';
        
        const tableHeader = document.createElement('div');
        tableHeader.className = 'result-table-header';
        tableHeader.textContent = `${tableName} (${matchingTables[tableName].length} items)`;
        
        const itemsList = document.createElement('ul');
        itemsList.className = 'result-items';
        
        // Sort items by display name then chance
        const sortedItems = [...matchingTables[tableName]].sort((a, b) => {
            const ka = itemSortKey(a), kb = itemSortKey(b);
            for (let i = 0; i < ka.length; i++) {
                if (ka[i] < kb[i]) return -1;
                if (ka[i] > kb[i]) return 1;
            }
            return 0;
        });

        sortedItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'result-item';

            // Build prefix/highlight/suffix around the match in the
            // formatted entry. Search hits the display name, but the line
            // we render shows qty/chance too.
            const display = itemDisplayName(item);
            const qty = formatQtyRange(item);
            const chance = formatChance(item);
            const lower = display.toLowerCase();
            const idx = lower.indexOf(searchTerm);

            if (idx !== -1) {
                const before = display.substring(0, idx);
                const match  = display.substring(idx, idx + searchTerm.length);
                const after  = display.substring(idx + searchTerm.length);
                li.innerHTML = `${qty}${before}<strong>${match}</strong>${after}${chance}`;
            } else {
                li.textContent = formatItemEntry(item);
            }

            if (typeof item === 'object' && item.group) {
                li.title = `Group: ${item.group}` +
                    (item.group_chance != null ? ` (${(item.group_chance * 100).toFixed(1)}% group roll)` : '');
            }

            itemsList.appendChild(li);
        });
        
        // Add event to make table clickable
        tableHeader.addEventListener('click', () => {
            // Toggle display of items
            if (itemsList.style.display === 'none') {
                itemsList.style.display = 'block';
            } else {
                itemsList.style.display = 'none';
            }
        });
        
        // Add button to view full table
        const viewTableBtn = document.createElement('button');
        viewTableBtn.className = 'view-table-btn';
        viewTableBtn.textContent = 'View Full Table';
        viewTableBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent toggling the items list
            exitGlobalSearchAndViewTable(tableName);
        });
        
        tableHeader.appendChild(viewTableBtn);
        tableResult.appendChild(tableHeader);
        tableResult.appendChild(itemsList);
        globalResults.appendChild(tableResult);
    });
}

// Exit global search and view a specific table
function exitGlobalSearchAndViewTable(tableName) {
    // Exit global search mode
    globalSearchActive = false;
    toggleGlobalSearchBtn.textContent = 'Show Results';
    globalSearchView.classList.add('hidden');
    
    // Show normal view
    normalView.classList.remove('hidden');
    
    // Display the table
    currentTable = tableName;
    
    // Update the UI to show the selected table
    document.querySelectorAll('#tables-list li').forEach(item => {
        item.classList.remove('active');
        
        if (item.dataset.table === tableName) {
            item.classList.add('active');
            // Ensure the table is visible by scrolling to it
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
    
    // Display items for this table
    displayTableItems(tableName);
}

// Toggle compare mode
function toggleCompareMode() {
    compareMode = !compareMode;
    
    if (compareMode) {
        // Enter compare mode
        compareToggleBtn.textContent = 'Selecting Tables...';
        
        // Hide normal view
        normalView.classList.add('hidden');
        
        // Reset table selections
        currentTable = null;
        secondTable = null;
        
        // Set up and show tables selection view
        populateCompareTablesList();
        tablesSelectionView.classList.remove('hidden');
        compareView.classList.add('hidden');
        
        // Hide comparison info until tables are selected
        comparisonInfo.classList.add('hidden');
        
        // Hide global search view if active
        globalSearchActive = false;
        globalSearchView.classList.add('hidden');
        toggleGlobalSearchBtn.textContent = 'Show Results';
    } else {
        // Exit compare mode
        exitCompareMode();
    }
}

// Exit compare mode
function exitCompareMode() {
    compareMode = false;
    compareToggleBtn.textContent = 'Compare Tables';
    
    // Reset and hide compare views
    normalView.classList.remove('hidden');
    tablesSelectionView.classList.add('hidden');
    compareView.classList.add('hidden');
    
    // Reset table selections
    currentTable = null;
    secondTable = null;
    
    // Reset the selection heading
    selectedTableHeading.textContent = 'Select a loot table';
    
    // Clear the items list
    itemsList.innerHTML = '';
}

// Toggle global search view
function toggleGlobalSearch() {
    globalSearchActive = !globalSearchActive;
    
    if (globalSearchActive) {
        // Show global search results
        toggleGlobalSearchBtn.textContent = 'Hide Results';
        normalView.classList.add('hidden');
        tablesSelectionView.classList.add('hidden');
        compareView.classList.add('hidden');
        globalSearchView.classList.remove('hidden');
        
        // Exit compare mode if active
        if (compareMode) {
            compareMode = false;
            compareToggleBtn.textContent = 'Compare Tables';
        }
        
        // Perform search if there's a term
        const searchTerm = globalItemSearchInput.value.trim();
        if (searchTerm) {
            performGlobalSearch(searchTerm);
        }
    } else {
        // Hide global search results
        toggleGlobalSearchBtn.textContent = 'Show Results';
        globalSearchView.classList.add('hidden');
        normalView.classList.remove('hidden');
    }
}

// Setup category filter functionality
function setupCategoryFilter() {
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            filterButtons.forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Set current filter
            currentCategoryFilter = button.dataset.filter;
            
            // Apply filters
            applyFilters();
        });
    });
    
    // Set "All" as active by default
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
}

// Search functionality
function setupSearch() {
    // Main table search
    tableSearchInput.addEventListener('input', () => {
        applyFilters();
    });
    
    // Item search in selected table
    itemSearchInput.addEventListener('input', () => {
        if (currentTable) {
            displayTableItems(currentTable, itemSearchInput.value.trim());
        }
    });
    
    // Compare table search
    compareTableSearchInput.addEventListener('input', () => {
        applyCompareFilters();
    });
    
    // Clear buttons
    clearTableSearchBtn.addEventListener('click', () => {
        tableSearchInput.value = '';
        applyFilters();
    });
    
    clearItemSearchBtn.addEventListener('click', () => {
        itemSearchInput.value = '';
        if (currentTable) {
            displayTableItems(currentTable);
        }
    });
    
    clearCompareTableSearchBtn.addEventListener('click', () => {
        compareTableSearchInput.value = '';
        applyCompareFilters();
    });
    
    // Comparison view search
    table1ItemSearch.addEventListener('input', () => {
        displayCompareTables();
    });
    
    table2ItemSearch.addEventListener('input', () => {
        displayCompareTables();
    });
    
    clearTable1SearchBtn.addEventListener('click', () => {
        table1ItemSearch.value = '';
        displayCompareTables();
    });
    
    clearTable2SearchBtn.addEventListener('click', () => {
        table2ItemSearch.value = '';
        displayCompareTables();
    });
    
    // Global search
    globalItemSearchInput.addEventListener('input', () => {
        const searchTerm = globalItemSearchInput.value.trim();
        if (globalSearchActive && searchTerm) {
            performGlobalSearch(searchTerm);
        }
    });
    
    globalItemSearchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            const searchTerm = globalItemSearchInput.value.trim();
            if (searchTerm) {
                if (!globalSearchActive) {
                    toggleGlobalSearch();
                } else {
                    performGlobalSearch(searchTerm);
                }
            }
        }
    });
    
    clearGlobalSearchBtn.addEventListener('click', () => {
        globalItemSearchInput.value = '';
        if (globalSearchActive) {
            globalResults.innerHTML = '<div class="no-results">Enter a search term above</div>';
            searchTermDisplay.textContent = '';
        }
    });
    
    toggleGlobalSearchBtn.addEventListener('click', toggleGlobalSearch);
}

// Setup comparison functionality
function setupCompare() {
    compareToggleBtn.addEventListener('click', toggleCompareMode);
    exitCompareBtn.addEventListener('click', exitCompareMode);
}

// Show error message
function showError(message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    
    document.querySelector('.container').prepend(errorElement);
}

// Initialize the application
function init() {
    fetchLootTables();
    setupSearch();
    setupCompare();
    setupCategoryFilter();
}

// Start the application when the page loads
window.addEventListener('DOMContentLoaded', init); 