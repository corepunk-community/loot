let questRewards = {};
let apiQuests = {};
let slugMap = {};
let questMeta = {};

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

function isInChain(questName) {
    const meta = getQuestMeta(questName);
    if (meta && (meta.nextQuests || meta.prevQuests)) return true;
    const api = getApiQuest(questName);
    if (api && api.prerequisiteQuests && api.prerequisiteQuests.length > 0) return true;
    return false;
}

async function init() {
    try {
        const versionsRes = await fetch('versions.json');
        if (!versionsRes.ok) throw new Error('Failed to load versions');
        const versions = await versionsRes.json();
        const latest = versions[versions.length - 1];

        const fetches = [fetch(latest.quest_rewards_file || 'quest_rewards.json')];
        if (latest.api_quests_file) fetches.push(fetch(latest.api_quests_file));
        if (latest.quest_metadata_file) fetches.push(fetch(latest.quest_metadata_file));

        const [rewardsRes, apiRes, metaRes] = await Promise.all(fetches);

        if (rewardsRes.ok) questRewards = await rewardsRes.json();
        if (apiRes && apiRes.ok) {
            const apiData = await apiRes.json();
            const questList = Array.isArray(apiData) ? apiData : apiData.quests || [];
            questList.forEach(q => { apiQuests[q.slug] = q; });
            if (apiData.slugMap) slugMap = apiData.slugMap;
        }
        if (metaRes && metaRes.ok) questMeta = await metaRes.json();

        render();
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('locations-container').innerHTML =
            '<div class="error-message">Failed to load quest data.</div>';
    }
}

function render() {
    // Group quests by region (from binary metadata, primary source)
    const byRegion = {};
    const questNames = Object.keys(questRewards).sort();

    questNames.forEach(name => {
        const meta = getQuestMeta(name);
        const api = getApiQuest(name);
        const region = meta?.region || api?.location || 'Unknown';
        if (!byRegion[region]) byRegion[region] = [];
        byRegion[region].push(name);
    });

    // Sort regions by quest count descending
    const sortedRegions = Object.entries(byRegion).sort((a, b) => b[1].length - a[1].length);

    // Summary
    const summaryEl = document.getElementById('locations-summary');
    summaryEl.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${sortedRegions.length}</div>
                <div class="stat-label">Regions</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${questNames.length}</div>
                <div class="stat-label">Quests with Rewards</div>
            </div>
        </div>
    `;

    // Render regions
    const container = document.getElementById('locations-container');
    container.innerHTML = '';

    sortedRegions.forEach(([region, quests], idx) => {
        const section = document.createElement('div');
        section.className = 'chain-group';

        const header = document.createElement('div');
        header.className = 'chain-group-header';
        header.innerHTML = `
            <span class="chain-group-title">${region}</span>
            <span class="chain-group-count">${quests.length} quests</span>
            <span class="chain-group-chevron">&#9654;</span>
        `;

        const body = document.createElement('div');
        body.className = 'chain-group-body';
        if (idx > 0) body.classList.add('hidden');
        else header.querySelector('.chain-group-chevron').classList.add('expanded');

        header.addEventListener('click', () => {
            body.classList.toggle('hidden');
            header.querySelector('.chain-group-chevron').classList.toggle('expanded');
        });

        // Build table of quests in this region
        const table = document.createElement('table');
        table.className = 'analysis-table';
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr><th>Lv</th><th>Quest</th><th>Giver</th><th>Location Detail</th><th></th></tr>';
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        // Sort quests by level then name
        quests.sort((a, b) => {
            const la = getApiQuest(a)?.level || 999;
            const lb = getApiQuest(b)?.level || 999;
            if (la !== lb) return la - lb;
            return a.localeCompare(b);
        });

        quests.forEach(questName => {
            const api = getApiQuest(questName);
            const meta = getQuestMeta(questName);
            const tr = document.createElement('tr');

            // Level
            const tdLvl = document.createElement('td');
            tdLvl.className = 'analysis-table-level';
            tdLvl.textContent = api?.level ?? '';
            tr.appendChild(tdLvl);

            // Quest name with link
            const tdName = document.createElement('td');
            const link = document.createElement('a');
            link.className = 'analysis-quest-link';
            link.textContent = questName;
            link.href = 'quests.html';
            link.addEventListener('click', (e) => {
                e.preventDefault();
                sessionStorage.setItem('selectedQuest', questName);
                window.location.href = 'quests.html';
            });
            tdName.appendChild(link);

            if (!api) {
                const tag = document.createElement('span');
                tag.className = 'quest-unverified-tag';
                tag.title = 'Not on corepunk.help';
                tag.textContent = '?';
                tdName.appendChild(tag);
            }
            tr.appendChild(tdName);

            // Giver (binary primary, API fallback)
            const tdGiver = document.createElement('td');
            tdGiver.className = 'location-table-giver';
            const giverName = meta?.questGiver || api?.questGiver?.name || '';
            if (api?.questGiver?.slug && giverName) {
                const npcLink = document.createElement('a');
                npcLink.href = `https://corepunk.help/npcs/${api.questGiver.slug}`;
                npcLink.target = '_blank';
                npcLink.rel = 'noopener';
                npcLink.className = 'npc-map-link';
                npcLink.textContent = giverName;
                tdGiver.appendChild(npcLink);
            } else {
                tdGiver.textContent = giverName;
            }
            tr.appendChild(tdGiver);

            // Location detail (binary sublocation)
            const tdLoc = document.createElement('td');
            tdLoc.className = 'location-table-detail';
            tdLoc.textContent = meta?.questLocation || '';
            tr.appendChild(tdLoc);

            // Chain indicator
            const tdChain = document.createElement('td');
            tdChain.className = 'location-table-chain';
            if (isInChain(questName)) {
                const icon = document.createElement('span');
                icon.className = 'chain-icon';
                icon.title = 'Part of a quest chain';
                icon.textContent = '\u2197';
                tdChain.appendChild(icon);
            }
            tr.appendChild(tdChain);

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        body.appendChild(table);
        section.appendChild(header);
        section.appendChild(body);
        container.appendChild(section);
    });
}

window.addEventListener('DOMContentLoaded', init);
