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
//
// As of v0.103 the parser emits structured `ingredients` arrays plus an
// `output` object. Older version files only have `items: [string, ...]`
// without distinguishing roles. This predicate keeps both forms in scope.
function isDisplayableSynth(r) {
    if (Array.isArray(r.ingredients)) return r.ingredients.length > 0;
    return Array.isArray(r.items) && r.items.length > 1;
}

// Normalize a recipe to a unified shape `{ output, ingredients }` regardless
// of whether it came from the new structured parser or an old version file.
// `output` is { name, qty } (or null), `ingredients` is [{ name, qty, slot }].
function recipeShape(recipe) {
    if (Array.isArray(recipe.ingredients)) {
        return {
            output: recipe.output || null,
            ingredients: recipe.ingredients.map(i => ({
                name: i.name || i,
                qty:  typeof i === 'object' ? i.qty  : null,
                slot: typeof i === 'object' ? i.slot : null,
            })),
        };
    }
    // Legacy items[] shape — fall back to the fuzzy token classifier so the
    // diff and recipe pages still work for older version files.
    const items = recipe.items || [];
    if (recipe.kind === 'synthesis' || (recipe.system && !recipe.profession)) {
        const { product, ingredients } = classifySynthesisItems({ name: recipe.name, items });
        return {
            output: product ? { name: product } : null,
            ingredients: ingredients.map(n => ({ name: n })),
        };
    }
    const { product, ingredients } = classifyCraftingItems({ name: recipe.name, items });
    return {
        output: product && product !== '__recipe_name__' ? { name: product } : null,
        ingredients: ingredients.map(n => ({ name: n })),
    };
}

// Iterate every (recipe, item-name) pair so the search predicate can match
// either old-style strings or new-style { name, qty } objects.
function recipeItemNames(recipe) {
    const names = [];
    if (Array.isArray(recipe.ingredients)) {
        recipe.ingredients.forEach(i => names.push(typeof i === 'object' ? i.name : i));
    }
    if (recipe.output && recipe.output.name) names.push(recipe.output.name);
    if (Array.isArray(recipe.items)) recipe.items.forEach(i => names.push(i));
    return names.filter(Boolean);
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
// Recipe naming is messy in the source data:
//   Recipe_Iron_ingot                          → product Iron_ingot                       (exact)
//   rec_wp_knuckle_..._steam_blitz_unlocked    → product wp_knuckle_..._steam_blitzers    (prefix mismatch)
//   rec_con_ap_t2_double_biosteroids_shot_*    → product con_t2_double_biosteroids_shot   (recipe has extra "ap_" infix)
//   Recipe_food_corn_flour                     → product res_food_corn_flour              (product has extra "res_" prefix)
//   rec_con_t3_tripple_biosteroids_shot_*      → product con_t3_triple_biosteroids_shot   (typo in recipe name)
//
// A pure prefix or substring match can't handle all these. We tokenize both
// the recipe core and each candidate item on underscores, then score by
// overlapping tokens. The item with the highest score (and at least half of
// the core's tokens matched) wins.
function recipeCore(name) {
    let core = name;
    if (/^[Rr]ecipe_/.test(core))     core = core.replace(/^[Rr]ecipe_/, '');
    else if (core.startsWith('rec_')) core = core.substring(4);
    core = core.replace(/_unlocked$/, '').replace(/_unlock$/, '');
    return core.toLowerCase();
}

function tokens(s) {
    return s.toLowerCase().split(/[_\-]/).filter(t => t.length > 0);
}

function tokenScore(coreTokens, itemTokens) {
    // Count how many core tokens appear (anywhere) in the item tokens.
    // Tokens can appear in either order so we use a multiset intersection.
    const remaining = [...itemTokens];
    let matches = 0;
    for (const t of coreTokens) {
        const idx = remaining.indexOf(t);
        if (idx >= 0) {
            matches++;
            remaining.splice(idx, 1);
        }
    }
    return matches;
}

function classifyCraftingItems(recipe) {
    const core = recipeCore(recipe.name);
    const coreTokens = tokens(core);

    // Pass 1: exact match (cheapest, most certain)
    let productIndex = recipe.items.findIndex(it => it.toLowerCase() === core);

    // Pass 2: token-overlap scoring
    if (productIndex < 0 && coreTokens.length > 0) {
        const minMatch = Math.max(2, Math.ceil(coreTokens.length / 2));
        let bestScore = minMatch - 1;
        recipe.items.forEach((it, i) => {
            const score = tokenScore(coreTokens, tokens(it));
            if (score > bestScore) {
                bestScore = score;
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

    // Final fallback: if there's still no product (e.g. mend-o-matic, where
    // the actual item simply isn't referenced by any of the recipe's IDs),
    // synthesize a "virtual" product from the recipe name itself so the UI
    // doesn't show an unhelpful "(unknown)".
    if (!product) {
        product = '__recipe_name__'; // sentinel handled by the renderer
    }
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
        return recipeItemNames(r).some(n => n.toLowerCase().includes(search));
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
    const { output, ingredients } = recipeShape(recipe);

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
        body.appendChild(renderItemColumn('Ingredients', ingredients));
    }
    const arrow = document.createElement('div');
    arrow.className = 'recipe-arrow';
    arrow.innerHTML = '&#x2192;';
    body.appendChild(arrow);
    body.appendChild(renderItemColumn('Produces', output ? [output] : []));

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
        if (!isDisplayableSynth(r)) return false;
        if (system !== 'all' && r.system !== system) return false;
        if (!search) return true;
        if (r.display_name && r.display_name.toLowerCase().includes(search)) return true;
        if (r.name.toLowerCase().includes(search)) return true;
        return recipeItemNames(r).some(n => n.toLowerCase().includes(search));
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
    const { output, ingredients } = recipeShape(recipe);

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
    body.appendChild(renderItemColumn('Produces', output ? [output] : []));

    card.appendChild(body);
    return card;
}

// Quality-tier names matching the loot-table rarity field. Same colors used
// in the Loot Tables viewer for consistency.
const RECIPE_RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic'];
const RECIPE_RARITY_SHORT = ['C', 'U', 'R', 'E'];

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
            // Items can be plain strings (legacy `items[]` shape) or
            // { name, qty, slot, rarity } objects (new shape). Prefix with
            // quantity when > 1, and prepend a colored rarity badge for
            // synth recipe items (which carry a rarity tier inferred from
            // the recipe's _common/_uncommon/_rare/_epic suffix).
            const name = typeof it === 'object' ? it.name : it;
            const qty  = typeof it === 'object' ? it.qty  : null;
            const rarity = (typeof it === 'object' && it.rarity != null) ? it.rarity : null;
            const display = prettyItem(name || '');
            if (rarity != null && RECIPE_RARITY_SHORT[rarity]) {
                const badge = document.createElement('span');
                badge.className = `rarity-badge rarity-${rarity}`;
                badge.textContent = RECIPE_RARITY_SHORT[rarity];
                badge.title = RECIPE_RARITY_NAMES[rarity];
                div.appendChild(badge);
                div.appendChild(document.createTextNode(' '));
            }
            const text = (qty != null && qty > 1) ? `${qty}× ${display}` : display;
            div.appendChild(document.createTextNode(text));
            col.appendChild(div);
        });
    }
    return col;
}

window.addEventListener('DOMContentLoaded', init);
