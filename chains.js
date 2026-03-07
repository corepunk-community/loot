let questMeta = {};
let questRewards = {};
let apiQuests = {};
let slugMap = {};
let questNotes = {};
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
        const versionsRes = await fetch('versions.json');

        // Load latest data from version manifest
        if (versionsRes.ok) {
            const versions = await versionsRes.json();
            const latestVersion = versions[versions.length - 1];

            const rewardsFile = latestVersion.quest_rewards_file || 'quest_rewards.json';
            const fetches = [fetch(rewardsFile)];
            if (latestVersion.api_quests_file) fetches.push(fetch(latestVersion.api_quests_file));
            if (latestVersion.quest_metadata_file) fetches.push(fetch(latestVersion.quest_metadata_file));

            const [rewardsRes, apiRes, metaRes] = await Promise.all(fetches);
            if (rewardsRes.ok) {
                questRewards = await rewardsRes.json();
            }
            if (apiRes && apiRes.ok) {
                const apiData = await apiRes.json();
                const questList = Array.isArray(apiData) ? apiData : apiData.quests || [];
                questList.forEach(q => { apiQuests[q.slug] = q; });
                if (apiData.slugMap) slugMap = apiData.slugMap;
            }
            if (metaRes && metaRes.ok) {
                questMeta = await metaRes.json();
            }
        }

        // Load quest notes
        try {
            const notesRes = await fetch('quest_notes.json');
            if (notesRes.ok) questNotes = await notesRes.json();
        } catch (e) { /* optional */ }

        // Initialize quest modal
        QuestModal.init({ questRewards, apiQuests, slugMap, questMeta, questNotes });

        allChainGroups = buildUnifiedChains();
        renderSummary();
        renderChains();
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('chains-container').innerHTML =
            '<div class="error-message">Failed to load quest chain data.</div>';
    }
}

// Convert a quest ID (e.g. "a_bitter_brew") to a display name
function formatQuestId(id) {
    return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Build binary chain groups from questMeta nextQuests/prevQuests
function buildBinaryChainGroups() {
    // Build adjacency graph from metadata entries with nextQuests or prevQuests
    const graph = {}; // id -> Set of connected ids
    Object.values(questMeta).forEach(entry => {
        const id = entry.id;
        const hasNext = entry.nextQuests && entry.nextQuests.length > 0;
        const hasPrev = entry.prevQuests && entry.prevQuests.length > 0;
        if (!hasNext && !hasPrev) return;

        if (!graph[id]) graph[id] = new Set();

        (entry.nextQuests || []).forEach(nid => {
            if (!graph[nid]) graph[nid] = new Set();
            graph[id].add(nid);
            graph[nid].add(id);
        });
        (entry.prevQuests || []).forEach(pid => {
            if (!graph[pid]) graph[pid] = new Set();
            graph[id].add(pid);
            graph[pid].add(id);
        });
    });

    // Find connected components via BFS
    const visited = new Set();
    const components = [];

    Object.keys(graph).forEach(id => {
        if (visited.has(id)) return;
        const component = [];
        const queue = [id];
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current)) continue;
            visited.add(current);
            component.push(current);
            graph[current].forEach(neighbor => {
                if (!visited.has(neighbor)) queue.push(neighbor);
            });
        }
        if (component.length > 1) {
            components.push(component);
        }
    });

    // Convert each component to chain format: [{name, slug, requires: [names], unlocks: [names]}, ...]
    return components.map(component => {
        return component.map(id => {
            const entry = questMeta[id];
            const name = entry ? entry.name : formatQuestId(id);
            const nextIds = entry ? (entry.nextQuests || []) : [];
            const prevIds = entry ? (entry.prevQuests || []) : [];
            return {
                name: name,
                slug: toSlug(name),
                requires: prevIds.map(pid => questMeta[pid] ? questMeta[pid].name : formatQuestId(pid)),
                unlocks: nextIds.map(nid => questMeta[nid] ? questMeta[nid].name : formatQuestId(nid))
            };
        });
    });
}

// Build unified chain groups from both binary and API data
function buildUnifiedChains() {
    const binaryChainGroups = buildBinaryChainGroups();

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

// Build a depth map using topological sort (longest path from roots)
function buildDepthMap(chain) {
    const nameToNode = {};
    const inDegree = {};

    chain.forEach(q => {
        nameToNode[q.name] = q;
        inDegree[q.name] = 0;
    });

    chain.forEach(q => {
        (q.requires || []).forEach(req => {
            if (nameToNode[req]) inDegree[q.name]++;
        });
    });

    const depthMap = {};
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
        if (!node) continue;
        (node.unlocks || []).forEach(next => {
            if (!nameToNode[next]) return;
            const d = depthMap[current] + 1;
            if (depthMap[next] === undefined || depthMap[next] < d) depthMap[next] = d;
            inDegree[next]--;
            if (inDegree[next] === 0) queue.push(next);
        });
    }

    // Handle any remaining (cycles) — assign depth 0
    chain.forEach(q => { if (depthMap[q.name] === undefined) depthMap[q.name] = 0; });
    return depthMap;
}

// Build edges: parent name -> [child names] (within chain)
function buildEdges(chain) {
    const nameSet = new Set(chain.map(q => q.name));
    const edges = {};
    chain.forEach(q => {
        const children = (q.unlocks || []).filter(n => nameSet.has(n));
        if (children.length > 0) edges[q.name] = children;
    });
    return edges;
}

// Create a quest node DOM element
function createQuestNode(q) {
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

    const link = document.createElement('a');
    link.href = '#';
    link.textContent = q.name;
    link.className = 'chain-quest-link';
    if (!hasRewards) link.classList.add('chain-quest-link-dim');
    link.addEventListener('click', (e) => {
        e.preventDefault();
        QuestModal.show(q.name, q.slug);
    });
    title.appendChild(link);
    node.appendChild(title);

    if (api && api.location) {
        const locDiv = document.createElement('div');
        locDiv.className = 'chain-node-meta';
        locDiv.innerHTML = `<span class="chain-meta-label">Location:</span> ${api.location}`;
        node.appendChild(locDiv);
    }

    return node;
}

// Render a chain as a graph with fork/merge visualization
function renderChainGraph(chain) {
    const depthMap = buildDepthMap(chain);
    const edges = buildEdges(chain);
    const nameToNode = {};
    chain.forEach(q => { nameToNode[q.name] = q; });

    const maxDepth = Math.max(...Object.values(depthMap));

    // Group quests by depth
    const byDepth = {};
    chain.forEach(q => {
        const d = depthMap[q.name];
        if (!byDepth[d]) byDepth[d] = [];
        byDepth[d].push(q);
    });

    // Determine if this is a simple linear chain (no forks)
    const isLinear = chain.every(q => (q.unlocks || []).filter(n => nameToNode[n]).length <= 1)
        && chain.every(q => (q.requires || []).filter(n => nameToNode[n]).length <= 1);

    if (isLinear) {
        return renderLinearChain(chain, byDepth, maxDepth);
    }

    // Complex chain with forks — use grid layout with connectors
    return renderForkedChain(chain, byDepth, maxDepth, edges, depthMap, nameToNode);
}

// Simple linear chain — just a vertical sequence
function renderLinearChain(chain, byDepth, maxDepth) {
    const container = document.createElement('div');
    container.className = 'chain-timeline';

    for (let d = 0; d <= maxDepth; d++) {
        const quests = byDepth[d] || [];
        if (quests.length === 0) continue;

        const step = document.createElement('div');
        step.className = 'chain-step';

        const label = document.createElement('div');
        label.className = 'chain-step-label';
        label.textContent = d === 0 ? 'Start' : `Step ${d}`;
        step.appendChild(label);

        const nodesRow = document.createElement('div');
        nodesRow.className = 'chain-step-nodes';
        quests.forEach(q => nodesRow.appendChild(createQuestNode(q)));
        step.appendChild(nodesRow);
        container.appendChild(step);

        if (d < maxDepth) {
            const conn = document.createElement('div');
            conn.className = 'chain-connector';
            conn.innerHTML = '&#9660;';
            container.appendChild(conn);
        }
    }
    return container;
}

// Forked chain — assign columns to each branch, draw SVG connectors
function renderForkedChain(chain, byDepth, maxDepth, edges, depthMap, nameToNode) {
    const container = document.createElement('div');
    container.className = 'chain-graph';

    // Compute descendant weight for fork ordering (more weight = more forking below)
    const weightCache = {};
    function weight(name) {
        if (weightCache[name] !== undefined) return weightCache[name];
        weightCache[name] = 0; // prevent cycles
        const children = (edges[name] || []).filter(n => nameToNode[n]);
        let w = children.length;
        children.forEach(c => { w += weight(c); });
        weightCache[name] = w;
        return w;
    }

    // Column assignment with reuse: track occupied cells per (depth, col)
    const colMap = {};
    const usedCols = {}; // depth -> Set of col indices

    function useCol(d, col) {
        if (!usedCols[d]) usedCols[d] = new Set();
        usedCols[d].add(col);
    }

    function findFreeCol(startCol, fromD, toD) {
        let col = startCol;
        while (true) {
            let free = true;
            for (let d = fromD; d <= toD; d++) {
                if (usedCols[d] && usedCols[d].has(col)) { free = false; break; }
            }
            if (free) return col;
            col++;
        }
    }

    function assignCol(name, col) {
        if (colMap[name] !== undefined) return;
        const d = depthMap[name];
        colMap[name] = col;
        useCol(d, col);

        const children = (edges[name] || []).filter(n => nameToNode[n] && colMap[n] === undefined);
        if (children.length === 0) return;

        // Sort ascending by weight: lightest (most linear) inherits parent column (left)
        // Heaviest (most forking) goes rightward
        children.sort((a, b) => weight(a) - weight(b));

        // First child (most linear) inherits parent column
        const c0d = depthMap[children[0]];
        for (let dd = d + 1; dd < c0d; dd++) useCol(dd, col);
        assignCol(children[0], col);

        // Other children get new columns nearby, reusing freed space
        for (let i = 1; i < children.length; i++) {
            const cd = depthMap[children[i]];
            const nc = findFreeCol(col + 1, d + 1, cd);
            for (let dd = d + 1; dd <= cd; dd++) useCol(dd, nc);
            assignCol(children[i], nc);
        }
    }

    // Sort roots: lightest first (most linear path on left)
    const roots = (byDepth[0] || []).slice();
    roots.sort((a, b) => weight(a.name) - weight(b.name));
    roots.forEach(q => {
        const col = findFreeCol(0, depthMap[q.name], depthMap[q.name]);
        assignCol(q.name, col);
    });

    // Assign any unvisited quests (cycles, disconnected)
    chain.forEach(q => {
        if (colMap[q.name] === undefined) {
            assignCol(q.name, findFreeCol(0, depthMap[q.name], depthMap[q.name]));
        }
    });

    // Compact: remap to contiguous column indices (removes gaps)
    const usedColNums = [...new Set(Object.values(colMap))].sort((a, b) => a - b);
    const remap = {};
    usedColNums.forEach((c, i) => { remap[c] = i; });
    Object.keys(colMap).forEach(name => { colMap[name] = remap[colMap[name]]; });
    const totalCols = usedColNums.length;

    // Build the grid: rows (depths) × columns
    const grid = [];
    for (let d = 0; d <= maxDepth; d++) {
        const row = new Array(totalCols).fill(null);
        (byDepth[d] || []).forEach(q => {
            row[colMap[q.name]] = q;
        });
        grid.push(row);
    }

    // Render grid as HTML
    const graphEl = document.createElement('div');
    graphEl.className = 'chain-grid';
    graphEl.style.gridTemplateColumns = `60px repeat(${totalCols}, 1fr)`;

    for (let d = 0; d <= maxDepth; d++) {
        const label = document.createElement('div');
        label.className = 'chain-grid-label';
        label.textContent = d === 0 ? 'Start' : `Step ${d}`;
        graphEl.appendChild(label);

        for (let c = 0; c < totalCols; c++) {
            const cell = document.createElement('div');
            cell.className = 'chain-grid-cell';
            const q = grid[d][c];
            if (q) cell.appendChild(createQuestNode(q));
            graphEl.appendChild(cell);
        }

        if (d < maxDepth) {
            const spacer = document.createElement('div');
            spacer.className = 'chain-grid-connector-label';
            graphEl.appendChild(spacer);

            for (let c = 0; c < totalCols; c++) {
                const connCell = document.createElement('div');
                connCell.className = 'chain-grid-connector';
                graphEl.appendChild(connCell);
            }
        }
    }

    // Scroll hint
    const hint = document.createElement('div');
    hint.className = 'chain-scroll-hint';
    hint.textContent = 'Drag to scroll \u2194';
    container.appendChild(hint);

    container.appendChild(graphEl);
    container._edgeData = { grid, edges, colMap, nameToNode, maxDepth, totalCols };

    requestAnimationFrame(() => {
        drawEdgeLines(container, grid, edges, colMap, nameToNode, maxDepth, totalCols);
    });

    enableDragPan(container);

    return container;
}

// Draw SVG lines connecting parent nodes to child nodes
function drawEdgeLines(container, grid, edges, colMap, nameToNode, maxDepth, totalCols) {
    const graphEl = container.querySelector('.chain-grid');
    if (!graphEl) return;

    // Remove any existing SVG
    const existing = container.querySelector('.chain-edge-svg');
    if (existing) existing.remove();

    const rect = graphEl.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('chain-edge-svg');
    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', rect.height);
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';

    container.style.position = 'relative';

    // Find all node elements and their positions
    const nodePositions = {};
    graphEl.querySelectorAll('.chain-grid-cell').forEach(cell => {
        const nodeEl = cell.querySelector('.chain-node');
        if (!nodeEl) return;
        const link = nodeEl.querySelector('.chain-quest-link');
        if (!link) return;
        const name = link.textContent;
        const cellRect = cell.getBoundingClientRect();
        const graphRect = graphEl.getBoundingClientRect();
        nodePositions[name] = {
            cx: cellRect.left - graphRect.left + cellRect.width / 2,
            bottom: cellRect.top - graphRect.top + cellRect.height,
            top: cellRect.top - graphRect.top
        };
    });

    // Draw edges
    Object.entries(edges).forEach(([parent, children]) => {
        const pPos = nodePositions[parent];
        if (!pPos) return;

        children.forEach(child => {
            if (!nameToNode[child]) return;
            const cPos = nodePositions[child];
            if (!cPos) return;

            const isSameCol = colMap[parent] === colMap[child];
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

            const x1 = pPos.cx;
            const y1 = pPos.bottom + 2;
            const x2 = cPos.cx;
            const y2 = cPos.top - 2;
            const midY = (y1 + y2) / 2;

            if (isSameCol) {
                path.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
            } else {
                // Curved path for cross-column edges
                path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
            }

            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', isSameCol ? '#555' : '#666');
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('stroke-dasharray', isSameCol ? 'none' : '4 3');

            svg.appendChild(path);

            // Arrowhead
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const ax = x2;
            const ay = y2;
            arrow.setAttribute('points', `${ax},${ay} ${ax - 4},${ay - 7} ${ax + 4},${ay - 7}`);
            arrow.setAttribute('fill', isSameCol ? '#555' : '#666');
            svg.appendChild(arrow);
        });
    });

    container.appendChild(svg);
}

// Enable click-and-drag horizontal panning on a scrollable element
function enableDragPan(el) {
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let hasMoved = false;

    el.addEventListener('mousedown', (e) => {
        // Don't intercept clicks on links/buttons
        if (e.target.closest('a, button')) return;
        isDown = true;
        hasMoved = false;
        startX = e.pageX - el.offsetLeft;
        scrollLeft = el.scrollLeft;
        el.classList.add('is-dragging');
    });

    el.addEventListener('mouseleave', () => {
        if (isDown) {
            isDown = false;
            el.classList.remove('is-dragging');
        }
    });

    el.addEventListener('mouseup', () => {
        isDown = false;
        el.classList.remove('is-dragging');
    });

    el.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - el.offsetLeft;
        const walk = x - startX;
        if (Math.abs(walk) > 3) hasMoved = true;
        el.scrollLeft = scrollLeft - walk;
    });

    // Suppress click after drag
    el.addEventListener('click', (e) => {
        if (hasMoved) {
            e.stopPropagation();
            e.preventDefault();
            hasMoved = false;
        }
    }, true);

    // Add scroll hint if content overflows
    function checkOverflow() {
        if (el.scrollWidth > el.clientWidth + 10) {
            el.classList.add('has-overflow');
        } else {
            el.classList.remove('has-overflow');
        }
    }

    el.addEventListener('scroll', () => {
        el.classList.add('has-scrolled');
    }, { once: true });

    // Check on load and resize
    requestAnimationFrame(checkOverflow);
    window.addEventListener('resize', checkOverflow);
}

function renderChains() {
    const container = document.getElementById('chains-container');
    container.innerHTML = '';

    allChainGroups.forEach((group, idx) => {
        const chain = group.chain;
        const section = document.createElement('div');
        section.className = 'chain-group';

        // Build chain title from roots
        const depthMap = buildDepthMap(chain);
        const roots = chain.filter(q => depthMap[q.name] === 0);
        const chainTitle = roots.length > 0 ? roots[0].name : chain[0].name;

        // Source badge
        const sourceBadge = group.source === 'api' ? ' <span class="chain-source-badge chain-source-api">API Only</span>'
            : group.source === 'binary' ? ' <span class="chain-source-badge chain-source-binary">Binary Only</span>'
            : ' <span class="chain-source-badge chain-source-both">Verified</span>';

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
            // Redraw SVG lines after body becomes visible
            if (!body.classList.contains('hidden')) {
                requestAnimationFrame(() => {
                    body.querySelectorAll('.chain-graph').forEach(g => {
                        const grid = g.querySelector('.chain-grid');
                        if (grid && g._edgeData) {
                            const d = g._edgeData;
                            drawEdgeLines(g, d.grid, d.edges, d.colMap, d.nameToNode, d.maxDepth, d.totalCols);
                        }
                    });
                });
            }
        });

        body.appendChild(renderChainGraph(chain));
        section.appendChild(header);
        section.appendChild(body);
        container.appendChild(section);
    });
}

function init() {
    fetchData();
}

window.addEventListener('DOMContentLoaded', init);
