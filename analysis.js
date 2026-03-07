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

function toggleSection(body, chevron) {
    const isOpen = !body.classList.contains('hidden');
    if (isOpen) {
        body.classList.add('hidden');
        chevron.classList.remove('expanded');
    } else {
        body.classList.remove('hidden');
        chevron.classList.add('expanded');
    }
}

function renderQuestLists() {
    const sections = [
        {
            id: 'upgrade-t2-epic',
            title: 'Item Upgrade T2 Epic',
            predicate: item => item === 'Synthesis Item Upgrade T2 Epic'
        },
        {
            id: 'upgrade-t3-epic',
            title: 'Item Upgrade T3 Epic',
            predicate: item => item === 'Synthesis Item Upgrade T3 Epic'
        },
        {
            id: 't3-weapons',
            title: 'T3 Weapons or Weapon Recipes',
            predicate: item => {
                const lower = item.toLowerCase();
                return (lower.startsWith('wp ') || lower.startsWith('rec wp '));
            }
        },
        {
            id: 't3-artifacts',
            title: 'T3 Artifacts or Artifact Recipes',
            predicate: item => {
                const lower = item.toLowerCase();
                return (lower.startsWith('art t3 ') || lower.startsWith('rec art t3 '));
            }
        },
        {
            id: 'talent-fragmenters',
            title: 'Talent Fragmenters',
            predicate: item => item === 'Talent Fragmenter'
        }
    ];

    const container = document.getElementById('quest-lists');
    container.innerHTML = '';

    // Build table of contents
    const toc = document.getElementById('analysis-toc');
    const tocTitle = document.createElement('h3');
    tocTitle.textContent = 'Quest Reward Lookups';
    toc.appendChild(tocTitle);

    const tocList = document.createElement('ul');

    // Pre-compute results and render sections
    const sectionEls = [];

    sections.forEach(section => {
        const results = findQuests(section.predicate);

        // TOC entry
        const tocItem = document.createElement('li');
        const tocLink = document.createElement('a');
        tocLink.href = `#${section.id}`;
        tocLink.textContent = `${section.title} (${results.length})`;
        tocItem.appendChild(tocLink);
        tocList.appendChild(tocItem);

        // Section panel
        const panel = document.createElement('div');
        panel.className = 'analysis-section';
        panel.id = section.id;

        const header = document.createElement('div');
        header.className = 'analysis-section-header';
        header.innerHTML = `
            <span class="analysis-section-title">${section.title}</span>
            <span class="analysis-section-count">${results.length}</span>
            <span class="analysis-section-chevron">&#9654;</span>
        `;

        const body = document.createElement('div');
        body.className = 'analysis-section-body hidden';

        if (results.length === 0) {
            body.innerHTML = '<div class="no-results">No matching quests</div>';
        } else {
            body.appendChild(buildQuestTable(results));
        }

        const chevron = header.querySelector('.analysis-section-chevron');
        header.addEventListener('click', () => toggleSection(body, chevron));
        tocLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (body.classList.contains('hidden')) {
                toggleSection(body, chevron);
            }
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        panel.appendChild(header);
        panel.appendChild(body);
        container.appendChild(panel);
    });

    toc.appendChild(tocList);

    // Unverified quests
    const unverified = Object.keys(questRewards).filter(n => !getApiQuest(n)).sort();
    if (unverified.length > 0) {
        const tocItem = document.createElement('li');
        const tocLink = document.createElement('a');
        tocLink.href = '#unverified';
        tocLink.textContent = `Unverified Quests (${unverified.length})`;
        tocItem.appendChild(tocLink);
        tocList.appendChild(tocItem);

        renderUnverifiedSection(container, unverified, tocLink);
    }
}

function buildQuestTable(results) {
    const table = document.createElement('table');
    table.className = 'analysis-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Lv</th><th>Quest</th><th>Matching Items</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    results.forEach(({ quest, items }) => {
        const tr = document.createElement('tr');
        const api = getApiQuest(quest);

        // Level
        const tdLvl = document.createElement('td');
        tdLvl.className = 'analysis-table-level';
        tdLvl.textContent = api?.level ?? '—';
        tr.appendChild(tdLvl);

        // Quest name
        const tdName = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'analysis-quest-link';
        link.textContent = quest;
        link.href = 'quests.html';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            sessionStorage.setItem('selectedQuest', quest);
            window.location.href = 'quests.html';
        });
        tdName.appendChild(link);
        if (!api) {
            const tag = document.createElement('span');
            tag.className = 'quest-unverified-tag';
            tag.title = 'Not found on corepunk.help';
            tag.textContent = '?';
            tdName.appendChild(tag);
        }
        tr.appendChild(tdName);

        // Items (plain text, comma-separated)
        const tdItems = document.createElement('td');
        tdItems.className = 'analysis-table-items';
        tdItems.textContent = items.join(', ');
        tr.appendChild(tdItems);

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    return table;
}

function renderUnverifiedSection(container, unverified, tocLink) {
    const panel = document.createElement('div');
    panel.className = 'analysis-section';
    panel.id = 'unverified';

    const header = document.createElement('div');
    header.className = 'analysis-section-header';
    header.innerHTML = `
        <span class="analysis-section-title">Unverified Quests</span>
        <span class="analysis-section-count">${unverified.length}</span>
        <span class="analysis-section-chevron">&#9654;</span>
    `;

    const body = document.createElement('div');
    body.className = 'analysis-section-body hidden';

    const note = document.createElement('p');
    note.className = 'analysis-section-note';
    note.textContent = 'These quests were found in game files but are not listed on corepunk.help. They may not be accessible in-game.';
    body.appendChild(note);

    const table = document.createElement('table');
    table.className = 'analysis-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Quest</th><th>Reward Items</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    unverified.forEach(quest => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'analysis-quest-link';
        link.textContent = quest;
        link.href = 'quests.html';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            sessionStorage.setItem('selectedQuest', quest);
            window.location.href = 'quests.html';
        });
        tdName.appendChild(link);
        tr.appendChild(tdName);

        const tdItems = document.createElement('td');
        tdItems.className = 'analysis-table-items';
        tdItems.textContent = `${questRewards[quest].length} items`;
        tr.appendChild(tdItems);

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    body.appendChild(table);

    const chevron = header.querySelector('.analysis-section-chevron');
    header.addEventListener('click', () => toggleSection(body, chevron));
    tocLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (body.classList.contains('hidden')) {
            toggleSection(body, chevron);
        }
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    panel.appendChild(header);
    panel.appendChild(body);
    container.appendChild(panel);
}

window.addEventListener('DOMContentLoaded', init);
