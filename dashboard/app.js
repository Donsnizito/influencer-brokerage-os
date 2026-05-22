const STAGE_COLUMNS = {
    'INFLUENCER_DISCOVERED': 'discovery',
    'QUOTE_REQUESTED': 'discovery',
    'QUOTE_RECEIVED': 'discovery',
    'BRAND_COLD': 'discovery',
    'BRAND_PITCHED': 'discovery',
    'BRAND_INTERESTED': 'discovery',
    'DEAL_INITIATED': 'negotiation',
    'NEGOTIATING': 'negotiation',
    'DEAL_LOCKED': 'negotiation',
    'CONTRACT_SENT': 'contracts',
    'CONTRACT_SIGNED': 'contracts',
    'PAYMENT_COLLECTED': 'contracts',
    'PAYMENT_RELEASED': 'contracts',
    'CAMPAIGN_LIVE': 'live',
    'CAMPAIGN_COMPLETE': 'live'
};

const NICHE_COLORS = {
    'ai_tech': '#6366f1',
    'travel': '#0ea5e9',
    'productivity': '#8b5cf6',
    'self_development': '#10b981',
    'lifestyle': '#f59e0b',
    'automotive': '#ef4444',
    'diy': '#f97316',
    'education': '#14b8a6'
};

let allDeals = [];
let monthlyFees = 0;

async function fetchDeals() {
    try {
        const res = await fetch('/api/deals');
        allDeals = await res.json();
        
        if (!allDeals) {
            allDeals = [];
        }
        render();
    } catch (e) {
        console.error('Failed to fetch deals:', e);
        allDeals = [];
        render();
    }
}


function calcFees(deals) {
    return deals.filter(d => d.broker_fee).reduce((sum, d) => sum + (d.broker_fee || 0), 0);
}

function render() {
    monthlyFees = calcFees(allDeals);
    renderRevenue();
    renderKanban();
    renderEscalations();
    renderPaymentQueue();
    renderCampaignTracker();
    updateBadges();
}

function renderRevenue() {
    const target = 10000;
    document.getElementById('monthly-rev').textContent = `$${monthlyFees.toLocaleString()}`;
    document.getElementById('active-deals').textContent = allDeals.filter(d => d.status && !['CAMPAIGN_COMPLETE', 'COLD', 'BRAND_COLD', 'ROSTER_DECLINED'].includes(d.status)).length;
    const pct = Math.min(100, Math.round((monthlyFees / target) * 100));
    document.querySelector('.target-progress').textContent = `${pct}% of $10K Goal`;
}

function updateBadges() {
    const escalations = allDeals.filter(d => d.escalation_flag === 'RED' || d.escalation_flag === 'YELLOW');
    const payments = allDeals.filter(d => d.status === 'PAYMENT_COLLECTED');
    document.getElementById('escalation-count').textContent = escalations.length;
    document.getElementById('payment-count').textContent = payments.length;
}

function renderKanban() {
    const columns = { discovery: [], negotiation: [], contracts: [], live: [] };
    allDeals.forEach(deal => {
        const col = STAGE_COLUMNS[deal.status];
        if (col) columns[col].push(deal);
    });

    for (const [col, deals] of Object.entries(columns)) {
        const body = document.getElementById(`col-${col}`);
        const count = document.getElementById(`count-${col}`);
        if (!body || !count) continue;
        count.textContent = deals.length;
        body.innerHTML = deals.length === 0 ? '<p class="empty-col">No deals here</p>' : deals.map(d => dealCard(d)).join('');
    }
}

function dealCard(deal) {
    const nicheColor = NICHE_COLORS[deal.niche] || '#6b7280';
    const isYellow = deal.escalation_flag === 'YELLOW';
    const isRed = deal.escalation_flag === 'RED';
    const borderClass = isRed ? 'card-red' : isYellow ? 'card-yellow' : deal.status === 'CAMPAIGN_LIVE' ? 'card-green' : '';

    const viewBar = deal.status === 'CAMPAIGN_LIVE' && deal.views_last_checked
        ? `<div class="progress-row">
             <span>${(deal.views_last_checked || 0).toLocaleString()} / ${(deal.view_guarantee || 100000).toLocaleString()} views</span>
             <div class="progress-bar-mini"><div class="fill" style="width:${Math.min(100, Math.round((deal.views_last_checked / deal.view_guarantee) * 100))}%"></div></div>
           </div>`
        : '';

    const feeBlock = deal.agreed_rate
        ? `<div class="card-value">$${deal.agreed_rate.toLocaleString()} <span class="fee">(Fee: $${(deal.broker_fee || 0).toLocaleString()})</span></div>`
        : '';

    return `<div class="deal-card ${borderClass}">
        <div class="card-tags">
            <span class="tag" style="background:${nicheColor}22;color:${nicheColor}">${deal.niche || 'Unknown'}</span>
            <span class="tag tag-status">${deal.status}</span>
        </div>
        <h4>${deal.influencer_name || 'Unknown Influencer'}${deal.brand_name ? ' × ' + deal.brand_name : ''}</h4>
        ${feeBlock}
        ${viewBar}
        <div class="card-meta">
            ${isRed ? '<span class="flag text-red">🔴 Escalated</span>' : ''}
            ${isYellow ? '<span class="flag text-yellow">⚠️ Needs Approval</span>' : ''}
        </div>
    </div>`;
}

function renderEscalations() {
    const list = document.getElementById('escalations-list');
    if (!list) return;
    const escalated = allDeals.filter(d => d.escalation_flag === 'RED' || d.escalation_flag === 'YELLOW');

    if (escalated.length === 0) {
        list.innerHTML = '<p class="empty-col" style="padding:20px">No escalations. All clear ✅</p>';
        return;
    }

    list.innerHTML = escalated.map(deal => {
        const isRed = deal.escalation_flag === 'RED';
        return `<div class="list-item ${isRed ? 'alert-red' : 'alert-yellow'}">
            <div class="item-main">
                <div class="item-title">${isRed ? '🔴 RED FLAG' : '⚠️ YELLOW FLAG'}: ${deal.influencer_name || deal.id} × ${deal.brand_name || 'Brand TBD'}</div>
                <div class="item-desc">Status: ${deal.status} | Deal ID: ${deal.id}</div>
            </div>
            <div class="item-actions">
                <button class="btn btn-outline" onclick="viewDeal('${deal.id}')">View Thread</button>
                ${isRed ? '<button class="btn btn-danger" onclick="takeover(\'' + deal.id + '\')">Take Over</button>' : '<button class="btn btn-primary" onclick="approveAction(\'' + deal.id + '\')">Review Draft</button>'}
            </div>
        </div>`;
    }).join('');
}

function renderPaymentQueue() {
    const list = document.getElementById('payment-list');
    if (!list) return;
    const waiting = allDeals.filter(d => d.status === 'PAYMENT_COLLECTED');

    if (waiting.length === 0) {
        list.innerHTML = '<p class="empty-col" style="padding:20px">No payouts pending ✅</p>';
        return;
    }

    list.innerHTML = waiting.map(deal => `
        <div class="list-item payout-item">
            <div class="item-main">
                <div class="item-title">${deal.influencer_name || 'Unknown'} × ${deal.brand_name || 'Brand'}</div>
                <div class="financials">
                    <span class="total">Collected: $${(deal.agreed_rate || 0).toLocaleString()}</span>
                    <span class="fee text-green">Fee: $${(deal.broker_fee || 0).toLocaleString()}</span>
                    <span class="font-bold">Influencer Payout: $${((deal.agreed_rate || 0) - (deal.broker_fee || 0)).toLocaleString()}</span>
                </div>
            </div>
            <div class="item-actions">
                <button class="btn btn-success" onclick="confirmRelease('${deal.id}')">Release Payout via Stripe</button>
            </div>
        </div>
    `).join('');
}

function renderCampaignTracker() {
    const list = document.getElementById('tracker-list');
    if (!list) return;
    const live = allDeals.filter(d => d.status === 'CAMPAIGN_LIVE');

    if (live.length === 0) {
        list.innerHTML = '<p class="empty-col" style="padding:20px">No live campaigns yet</p>';
        return;
    }

    list.innerHTML = live.map(deal => {
        const views = deal.views_last_checked || 0;
        const target = deal.view_guarantee || 100000;
        const pct = Math.min(100, Math.round((views / target) * 100));
        const color = pct >= 100 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#3b82f6';

        return `<div class="tracker-card">
            <div class="tracker-header">
                <h4>${deal.influencer_name || 'Unknown'} × ${deal.brand_name || 'Brand'}</h4>
                <span class="tag" style="background:#10b98122;color:#10b981">LIVE</span>
            </div>
            <div class="tracker-body">
                <div class="view-stats">
                    <span class="view-count" style="color:${color}">${views.toLocaleString()}</span>
                    <span class="view-target">/ ${target.toLocaleString()} views</span>
                    <span class="view-pct">${pct}%</span>
                </div>
                <div class="progress-bar">
                    <div class="fill" style="width:${pct}%;background:${color}"></div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// Action handlers
async function confirmRelease(dealId) {
    if (!confirm(`Release payout for Deal ${dealId}?\n\nThis will initiate a real Stripe Transfer. No exceptions.`)) return;
    try {
        const res = await fetch('/api/release_payout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deal_id: dealId })
        });
        const data = await res.json();
        if (data.success) {
            alert('✅ Payout released successfully.');
            fetchDeals();
        } else {
            alert('❌ Error: ' + data.error);
        }
    } catch (e) {
        alert('❌ Server error: ' + e.message);
    }
}

function viewDeal(id) { alert(`Opening thread for Deal ${id}. (Connect your email client integration here.)`); }
function takeover(id) { alert(`Manual takeover initiated for Deal ${id}.`); }
function approveAction(id) { alert(`Review draft for Deal ${id}.`); }

// Navigation
document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');
    const title = document.getElementById('current-view-title');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(n => n.classList.remove('active'));
            views.forEach(v => v.classList.add('hidden'));
            item.classList.add('active');
            const viewId = `view-${item.dataset.view}`;
            document.getElementById(viewId)?.classList.remove('hidden');
            title.textContent = item.querySelector('span:not(.icon)').childNodes[0].textContent.trim();
        });
    });

    // Initial load
    fetchDeals();
    // Refresh every 60 seconds
    setInterval(fetchDeals, 60000);
});
