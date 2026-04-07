// Recipes viewer.
//
// Two separate crafting systems share this page on purpose: the older
// "Recipe_*" profession recipes and the newer "syn_*" synthesis blueprints.
// We deliberately keep them in separate tabs so they don't get confused.

let versions = [];
let recipesData = null;
let activeTab = 'crafting';

const versionSelect = document.getElementById('recipes-version');
const tabsEl = document.querySelector('.recipe-tabs');
const tabPanels = {
    crafting:  document.getElementById('tab-crafting'),
    synthesis: document.getElementById('tab-synthesis'),
};
const counts = {
    crafting:  document.getElementById('crafting-count'),
    synthesis: document.getElementById('synthesis-count'),
};

const craftingListEl   = document.getElementById('crafting-list');
const craftingSearchEl = document.getElementById('crafting-search');
const clearCraftingSearchBtn = document.getElementById('clear-crafting-search');
const profFiltersEl    = document.getElementById('profession-filters');

const synthesisListEl   = document.getElementById('synthesis-list');
const synthesisSearchEl = document.getElementById('synthesis-search');
const clearSynthesisSearchBtn = document.getElementById('clear-synthesis-search');
const systemFiltersEl   = document.getElementById('system-filters');

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
    try {
        const res = await fetch('versions.json');
        if (!res.ok) throw new Error('Failed to load versions.json');
        versions = await res.json();

        const available = versions.filter(v => v.recipes_file);
        if (available.length === 0) {
            tabPanels.crafting.innerHTML =
                '<div class="error-message">No recipe data found. Run <code>ruby parse_recipes.rb &lt;version&gt;</code> first.</div>';
            return;
        }

        available.forEach(v => versionSelect.add(new Option(`v${v.version}`, v.recipes_file)));
        versionSelect.selectedIndex = available.length - 1;

        await loadRecipes(versionSelect.value);
        wireUp();
    } catch (err) {
        console.error('Init failed', err);
        tabPanels.crafting.innerHTML = `<div class="error-message">Error: ${err.message}</div>`;
    }
}

// Predicate matching the same single-item filter we apply in renderSynthesis.
// Used by both the tab counter and the system filter so they stay in sync.
function isDisplayableSynth(r) {
    return r.items && r.items.length > 1;
}

async function loadRecipes(file) {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Failed to load ${file}`);
    recipesData = await res.json();

    counts.crafting.textContent  = recipesData.crafting_recipes.length;
    counts.synthesis.textContent = recipesData.synthesis.filter(isDisplayableSynth).length;

    rebuildProfessionFilters();
    rebuildSystemFilters();
    renderCrafting();
    renderSynthesis();
}

function wireUp() {
    versionSelect.addEventListener('change', () => loadRecipes(versionSelect.value));

    tabsEl.querySelectorAll('.recipe-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            tabsEl.querySelectorAll('.recipe-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.dataset.tab;
            Object.entries(tabPanels).forEach(([k, p]) => {
                p.classList.toggle('hidden', k !== activeTab);
            });
        });
    });

    craftingSearchEl.addEventListener('input', renderCrafting);
    clearCraftingSearchBtn.addEventListener('click', () => {
        craftingSearchEl.value = '';
        renderCrafting();
    });

    synthesisSearchEl.addEventListener('input', renderSynthesis);
    clearSynthesisSearchBtn.addEventListener('click', () => {
        synthesisSearchEl.value = '';
        renderSynthesis();
    });
}

// ---------------------------------------------------------------------------
// Splitting items into product / ingredients / scroll
//
// The parser dumps every referenced entity name into a single `items` list
// without distinguishing roles. We can usually figure out which is which from
// the recipe name itself:
//
//   Recipe_Iron_ingot      → product item is "Iron_ingot"
//   syn_rec_<thing>        → product item is "<thing>" (without _unlocked)
//                           recipe-scroll item is "rec_<thing>"
// ---------------------------------------------------------------------------

// Convert a raw entity name like "wp_knuckle_warm_shaman_1h_steam_blitzers"
// into a readable display string like "Steam Blitzers".
//
// Game item names follow predictable prefix patterns that pack class /
// tier / hand info into the identifier. Strip those so the player only
// sees the actual item name.
function prettyItem(name) {
    let s = name;
    // Recipe scroll wrapper: rec_<core>_unlocked → <core>
    s = s.replace(/^rec_/, '').replace(/_unlocked$/, '');
    // Weapons: wp_<type>_<class>_<subclass>_<hands>_<name>
    s = s.replace(/^wp_[a-z]+_[a-z]+_[a-z]+_[12]h_/, '');
    // Artifacts: art_t<n>_<name>
    s = s.replace(/^art_t\d_/, '');
    // Active runes: active_rune_t<n>_<name>
    s = s.replace(/^active_rune_t\d_/, '');
    // Basic / advanced runes: (bas|adv)_rune_(t<n>_)?<name>
    s = s.replace(/^(bas|adv)_rune_(t\d_)?/, '');
    // Basic / advanced chips: (bas|adv)_cp_t<n>_<name>
    s = s.replace(/^(bas|adv)_cp_t\d_/, '');
    // Tiered consumables: con_t<n>_<name>
    s = s.replace(/^con_t\d_/, '');
    // Generic prefixes
    s = s.replace(/^con_/, '')
         .replace(/^res_/, '')
         .replace(/^lt_/, '')
         .replace(/^lgt_/, '');
    return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Identify the product item produced by a crafting recipe.
//
// Recipe entity names come in two flavors:
//   Recipe_Iron_ingot                     → product "Iron_ingot"
//   rec_wp_knuckle_..._steam_blitz_unlocked → product "wp_knuckle_..._steam_blitzers"
//
// Note the second case: the recipe-name "core" is sometimes a *prefix* of the
// actual product name (e.g. "steam_blitz" vs "steam_blitzers"), so an exact
// equality check isn't enough. We strip the known prefix/suffix to derive a
// core, then match items by exact equality first, prefix-startsWith second,
// and longest-common-prefix as a last resort.
function recipeCore(name) {
    let core = name;
    if (/^[Rr]ecipe_/.test(core))   core = core.replace(/^[Rr]ecipe_/, '');
    else if (core.startsWith('rec_')) core = core.substring(4);
    core = core.replace(/_unlocked$/, '');
    return core.toLowerCase();
}

function commonPrefixLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
}

function classifyCraftingItems(recipe) {
    const core = recipeCore(recipe.name);

    // Pass 1: exact match
    let productIndex = recipe.items.findIndex(it => it.toLowerCase() === core);
    // Pass 2: item starts with core (handles steam_blitz → steam_blitzers)
    if (productIndex < 0) {
        productIndex = recipe.items.findIndex(it => it.toLowerCase().startsWith(core));
    }
    // Pass 3: longest common prefix, requiring at least half of `core` to match
    if (productIndex < 0 && core.length > 0) {
        let bestLen = Math.floor(core.length / 2);
        recipe.items.forEach((it, i) => {
            const len = commonPrefixLen(it.toLowerCase(), core);
            if (len > bestLen) {
                bestLen = len;
                productIndex = i;
            }
        });
    }

    let product = null;
    const ingredients = [];
    recipe.items.forEach((it, i) => {
        if (i === productIndex && product === null) {
            product = it;
        } else {
            ingredients.push(it);
        }
    });
    return { product, ingredients };
}

function classifySynthesisItems(recipe) {
    // syn_rec_<core>_<rarity?>  → product = <core>, scroll = rec_<core>_unlocked
    // syn_<core>                → product = <core>
    const core = recipe.name.replace(/^syn_(rec_)?/, '').replace(/_(unlocked|upg|ovr|epic|rare|uncommon|common|legendary|e\d|r\d|unc\d?|t\d)$/i, '');
    const lowerCore = core.toLowerCase();

    let product = null;
    let scroll = null;
    const ingredients = [];

    for (const item of recipe.items) {
        const li = item.toLowerCase();
        if (!product && li === lowerCore) {
            product = item;
        } else if (!scroll && li.startsWith('rec_') && li.includes(lowerCore)) {
            scroll = item;
        } else {
            ingredients.push(item);
        }
    }
    // Fallback: best fuzzy match for the product
    if (!product) {
        for (let i = 0; i < ingredients.length; i++) {
            const it = ingredients[i].toLowerCase();
            if (lowerCore.includes(it) || it.includes(lowerCore)) {
                product = ingredients.splice(i, 1)[0];
                break;
            }
        }
    }
    return { product, scroll, ingredients };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function rebuildProfessionFilters() {
    const profs = new Set();
    recipesData.crafting_recipes.forEach(r => { if (r.profession) profs.add(r.profession); });
    const ordered = [...profs].sort();

    profFiltersEl.innerHTML = '';
    const all = document.createElement('button');
    all.className = 'filter-btn active';
    all.dataset.prof = 'all';
    all.textContent = 'All Professions';
    profFiltersEl.appendChild(all);
    ordered.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.prof = p;
        btn.textContent = p;
        profFiltersEl.appendChild(btn);
    });
    profFiltersEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            profFiltersEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderCrafting();
        });
    });
}

function rebuildSystemFilters() {
    const systems = new Set();
    recipesData.synthesis.forEach(r => { if (r.system && isDisplayableSynth(r)) systems.add(r.system); });
    const ordered = [...systems].sort();

    systemFiltersEl.innerHTML = '';
    const all = document.createElement('button');
    all.className = 'filter-btn active';
    all.dataset.system = 'all';
    all.textContent = 'All Systems';
    systemFiltersEl.appendChild(all);
    ordered.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn';
        btn.dataset.system = s;
        btn.textContent = prettySystem(s);
        systemFiltersEl.appendChild(btn);
    });
    systemFiltersEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            systemFiltersEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderSynthesis();
        });
    });
}

function prettySystem(s) {
    const labels = {
        active_rune: 'Active Runes',
        adv_cp:      'Advanced CP',
        bas_cp:      'Basic CP',
        art_t1:      'Artifacts T1',
        art_t2:      'Artifacts T2',
        art_t3:      'Artifacts T3',
        con_short:   'Consumables',
        con_t3:      'Consumables T3',
        con_weapon:  'Weapon Consumables',
        wp_bow:      'Weapons — Bow',
        wp_dagger:   'Weapons — Dagger',
        wp_gun:      'Weapons — Gun',
        wp_knuckle:  'Weapons — Knuckle',
        wp_shield:   'Weapons — Shield',
        wp_spear:    'Weapons — Spear',
        wp_sword:    'Weapons — Sword',
    };
    return labels[s] || s;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function activeProf() {
    const a = profFiltersEl.querySelector('.active');
    return a ? a.dataset.prof : 'all';
}

function activeSystem() {
    const a = systemFiltersEl.querySelector('.active');
    return a ? a.dataset.system : 'all';
}

function renderCrafting() {
    if (!recipesData) return;
    const search = craftingSearchEl.value.trim().toLowerCase();
    const prof = activeProf();
    craftingListEl.innerHTML = '';

    const filtered = recipesData.crafting_recipes.filter(r => {
        if (prof !== 'all' && r.profession !== prof) return false;
        if (!search) return true;
        if (r.display_name && r.display_name.toLowerCase().includes(search)) return true;
        if (r.name.toLowerCase().includes(search)) return true;
        if (r.profession && r.profession.toLowerCase().includes(search)) return true;
        return r.items.some(i => i.toLowerCase().includes(search));
    });

    if (filtered.length === 0) {
        craftingListEl.innerHTML = '<div class="no-tables-message">No recipes match.</div>';
        return;
    }

    // Group by profession for visual structure
    const byProf = new Map();
    filtered.forEach(r => {
        const key = r.profession || 'Other';
        if (!byProf.has(key)) byProf.set(key, []);
        byProf.get(key).push(r);
    });

    [...byProf.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([profession, recipes]) => {
        const section = document.createElement('div');
        section.className = 'recipe-section';
        const heading = document.createElement('h2');
        heading.className = 'recipe-section-heading';
        heading.textContent = `${profession} (${recipes.length})`;
        section.appendChild(heading);
        recipes.forEach(r => section.appendChild(renderCraftingCard(r)));
        craftingListEl.appendChild(section);
    });
}

function renderCraftingCard(recipe) {
    const { product, ingredients } = classifyCraftingItems(recipe);

    const card = document.createElement('div');
    card.className = 'recipe-card';

    const head = document.createElement('div');
    head.className = 'recipe-card-head';
    const title = document.createElement('span');
    title.className = 'recipe-card-title';
    title.textContent = recipe.display_name || prettyItem(recipe.name);
    head.appendChild(title);
    if (recipe.profession) {
        const prof = document.createElement('span');
        prof.className = 'recipe-card-tag';
        prof.textContent = recipe.profession;
        head.appendChild(prof);
    }
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'recipe-card-body';

    if (ingredients.length > 0) {
        const inSide = renderItemColumn('Ingredients', ingredients);
        body.appendChild(inSide);
    }
    const arrow = document.createElement('div');
    arrow.className = 'recipe-arrow';
    arrow.innerHTML = '&#x2192;';
    body.appendChild(arrow);
    body.appendChild(renderItemColumn('Produces', product ? [product] : []));

    card.appendChild(body);
    return card;
}

function renderSynthesis() {
    if (!recipesData) return;
    const search = synthesisSearchEl.value.trim().toLowerCase();
    const system = activeSystem();
    synthesisListEl.innerHTML = '';

    const filtered = recipesData.synthesis.filter(r => {
        // Skip "upgrade" synth recipes — these are item-upgrade-kit operations
        // (rarity rolls, upgrades, overclock variants) that all have a single
        // referenced item (the item being upgraded). They are noise on the
        // recipes page but still tracked in the data file so the Patch Diff
        // view can pick them up.
        if (!r.items || r.items.length <= 1) return false;
        if (system !== 'all' && r.system !== system) return false;
        if (!search) return true;
        if (r.display_name && r.display_name.toLowerCase().includes(search)) return true;
        if (r.name.toLowerCase().includes(search)) return true;
        return r.items.some(i => i.toLowerCase().includes(search));
    });

    if (filtered.length === 0) {
        synthesisListEl.innerHTML = '<div class="no-tables-message">No synthesis blueprints match.</div>';
        return;
    }

    // Group by system, alphabetically inside each
    const bySystem = new Map();
    filtered.forEach(r => {
        const key = r.system || 'other';
        if (!bySystem.has(key)) bySystem.set(key, []);
        bySystem.get(key).push(r);
    });

    [...bySystem.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([system, recipes]) => {
        const section = document.createElement('div');
        section.className = 'recipe-section';
        const heading = document.createElement('h2');
        heading.className = 'recipe-section-heading';
        heading.textContent = `${prettySystem(system)} (${recipes.length})`;
        section.appendChild(heading);

        // Synth lists can be huge — collapse each section behind a chevron.
        const body = document.createElement('div');
        body.className = 'recipe-section-body';
        const initial = recipes.slice(0, 50);
        initial.forEach(r => body.appendChild(renderSynthesisCard(r)));
        if (recipes.length > 50) {
            const more = document.createElement('button');
            more.className = 'view-table-btn';
            more.textContent = `Show ${recipes.length - 50} more`;
            more.addEventListener('click', () => {
                more.remove();
                recipes.slice(50).forEach(r => body.appendChild(renderSynthesisCard(r)));
            });
            body.appendChild(more);
        }

        heading.style.cursor = 'pointer';
        heading.addEventListener('click', () => body.classList.toggle('hidden'));

        section.appendChild(body);
        synthesisListEl.appendChild(section);
    });
}

function renderSynthesisCard(recipe) {
    const { product, scroll, ingredients } = classifySynthesisItems(recipe);

    const card = document.createElement('div');
    card.className = 'recipe-card';

    const head = document.createElement('div');
    head.className = 'recipe-card-head';
    const title = document.createElement('span');
    title.className = 'recipe-card-title';
    title.textContent = recipe.display_name || prettyItem(recipe.name);
    head.appendChild(title);
    if (recipe.system) {
        const sys = document.createElement('span');
        sys.className = 'recipe-card-tag';
        sys.textContent = prettySystem(recipe.system);
        head.appendChild(sys);
    }
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'recipe-card-body';

    if (ingredients.length > 0) {
        body.appendChild(renderItemColumn('Ingredients', ingredients));
    }
    const arrow = document.createElement('div');
    arrow.className = 'recipe-arrow';
    arrow.innerHTML = '&#x2192;';
    body.appendChild(arrow);
    body.appendChild(renderItemColumn('Produces', product ? [product] : []));

    if (scroll) {
        const scrollLine = document.createElement('div');
        scrollLine.className = 'recipe-scroll-note';
        scrollLine.textContent = `Recipe scroll: ${prettyItem(scroll)}`;
        card.appendChild(scrollLine);
    }

    card.appendChild(body);
    return card;
}

function renderItemColumn(label, items) {
    const col = document.createElement('div');
    col.className = 'recipe-col';
    const heading = document.createElement('div');
    heading.className = 'recipe-col-label';
    heading.textContent = label;
    col.appendChild(heading);
    if (items.length === 0) {
        const none = document.createElement('div');
        none.className = 'recipe-item recipe-item-missing';
        none.textContent = '(unknown)';
        col.appendChild(none);
    } else {
        items.forEach(it => {
            const div = document.createElement('div');
            div.className = 'recipe-item';
            div.textContent = prettyItem(it);
            col.appendChild(div);
        });
    }
    return col;
}

window.addEventListener('DOMContentLoaded', init);
