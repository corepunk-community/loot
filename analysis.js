let questRewards = {};
let apiQuests = {};

function toSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
}

function getApiQuest(questName) {
    return apiQuests[toSlug(questName)] || null;
}

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

async function init() {
    try {
        const versionsRes = await fetch('versions.json');
        if (!versionsRes.ok) throw new Error('Failed to load versions manifest');
        const versions = await versionsRes.json();
        const latest = versions[versions.length - 1];
        const rewardsFile = latest.quest_rewards_file || 'quest_rewards.json';

        const fetches = [fetch(rewardsFile)];
        if (latest.api_quests_file) fetches.push(fetch(latest.api_quests_file));

        const [rewardsRes, apiRes] = await Promise.all(fetches);
        if (!rewardsRes.ok) throw new Error('Failed to load quest rewards');
        questRewards = await rewardsRes.json();

        if (apiRes && apiRes.ok) {
            const apiData = await apiRes.json();
            apiData.forEach(q => { apiQuests[q.slug] = q; });
        }

        renderStats();
        renderQuestLists();
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('quest-lists').innerHTML =
            '<div class="error-message">Failed to load quest rewards data.</div>';
    }
}

function renderStats() {
    const quests = Object.keys(questRewards);
    const allItems = Object.values(questRewards).flat();
    const uniqueItems = [...new Set(allItems)];
    const avgItems = quests.length > 0 ? (allItems.length / quests.length).toFixed(1) : 0;

    document.getElementById('stat-total-quests').textContent = quests.length;
    document.getElementById('stat-unique-items').textContent = uniqueItems.length;
    document.getElementById('stat-avg-items').textContent = avgItems;

    // Top rewards
    const itemCounts = {};
    allItems.forEach(item => { itemCounts[item] = (itemCounts[item] || 0) + 1; });
    const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

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
        artifact: 'Artifacts', recipe: 'Recipes', consumable: 'Consumables',
        chip: 'Chips', synthesis: 'Synthesis', weapon: 'Weapons',
        currency: 'Currency', other: 'Other'
    };

    allItems.forEach(item => {
        const type = getItemType(item);
        typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    const maxCount = Math.max(...Object.values(typeCounts));
    const barsContainer = document.getElementById('reward-type-bars');
    barsContainer.innerHTML = '';

    Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
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

// Find quests where at least one item matches the predicate
function findQuests(predicate) {
    const results = [];
    Object.entries(questRewards).forEach(([quest, items]) => {
        const matched = items.filter(predicate);
        if (matched.length > 0) {
            results.push({ quest, items: matched });
        }
    });
    return results.sort((a, b) => a.quest.localeCompare(b.quest));
}

function renderQuestLists() {
    const sections = [
        {
            title: 'Quests Providing Item Upgrade T2 Epic',
            predicate: item => item === 'Synthesis Item Upgrade T2 Epic'
        },
        {
            title: 'Quests Providing Item Upgrade T3 Epic',
            predicate: item => item === 'Synthesis Item Upgrade T3 Epic'
        },
        {
            title: 'Quests Providing T3 Weapons or Weapon Recipes',
            predicate: item => {
                const lower = item.toLowerCase();
                return (lower.startsWith('wp ') || lower.startsWith('rec wp '));
            }
        },
        {
            title: 'Quests Providing T3 Artifacts or Artifact Recipes',
            predicate: item => {
                const lower = item.toLowerCase();
                return (lower.startsWith('art t3 ') || lower.startsWith('rec art t3 '));
            }
        },
        {
            title: 'Quests Providing Talent Fragmenters',
            predicate: item => item === 'Talent Fragmenter'
        }
    ];

    const container = document.getElementById('quest-lists');
    container.innerHTML = '';

    sections.forEach(section => {
        const results = findQuests(section.predicate);

        const panel = document.createElement('div');
        panel.className = 'analysis-section';

        const header = document.createElement('div');
        header.className = 'analysis-section-header';
        header.innerHTML = `
            <span class="analysis-section-title">${section.title}</span>
            <span class="analysis-section-count">${results.length} quests</span>
            <span class="analysis-section-chevron expanded">&#9654;</span>
        `;

        const body = document.createElement('div');
        body.className = 'analysis-section-body';

        if (results.length === 0) {
            body.innerHTML = '<div class="no-results">No matching quests</div>';
        } else {
            results.forEach(({ quest, items }) => {
                const row = document.createElement('div');
                row.className = 'analysis-quest-row';

                const api = getApiQuest(quest);

                // Level badge
                if (api && api.level) {
                    const lvl = document.createElement('span');
                    lvl.className = 'quest-level-badge';
                    lvl.textContent = api.level;
                    row.appendChild(lvl);
                }

                const link = document.createElement('a');
                link.className = 'analysis-quest-link';
                link.textContent = quest;
                link.href = 'quests.html';
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    sessionStorage.setItem('selectedQuest', quest);
                    window.location.href = 'quests.html';
                });

                const itemTags = document.createElement('div');
                itemTags.className = 'analysis-quest-items';
                items.forEach(item => {
                    const tag = document.createElement('span');
                    tag.className = `analysis-item-tag reward-tag reward-tag-${getItemType(item)}`;
                    tag.textContent = item;
                    itemTags.appendChild(tag);
                });

                row.appendChild(link);
                row.appendChild(itemTags);
                body.appendChild(row);
            });
        }

        header.addEventListener('click', () => {
            const chevron = header.querySelector('.analysis-section-chevron');
            const isOpen = !body.classList.contains('hidden');
            if (isOpen) {
                body.classList.add('hidden');
                chevron.classList.remove('expanded');
            } else {
                body.classList.remove('hidden');
                chevron.classList.add('expanded');
            }
        });

        panel.appendChild(header);
        panel.appendChild(body);
        container.appendChild(panel);
    });
}

window.addEventListener('DOMContentLoaded', init);
