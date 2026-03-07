// Global variables
let questRewards = {};
let questChains = {};
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

// Stats elements
const statsPanel = document.getElementById('stats-panel');
const toggleStatsBtn = document.getElementById('toggle-stats');

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
    if (lower.includes('ancient coin')) return 'currency';
    return 'other';
}

// Check if a quest has items matching a reward type filter
function questMatchesFilter(questName, filter) {
    if (filter === 'all') return true;
    const items = questRewards[questName] || [];
    return items.some(item => getItemType(item) === filter);
}

// Fetch quest rewards and chain data
async function fetchQuestRewards() {
    try {
        const [rewardsResponse, chainsResponse] = await Promise.all([
            fetch('quest_rewards.json'),
            fetch('quest_chains.json')
        ]);

        if (!rewardsResponse.ok) {
            throw new Error(`HTTP error! Status: ${rewardsResponse.status}`);
        }
        questRewards = await rewardsResponse.json();

        if (chainsResponse.ok) {
            questChains = await chainsResponse.json();
        }

        populateTablesList();
        renderStats();
    } catch (error) {
        console.error('Error fetching quest rewards:', error);
        showError('Failed to load quest rewards data. Please try again later.');
    }
}

// Render analysis stats
function renderStats() {
    const quests = Object.keys(questRewards);
    const allItems = Object.values(questRewards).flat();
    const uniqueItems = [...new Set(allItems)];
    const avgItems = quests.length > 0 ? (allItems.length / quests.length).toFixed(1) : 0;

    document.getElementById('stat-total-quests').textContent = quests.length;
    document.getElementById('stat-unique-items').textContent = uniqueItems.length;
    document.getElementById('stat-avg-items').textContent = avgItems;
    document.getElementById('stat-total-items').textContent = allItems.length.toLocaleString();

    // Top rewards - most common items across all quests
    const itemCounts = {};
    allItems.forEach(item => {
        itemCounts[item] = (itemCounts[item] || 0) + 1;
    });
    const topItems = Object.entries(itemCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    const topList = document.getElementById('top-rewards-list');
    topList.innerHTML = '';
    topItems.forEach(([item, count]) => {
        const li = document.createElement('li');
        const pct = ((count / quests.length) * 100).toFixed(0);
        li.innerHTML = `<span class="top-item-name">${item}</span><span class="top-item-count">${count} quests (${pct}%)</span>`;
        topList.appendChild(li);
    });

    // Reward type breakdown
    const typeCounts = {};
    const typeLabels = {
        artifact: 'Artifacts',
        recipe: 'Recipes',
        consumable: 'Consumables',
        chip: 'Chip Parts',
        synthesis: 'Synthesis',
        currency: 'Currency',
        other: 'Other'
    };

    allItems.forEach(item => {
        const type = getItemType(item);
        typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    const maxCount = Math.max(...Object.values(typeCounts));
    const barsContainer = document.getElementById('reward-type-bars');
    barsContainer.innerHTML = '';

    // Sort by count descending
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

    sortedTypes.forEach(([type, count]) => {
        const pct = ((count / allItems.length) * 100).toFixed(1);
        const barWidth = ((count / maxCount) * 100).toFixed(0);

        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML = `
            <span class="bar-label">${typeLabels[type] || type}</span>
            <div class="bar-track">
                <div class="bar-fill bar-${type}" style="width: ${barWidth}%"></div>
            </div>
            <span class="bar-value">${count} (${pct}%)</span>
        `;
        barsContainer.appendChild(row);
    });
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

        // Add chain indicator if this quest has chain data
        if (questChains[questName]) {
            const chainIcon = document.createElement('span');
            chainIcon.className = 'chain-icon';
            chainIcon.title = 'Part of a quest chain';
            chainIcon.textContent = '\u26D3';
            li.appendChild(document.createTextNode(questName));
            li.appendChild(chainIcon);
        } else {
            li.textContent = questName;
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
        chip: 'Chip Parts',
        synthesis: 'Synthesis',
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

// Display items for a specific quest
function displayQuestItems(questName, searchTerm = '') {
    currentQuest = questName;
    selectedTableHeading.textContent = questName;

    const items = questRewards[questName] || [];

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

// Setup stats panel toggle
function setupStats() {
    let statsVisible = true;
    toggleStatsBtn.addEventListener('click', () => {
        statsVisible = !statsVisible;
        const detail = statsPanel.querySelector('.stats-detail');
        const grid = statsPanel.querySelector('.stats-grid');
        if (statsVisible) {
            detail.classList.remove('hidden');
            grid.classList.remove('hidden');
            toggleStatsBtn.textContent = 'Hide Analysis';
        } else {
            detail.classList.add('hidden');
            grid.classList.add('hidden');
            toggleStatsBtn.textContent = 'Show Analysis';
        }
    });
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
    setupStats();
}

window.addEventListener('DOMContentLoaded', init);
