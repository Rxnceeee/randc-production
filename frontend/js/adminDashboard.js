'use strict';

// Chart.js instances
let _dbChartTrend   = null;
let _dbChartDemand  = null;
let _dbChartMonthly = null;

// ── LIVE CLOCK ────────────────────────────────────────────────────────────────
function dbStartClock() {
  function tick() {
    const now   = new Date();
    const timeEl = document.getElementById('dbLiveTime');
    const dateEl = document.getElementById('dbLiveDate');
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-PH', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  }
  tick();
  setInterval(tick, 1000);
}

// ── AUTH HEADER ───────────────────────────────────────────────────────────────
function dbAuthHeader() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── MAIN LOAD ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const storedUser = JSON.parse(
      localStorage.getItem('user') || sessionStorage.getItem('user') || '{}'
    );
    const adminName = storedUser.first_name || storedUser.username || 'Admin';
    const el = document.getElementById('dbAdminName');
    const av = document.getElementById('dbAdminAvatar');
    if (el) el.textContent = `Good ${dbGetGreeting()}, ${adminName}`;
    if (av) av.textContent = (adminName[0] || 'A').toUpperCase();

    const [statsRes, testimonialsRes, upcomingRes] = await Promise.allSettled([
      dbFetch('/api/admin/getDashboardStats'),
      dbFetchTestimonials(),
      dbFetchUpcomingAppointments(),
    ]);

    const data = statsRes.status === 'fulfilled' ? statsRes.value : null;

    if (data) {
      dbRenderKPIs(data);
      dbRenderPipeline(data);
      dbRenderCharts(data);
      dbRenderAlerts(data);
      dbRenderSlots(data.todaySlots || []);
      dbRenderTopServices(data.topServices || []);
    }

    if (testimonialsRes.status === 'fulfilled') dbRenderTestimonials(testimonialsRes.value);
    if (upcomingRes.status   === 'fulfilled') dbRenderUpcoming(upcomingRes.value);

  } catch (err) {
    console.error('[Dashboard] Load error:', err);
  }
}

async function dbFetch(path) {
  const res = await fetch((typeof BASE_URL !== 'undefined' ? BASE_URL : '') + path, {
    headers: dbAuthHeader()
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function dbFetchTestimonials() {
  return dbFetch('/api/admin/testimonials');
}

async function dbFetchUpcomingAppointments() {
  return dbFetch('/api/admin/filterAppointments/approved');
}

// ── KPI CARDS ─────────────────────────────────────────────────────────────────
function dbRenderKPIs(data) {
  const tx    = data.transactionStats || {};
  const appt  = data.appointmentStats || {};
  const users = data.userStats        || [];
  const proc  = data.processingStats  || {};

  const clients = users.find(u => u.role === 'client');

  const pending   = +(tx.pending  || 0);
  const ongoing   = +(tx.ongoing  || tx.on_going || 0);
  const toClaim   = +(tx.to_claim || 0);
  const claimed   = +(tx.claimed  || tx.completed || 0);
  const penalty   = +(tx.penalty_count || tx.penalty || 0);

  // KPI 1 — Today's Appointments
  dbSetEl('kpiTodayAppt', data.todayAppointments ?? '—');
  dbSetEl('kpiTodaySub',  `${appt.approved || 0} approved · ${appt.pending || 0} pending`);
  dbSetTrend('kpiTodayTrend', data.todayAppointments, 5, '↑ Active', '↓ Slow');

  // KPI 2 — In Progress
  dbSetEl('kpiPendingTx',  ongoing);
  dbSetEl('kpiPendingSub', `${pending} submitted · queued`);

  // KPI 3 — Ready to Claim
  dbSetEl('kpiReadyClaim', toClaim);
  dbSetEl('kpiClaimSub',   toClaim > 10 ? '⚠ High backlog' : 'Normal volume');
  dbSetTrend('kpiClaimTrend', toClaim > 15 ? 1 : -1, 0, '↑ High', '↓ Normal');

  // KPI 4 — Active Clients
  const activeC = clients?.active_count ?? clients?.count ?? '—';
  dbSetEl('kpiActiveClients', activeC);
  dbSetEl('kpiClientsSub',    `${clients?.verified_count ?? 0} verified`);
  dbSetTrend('kpiClientsTrend', 1, 0, '↑ Growing', '↑ Growing');

  // KPI 5 — Slot Utilisation
  const todaySlots = data.todaySlots || [];
  const slotFull   = todaySlots.filter(s => s.current_bookings >= s.max_capacity).length;
  const slotOpen   = todaySlots.filter(s => s.is_available && s.current_bookings < s.max_capacity).length;
  const totalSlot  = todaySlots.length || 1;
  const utilPct    = Math.round((slotFull / totalSlot) * 100);
  dbSetEl('kpiSlotUtil', utilPct + '%');
  dbSetEl('kpiSlotSub',  `${slotFull} full · ${slotOpen} open`);
  const fillEl = document.getElementById('kpiSlotFill');
  if (fillEl) fillEl.style.width = utilPct + '%';

  // KPI 6 — Avg Processing Days
  const avgDays = parseFloat(proc.avg_processing_days || 0).toFixed(1);
  dbSetEl('kpiAvgProc', avgDays + 'd');
  dbSetTrend('kpiProcTrend', parseFloat(avgDays) > 7 ? 1 : -1, 0, '↑ Slow', '↓ Fast');

  // KPI 7 — Penalty Transactions
  dbSetEl('kpiPenaltyCount', penalty);
  dbSetTrend('kpiPenaltyTrend', penalty > 0 ? 1 : -1, 0, '↑ Action Needed', '↓ Clear');

  // KPI 8 — Client Satisfaction
  const starsEl = document.getElementById('kpiStars');
  if (starsEl) starsEl.innerHTML = '';
}

// ── ALERTS ────────────────────────────────────────────────────────────────────
function dbRenderAlerts(data) {
  const tx   = data.transactionStats || {};
  const appt = data.appointmentStats || {};
  const alerts = [];

  const toClaim = +(tx.to_claim     || 0);
  const penalty = +(tx.penalty_count || tx.penalty || 0);
  const today   = +(data.todayAppointments || 0);

  if (penalty > 0) alerts.push({
    type:'danger', icon:'bi-exclamation-triangle-fill',
    title:'Penalty Triggered',
    text:`${penalty} transaction(s) exceeded the 7-day claim window — ₱200 penalty applies.`,
    action:'View Transactions', panel:'panel-transactions'
  });
  if (toClaim > 20) alerts.push({
    type:'warning', icon:'bi-box-seam-fill',
    title:'High Unclaimed Volume',
    text:`${toClaim} documents are ready to claim. High backlog risks further penalties.`,
    action:'Manage', panel:'panel-transactions'
  });
  if (today === 0) alerts.push({
    type:'info', icon:'bi-calendar-x',
    title:'No Appointments Today',
    text:'No appointments scheduled for today. May be a holiday or low-demand day.',
    action:null
  });
  if ((appt.pending || 0) > 0) alerts.push({
    type:'warning', icon:'bi-clock-history',
    title:'Pending Appointment Requests',
    text:`${appt.pending} appointment request(s) awaiting review.`,
    action:'Review', panel:'panel-appointments'
  });

  const row = document.getElementById('dbAlertsRow');
  if (!row) return;
  if (!alerts.length) {
    row.innerHTML = `
      <div class="db-alert db-alert--success">
        <i class="bi bi-check-circle-fill"></i>
        <div class="db-alert-body"><strong>All Clear</strong>No critical issues detected. System operating normally.</div>
      </div>`;
    return;
  }
  row.innerHTML = alerts.map(a => `
    <div class="db-alert db-alert--${a.type}">
      <i class="bi ${a.icon}"></i>
      <div class="db-alert-body"><strong>${a.title}</strong>${a.text}</div>
      ${a.action ? `<button class="db-alert-action" onclick="switchPanel('${a.panel}')">${a.action}</button>` : ''}
    </div>`).join('');
}

function dbRenderPipeline(data) {
  const tx = data.transactionStats || {};
  const pending   = +(tx.pending   || 0);
  const submitted   = +(tx.submitted   || 0);
  const ongoing   = +(tx.ongoing   || tx.on_going || 0);
  const toClaim   = +(tx.to_claim  || 0);
  const claimed   = +(tx.claimed   || tx.completed || 0);
  const cancelled = +(tx.cancelled || 0);
  const total     = pending + ongoing + toClaim + claimed + cancelled || 1;

  dbSetEl('pipeIn',     pending);
  dbSetEl('pipeSub',     submitted);

  dbSetEl('pipeProc',   ongoing);
  dbSetEl('pipeClaim',  toClaim);
  dbSetEl('pipeDone',   claimed);
  dbSetEl('pipeCancel', cancelled);

  const setPipe = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.round((val / total) * 100) + '%';
  };
  setPipe('pipeInFill',     pending);
  setPipe('pipeProcFill',   ongoing);
  setPipe('pipeClaimFill',  toClaim);
  setPipe('pipeDoneFill',   claimed);
  setPipe('pipeCancelFill', cancelled);

  const totalAll = pending + ongoing + toClaim + claimed + cancelled;
  dbSetEl('tpTotal',      totalAll);
  dbSetEl('tpClaimRate',  totalAll ? Math.round((claimed   / totalAll) * 100) + '%' : '—');
  dbSetEl('tpAvgDays',    parseFloat(data.processingStats?.avg_processing_days || 0).toFixed(1) + 'd');
  dbSetEl('tpCancelRate', totalAll ? Math.round((cancelled / totalAll) * 100) + '%' : '—');
}

function dbRenderSlots(slots) {
  const container = document.getElementById('dbSlotList');
  if (!container) return;

  const allTimes = [
    { t:'08:00:00', label:'8:00 AM'  }, { t:'09:00:00', label:'9:00 AM'  },
    { t:'10:00:00', label:'10:00 AM' }, { t:'11:00:00', label:'11:00 AM' },
    { t:'13:00:00', label:'1:00 PM'  }, { t:'14:00:00', label:'2:00 PM'  },
    { t:'15:00:00', label:'3:00 PM'  }, { t:'16:00:00', label:'4:00 PM'  },
  ];

  const slotMap = {};
  if (Array.isArray(slots)) {
    slots.forEach(s => { slotMap[s.appointment_time] = s; });
  }

  const colors = ['#22c55e','#22c55e','#fbbf24','#f97316','#ef4444'];

  container.innerHTML = allTimes.map(({ t, label }) => {
    const s        = slotMap[t];
    const booked   = s ? +s.current_bookings : 0;
    const cap      = s ? +s.max_capacity    : 3;
    const pct      = (s && cap > 0) ? Math.round((booked / cap) * 100) : 0;
    const isFull   = booked >= cap && cap > 0;
    const isUnavail = s && !s.is_available;
    const colorIdx  = Math.min(Math.floor(pct / 25), 4);
    const barColor  = isFull ? '#ef4444' : isUnavail ? '#5a6a88' : (colors[colorIdx] || '#22c55e');

    return `
      <div class="db-slot-row ${isFull ? 'db-slot-full' : ''} ${isUnavail ? 'db-slot-closed' : ''}">
        <span class="db-slot-time">${label}</span>
        <div class="db-slot-bar-wrap">
          <div class="db-slot-bar-fill" style="width:${pct}%;background:${barColor};"></div>
        </div>
        <span class="db-slot-count" style="color:${barColor};">
          ${isUnavail ? 'N/A' : s ? `${booked}/${cap}` : '—'}
        </span>
      </div>`;
  }).join('');
}

// ── CHARTS ────────────────────────────────────────────────────────────────────
function dbRenderCharts(data) {
  const isDark     = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor  = isDark ? 'rgba(46,63,96,.5)'     : 'rgba(220,225,240,.8)';
  const textColor  = isDark ? '#5a6a88'               : '#9ca3af';

  if (typeof Chart === 'undefined') {
    console.warn('[Dashboard] Chart.js not loaded — charts skipped');
    return;
  }
  Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";

  // Booking Trend (line)
  const trendCtx = document.getElementById('chartBookingTrend');
  if (trendCtx) {
    if (_dbChartTrend) _dbChartTrend.destroy();
    const raw    = (data.recentActivity || []).slice().reverse();
    const labels = raw.map(r => new Date(r.date + 'T00:00:00')
      .toLocaleDateString('en-US', { month:'short', day:'numeric' }));
    const values = raw.map(r => r.new_appointments || 0);

    _dbChartTrend = new Chart(trendCtx, {
      type:'line',
      data:{
        labels,
        datasets:[{
          label:'Bookings', data:values,
          borderColor:'#22c55e',
          backgroundColor: isDark ? 'rgba(34,197,94,.08)' : 'rgba(34,197,94,.12)',
          borderWidth:2, pointRadius:0, pointHoverRadius:4, fill:true, tension:0.4,
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:600},
        plugins:{ legend:{display:false}, tooltip:{
          backgroundColor: isDark ? '#1a2540':'#fff',
          titleColor: isDark ? '#e8edf7':'#0f172a',
          bodyColor:  isDark ? '#8a97b4':'#374151',
          borderColor: isDark ? '#2e3f60':'#dde1ef', borderWidth:1,
        }},
        scales:{
          x:{ grid:{color:gridColor}, ticks:{color:textColor, maxTicksLimit:7} },
          y:{ grid:{color:gridColor}, ticks:{color:textColor, stepSize:1}, beginAtZero:true }
        }
      }
    });
  }

  // Service Demand (doughnut)
  const demandCtx = document.getElementById('chartServiceDemand');
  if (demandCtx) {
    if (_dbChartDemand) _dbChartDemand.destroy();
    const svcData = data.topServices || [];
    const palette = ['#22c55e','#22d3ee','#6366f1','#f59e0b','#f43f5e','#a855f7','#06b6d4'];
    const total   = svcData.reduce((s, x) => s + (+x.transaction_count || 0), 0) || 1;

    _dbChartDemand = new Chart(demandCtx, {
      type:'doughnut',
      data:{
        labels: svcData.map(s => s.service_name),
        datasets:[{
          data: svcData.map(s => s.transaction_count || 0),
          backgroundColor: palette, borderWidth:2,
          borderColor: isDark ? '#0e1525':'#fff', hoverOffset:4,
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:600}, cutout:'68%',
        plugins:{ legend:{display:false}, tooltip:{
          callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw/total*100)}%)` }
        }}
      }
    });

    const leg = document.getElementById('dbServiceLegend');
    if (leg) {
      leg.innerHTML = svcData.map((s, i) => `
        <div class="db-svc-legend-item">
          <span class="db-svc-legend-dot" style="background:${palette[i]};"></span>
          <span class="db-svc-legend-name">${s.service_name}</span>
          <span class="db-svc-legend-val">${s.transaction_count}</span>
          <span class="db-svc-legend-pct">${Math.round((s.transaction_count/total)*100)}%</span>
        </div>`).join('');
    }
  }

  // Monthly Volume (bar)
  const monthCtx = document.getElementById('chartMonthlyVol');
  if (monthCtx) {
    if (_dbChartMonthly) _dbChartMonthly.destroy();
    const monthly  = (data.monthlyTrends || []).slice().reverse();
    const mLabels  = monthly.map(m => {
      const [y, mo] = m.month.split('-');
      return new Date(+y, +mo-1).toLocaleDateString('en-US', { month:'short', year:'2-digit' });
    });

    _dbChartMonthly = new Chart(monthCtx, {
      type:'bar',
      data:{
        labels: mLabels,
        datasets:[{
          label:'Transactions', data: monthly.map(m => m.transaction_count || 0),
          backgroundColor:'rgba(34,211,238,.25)', borderColor:'#22d3ee',
          borderWidth:1.5, borderRadius:4,
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:600},
        plugins:{ legend:{display:false} },
        scales:{
          x:{ grid:{color:gridColor}, ticks:{color:textColor} },
          y:{ grid:{color:gridColor}, ticks:{color:textColor}, beginAtZero:true }
        }
      }
    });
  }
}

// ── TOP SERVICES LIST ─────────────────────────────────────────────────────────
function dbRenderTopServices(services) {
  const list = document.getElementById('dbTopServicesList');
  if (!list) return;

  if (!services.length) {
    list.innerHTML = `<div class="db-list-empty"><i class="bi bi-briefcase"></i>No service data yet</div>`;
    return;
  }

  const max = Math.max(...services.map(s => +s.transaction_count || 0), 1);
  const palette = ['#22c55e','#22d3ee','#6366f1','#f59e0b','#f43f5e','#a855f7','#06b6d4'];

  list.innerHTML = services.map((s, i) => {
    const pct = Math.round(((+s.transaction_count || 0) / max) * 100);
    return `
      <div class="db-svc-rank-row">
        <span class="db-svc-rank-num">${i + 1}</span>
        <span class="db-svc-rank-name">${dbEsc(s.service_name)}</span>
        <div class="db-svc-rank-bar-wrap">
          <div class="db-svc-rank-fill" style="width:${pct}%;background:${palette[i] || '#22c55e'};"></div>
        </div>
        <span class="db-svc-rank-count">${s.transaction_count}</span>
      </div>`;
  }).join('');
}

// ── UPCOMING APPOINTMENTS ─────────────────────────────────────────────────────
function dbRenderUpcoming(response) {
  const list = document.getElementById('dbUpcomingAppts');
  if (!list) return;

  const items  = Array.isArray(response) ? response : (response?.appointments || response?.data || []);
  const sorted = items
    .filter(a => a.status === 'approved')
    .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date))
    .slice(0, 6);

  if (!sorted.length) {
    list.innerHTML = `<div class="db-list-empty"><i class="bi bi-calendar-x"></i>No upcoming appointments</div>`;
    return;
  }

  list.innerHTML = sorted.map(a => {
    const name     = a.client_name || `${a.first_name||''} ${a.last_name||''}`.trim();
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const dateStr  = new Date(a.appointment_date + 'T00:00:00')
      .toLocaleDateString('en-US', { month:'short', day:'numeric' });
    return `
      <div class="db-appt-row">
        <div class="db-appt-avatar">${initials}</div>
        <div class="db-appt-info">
          <div class="db-appt-name">${dbEsc(name)}</div>
          <div class="db-appt-meta">${dateStr}</div>
        </div>
        <div class="db-appt-time">${dbFmt12h(a.appointment_time)}</div>
      </div>`;
  }).join('');
}

// ── TESTIMONIALS + RATING ─────────────────────────────────────────────────────
function dbRenderTestimonials(response) {
  const list  = document.getElementById('dbTestimonialList');
  const bk    = document.getElementById('dbRatingBreakdown');
  const ovEl  = document.getElementById('dbRatingOverall');
  if (!list) return;

  const items = Array.isArray(response) ? response : (response?.testimonials || response?.data || []);
  if (!items.length) {
    list.innerHTML = `<div class="db-list-empty"><i class="bi bi-star"></i>No reviews yet</div>`;
    return;
  }

  const avg = items.reduce((s, t) => s + (+t.rating || 0), 0) / items.length;
  if (ovEl) ovEl.textContent = `${avg.toFixed(1)} / 5.0  (${items.length})`;

  dbSetEl('kpiAvgRating', avg.toFixed(1));
  dbSetEl('kpiRatingSub',  `${items.length} total reviews`);
  const starsEl = document.getElementById('kpiStars');
  if (starsEl) starsEl.innerHTML = dbStarHtml(avg);

  if (bk) {
    bk.innerHTML = [5,4,3,2,1].map(star => {
      const count = items.filter(t => +t.rating === star).length;
      const pct   = Math.round((count / items.length) * 100);
      return `
        <div class="db-rating-bar-row">
          <span class="db-rating-star">${star}★</span>
          <div class="db-rating-track"><div class="db-rating-fill" style="width:${pct}%"></div></div>
          <span class="db-rating-num">${count}</span>
        </div>`;
    }).join('');
  }

  list.innerHTML = items.slice(0, 3).map(t => {
    const stars = '★'.repeat(+t.rating) + '☆'.repeat(5 - (+t.rating));
    const name  = t.client_name || t.initials || 'Client';
    const msg   = (t.message || t.content || '');
    return `
      <div class="db-testi-row">
        <div class="db-testi-header">
          <span class="db-testi-name">${dbEsc(name)}</span>
          <span class="db-testi-stars">${stars}</span>
        </div>
        <div class="db-testi-msg">"${dbEsc(msg.slice(0, 90))}${msg.length > 90 ? '…' : ''}"</div>
      </div>`;
  }).join('');
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function dbSetEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function dbSetTrend(id, val, threshold = 0, upLabel = '↑', downLabel = '↓') {
  const el = document.getElementById(id);
  if (!el || val === null || val === undefined) return;
  const up  = val > threshold;
  el.textContent = up ? upLabel : downLabel;
  el.className   = 'db-kpi-trend ' + (up ? 'db-trend-up' : 'db-trend-down');
}

function dbGetGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function dbFmt12h(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function dbStarHtml(rating) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += rating >= i ? '★' : rating >= i - 0.5 ? '½' : '☆';
  }
  return html;
}

function dbEsc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  dbStartClock();
  if (document.getElementById('panel-dashboard')?.classList.contains('active')) {
    loadDashboard();
  }
});

document.querySelectorAll('[data-panel="panel-dashboard"], [onclick*="panel-dashboard"]')
  .forEach(el => el.addEventListener('click', () => setTimeout(loadDashboard, 80)));
