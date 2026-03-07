let binaryChainGroups = [];
let questRewards = {};
let apiQuests = {};
let slugMap = {};
let allChainGroups = []; // Unified chain groups for rendering

function toSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
}

function getApiQuest(questName) {
    const slug = toSlug(questName);
    return apiQuests[slug] || apiQuests[slugMap[slug]] || null;
}

// Get display name for a quest (prefer API name, fall back to binary name or slug)
function getDisplayName(slug) {
    if (apiQuests[slug]) return apiQuests[slug].name;
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function fetchData() {
    try {
        const [chainsRes, versionsRes] = await Promise.all([
            fetch('quest_chain_groups.json'),
            fetch('versions.json')
        ]);

        if (chainsRes.ok) {
            binaryChainGroups = await chainsRes.json();
        }

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
                const questList = Array.isArray(apiData) ? apiData : apiData.quests || [];
                questList.forEach(q => { apiQuests[q.slug] = q; });
                if (apiData.slugMap) slugMap = apiData.slugMap;
            }
        }

        allChainGroups = buildUnifiedChains();
        renderSummary();
        renderChains();
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('chains-container').innerHTML =
            '<div class="error-message">Failed to load quest chain data.</div>';
    }
}

// Build unified chain groups from both binary and API data
function buildUnifiedChains() {
    // Build a graph from API prerequisiteQuests
    const apiGraph = {}; // slug -> { requires: [slugs], unlocks: [slugs] }
    Object.values(apiQuests).forEach(q => {
        const slug = q.slug;
        if (!apiGraph[slug]) apiGraph[slug] = { requires: [], unlocks: [] };
        (q.prerequisiteQuests || []).forEach(prereq => {
            if (!prereq) return;
            if (!apiGraph[prereq]) apiGraph[prereq] = { requires: [], unlocks: [] };
            apiGraph[slug].requires.push(prereq);
            apiGraph[prereq].unlocks.push(slug);
        });
    });

    // Find connected components in the API graph
    const visited = new Set();
    const apiComponents = [];

    Object.keys(apiGraph).forEach(slug => {
        if (visited.has(slug)) return;
        if (apiGraph[slug].requires.length === 0 && apiGraph[slug].unlocks.length === 0) return;
        const component = [];
        const queue = [slug];
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current)) continue;
            visited.add(current);
            component.push(current);
            apiGraph[current].requires.forEach(r => { if (!visited.has(r)) queue.push(r); });
            apiGraph[current].unlocks.forEach(u => { if (!visited.has(u)) queue.push(u); });
        }
        if (component.length > 1) {
            apiComponents.push(component);
        }
    });

    // Convert API components to the chain format: [{name, requires, unlocks}, ...]
    const apiChains = apiComponents.map(component => {
        return component.map(slug => {
            const q = apiQuests[slug];
            return {
                name: q ? q.name : getDisplayName(slug),
                slug: slug,
                requires: apiGraph[slug].requires.map(s => apiQuests[s] ? apiQuests[s].name : getDisplayName(s)),
                unlocks: apiGraph[slug].unlocks.map(s => apiQuests[s] ? apiQuests[s].name : getDisplayName(s)),
                source: 'api'
            };
        });
    });

    // Build a set of binary quest slugs that are in chains
    const binaryChainSlugs = new Set();
    binaryChainGroups.forEach(chain => {
        chain.forEach(q => binaryChainSlugs.add(toSlug(q.name)));
    });

    // Merge: for API chains that overlap with binary chains, mark quests with binary data
    // For API chains with no binary overlap, add as API-only chains
    const merged = [];
    const usedApiChainIndices = new Set();

    // First, check each API chain for binary overlap
    apiChains.forEach((apiChain, idx) => {
        const apiSlugs = new Set(apiChain.map(q => q.slug));
        let hasBinaryOverlap = false;
        binaryChainGroups.forEach(binaryChain => {
            binaryChain.forEach(q => {
                const slug = toSlug(q.name);
                const mappedSlug = slugMap[slug] || slug;
                if (apiSlugs.has(slug) || apiSlugs.has(mappedSlug)) {
                    hasBinaryOverlap = true;
                }
            });
        });

        // Mark quests that have binary reward data
        apiChain.forEach(q => {
            const hasRewards = Object.keys(questRewards).some(name => {
                const s = toSlug(name);
                return s === q.slug || slugMap[s] === q.slug;
            });
            q.hasRewards = hasRewards;
        });

        merged.push({
            chain: apiChain,
            source: hasBinaryOverlap ? 'both' : 'api',
        });
    });

    // Add binary-only chains (those not covered by API)
    binaryChainGroups.forEach(binaryChain => {
        const binarySlugs = binaryChain.map(q => {
            const s = toSlug(q.name);
            return slugMap[s] || s;
        });

        // Check if this binary chain is already represented in an API chain
        const isRepresented = merged.some(m => {
            const apiSlugs = new Set(m.chain.map(q => q.slug));
            return binarySlugs.some(s => apiSlugs.has(s));
        });

        if (!isRepresented) {
            const converted = binaryChain.map(q => ({
                name: q.name,
                slug: toSlug(q.name),
                requires: q.requires || [],
                unlocks: q.unlocks || [],
                hasRewards: questRewards.hasOwnProperty(q.name),
                source: 'binary'
            }));
            merged.push({ chain: converted, source: 'binary' });
        }
    });

    // Sort by chain length descending
    merged.sort((a, b) => b.chain.length - a.chain.length);

    return merged;
}

function renderSummary() {
    const totalQuests = allChainGroups.reduce((sum, g) => sum + g.chain.length, 0);
    const apiOnlyCount = allChainGroups.filter(g => g.source === 'api').length;
    const container = document.getElementById('chains-summary');
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${allChainGroups.length}</div>
                <div class="stat-label">Quest Chains</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalQuests}</div>
                <div class="stat-label">Linked Quests</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${allChainGroups[0] ? allChainGroups[0].chain.length : 0}</div>
                <div class="stat-label">Longest Chain</div>
            </div>
        </div>
    `;
}

// Build a depth map using topological sort (longest path)
function buildDepthMap(chain) {
    const depthMap = {};
    const nameToNode = {};
    const inDegree = {};

    chain.forEach(q => {
        nameToNode[q.name] = q;
        inDegree[q.name] = 0;
    });

    chain.forEach(q => {
        let count = 0;
        if (q.requires) {
            q.requires.forEach(req => { if (nameToNode[req]) count++; });
        }
        inDegree[q.name] = count;
    });

    const queue = [];
    chain.forEach(q => {
        if (inDegree[q.name] === 0) {
            depthMap[q.name] = 0;
            queue.push(q.name);
        }
    });

    while (queue.length > 0) {
        const current = queue.shift();
        const node = nameToNode[current];
        if (!node || !node.unlocks) continue;

        node.unlocks.forEach(next => {
            if (!nameToNode[next]) return;
            const newDepth = depthMap[current] + 1;
            if (depthMap[next] === undefined || depthMap[next] < newDepth) {
                depthMap[next] = newDepth;
            }
            inDegree[next]--;
            if (inDegree[next] === 0) {
                queue.push(next);
            }
        });
    }

    return depthMap;
}

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

    allChainGroups.forEach((group, idx) => {
        const chain = group.chain;
        const section = document.createElement('div');
        section.className = 'chain-group';

        // Build chain title from first quest or longest path root
        const depthMap = buildDepthMap(chain);
        const roots = chain.filter(q => depthMap[q.name] === 0);
        const chainTitle = roots.length > 0 ? roots[0].name : chain[0].name;

        // Source badge
        const sourceBadge = group.source === 'api' ? ' <span class="chain-source-badge chain-source-api">API</span>'
            : group.source === 'binary' ? ' <span class="chain-source-badge chain-source-binary">Binary</span>'
            : '';

        // Chain header
        const header = document.createElement('div');
        header.className = 'chain-group-header';
        header.innerHTML = `
            <span class="chain-group-title">${chainTitle}${sourceBadge}</span>
            <span class="chain-group-count">${chain.length} quests</span>
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

        const groups = groupByDepth(chain, depthMap);
        const maxDepth = Math.max(...Object.keys(groups).map(Number));

        const timeline = document.createElement('div');
        timeline.className = 'chain-timeline';

        for (let depth = 0; depth <= maxDepth; depth++) {
            const stepQuests = groups[depth] || [];
            if (stepQuests.length === 0) continue;

            const step = document.createElement('div');
            step.className = 'chain-step';

            const label = document.createElement('div');
            label.className = 'chain-step-label';
            label.textContent = depth === 0 ? 'Start' : `Step ${depth}`;
            step.appendChild(label);

            const nodesRow = document.createElement('div');
            nodesRow.className = 'chain-step-nodes';

            stepQuests.forEach(q => {
                const node = document.createElement('div');
                node.className = 'chain-node';

                const hasRewards = q.hasRewards !== undefined ? q.hasRewards : questRewards.hasOwnProperty(q.name);
                const api = apiQuests[q.slug] || getApiQuest(q.name);

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
                    link.href = 'quests.html';
                    link.textContent = q.name;
                    link.className = 'chain-quest-link';
                    link.addEventListener('click', () => {
                        sessionStorage.setItem('selectedQuest', q.name);
                    });
                    title.appendChild(link);
                } else {
                    title.appendChild(document.createTextNode(q.name));
                    title.classList.add('chain-node-dim');
                }
                node.appendChild(title);

                if (api && api.location) {
                    const locDiv = document.createElement('div');
                    locDiv.className = 'chain-node-meta';
                    locDiv.innerHTML = `<span class="chain-meta-label">Location:</span> ${api.location}`;
                    node.appendChild(locDiv);
                }

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

function init() {
    fetchData();
}

window.addEventListener('DOMContentLoaded', init);
