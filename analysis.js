let questRewards = {};
let apiQuests = {};
let slugMap = {};
let questMeta = {};
let questNotes = {};

function toSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
}

function getApiQuest(questName) {
    const slug = toSlug(questName);
    return apiQuests[slug] || apiQuests[slugMap[slug]] || null;
}

function getQuestMeta(questName) {
    const id = questName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '_').replace(/-/g, '_').trim();
    return questMeta[id] || null;
}

function isPIRelated(questName) {
    const meta = getQuestMeta(questName);
    if (meta?.region === 'Prison Island') return true;
    if (meta?.piRelated) return true;
    if (questNotes[questName]?.piRelated) return true;
    return false;
}

// Quest reward items used to be plain strings; they are now objects of
// shape { name, qty, head, flag } as of v0.103. These helpers normalize
// either shape so the rest of the page doesn't have to care.
function itemDisplayName(item) {
    if (typeof item === 'string') return item;
    return item?.name || '';
}

function formatItemEntry(item) {
    if (typeof item === 'string') return item;
    if (item.qty != null && item.qty > 1) return `${item.qty}× ${item.name}`;
    return item.name || '';
}

function getItemType(item) {
    const lower = itemDisplayName(item).toLowerCase();
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
        // API data is version-independent in practice; fall back to the most
        // recent version that has it so --skip-api on the newest run doesn't
        // wipe out all enrichment.
        const latestWithApi = [...versions].reverse().find(v => v.api_quests_file);
        const apiQuestsFile = latest.api_quests_file || latestWithApi?.api_quests_file;

        // Use fixed slots so positional destructuring stays correct even when
        // the API or metadata fetch is skipped for this version.
        const fetches = [
            fetch(rewardsFile),
            apiQuestsFile ? fetch(apiQuestsFile) : Promise.resolve(null),
            latest.quest_metadata_file ? fetch(latest.quest_metadata_file) : Promise.resolve(null),
        ];

        const [rewardsRes, apiRes, metaRes] = await Promise.all(fetches);
        if (!rewardsRes.ok) throw new Error('Failed to load quest rewards');
        questRewards = await rewardsRes.json();

        if (apiRes && apiRes.ok) {
            const apiData = await apiRes.json();
            const questList = Array.isArray(apiData) ? apiData : apiData.quests || [];
            questList.forEach(q => { apiQuests[q.slug] = q; });
            if (apiData.slugMap) slugMap = apiData.slugMap;
        }

        if (metaRes && metaRes.ok) {
            questMeta = await metaRes.json();
        }

        try {
            const notesRes = await fetch('quest_notes.json');
            if (notesRes.ok) questNotes = await notesRes.json();
        } catch (e) { /* notes are optional */ }

        // Initialize quest modal
        QuestModal.init({ questRewards, apiQuests, slugMap, questMeta, questNotes });

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
    const uniqueItems = [...new Set(allItems.map(itemDisplayName))];
    const avgItems = quests.length > 0 ? (allItems.length / quests.length).toFixed(1) : 0;

    document.getElementById('stat-total-quests').textContent = quests.length;
    document.getElementById('stat-unique-items').textContent = uniqueItems.length;
    document.getElementById('stat-avg-items').textContent = avgItems;

    // Top rewards (count quests that include each item, by display name)
    const itemCounts = {};
    allItems.forEach(item => {
        const name = itemDisplayName(item);
        itemCounts[name] = (itemCounts[name] || 0) + 1;
    });
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
            predicate: item => itemDisplayName(item) === 'Synthesis Item Upgrade T2 Epic'
        },
        {
            id: 'upgrade-t3-epic',
            title: 'Item Upgrade T3 Epic',
            predicate: item => itemDisplayName(item) === 'Synthesis Item Upgrade T3 Epic'
        },
        {
            id: 'weapons',
            title: 'Weapons or Weapon Recipes',
            predicate: item => {
                const lower = itemDisplayName(item).toLowerCase();
                return (lower.startsWith('wp ') || lower.startsWith('rec wp '));
            }
        },
        {
            id: 't3-artifacts',
            title: 'T3 Artifacts or Artifact Recipes',
            predicate: item => {
                const lower = itemDisplayName(item).toLowerCase();
                return (lower.startsWith('art t3 ') || lower.startsWith('rec art t3 '));
            }
        },
        {
            id: 'talent-fragmenters',
            title: 'Talent Fragmenters',
            predicate: item => itemDisplayName(item) === 'Talent Fragmenter'
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

    // Quests by Region
    const regionsTocItem = document.createElement('li');
    const regionsTocLink = document.createElement('a');
    regionsTocLink.href = '#regions';
    regionsTocLink.textContent = 'Quests by Region';
    regionsTocItem.appendChild(regionsTocLink);
    tocList.appendChild(regionsTocItem);

    renderLocationAnalysis(container, regionsTocLink);
}

function buildQuestTable(results) {
    const table = document.createElement('table');
    table.className = 'analysis-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Lv</th><th>Quest</th><th>Location</th><th>Giver</th><th>Matching Items</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    results.forEach(({ quest, items }) => {
        const tr = document.createElement('tr');
        const api = getApiQuest(quest);
        const meta = getQuestMeta(quest);

        // Level
        const tdLvl = document.createElement('td');
        tdLvl.className = 'analysis-table-level';
        tdLvl.textContent = api?.level ?? '';
        tr.appendChild(tdLvl);

        // Quest name
        const tdName = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'analysis-quest-link';
        link.textContent = quest;
        link.href = '#';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            QuestModal.show(quest);
        });
        tdName.appendChild(link);
        if (isPIRelated(quest)) {
            const badge = document.createElement('span');
            badge.className = 'region-badge region-badge-prison';
            badge.textContent = 'PI';
            badge.title = meta?.region === 'Prison Island' ? 'Prison Island' : 'Prison Island related';
            tdName.appendChild(badge);
        }
        if (!api) {
            const tag = document.createElement('span');
            tag.className = 'quest-unverified-tag';
            tag.title = 'Not found on corepunk.help';
            tag.textContent = '?';
            tdName.appendChild(tag);
        }
        tr.appendChild(tdName);

        // Location
        const tdLocation = document.createElement('td');
        tdLocation.textContent = meta?.questLocation || meta?.region || api?.location || '';
        tr.appendChild(tdLocation);

        // Giver
        const tdGiver = document.createElement('td');
        const giverName = meta?.questGiver || api?.questGiver?.name || '';
        const giverSlug = api?.questGiver?.slug || '';
        if (giverName && giverSlug) {
            tdGiver.innerHTML = `<a href="https://corepunk.help/npcs/${giverSlug}" target="_blank" rel="noopener" class="npc-map-link">${giverName}</a>`;
        } else {
            tdGiver.textContent = giverName;
        }
        tr.appendChild(tdGiver);

        // Items (plain text, comma-separated)
        const tdItems = document.createElement('td');
        tdItems.className = 'analysis-table-items';
        tdItems.textContent = items.map(formatItemEntry).join(', ');
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
    note.textContent = 'These quests exist in game files but are not on corepunk.help. They may be upcoming content, inactive Prison Island events, or use different names on the API.';
    body.appendChild(note);

    const table = document.createElement('table');
    table.className = 'analysis-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Quest</th><th>Region</th><th>Location</th><th>Giver</th><th>Note</th><th>Items</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    unverified.forEach(quest => {
        const tr = document.createElement('tr');
        const meta = getQuestMeta(quest);

        // Quest name
        const tdName = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'analysis-quest-link';
        link.textContent = quest;
        link.href = '#';
        link.addEventListener('click', (e) => {
            e.preventDefault();
            QuestModal.show(quest);
        });
        tdName.appendChild(link);
        if (isPIRelated(quest)) {
            const badge = document.createElement('span');
            badge.className = 'region-badge region-badge-prison';
            badge.textContent = 'PI';
            badge.title = meta?.region === 'Prison Island' ? 'Prison Island' : 'Prison Island related';
            tdName.appendChild(badge);
        }
        tr.appendChild(tdName);

        // Region
        const tdRegion = document.createElement('td');
        tdRegion.textContent = meta?.region || '';
        tr.appendChild(tdRegion);

        // Location
        const tdLocation = document.createElement('td');
        tdLocation.textContent = meta?.questLocation || '';
        tr.appendChild(tdLocation);

        // Giver
        const tdGiver = document.createElement('td');
        tdGiver.textContent = meta?.questGiver || '';
        tr.appendChild(tdGiver);

        // Note
        const tdNote = document.createElement('td');
        tdNote.className = 'analysis-table-note';
        tdNote.textContent = questNotes[quest]?.note || '';
        tr.appendChild(tdNote);

        // Items count
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

function renderLocationAnalysis(container, tocLink) {
    const allQuests = Object.keys(questRewards);
    const regionGroups = {};

    allQuests.forEach(quest => {
        const meta = getQuestMeta(quest);
        const region = meta?.region || 'Unknown';
        if (!regionGroups[region]) {
            regionGroups[region] = { quests: [], totalItems: 0 };
        }
        regionGroups[region].quests.push(quest);
        regionGroups[region].totalItems += questRewards[quest].length;
    });

    const sortedRegions = Object.entries(regionGroups).sort((a, b) => b[1].quests.length - a[1].quests.length);

    const panel = document.createElement('div');
    panel.className = 'analysis-section';
    panel.id = 'regions';

    const header = document.createElement('div');
    header.className = 'analysis-section-header';
    header.innerHTML = `
        <span class="analysis-section-title">Quests by Region</span>
        <span class="analysis-section-count">${sortedRegions.length} regions</span>
        <span class="analysis-section-chevron">&#9654;</span>
    `;

    const body = document.createElement('div');
    body.className = 'analysis-section-body hidden';

    const table = document.createElement('table');
    table.className = 'analysis-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Region</th><th>Quests</th><th>% of Total</th><th>Avg Items</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    sortedRegions.forEach(([region, data]) => {
        const tr = document.createElement('tr');

        const tdRegion = document.createElement('td');
        tdRegion.textContent = region;
        tr.appendChild(tdRegion);

        const tdCount = document.createElement('td');
        tdCount.textContent = data.quests.length;
        tr.appendChild(tdCount);

        const tdPct = document.createElement('td');
        const pct = ((data.quests.length / allQuests.length) * 100).toFixed(1);
        tdPct.textContent = `${pct}%`;
        tr.appendChild(tdPct);

        const tdAvg = document.createElement('td');
        const avg = data.quests.length > 0 ? (data.totalItems / data.quests.length).toFixed(1) : '0';
        tdAvg.textContent = avg;
        tr.appendChild(tdAvg);

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
