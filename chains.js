let chainGroups = [];
let questRewards = {};
let apiQuests = {};

function toSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
}

function getApiQuest(questName) {
    return apiQuests[toSlug(questName)] || null;
}

async function fetchData() {
    try {
        const [chainsRes, versionsRes] = await Promise.all([
            fetch('quest_chain_groups.json'),
            fetch('versions.json')
        ]);

        if (!chainsRes.ok) throw new Error('Failed to load chain data');
        chainGroups = await chainsRes.json();

        // Load latest data from version manifest
        if (versionsRes.ok) {
            const versions = await versionsRes.json();
            const latestVersion = versions[versions.length - 1];

            const rewardsFile = latestVersion.quest_rewards_file || 'quest_rewards.json';
            const fetches = [fetch(rewardsFile)];
            if (latestVersion.api_quests_file) fetches.push(fetch(latestVersion.api_quests_file));

            const [rewardsRes, apiRes] = await Promise.all(fetches);
            if (rewardsRes.ok) {
                questRewards = await rewardsRes.json();
            }
            if (apiRes && apiRes.ok) {
                const apiData = await apiRes.json();
                apiData.forEach(q => { apiQuests[q.slug] = q; });
            }
        }

        renderSummary();
        renderChains();
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('chains-container').innerHTML =
            '<div class="error-message">Failed to load quest chain data.</div>';
    }
}

function renderSummary() {
    const totalQuests = chainGroups.reduce((sum, c) => sum + c.length, 0);
    const container = document.getElementById('chains-summary');
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${chainGroups.length}</div>
                <div class="stat-label">Quest Chains</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalQuests}</div>
                <div class="stat-label">Linked Quests</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${chainGroups[0] ? chainGroups[0].length : 0}</div>
                <div class="stat-label">Longest Chain</div>
            </div>
        </div>
    `;
}

// Build a depth map using BFS from root nodes
function buildDepthMap(chain) {
    const depthMap = {};
    const nameToNode = {};
    chain.forEach(q => { nameToNode[q.name] = q; });

    // Find roots (no requires)
    const roots = chain.filter(q => !q.requires || q.requires.length === 0);

    // BFS from roots
    const queue = [];
    roots.forEach(r => {
        depthMap[r.name] = 0;
        queue.push(r.name);
    });

    while (queue.length > 0) {
        const current = queue.shift();
        const node = nameToNode[current];
        if (!node || !node.unlocks) continue;

        node.unlocks.forEach(next => {
            if (depthMap[next] === undefined || depthMap[next] < depthMap[current] + 1) {
                depthMap[next] = depthMap[current] + 1;
                queue.push(next);
            }
        });
    }

    return depthMap;
}

// Group quests by their depth (step number)
function groupByDepth(chain, depthMap) {
    const groups = {};
    chain.forEach(q => {
        const depth = depthMap[q.name] !== undefined ? depthMap[q.name] : 0;
        if (!groups[depth]) groups[depth] = [];
        groups[depth].push(q);
    });
    return groups;
}

function renderChains() {
    const container = document.getElementById('chains-container');
    container.innerHTML = '';

    chainGroups.forEach((chain, idx) => {
        const section = document.createElement('div');
        section.className = 'chain-group';

        // Chain header
        const header = document.createElement('div');
        header.className = 'chain-group-header';
        header.innerHTML = `
            <span class="chain-group-title">Chain ${idx + 1}</span>
            <span class="chain-group-count">${chain.length} quests</span>
            <span class="chain-group-chevron">&#9654;</span>
        `;

        // Chain body (initially visible for first chain, collapsed for rest)
        const body = document.createElement('div');
        body.className = 'chain-group-body';
        if (idx > 0) body.classList.add('hidden');
        else header.querySelector('.chain-group-chevron').classList.add('expanded');

        header.addEventListener('click', () => {
            body.classList.toggle('hidden');
            header.querySelector('.chain-group-chevron').classList.toggle('expanded');
        });

        // Build the timeline
        const depthMap = buildDepthMap(chain);
        const groups = groupByDepth(chain, depthMap);
        const maxDepth = Math.max(...Object.keys(groups).map(Number));

        const timeline = document.createElement('div');
        timeline.className = 'chain-timeline';

        for (let depth = 0; depth <= maxDepth; depth++) {
            const stepQuests = groups[depth] || [];
            if (stepQuests.length === 0) continue;

            const step = document.createElement('div');
            step.className = 'chain-step';

            // Step label
            const label = document.createElement('div');
            label.className = 'chain-step-label';
            label.textContent = depth === 0 ? 'Start' : `Step ${depth}`;
            step.appendChild(label);

            // Quest nodes at this step
            const nodesRow = document.createElement('div');
            nodesRow.className = 'chain-step-nodes';

            stepQuests.forEach(q => {
                const node = document.createElement('div');
                node.className = 'chain-node';

                const hasRewards = questRewards.hasOwnProperty(q.name);
                const api = getApiQuest(q.name);

                // Node title with level
                const title = document.createElement('div');
                title.className = 'chain-node-title';

                if (api && api.level) {
                    const lvl = document.createElement('span');
                    lvl.className = 'quest-level-badge';
                    lvl.textContent = api.level;
                    title.appendChild(lvl);
                }

                if (hasRewards) {
                    const link = document.createElement('a');
                    link.href = `quests.html`;
                    link.textContent = q.name;
                    link.className = 'chain-quest-link';
                    link.addEventListener('click', (e) => {
                        sessionStorage.setItem('selectedQuest', q.name);
                    });
                    title.appendChild(link);
                } else {
                    title.appendChild(document.createTextNode(q.name));
                    title.classList.add('chain-node-dim');
                }
                node.appendChild(title);

                // Location
                if (api && api.location) {
                    const locDiv = document.createElement('div');
                    locDiv.className = 'chain-node-meta';
                    locDiv.innerHTML = `<span class="chain-meta-label">Location:</span> ${api.location}`;
                    node.appendChild(locDiv);
                }

                // Connections info
                if (q.requires && q.requires.length > 0) {
                    const reqDiv = document.createElement('div');
                    reqDiv.className = 'chain-node-meta chain-node-requires';
                    reqDiv.innerHTML = `<span class="chain-meta-label">Requires:</span> ${q.requires.join(', ')}`;
                    node.appendChild(reqDiv);
                }
                if (q.unlocks && q.unlocks.length > 0) {
                    const unlDiv = document.createElement('div');
                    unlDiv.className = 'chain-node-meta chain-node-unlocks';
                    unlDiv.innerHTML = `<span class="chain-meta-label">Unlocks:</span> ${q.unlocks.join(', ')}`;
                    node.appendChild(unlDiv);
                }

                nodesRow.appendChild(node);
            });

            step.appendChild(nodesRow);
            timeline.appendChild(step);

            // Add connector arrow between steps (except after last)
            if (depth < maxDepth) {
                const connector = document.createElement('div');
                connector.className = 'chain-connector';
                connector.innerHTML = '&#9660;';
                timeline.appendChild(connector);
            }
        }

        body.appendChild(timeline);
        section.appendChild(header);
        section.appendChild(body);
        container.appendChild(section);
    });
}

// On quests.html, check for a selectedQuest from chains page
function checkInboundNavigation() {
    const selected = sessionStorage.getItem('selectedQuest');
    if (selected) {
        sessionStorage.removeItem('selectedQuest');
    }
}

function init() {
    fetchData();
}

window.addEventListener('DOMContentLoaded', init);
