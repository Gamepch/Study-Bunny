// ── 색상 팔레트 ───────────────────────────────────────────────
const COLORS = ['#534ab7','#0f6e56','#ba7517','#993c1d','#1a6fa8','#7c3d9e','#c0392b','#2c7a4b'];

// ── 상태 ─────────────────────────────────────────────────────
let currentUser   = null;
let subjects      = [];          // [{id, name, color, sort_order}]
let todayStats    = {};          // {subject_id: duration_sec, ...}
let goalSec       = 28800;
let ddayInfo      = null;        // {name, days}
let statRange     = 'today';
let statsCache    = null;        // 마지막 fetch 결과

// 측정 상태 (경과 계산 방식)
let activeSub     = null;        // {id, name, color}
let startedAt     = null;        // Date.now() 기준 timestamp (ms)
let accumulated   = 0;           // 일시정지까지 누적된 ms
let isPaused      = false;
let tickId        = null;
let selectedColor = COLORS[0];

const LS_SESSION  = 'study_active_session';

// ── 경과 시간 계산 ─────────────────────────────────────────
function elapsedMs() {
    const running = (!isPaused && startedAt) ? Date.now() - startedAt : 0;
    return accumulated + running;
}

function elapsedSec() { return Math.floor(elapsedMs() / 1000); }

// ── 포맷 ──────────────────────────────────────────────────
function fmtHMS(sec) {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function fmtDuration(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0)          return `${h}시간`;
    if (m > 0)          return `${m}분`;
    return `${sec}초`;
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── 씬 전환 ───────────────────────────────────────────────
function goScene(name) {
    if (name === 'timer' && activeSub) {
        _activateScene('running');
        return;
    }
    _activateScene(name);
    if (name === 'stats') loadStats();
    if (name === 'settings') renderSettingsSubjects();
}

function _activateScene(name) {
    document.querySelectorAll('.scene, .running-scene').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('scene-' + name);
    if (target) target.classList.add('active');

    // running 씬일 때 상단 탭 숨기기
    const innerBar = document.getElementById('inner-tab-bar');
    if (innerBar) innerBar.style.display = name === 'running' ? 'none' : '';

    document.querySelectorAll('.inner-tab-btn').forEach(t => t.classList.remove('active'));
    const tabKey = name === 'running' ? 'timer' : name;
    const innerTab = document.getElementById('inner-tab-' + tabKey);
    if (innerTab) innerTab.classList.add('active');
}

// ── 과목 목록 렌더 ─────────────────────────────────────────
function renderSubjectList() {
    const list = document.getElementById('subject-list');
    const hint = document.getElementById('empty-hint');
    list.querySelectorAll('.subject-card').forEach(el => el.remove());

    if (subjects.length === 0) {
        if (hint) hint.style.display = '';
        return;
    }
    if (hint) hint.style.display = 'none';

    subjects.forEach(sub => {
        const secToday = todayStats[sub.id] || 0;
        const card = document.createElement('div');
        card.className = 'subject-card';
        card.innerHTML = `
            <span class="subj-dot" style="background:${sub.color}"></span>
            <span class="subj-name">${esc(sub.name)}</span>
            <span class="subj-time">${secToday > 0 ? '오늘 ' + fmtDuration(secToday) : ''}</span>
        `;
        card.addEventListener('click', () => startSession(sub));
        list.insertBefore(card, list.querySelector('.add-btn'));
    });
}

// ── 과목 설정 씬 렌더 ──────────────────────────────────────
function renderSettingsSubjects() {
    const container = document.getElementById('settings-subject-list');
    container.innerHTML = '';
    if (subjects.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:24px 0;">과목이 없어요</div>';
        return;
    }
    subjects.forEach(sub => {
        const item = document.createElement('div');
        item.className = 'subj-edit-item';
        item.innerHTML = `
            <span class="subj-dot" style="background:${sub.color}"></span>
            <span class="nm">${esc(sub.name)}</span>
            <button class="subj-del-btn" onclick="confirmDeleteSubject(${sub.id}, '${esc(sub.name)}')">삭제</button>
        `;
        container.appendChild(item);
    });
}

// ── 세션 시작 ─────────────────────────────────────────────
function startSession(sub) {
    activeSub   = sub;
    startedAt   = Date.now();
    accumulated = 0;
    isPaused    = false;

    document.getElementById('run-dot').style.background = sub.color;
    document.getElementById('run-name').textContent = sub.name + ' 공부 중';
    updateRunToday();
    _activateScene('running');
    startTick();
    saveActiveSession();
}

function updateRunToday() {
    if (!activeSub) return;
    const sec = todayStats[activeSub.id] || 0;
    document.getElementById('run-today').textContent =
        sec > 0 ? `오늘 이 과목 ${fmtDuration(sec)}` : '오늘 이 과목 처음';
}

// ── 일시정지 / 재개 ───────────────────────────────────────
function togglePause() {
    if (!activeSub) return;
    if (isPaused) {
        // 재개
        startedAt = Date.now();
        isPaused  = false;
        document.getElementById('pause-btn').textContent = '⏸ 일시정지';
        document.getElementById('paused-label').style.display = 'none';
        startTick();
    } else {
        // 일시정지
        accumulated += Date.now() - startedAt;
        startedAt    = null;
        isPaused     = true;
        stopTick();
        document.getElementById('pause-btn').textContent = '▶ 계속';
        document.getElementById('paused-label').style.display = '';
    }
    saveActiveSession();
}

// ── 종료 ──────────────────────────────────────────────────
async function stopSession() {
    if (!activeSub) return;

    const durationSec = elapsedSec();
    const ended = new Date().toISOString();
    const sessionStartISO = new Date(
        isPaused ? (Date.now() - accumulated) : (Date.now() - accumulated - (Date.now() - startedAt))
    ).toISOString();

    stopTick();
    clearActiveSession();

    // 10초 미만 세션은 저장 안 함
    if (durationSec >= 10) {
        // 낙관적 UI: 즉시 todayStats 업데이트
        todayStats[activeSub.id] = (todayStats[activeSub.id] || 0) + durationSec;
        updateTodayTotalDisplay();

        // 서버 저장 (실패해도 로컬엔 반영됨)
        if (currentUser) {
            fetch('/api/study/sessions', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    subject_id:   activeSub.id,
                    started_at:   sessionStartISO,
                    ended_at:     ended,
                    duration_sec: durationSec,
                }),
            }).catch(() => {});
        }
    }

    activeSub   = null;
    startedAt   = null;
    accumulated = 0;
    isPaused    = false;

    renderSubjectList();
    _activateScene('timer');
}

// ── tick (UI 갱신, 1초마다) ────────────────────────────────
function startTick() {
    stopTick();
    tickId = setInterval(onTick, 1000);
    onTick();
}

function stopTick() {
    if (tickId) { clearInterval(tickId); tickId = null; }
}

function onTick() {
    const sec = elapsedSec();
    document.getElementById('big-time').textContent = fmtHMS(sec);
    document.title = `${fmtHMS(sec)} | 공부 타이머 🍀`;
}

// ── localStorage 세션 백업 ─────────────────────────────────
function saveActiveSession() {
    if (!activeSub) return;
    localStorage.setItem(LS_SESSION, JSON.stringify({
        subjectId:    activeSub.id,
        subjectName:  activeSub.name,
        subjectColor: activeSub.color,
        startedAt:    startedAt,    // 구간 시작 원본 타임스탬프 (일시정지 중엔 null)
        accumulated:  accumulated,  // 이전 구간 누적 ms
        isPaused,
    }));
}

function clearActiveSession() {
    localStorage.removeItem(LS_SESSION);
}

function restoreActiveSession() {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return;
    try {
        const s = JSON.parse(raw);
        activeSub   = { id: s.subjectId, name: s.subjectName, color: s.subjectColor };
        accumulated = s.accumulated;
        isPaused    = s.isPaused;
        startedAt   = s.startedAt;  // 원본 타임스탬프 그대로 복원 → elapsed 자동 계산

        document.getElementById('run-dot').style.background = activeSub.color;
        document.getElementById('run-name').textContent = activeSub.name + ' 공부 중';
        updateRunToday();

        if (!isPaused) {
            startTick();
        } else {
            document.getElementById('big-time').textContent = fmtHMS(elapsedSec());
            document.getElementById('pause-btn').textContent = '▶ 계속';
            document.getElementById('paused-label').style.display = '';
        }
        _activateScene('running');
    } catch {
        clearActiveSession();
    }
}

// ── 오늘 총 시간 표시 업데이트 ────────────────────────────
function updateTodayTotalDisplay() {
    const total = Object.values(todayStats).reduce((a, b) => a + b, 0);
    document.getElementById('today-total-display').textContent = fmtDuration(total) || '0분';
}

// ── 통계 로드 ─────────────────────────────────────────────
async function loadStats() {
    if (!currentUser) {
        renderStatsFromData({ today: { total_sec: 0, subjects: [] }, week: { total_sec: 0, subjects: [] }, goal_sec: goalSec, dday: null });
        return;
    }
    try {
        const res  = await fetch('/api/study/stats');
        const data = await res.json();
        statsCache = data;
        goalSec    = data.goal_sec || 28800;
        ddayInfo   = data.dday;
        renderStatsFromData(data);
        updateDdayBadge();
        updateGoalSettingVal();
    } catch {}
}

function renderStatsFromData(data) {
    const d      = statRange === 'today' ? data.today : data.week;
    const total  = d.total_sec || 0;
    const subs   = d.subjects || [];
    const goal   = data.goal_sec || goalSec;

    document.getElementById('stat-total-big').textContent   = fmtDuration(total) || '0분';
    document.getElementById('stat-total-label').textContent = statRange === 'today' ? '오늘 총 공부 시간' : '이번 주 총 공부 시간';

    // 목표 게이지 (오늘만)
    if (statRange === 'today') {
        const pct  = goal > 0 ? Math.min(1, total / goal) : 0;
        const circ = 2 * Math.PI * 22;
        const dash = pct * circ;
        document.getElementById('goal-arc').setAttribute('stroke-dasharray', `${dash.toFixed(1)} ${circ.toFixed(1)}`);
        document.getElementById('goal-pct').textContent  = Math.round(pct * 100) + '%';
        document.getElementById('goal-text').textContent = `목표 ${fmtDuration(goal)} 중 ${fmtDuration(total)} 달성`;
        document.getElementById('goal-row').style.display = '';
    } else {
        document.getElementById('goal-row').style.display = 'none';
    }

    // 과목별 바
    const bars   = document.getElementById('stat-bars');
    const empty  = document.getElementById('stat-empty');
    bars.innerHTML = '';
    if (subs.length === 0) {
        empty.style.display = '';
        empty.textContent = statRange === 'today' ? '오늘 첫 기록을 시작해볼까요?' : '이번 주는 아직 기록이 없어요';
    } else {
        empty.style.display = 'none';
        const maxSec = subs[0].total_sec;
        subs.forEach(s => {
            const pct  = maxSec > 0 ? (s.total_sec / maxSec * 100).toFixed(1) : 0;
            const name = s.name || '(삭제된 과목)';
            const color = s.color || '#9a9a94';
            bars.insertAdjacentHTML('beforeend', `
                <div class="bar-row">
                    <div class="bar-top">
                        <span class="nm">${esc(name)}</span>
                        <span class="tm">${fmtDuration(s.total_sec)}</span>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
                    </div>
                </div>
            `);
        });
    }
}

function setStatRange(range) {
    statRange = range;
    document.getElementById('stat-today-btn').classList.toggle('on', range === 'today');
    document.getElementById('stat-week-btn').classList.toggle('on',  range === 'week');
    if (statsCache) renderStatsFromData(statsCache);
    else loadStats();
}

// ── D-day 배지 ────────────────────────────────────────────
function updateDdayBadge() {
    const el = document.getElementById('dday-badge');
    if (!ddayInfo || ddayInfo.days === null) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.textContent = ddayInfo.days === 0 ? 'D-DAY' : `D-${ddayInfo.days}`;
}

// ── 설정: 목표 ────────────────────────────────────────────
function updateGoalSettingVal() {
    const h = Math.round(goalSec / 3600);
    document.getElementById('goal-setting-val').textContent = `${h}시간 ›`;
}

function openGoalModal() {
    document.getElementById('goal-hours-input').value = Math.round(goalSec / 3600) || 8;
    openModal('modal-goal');
}

async function submitGoal() {
    const h = parseInt(document.getElementById('goal-hours-input').value);
    if (isNaN(h) || h < 1 || h > 24) return;
    goalSec = h * 3600;
    updateGoalSettingVal();
    closeModal('modal-goal');
    if (currentUser) {
        await fetch('/api/daily-goal', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ target_sec: goalSec }),
        }).catch(() => {});
    }
}

// ── 설정: D-day ───────────────────────────────────────────
function updateDdaySettingVal() {
    const el = document.getElementById('dday-setting-val');
    if (!ddayInfo) { el.textContent = '설정 안됨 ›'; return; }
    el.textContent = ddayInfo.name ? `${ddayInfo.name} ›` : `D-${ddayInfo.days} ›`;
}

function openDdayModal() {
    document.getElementById('dday-name-input').value = ddayInfo?.name || '';
    document.getElementById('dday-date-input').value = '';
    openModal('modal-dday');
}

async function submitDday() {
    const name = document.getElementById('dday-name-input').value.trim();
    const date = document.getElementById('dday-date-input').value;
    closeModal('modal-dday');
    if (currentUser) {
        await fetch('/api/dday', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, target_date: date }),
        }).catch(() => {});
        await loadStats();
        updateDdaySettingVal();
    }
}

// ── 과목 추가 모달 ─────────────────────────────────────────
function openAddSubjectModal() {
    document.getElementById('add-subject-name').value = '';
    selectedColor = COLORS[0];
    renderColorPicker();
    openModal('modal-add-subject');
    setTimeout(() => document.getElementById('add-subject-name').focus(), 100);
}

function renderColorPicker() {
    const row = document.getElementById('color-picker');
    row.innerHTML = '';
    COLORS.forEach(c => {
        const sw = document.createElement('span');
        sw.className = 'color-swatch' + (c === selectedColor ? ' selected' : '');
        sw.style.background = c;
        sw.addEventListener('click', () => {
            selectedColor = c;
            row.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
            sw.classList.add('selected');
        });
        row.appendChild(sw);
    });
}

async function submitAddSubject() {
    const name = document.getElementById('add-subject-name').value.trim();
    if (!name) return;
    closeModal('modal-add-subject');

    if (!currentUser) {
        // 비로그인: 로컬에만 (서버 미저장, id는 임시 음수)
        const tmpId = -(Date.now());
        subjects.push({ id: tmpId, name, color: selectedColor, sort_order: subjects.length });
        renderSubjectList();
        renderSettingsSubjects();
        return;
    }

    try {
        const res  = await fetch('/api/subjects', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, color: selectedColor }),
        });
        const data = await res.json();
        subjects.push({ id: data.id, name, color: selectedColor, sort_order: subjects.length });
        renderSubjectList();
        renderSettingsSubjects();
    } catch {}
}

// ── 과목 삭제 ─────────────────────────────────────────────
async function confirmDeleteSubject(id, name) {
    if (!confirm(`'${name}'을(를) 숨길까요?\n지난 기록은 통계에 그대로 남아요`)) return;

    if (currentUser && id > 0) {
        await fetch(`/api/subjects/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    subjects = subjects.filter(s => s.id !== id);
    renderSubjectList();
    renderSettingsSubjects();
}

// ── 모달 헬퍼 ─────────────────────────────────────────────
function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
}

// 모달 배경 클릭 닫기
document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => {
        if (e.target === bd) bd.classList.remove('open');
    });
});

// ── XSS 방지 ──────────────────────────────────────────────
function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 페이지 이탈 경고 ──────────────────────────────────────
window.addEventListener('beforeunload', e => {
    if (activeSub && !isPaused) { e.preventDefault(); e.returnValue = ''; }
});

// ── visibility 복귀 시 tick 재개 ─────────────────────────
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeSub && !isPaused && !tickId) {
        startTick();
    }
});

// ── 초기화 ────────────────────────────────────────────────
async function init() {
    // 인증 확인
    try {
        const res  = await fetch('/api/auth/check');
        const data = await res.json();
        if (data.authenticated) currentUser = data.user.username;
    } catch {}

    // 과목 로드
    if (currentUser) {
        try {
            const res = await fetch('/api/subjects');
            subjects  = await res.json();
        } catch {}
    }

    // 오늘 통계 (과목별 todayStats 채우기)
    if (currentUser) {
        try {
            const res  = await fetch('/api/study/stats');
            const data = await res.json();
            statsCache = data;
            goalSec    = data.goal_sec || 28800;
            ddayInfo   = data.dday;
            if (data.today && data.today.subjects) {
                data.today.subjects.forEach(s => {
                    if (s.subject_id) todayStats[s.subject_id] = s.total_sec;
                });
            }
            updateDdayBadge();
            updateGoalSettingVal();
            updateDdaySettingVal();
        } catch {}
    }

    updateTodayTotalDisplay();
    renderSubjectList();

    // 진행 중 세션 복원
    restoreActiveSession();
}

init();
