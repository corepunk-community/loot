// quest-modal.js — Shared quest detail modal for use across pages
//
// Usage: include this script, then call:
//   QuestModal.init({ questRewards, apiQuests, slugMap, questMeta, questNotes })
//   QuestModal.show(questName)

const QuestModal = (() => {
    let data = {};
    let overlay = null;
    let currentSlug = null;

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

    function npcLink(slug, name) {
        return `<a href="https://corepunk.help/npcs/${slug}" target="_blank" rel="noopener" class="npc-map-link">${name}</a>`;
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
                html += `<span class="quest-detail-npc"><span class="quest-detail-label">Giver:</span> ${apiGiverSlug ? npcLink(apiGiverSlug, giverName) : giverName}</span>`;
            }
            if (apiFinisherName && apiFinisherSlug !== apiGiverSlug) {
                html += `<span class="quest-detail-npc"><span class="quest-detail-label">Finisher:</span> ${npcLink(apiFinisherSlug, apiFinisherName)}</span>`;
            }
            html += '</div>';
        }

        // Goals
        if (api?.goals && api.goals.length > 0) {
            html += '<div class="quest-detail-goals"><span class="quest-detail-label">Goals:</span><ul>';
            api.goals.forEach(g => {
                const qty = g.quantity > 1 ? ` (${g.quantity})` : '';
                html += `<li>${g.description}${qty}</li>`;
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
            html += `<div class="quest-modal-note"><span class="quest-detail-label">Notes:</span> ${note}</div>`;
        }

        // Unverified notice / external link
        if (!api) {
            if (!note) {
                html += `<div class="quest-unverified-notice">Not listed on corepunk.help \u2014 data from game files only.</div>`;
            }
        } else {
            html += `<div class="quest-modal-ext-link"><a href="https://corepunk.help/quests/${api.slug}" target="_blank" rel="noopener" class="npc-map-link">View on corepunk.help &#8599;</a></div>`;
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

    function buildRewardsHTML(questName) {
        const items = data.questRewards[questName];
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

        // Item list
        const sorted = [...items].sort();
        const itemsHTML = sorted.map(item => {
            const type = getItemType(item);
            return `<li class="item-type-${type}">${item}</li>`;
        }).join('');

        return `
            <div class="modal-rewards">
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
            questNotes: opts.questNotes || {}
        };
    }

    return { init, show, hide };
})();
