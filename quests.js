// Global variables
let questRewards = {};
let questChains = {};
let apiQuests = {};  // slug -> API quest data
let slugMap = {};    // binary slug -> API slug (for fuzzy matches)
let currentQuest = null;
let globalSearchActive = false;
let currentRewardFilter = "all";

// DOM elements
const tablesList = document.getElementById('tables-list');
const itemsList = document.getElementById('items-list');
const selectedTableHeading = document.getElementById('selected-table');
const tableSearchInput = document.getElementById('table-search');
const itemSearchInput = document.getElementById('item-search');
const clearTableSearchBtn = document.getElementById('clear-table-search');
const clearItemSearchBtn = document.getElementById('clear-item-search');
const rewardSummary = document.getElementById('reward-summary');

// Global search elements
const globalItemSearchInput = document.getElementById('global-item-search');
const clearGlobalSearchBtn = document.getElementById('clear-global-search');
const toggleGlobalSearchBtn = document.getElementById('toggle-global-search');
const globalSearchView = document.getElementById('global-search-view');
const globalResults = document.getElementById('global-results');
const searchTermDisplay = document.getElementById('search-term-display');
const normalView = document.getElementById('normal-view');

// Category filter elements
const filterButtons = document.querySelectorAll('.filter-btn');

// Reward type classification
function getItemType(itemName) {
    const lower = itemName.toLowerCase();
    if (lower.startsWith('art t') || lower.startsWith('art_t')) return 'artifact';
    if (lower.startsWith('rec ') || lower.startsWith('rec_')) return 'recipe';
    if (lower.startsWith('con ') || lower.startsWith('con_')) return 'consumable';
    if (lower.startsWith('bas cp') || lower.startsWith('adv cp')) return 'chip';
    if (lower.startsWith('synthesis') || lower.startsWith('reforge') || lower.startsWith('talent')) return 'synthesis';
    if (lower.startsWith('wp ') || lower.startsWith('wp_')) return 'weapon';
    if (lower.includes('ancient coin')) return 'currency';
    return 'other';
}

// Check if a quest has items matching a reward type filter
function questMatchesFilter(questName, filter) {
    if (filter === 'all') return true;
    const items = questRewards[questName] || [];
    return items.some(item => getItemType(item) === filter);
}

// Convert a quest name to a slug for API matching
function toSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
}

// Look up API data for a quest name (with slug map fallback)
function getApiQuest(questName) {
    const slug = toSlug(questName);
    return apiQuests[slug] || apiQuests[slugMap[slug]] || null;
}

// Fetch quest rewards, chain data, and API quest data
async function fetchQuestRewards() {
    try {
        // Load version manifest to find latest files
        const [versionsResponse, chainsResponse] = await Promise.all([
            fetch('versions.json'),
            fetch('quest_chains.json')
        ]);

        if (!versionsResponse.ok) {
            throw new Error('Failed to load versions manifest');
        }
        const versions = await versionsResponse.json();
        const latestVersion = versions[versions.length - 1];
        const rewardsFile = latestVersion.quest_rewards_file || 'quest_rewards.json';
        const apiQuestsFile = latestVersion.api_quests_file;

        const fetches = [fetch(rewardsFile)];
        if (apiQuestsFile) fetches.push(fetch(apiQuestsFile));

        const [rewardsResponse, apiResponse] = await Promise.all(fetches);

        if (!rewardsResponse.ok) {
            throw new Error(`HTTP error! Status: ${rewardsResponse.status}`);
        }
        questRewards = await rewardsResponse.json();

        if (chainsResponse.ok) {
            questChains = await chainsResponse.json();
        }

        // Build API quest lookup by slug
        if (apiResponse && apiResponse.ok) {
            const apiData = await apiResponse.json();
            // Handle both old format (array) and new format ({ quests, slugMap })
            const questList = Array.isArray(apiData) ? apiData : apiData.quests || [];
            questList.forEach(q => { apiQuests[q.slug] = q; });
            if (apiData.slugMap) slugMap = apiData.slugMap;
        }

        populateTablesList();

        // Check if navigated here from chains page or analysis page
        const selectedQuest = sessionStorage.getItem('selectedQuest');
        if (selectedQuest && questRewards[selectedQuest]) {
            sessionStorage.removeItem('selectedQuest');
            navigateToQuest(selectedQuest);
        }
    } catch (error) {
        console.error('Error fetching quest rewards:', error);
        showError('Failed to load quest rewards data. Please try again later.');
    }
}

// Apply filters (reward type + search)
function applyFilters() {
    const searchTerm = tableSearchInput.value.trim().toLowerCase();
    const tableItems = document.querySelectorAll('#tables-list li');

    let visibleCount = 0;

    tableItems.forEach(item => {
        const questName = item.dataset.table;
        const matchesFilter = questMatchesFilter(questName, currentRewardFilter);
        const matchesSearch = !searchTerm || questName.toLowerCase().includes(searchTerm);

        if (matchesFilter && matchesSearch) {
            item.classList.remove('hidden-table');
            visibleCount++;
        } else {
            item.classList.add('hidden-table');
        }
    });

    let noResultsMsg = document.getElementById('no-results-msg');
    if (visibleCount === 0) {
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('li');
            noResultsMsg.id = 'no-results-msg';
            noResultsMsg.textContent = 'No matching quests found';
            noResultsMsg.style.cursor = 'default';
            noResultsMsg.classList.add('no-tables-message');
            tablesList.appendChild(noResultsMsg);
        }
    } else if (noResultsMsg) {
        noResultsMsg.remove();
    }
}

// Populate quest list
function populateTablesList() {
    tablesList.innerHTML = '';

    const sortedNames = Object.keys(questRewards).sort();

    sortedNames.forEach(questName => {
        const li = document.createElement('li');
        li.dataset.table = questName;

        const api = getApiQuest(questName);

        // Level badge
        if (api && api.level) {
            const lvl = document.createElement('span');
            lvl.className = 'quest-level-badge';
            lvl.textContent = api.level;
            lvl.title = `Level ${api.level}`;
            li.appendChild(lvl);
        }

        li.appendChild(document.createTextNode(questName));

        // Chain indicator
        if (questChains[questName]) {
            const chainIcon = document.createElement('span');
            chainIcon.className = 'chain-icon';
            chainIcon.title = 'Part of a quest chain';
            chainIcon.textContent = '\u26D3';
            li.appendChild(chainIcon);
        }

        // Unverified tag for quests not on corepunk.help
        if (!api) {
            const tag = document.createElement('span');
            tag.className = 'quest-unverified-tag';
            tag.title = 'Not found on corepunk.help — may not be accessible in-game';
            tag.textContent = '?';
            li.appendChild(tag);
        }

        if (questName === currentQuest) {
            li.classList.add('active');
        }

        if (currentRewardFilter !== 'all' && !questMatchesFilter(questName, currentRewardFilter)) {
            li.classList.add('hidden-table');
        }

        li.addEventListener('click', () => {
            document.querySelectorAll('#tables-list li').forEach(item => {
                item.classList.remove('active');
            });
            li.classList.add('active');
            displayQuestItems(questName);
        });

        tablesList.appendChild(li);
    });

    if (tableSearchInput.value.trim()) {
        applyFilters();
    }
}

// Build a short summary of reward types for a quest
function buildRewardSummary(items) {
    const types = {};
    items.forEach(item => {
        const type = getItemType(item);
        types[type] = (types[type] || 0) + 1;
    });

    const labels = {
        artifact: 'Artifacts',
        recipe: 'Recipes',
        consumable: 'Consumables',
        chip: 'Chips',
        synthesis: 'Synthesis',
        weapon: 'Weapons',
        currency: 'Currency',
        other: 'Other'
    };

    const parts = Object.entries(types)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `<span class="reward-tag reward-tag-${type}">${count} ${labels[type] || type}</span>`);

    return parts.join('');
}

// Build quest chain HTML for a quest
function buildChainHTML(questName) {
    const chainData = questChains[questName];
    if (!chainData) return '';

    let html = '<div class="quest-chain-info">';

    if (chainData.prerequisites && chainData.prerequisites.length > 0) {
        html += '<div class="chain-section chain-prereqs">';
        html += '<span class="chain-label">Requires:</span>';
        chainData.prerequisites.forEach(prereq => {
            const hasRewards = questRewards.hasOwnProperty(prereq);
            html += `<a class="chain-link chain-prereq-link${hasRewards ? '' : ' chain-link-dim'}" data-quest="${prereq}">${prereq}</a>`;
        });
        html += '</div>';
    }

    if (chainData.followups && chainData.followups.length > 0) {
        html += '<div class="chain-section chain-followups">';
        html += '<span class="chain-label">Unlocks:</span>';
        chainData.followups.forEach(followup => {
            const hasRewards = questRewards.hasOwnProperty(followup);
            html += `<a class="chain-link chain-followup-link${hasRewards ? '' : ' chain-link-dim'}" data-quest="${followup}">${followup}</a>`;
        });
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// Navigate to a quest via chain link
function navigateToQuest(questName) {
    // If quest exists in rewards, select it
    if (questRewards[questName]) {
        document.querySelectorAll('#tables-list li').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.table === questName) {
                item.classList.add('active');
                item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
        displayQuestItems(questName);
    }
}

// Build a clickable NPC map link
function npcMapLink(slug, name) {
    return `<a href="https://corepunk.help/tools/map?npc=${slug}" target="_blank" rel="noopener" class="npc-map-link" title="View on map">${name}</a>`;
}

// Build quest detail HTML from API data
function buildQuestDetailHTML(questName) {
    const api = getApiQuest(questName);

    // Show unverified notice for quests not on corepunk.help
    if (!api) {
        return '<div class="quest-unverified-notice">This quest was found in game files but is not listed on corepunk.help. It may not be accessible in-game.</div>';
    }

    let html = '<div class="quest-detail-info">';

    // Level and location row
    const meta = [];
    if (api.level) meta.push(`<span class="quest-detail-level">Lv. ${api.level}</span>`);
    if (api.location) meta.push(`<span class="quest-detail-location">${api.location}</span>`);
    if (meta.length) html += `<div class="quest-detail-meta">${meta.join('')}</div>`;

    // Quest giver / finisher
    const giverSlug = api.questGiver?.slug;
    const giverName = api.questGiver?.name;
    const finisherSlug = api.questFinisher?.slug;
    const finisherName = api.questFinisher?.name;
    if (giverName || finisherName) {
        html += '<div class="quest-detail-npcs">';
        if (giverName) html += `<span class="quest-detail-npc"><span class="quest-detail-label">Giver:</span> ${npcMapLink(giverSlug, giverName)}</span>`;
        if (finisherName && finisherSlug !== giverSlug) html += `<span class="quest-detail-npc"><span class="quest-detail-label">Finisher:</span> ${npcMapLink(finisherSlug, finisherName)}</span>`;
        html += '</div>';
    }

    // Goals
    if (api.goals && api.goals.length > 0) {
        html += '<div class="quest-detail-goals"><span class="quest-detail-label">Goals:</span><ul>';
        api.goals.forEach(g => {
            const qty = g.quantity > 1 ? ` (${g.quantity})` : '';
            html += `<li>${g.description}${qty}</li>`;
        });
        html += '</ul></div>';
    }

    html += '</div>';
    return html;
}

// Display items for a specific quest
function displayQuestItems(questName, searchTerm = '') {
    currentQuest = questName;
    selectedTableHeading.textContent = questName;

    const items = questRewards[questName] || [];

    // Show quest detail info from API (or unverified notice)
    const detailContainer = document.getElementById('quest-detail');
    detailContainer.innerHTML = buildQuestDetailHTML(questName);
    detailContainer.classList.remove('hidden');

    // Show quest chain info
    const chainContainer = document.getElementById('quest-chain');
    const chainHTML = buildChainHTML(questName);
    if (chainHTML) {
        chainContainer.innerHTML = chainHTML;
        chainContainer.classList.remove('hidden');
        // Attach click handlers to chain links
        chainContainer.querySelectorAll('.chain-link').forEach(link => {
            link.addEventListener('click', () => {
                navigateToQuest(link.dataset.quest);
            });
        });
    } else {
        chainContainer.innerHTML = '';
        chainContainer.classList.add('hidden');
    }

    // Show reward type summary
    if (items.length > 0) {
        rewardSummary.innerHTML = buildRewardSummary(items);
        rewardSummary.classList.remove('hidden');
    } else {
        rewardSummary.classList.add('hidden');
    }

    filterItems(items, searchTerm, itemsList);
}

// Filter and render items in a list
function filterItems(items, searchTerm, containerElement) {
    containerElement.innerHTML = '';

    if (!items || items.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items for this quest';
        containerElement.appendChild(li);
        return;
    }

    const sortedItems = [...items].sort();
    let itemsFound = 0;

    sortedItems.forEach(item => {
        if (searchTerm && !item.toLowerCase().includes(searchTerm.toLowerCase())) {
            return;
        }
        itemsFound++;
        const li = document.createElement('li');
        li.textContent = item;

        // Add a subtle type indicator
        const type = getItemType(item);
        li.classList.add(`item-type-${type}`);

        containerElement.appendChild(li);
    });

    if (itemsFound === 0) {
        const li = document.createElement('li');
        li.textContent = 'No matching items found';
        li.classList.add('no-items-message');
        containerElement.appendChild(li);
    }
}

// Global search across all quests
function performGlobalSearch(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') return;

    searchTerm = searchTerm.trim().toLowerCase();
    searchTermDisplay.textContent = `"${searchTerm}"`;
    globalResults.innerHTML = '';

    const matchingQuests = {};

    Object.entries(questRewards).forEach(([questName, items]) => {
        const matchingItems = items.filter(item =>
            item.toLowerCase().includes(searchTerm)
        );
        if (matchingItems.length > 0) {
            matchingQuests[questName] = matchingItems;
        }
    });

    if (Object.keys(matchingQuests).length === 0) {
        globalResults.innerHTML = '<div class="no-results">No matches found</div>';
        return;
    }

    const sortedNames = Object.keys(matchingQuests).sort();

    sortedNames.forEach(questName => {
        const tableResult = document.createElement('div');
        tableResult.className = 'result-table';

        const tableHeader = document.createElement('div');
        tableHeader.className = 'result-table-header';
        tableHeader.textContent = `${questName} (${matchingQuests[questName].length} items)`;

        const resultItemsList = document.createElement('ul');
        resultItemsList.className = 'result-items';

        const sortedItems = [...matchingQuests[questName]].sort();

        sortedItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'result-item';

            const lowerItem = item.toLowerCase();
            const index = lowerItem.indexOf(searchTerm);

            if (index !== -1) {
                const before = item.substring(0, index);
                const match = item.substring(index, index + searchTerm.length);
                const after = item.substring(index + searchTerm.length);
                li.innerHTML = `${before}<strong>${match}</strong>${after}`;
            } else {
                li.textContent = item;
            }

            resultItemsList.appendChild(li);
        });

        tableHeader.addEventListener('click', () => {
            resultItemsList.style.display = resultItemsList.style.display === 'none' ? 'block' : 'none';
        });

        const viewBtn = document.createElement('button');
        viewBtn.className = 'view-table-btn';
        viewBtn.textContent = 'View Quest';
        viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exitGlobalSearchAndViewQuest(questName);
        });

        tableHeader.appendChild(viewBtn);
        tableResult.appendChild(tableHeader);
        tableResult.appendChild(resultItemsList);
        globalResults.appendChild(tableResult);
    });
}

// Exit global search and view a specific quest
function exitGlobalSearchAndViewQuest(questName) {
    globalSearchActive = false;
    toggleGlobalSearchBtn.textContent = 'Show Results';
    globalSearchView.classList.add('hidden');
    normalView.classList.remove('hidden');

    currentQuest = questName;

    document.querySelectorAll('#tables-list li').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.table === questName) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    displayQuestItems(questName);
}

// Toggle global search view
function toggleGlobalSearch() {
    globalSearchActive = !globalSearchActive;

    if (globalSearchActive) {
        toggleGlobalSearchBtn.textContent = 'Hide Results';
        normalView.classList.add('hidden');
        globalSearchView.classList.remove('hidden');

        const searchTerm = globalItemSearchInput.value.trim();
        if (searchTerm) {
            performGlobalSearch(searchTerm);
        }
    } else {
        toggleGlobalSearchBtn.textContent = 'Show Results';
        globalSearchView.classList.add('hidden');
        normalView.classList.remove('hidden');
    }
}

// Setup category filter (reward type)
function setupCategoryFilter() {
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentRewardFilter = button.dataset.filter;
            applyFilters();
        });
    });

    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
}

// Setup search functionality
function setupSearch() {
    tableSearchInput.addEventListener('input', () => {
        applyFilters();
    });

    itemSearchInput.addEventListener('input', () => {
        if (currentQuest) {
            displayQuestItems(currentQuest, itemSearchInput.value.trim());
        }
    });

    clearTableSearchBtn.addEventListener('click', () => {
        tableSearchInput.value = '';
        applyFilters();
    });

    clearItemSearchBtn.addEventListener('click', () => {
        itemSearchInput.value = '';
        if (currentQuest) {
            displayQuestItems(currentQuest);
        }
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

// Show error message
function showError(message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    document.querySelector('.container').prepend(errorElement);
}

// Initialize
function init() {
    fetchQuestRewards();
    setupSearch();
    setupCategoryFilter();
}

window.addEventListener('DOMContentLoaded', init);
