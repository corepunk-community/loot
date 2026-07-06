// quest-modal.js — Shared quest detail modal for use across pages
//
// Usage: include this script, then call:
//   QuestModal.init({ questRewards, apiQuests, slugMap, questMeta, questNotes })
//   QuestModal.show(questName)

const QuestModal = (() => {
    let data = {};
    let overlay = null;
    let currentSlug = null;
    let rewardIndex = null; // slug -> reward items, built lazily from questRewards

    function toSlug(name) {
        return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
    }

    function getApiQuest(questName, slug) {
        // Direct slug lookup first (if provided)
        if (slug && data.apiQuests[slug]) return data.apiQuests[slug];
        // Convert name to slug
        const derivedSlug = toSlug(questName);
        if (data.apiQuests[derivedSlug]) return data.apiQuests[derivedSlug];
        if (data.slugMap[derivedSlug] && data.apiQuests[data.slugMap[derivedSlug]]) return data.apiQuests[data.slugMap[derivedSlug]];
        // Fallback: search by name (for API quests with different slugs)
        for (const q of Object.values(data.apiQuests)) {
            if (q.name === questName) return q;
        }
        return null;
    }

    function getQuestMeta(questName) {
        const id = questName.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '_').replace(/-/g, '_').trim();
        return data.questMeta[id] || null;
    }

    function isPIRelated(questName) {
        const meta = getQuestMeta(questName);
        if (meta?.region === 'Prison Island') return true;
        if (meta?.piRelated) return true;
        if (data.questNotes[questName]?.piRelated) return true;
        return false;
    }

    // A quest is "removed content" if the metadata flags it Prison Island-related
    // but it isn't on corepunk.help (it shows the "?" tag) — i.e. no longer
    // reachable in-game. These are cut from every quest UI; the raw JSON keeps
    // them (useful for version diffs, and reversible if a quest returns).
    function isRemovedPI(questName, slug) {
        return !getApiQuest(questName, slug) && isPIRelated(questName);
    }

    function formatQuestId(id) {
        const meta = data.questMeta[id];
        if (meta) return meta.name;
        return id.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    function formatApiSlug(slug) {
        const apiQ = data.apiQuests[slug];
        if (apiQ && apiQ.name) return apiQ.name;
        return slug.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    // An NPC links to the World Map only if it actually exists there (in friendly_npcs);
    // otherwise it's plain text. No corepunk.help links, no dead links.
    function npcOnMap(name) { return !!(name && data.mapNpcs && data.mapNpcs.has(name.toLowerCase())); }
    // Link an NPC to the World Map. Prefer the SLUG (targets the exact entity — clones like
    // greta-grubb vs greta-grubb-steppe are distinct), else fall back to the display name.
    function npcLink(slug, name) {
        if (!name) return '';
        const q = (slug && data.mapSlugs && data.mapSlugs.has(slug.toLowerCase())) ? slug
                : (npcOnMap(name) ? name : null);
        if (!q) return name;
        return `<a href="worldmap.html?npc=${encodeURIComponent(q)}" class="map-link" title="Show ${name} on the World Map">${name}</a>`;
    }
    // Kill-goal monster phrases -> the World Map species filter (matches creatures.json `k`).
    // Order matters: "boar mammoth" before "boar". First match wins.
    const MOB_SPECIES = [
      [/boar\s*mammoth|mammoth/i, 'boarmammoth'], [/wood\s*raptor|woodraptor/i, 'woodraptor'],
      [/wooden\s*deer/i, 'wooden-deer'], [/dendroid/i, 'dendroid'], [/leaf/i, 'leaf'],
      [/fungus/i, 'fungus'], [/spider/i, 'spider'], [/scrag/i, 'scrag'], [/ribbit/i, 'ribbits'],
      [/hyena/i, 'hyena'], [/archosaur/i, 'archosaur'], [/golem/i, 'golem'], [/timber/i, 'timber'],
      [/lacertian/i, 'lacertian'], [/gnoos/i, 'gnoose'], [/wolves|\bwolf/i, 'wolves'],
      [/occultist/i, 'sabbath'], [/chicken/i, 'domestic'], [/turkey/i, 'turkey'],
      [/mutated\s*rat|\brat/i, 'rat'], [/\bimp/i, 'imp'], [/\bboar\b/i, 'boar']
    ];
    // Linkify the monster in a kill/hunt goal -> the map, showing that species' spawns.
    function linkifyMob(desc) {
        if (!desc) return desc;
        for (const [rx, species] of MOB_SPECIES) {
            const m = desc.match(rx);
            if (m) {
                const i = m.index, len = m[0].length;
                return desc.slice(0, i) +
                    `<a href="worldmap.html?mob=${encodeURIComponent(species)}" class="map-link mob-link" title="Show ${desc.substr(i, len)} spawns on the World Map">${desc.substr(i, len)}</a>` +
                    desc.slice(i + len);
            }
        }
        return desc;
    }
    // Linkify any on-map NPC names embedded in free text (e.g. goal "Talk to Varkus Drov").
    function linkifyNpcs(text) {
        if (!text || !data.mapNpcNames || !data.mapNpcNames.length) return text;
        const lower = text.toLowerCase();
        for (const name of data.mapNpcNames) {           // longest-first (set in init)
            const ln = name.toLowerCase();
            let from = 0, i;
            while ((i = lower.indexOf(ln, from)) >= 0) {
                // require WORD boundaries so "Thorn" doesn't match inside "Thornfeld"
                const okBefore = i === 0 || !/[a-z0-9]/i.test(text[i - 1]);
                const okAfter = i + ln.length >= text.length || !/[a-z0-9']/i.test(text[i + ln.length]);
                if (okBefore && okAfter) {
                    return text.slice(0, i) + npcLink(null, text.substr(i, name.length)) +
                           linkifyNpcs(text.slice(i + name.length));
                }
                from = i + 1;
            }
        }
        return text;
    }

    function getItemType(item) {
        // Items may be plain strings (legacy) or { name, qty, ... } objects
        // (v0.103+); accept either.
        const lower = (typeof item === 'string' ? item : (item?.name || '')).toLowerCase();
        if (lower.startsWith('art t') || lower.startsWith('art_t')) return 'artifact';
        if (lower.startsWith('rec ') || lower.startsWith('rec_')) return 'recipe';
        if (lower.startsWith('con ') || lower.startsWith('con_')) return 'consumable';
        if (lower.startsWith('bas cp') || lower.startsWith('adv cp')) return 'chip';
        if (lower.startsWith('synthesis') || lower.startsWith('reforge') || lower.startsWith('talent')) return 'synthesis';
        if (lower.startsWith('wp ') || lower.startsWith('wp_')) return 'weapon';
        if (lower.includes('ancient coin')) return 'currency';
        return 'other';
    }

    // Reward rarity comes from the binary `flag` field on each reward item:
    // 0 Common, 1 Uncommon, 2 Rare, 3 Epic, 4 Legendary — the same 0-4 scale as
    // loot rarity. This is the quality the *quest* awards the item at (the same
    // item shows different flags in different quests), which is why it's read
    // from our own files rather than the item's base catalog quality.
    const REWARD_RARITY = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
    function itemRarity(item) {
        if (typeof item !== 'object' || item === null) return null;
        const f = item.flag;
        if (typeof f !== 'number' || f < 0 || f > 4) return null;
        return { rank: f, name: REWARD_RARITY[f] };
    }

    // Local mirrored icon path for a reward item (only artifacts/weapons have
    // them), or null. Keyed by the reward item's display name.
    function itemIcon(item) {
        const name = (typeof item === 'string') ? item : (item && item.name);
        return (name && data.itemIcons && data.itemIcons[name]) || null;
    }

    function buildDetailHTML(questName) {
        const api = getApiQuest(questName, currentSlug);
        const meta = getQuestMeta(questName);

        if (!api && !meta) {
            return '<div class="quest-unverified-notice">No metadata found for this quest.</div>';
        }

        let html = '<div class="quest-detail-info">';

        // Level, location, badges
        const infoParts = [];
        if (api?.level) infoParts.push(`<span class="quest-detail-level">Lv. ${api.level}</span>`);
        const location = meta?.questLocation || api?.location || meta?.region;
        if (location) infoParts.push(`<span class="quest-detail-location">${location}</span>`);
        if (isPIRelated(questName)) {
            const piLabel = meta?.region === 'Prison Island' ? 'Prison Island' : 'Prison Island related';
            infoParts.push(`<span class="region-badge region-badge-prison">${piLabel}</span>`);
        }
        if (meta?.questType === 'system') {
            infoParts.push(`<span class="region-badge region-badge-system" title="System/test quest">SYS</span>`);
        }
        if (meta?.selfInitiated) {
            infoParts.push(`<span class="region-badge region-badge-self" title="Self-initiated (triggered from object/item)">Self-initiated</span>`);
        }
        if (infoParts.length) html += `<div class="quest-detail-meta">${infoParts.join('')}</div>`;

        // Quest giver / finisher
        const giverName = meta?.questGiver || api?.questGiver?.name;
        const apiGiverSlug = api?.questGiver?.slug;
        const apiFinisherSlug = api?.questFinisher?.slug;
        const apiFinisherName = api?.questFinisher?.name;

        if (giverName || apiFinisherName) {
            html += '<div class="quest-detail-npcs">';
            if (giverName) {
                html += `<span class="quest-detail-npc"><span class="quest-detail-label">Giver:</span> ${npcLink(apiGiverSlug, giverName)}</span>`;
            }
            if (apiFinisherName && apiFinisherSlug !== apiGiverSlug) {
                html += `<span class="quest-detail-npc"><span class="quest-detail-label">Finisher:</span> ${npcLink(apiFinisherSlug, apiFinisherName)}</span>`;
            }
            html += '</div>';
        }

        // Goals — NPC names inside them (e.g. "Talk to Varkus Drov") link to the World Map
        if (api?.goals && api.goals.length > 0) {
            html += '<div class="quest-detail-goals"><span class="quest-detail-label">Goals:</span><ul>';
            api.goals.forEach(g => {
                const qty = g.quantity > 1 ? ` (${g.quantity})` : '';
                const kill = /kill|hunt/i.test(g.type || '') || /^\s*(kill|hunt)\b/i.test(g.description || '');
                html += `<li>${kill ? linkifyMob(g.description) : linkifyNpcs(g.description)}${qty}</li>`;
            });
            html += '</ul></div>';
        } else if (meta?.goals && meta.goals.length > 0) {
            html += '<div class="quest-detail-goals"><span class="quest-detail-label">Goals:</span><ul>';
            meta.goals.forEach(g => { html += `<li>${g}</li>`; });
            html += '</ul></div>';
        }

        // Notes
        const note = data.questNotes[questName]?.note;
        if (note) {
            html += `<div class="quest-detail-notes"><span class="quest-detail-label">Notes:</span> <span class="quest-detail-note-text">${note}</span></div>`;
        }

        // Unverified notice (kept as provenance text \u2014 no external link)
        if (!api && !note) {
            html += `<div class="quest-unverified-notice">Not listed on corepunk.help \u2014 data from game files only.</div>`;
        }

        html += '</div>';
        return html;
    }

    function buildChainHTML(questName) {
        const meta = getQuestMeta(questName);
        const api = getApiQuest(questName, currentSlug);

        const prerequisites = [];
        const followups = [];
        const seenPre = new Set();
        const seenFol = new Set();

        if (meta?.prevQuests) {
            meta.prevQuests.forEach(id => {
                const name = formatQuestId(id);
                if (!seenPre.has(name.toLowerCase())) { seenPre.add(name.toLowerCase()); prerequisites.push(name); }
            });
        }
        if (api?.prerequisiteQuests) {
            api.prerequisiteQuests.forEach(slug => {
                if (!slug) return;
                const name = formatApiSlug(slug);
                if (!seenPre.has(name.toLowerCase())) { seenPre.add(name.toLowerCase()); prerequisites.push(name); }
            });
        }
        if (meta?.nextQuests) {
            meta.nextQuests.forEach(id => {
                const name = formatQuestId(id);
                if (!seenFol.has(name.toLowerCase())) { seenFol.add(name.toLowerCase()); followups.push(name); }
            });
        }
        const thisSlug = toSlug(questName);
        Object.values(data.apiQuests).forEach(q => {
            if (q.prerequisiteQuests && q.prerequisiteQuests.includes(thisSlug)) {
                const name = q.name || formatApiSlug(q.slug);
                if (!seenFol.has(name.toLowerCase())) { seenFol.add(name.toLowerCase()); followups.push(name); }
            }
        });

        if (prerequisites.length === 0 && followups.length === 0) return '';

        let html = '<div class="quest-chain-info">';
        if (prerequisites.length > 0) {
            html += '<div class="chain-section chain-prereqs"><span class="chain-label">Requires:</span>';
            prerequisites.forEach(p => {
                html += `<a class="chain-link chain-prereq-link modal-quest-link" data-quest="${p}">${p}</a>`;
            });
            html += '</div>';
        }
        if (followups.length > 0) {
            html += '<div class="chain-section chain-followups"><span class="chain-label">Unlocks:</span>';
            followups.forEach(f => {
                html += `<a class="chain-link chain-followup-link modal-quest-link" data-quest="${f}">${f}</a>`;
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // Quest rewards are addressed by SLUG — the same stable identity the chain
    // and API data use. As of v0.113 the data file is slug-keyed
    // ({ slug: { name, items } }); older files are name-keyed ({ name: [items] }).
    // We index either shape by slug so a single lookup path serves every caller,
    // which is what stops the dim-flag and the modal from disagreeing (the API
    // display name frequently differs from the binary name, e.g. "A Spark in the
    // Dark" vs "Campfire Crafting Lesson", or "Star-Powered Shot" vs the binary
    // "Star-powered Shot").
    function buildRewardIndex() {
        rewardIndex = {};
        const raw = data.questRewards || {};
        Object.keys(raw).forEach(key => {
            const val = raw[key];
            const items = Array.isArray(val) ? val : (val && val.items);
            if (!Array.isArray(items)) return;
            const slug = Array.isArray(val) ? toSlug(key) : key; // legacy key is a name
            if (slug && rewardIndex[slug] === undefined) rewardIndex[slug] = items;
            // Bridge the few binary slugs that map to a different API slug.
            const mapped = data.slugMap[slug];
            if (mapped && rewardIndex[mapped] === undefined) rewardIndex[mapped] = items;
        });
    }

    // Canonical reward lookup: resolve a quest to its reward items by slug.
    // getApiQuest recovers the slug even when none was passed (modal-internal
    // Requires/Unlocks links navigate by name only).
    function findRewardItems(questName, slug) {
        if (!rewardIndex) buildRewardIndex();
        const ns = toSlug(questName);
        const api = getApiQuest(questName, slug);
        const candidates = [slug, ns, data.slugMap[ns], api && api.slug];
        for (const c of candidates) {
            if (c && rewardIndex[c]) return rewardIndex[c];
        }
        return null;
    }

    function hasRewards(questName, slug) {
        const items = findRewardItems(questName, slug);
        return !!(items && items.length);
    }

    // Normalize a loaded quest_rewards file (either shape) into a name-keyed
    // { name: [items] } map for the name-centric browser pages.
    function toNameKeyed(raw) {
        const out = {};
        Object.keys(raw || {}).forEach(key => {
            const val = raw[key];
            if (Array.isArray(val)) out[key] = val;
            else if (val && Array.isArray(val.items)) out[val.name || key] = val.items;
        });
        return out;
    }

    function buildRewardsHTML(questName) {
        const items = findRewardItems(questName, currentSlug);
        if (!items || items.length === 0) return '';

        const typeLabels = {
            artifact: 'Artifacts', recipe: 'Recipes', consumable: 'Consumables',
            chip: 'Chips', synthesis: 'Synthesis', weapon: 'Weapons',
            currency: 'Currency', other: 'Other'
        };

        // Summary tags
        const types = {};
        items.forEach(item => { const t = getItemType(item); types[t] = (types[t] || 0) + 1; });
        const summary = Object.entries(types)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `<span class="reward-tag reward-tag-${type}">${count} ${typeLabels[type] || type}</span>`)
            .join('');

        // Item list — items may be plain strings (legacy) or
        // { name, qty, ... } objects (v0.103+).
        const displayName = item => (typeof item === 'string' ? item : (item?.name || ''));
        const formatItem = item => {
            if (typeof item === 'string') return item;
            if (item.qty != null && item.qty > 1) return `${item.qty}× ${item.name}`;
            return item.name || '';
        };
        const sorted = [...items].sort((a, b) => displayName(a).localeCompare(displayName(b)));
        const itemsHTML = sorted.map(item => {
            const type = getItemType(item);
            const rq = itemRarity(item);
            const cls = `item-type-${type}${rq ? ` rq-${rq.rank}` : ''}${itemIcon(item) ? ' has-icon' : ''}`;
            const title = rq ? ` title="${rq.name}"` : '';
            const icon = itemIcon(item);
            const img = icon ? `<img class="reward-item-icon" src="${icon}" alt="" loading="lazy">` : '';
            return `<li class="${cls}"${title}>${img}${formatItem(item)}</li>`;
        }).join('');

        return `
            <div class="modal-rewards">
                <div class="modal-rewards-header"><span class="quest-detail-label">Rewards:</span> <span class="modal-rewards-count">${items.length} items</span></div>
                <div class="modal-rewards-summary">${summary}</div>
                <ul class="modal-rewards-list">${itemsHTML}</ul>
            </div>
        `;
    }

    function createOverlay() {
        overlay = document.createElement('div');
        overlay.className = 'quest-modal-overlay';
        overlay.innerHTML = `
            <div class="quest-modal">
                <div class="quest-modal-header">
                    <h2 class="quest-modal-title"></h2>
                    <button class="quest-modal-close" title="Close">&times;</button>
                </div>
                <div class="quest-modal-body"></div>
            </div>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hide();
        });
        overlay.querySelector('.quest-modal-close').addEventListener('click', hide);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('visible')) hide();
        });
        document.body.appendChild(overlay);
    }

    function show(questName, slug) {
        if (!overlay) createOverlay();

        // Store current slug for internal lookups
        currentSlug = slug || null;

        const titleEl = overlay.querySelector('.quest-modal-title');
        const bodyEl = overlay.querySelector('.quest-modal-body');

        titleEl.textContent = questName;
        bodyEl.innerHTML = buildDetailHTML(questName) + buildChainHTML(questName) + buildRewardsHTML(questName);

        // Wire chain links inside the modal to navigate
        bodyEl.querySelectorAll('.modal-quest-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                show(link.dataset.quest);
            });
        });

        overlay.classList.add('visible');
    }

    function hide() {
        if (overlay) overlay.classList.remove('visible');
    }

    function init(opts) {
        data = {
            questRewards: opts.questRewards || {},
            apiQuests: opts.apiQuests || {},
            slugMap: opts.slugMap || {},
            questMeta: opts.questMeta || {},
            questNotes: opts.questNotes || {},
            itemIcons: opts.itemIcons || {},
            mapNpcs: new Set(),      // display names on the map
            mapNpcNames: [],         // names, longest-first, for linkifying goal text
            mapSlugs: new Set()      // slugs on the map (uniquely identify clone entities)
        };
        rewardIndex = null; // rebuilt lazily against the new data
        // NPCs that actually exist on the World Map — so we only ever link those (no dead links).
        // Prefer the synchronous embedded list (map_npcs.js) so links render on first paint.
        const embedded = (typeof window !== 'undefined') && window.MAP_NPCS;
        setMapNpcs(opts.mapNpcs || embedded);
        if (!opts.mapNpcs && !embedded) {
            fetch('map_npcs.json').then(r => r.ok ? r.json() : []).then(setMapNpcs).catch(() => {});
        }
    }
    function setMapNpcs(src) {
        if (!src) return;
        const names = Array.isArray(src) ? src : (src.names || []);
        const slugs = Array.isArray(src) ? [] : (src.slugs || []);
        if (names.length) {
            data.mapNpcs = new Set(names.map(n => n.toLowerCase()));
            data.mapNpcNames = names.slice().sort((a, b) => b.length - a.length); // longest first
        }
        if (slugs.length) data.mapSlugs = new Set(slugs.map(s => s.toLowerCase()));
    }

    return { init, show, hide, getRewards: findRewardItems, hasRewards, toNameKeyed, isPIRelated, isRemovedPI, getApiQuest, itemRarity, itemIcon,
             npcMapLink: (a, b) => (b === undefined ? npcLink(null, a) : npcLink(a, b)), npcOnMap, linkifyNpcs, linkifyMob };
})();
