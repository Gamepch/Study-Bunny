// ── Constants ────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 90; // 565.49

const MODE_CONFIG = {
    focus: { label: '집중',    color: '#34d399', track: '#d1fae5', shadow: 'rgba(52,211,153,0.3)' },
    short: { label: '짧은 휴식', color: '#38bdf8', track: '#e0f2fe', shadow: 'rgba(56,189,248,0.3)' },
    long:  { label: '긴 휴식',  color: '#a78bfa', track: '#ede9fe', shadow: 'rgba(167,139,250,0.3)' },
};

const LS_DUR = 'pomodoro_focus_dur'; // 계정 무관 UI 설정

// ── State ────────────────────────────────────────────────────
let currentUsername  = 'guest';
let mode             = 'focus';
let selectedFocusMin = parseInt(localStorage.getItem(LS_DUR) || '25');
let totalTime        = selectedFocusMin * 60;
let timeLeft         = totalTime;
let isRunning        = false;
let timerId          = null;
let sessionInCycle   = 0;

// 계정별 키 생성
function lsKey(k) { return `pomodoro_${currentUsername}_${k}`; }

// ── Helpers ──────────────────────────────────────────────────
function getTodayStr() {
    return new Date().toLocaleDateString('ko-KR');
}

function getTodayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function loadStats() {
    if (localStorage.getItem(lsKey('date')) !== getTodayStr()) {
        localStorage.setItem(lsKey('date'),     getTodayStr());
        localStorage.setItem(lsKey('sessions'), '0');
        localStorage.setItem(lsKey('total'),    '0');
        localStorage.setItem(lsKey('cycle'),    '0');
    }
    sessionInCycle = parseInt(localStorage.getItem(lsKey('cycle')) || '0');
}

function getSessions() { return parseInt(localStorage.getItem(lsKey('sessions')) || '0'); }
function getTotalSec()  { return parseInt(localStorage.getItem(lsKey('total'))    || '0'); }

function recordFocusSession(durationSec) {
    localStorage.setItem(lsKey('sessions'), String(getSessions() + 1));
    localStorage.setItem(lsKey('total'),    String(getTotalSec()  + durationSec));
    sessionInCycle = (sessionInCycle + 1) % 4;
    localStorage.setItem(lsKey('cycle'), String(sessionInCycle));

    // 스트릭 캘린더용 날짜별 히스토리 영구 저장
    const histKey = lsKey('history');
    const today   = getTodayISO();
    let hist = {};
    try { hist = JSON.parse(localStorage.getItem(histKey) || '{}'); } catch {}
    if (!hist[today]) hist[today] = { sessions: 0, totalSec: 0 };
    hist[today].sessions += 1;
    hist[today].totalSec += durationSec;
    // 최대 365일 유지
    const keys = Object.keys(hist).sort();
    if (keys.length > 365) keys.slice(0, keys.length - 365).forEach(k => delete hist[k]);
    localStorage.setItem(histKey, JSON.stringify(hist));
}

function fmtMMSS(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
}

function fmtDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0)           return `${h}시간`;
    return `${m}분`;
}

// ── Render ───────────────────────────────────────────────────
function renderTimer() {
    const display   = document.getElementById('time-display');
    const ring      = document.getElementById('progress-ring');
    const trackRing = document.getElementById('track-ring');
    const modeLabel = document.getElementById('mode-label');
    const startBtn  = document.getElementById('start-btn');
    const cfg       = MODE_CONFIG[mode];

    display.textContent = fmtMMSS(timeLeft);
    document.title = isRunning
        ? `${fmtMMSS(timeLeft)} | Clover 타이머 🍀`
        : '포모도로 타이머 | Clover Study 🍀';

    // Progress ring
    const progress = totalTime > 0 ? timeLeft / totalTime : 1;
    ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
    ring.style.stroke  = cfg.color;
    trackRing.style.stroke = cfg.track;

    // Mode label
    modeLabel.textContent = cfg.label;
    modeLabel.style.color = cfg.color;

    // Start button
    if (isRunning) {
        startBtn.textContent       = '⏸';
        startBtn.style.background  = '#f87171';
        startBtn.style.boxShadow   = '0 10px 24px rgba(248,113,113,0.28)';
    } else {
        startBtn.textContent       = '▶';
        startBtn.style.background  = cfg.color;
        startBtn.style.boxShadow   = `0 10px 24px ${cfg.shadow}`;
    }
}

function renderDots() {
    const dots = document.querySelectorAll('#session-dots .dot');
    dots.forEach((d, i) => {
        if (i < sessionInCycle) {
            d.style.background = '#34d399';
            d.style.transform  = 'scale(1.25)';
        } else {
            d.style.background = '#e5e7eb';
            d.style.transform  = 'scale(1)';
        }
    });
}

function renderStats() {
    const sessions = getSessions();
    const total    = getTotalSec();
    document.getElementById('stat-sessions').textContent   = sessions;
    document.getElementById('stat-total-time').textContent = fmtDuration(total);
}

function renderModeButtons() {
    ['focus', 'short', 'long'].forEach(m => {
        const btn = document.getElementById(`mode-btn-${m === 'short' ? 'short' : m === 'long' ? 'long' : 'focus'}`);
        const active = m === mode;
        const cfg    = MODE_CONFIG[m];
        btn.style.background = active ? cfg.color : '';
        btn.style.color      = active ? '#fff' : '#9ca3af';
        btn.style.boxShadow  = active ? `0 4px 12px ${cfg.shadow}` : '';
    });
    document.getElementById('focus-duration-selector').style.display =
        mode === 'focus' ? '' : 'none';
}

function renderDurationSlider() {
    const slider = document.getElementById('duration-slider');
    const label  = document.getElementById('slider-label');
    if (!slider) return;
    slider.value = selectedFocusMin;
    label.textContent = `${selectedFocusMin}분`;
    const pct = ((selectedFocusMin - 1) / 59) * 100;
    slider.style.background = `linear-gradient(to right, #34d399 ${pct}%, #e5e7eb ${pct}%)`;
}

// ── Mode / Duration ───────────────────────────────────────────
function setMode(newMode, silent = false) {
    if (isRunning && !silent) {
        if (!confirm('타이머가 진행 중이에요. 모드를 바꾸면 초기화됩니다. 계속할까요?')) return;
        pauseTimer();
    }
    mode = newMode;
    if (mode === 'focus')      totalTime = selectedFocusMin * 60;
    else if (mode === 'short') totalTime = 5  * 60;
    else                       totalTime = 15 * 60;
    timeLeft = totalTime;
    renderModeButtons();
    renderTimer();
    renderDots();
}

// 슬라이더 드래그 중 — 라벨과 색상만 실시간 업데이트
function onSliderInput(val) {
    const min    = parseInt(val);
    const label  = document.getElementById('slider-label');
    const slider = document.getElementById('duration-slider');
    label.textContent = `${min}분`;
    const pct = ((min - 1) / 59) * 100;
    slider.style.background = `linear-gradient(to right, #34d399 ${pct}%, #e5e7eb ${pct}%)`;
}

// 슬라이더 손 뗐을 때 — 타이머 실제 반영
function onSliderChange(val) {
    const min = parseInt(val);
    if (isRunning) {
        if (!confirm('타이머가 진행 중이에요. 시간을 바꾸면 초기화됩니다. 계속할까요?')) {
            renderDurationSlider(); // 되돌리기
            return;
        }
        pauseTimer();
    }
    setFocusDuration(min);
}

function setFocusDuration(min) {
    selectedFocusMin = min;
    localStorage.setItem(LS_DUR, String(min));
    if (mode === 'focus') {
        totalTime = min * 60;
        timeLeft  = totalTime;
    }
    renderDurationSlider();
    renderTimer();
}

// ── Timer Controls ────────────────────────────────────────────
function toggleTimer() {
    isRunning ? pauseTimer() : startTimer();
}

function startTimer() {
    requestNotifPermission();
    isRunning = true;
    timerId   = setInterval(tick, 1000);
    renderTimer();
}

function pauseTimer() {
    isRunning = false;
    clearInterval(timerId);
    timerId   = null;
    renderTimer();
}

function resetTimer() {
    pauseTimer();
    timeLeft = totalTime;
    renderTimer();
}

function skipSession() {
    pauseTimer();
    // Skip without recording the session
    if (mode === 'focus') {
        const next = sessionInCycle === 3 ? 'long' : 'short';
        setMode(next, true);
    } else {
        setMode('focus', true);
    }
}

function tick() {
    timeLeft--;
    renderTimer();
    if (timeLeft <= 0) {
        pauseTimer();
        onSessionComplete();
    }
}

// ── Session Complete ──────────────────────────────────────────
function onSessionComplete() {
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);

    if (mode === 'focus') {
        recordFocusSession(totalTime);
        renderStats();
        renderDots();

        const sessions = getSessions();
        const total    = getTotalSec();
        showToast('🎉', `${selectedFocusMin}분 집중 완료!`,
                  `오늘 ${sessions}세션 · ${fmtDuration(total)} 달성 🍀`);
        sendNotification(`🎉 ${selectedFocusMin}분 집중 완료!`,
                         `오늘 ${sessions}세션 · ${fmtDuration(total)}`);

        const nextMode = sessionInCycle === 0 ? 'long' : 'short';
        setTimeout(() => setMode(nextMode, true), 600);
    } else {
        showToast('☕', '휴식 종료!', '다시 집중 모드로 돌아가요');
        sendNotification('☕ 휴식 종료!', '다시 집중해봐요!');
        setTimeout(() => setMode('focus', true), 600);
    }
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimeout = null;
function showToast(emoji, title, body) {
    document.getElementById('toast-emoji').textContent = emoji;
    document.getElementById('toast-title').textContent = title;
    document.getElementById('toast-body').textContent  = body;
    const toast = document.getElementById('session-toast');
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(closeToast, 6000);
}
function closeToast() {
    document.getElementById('session-toast').classList.add('hidden');
}

// ── Notifications ─────────────────────────────────────────────
function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}
function sendNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/static/favicon.ico' });
    }
}


// ── Page Leave Warning ────────────────────────────────────────
window.addEventListener('beforeunload', e => {
    if (isRunning) { e.preventDefault(); e.returnValue = ''; }
});

// ── Keyboard ──────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeToast(); }
    if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        toggleTimer();
    }
});

// ── Auth Check ────────────────────────────────────────────────
async function checkAuth() {
    try {
        const res  = await fetch('/api/auth/check');
        const data = await res.json();
        const zone = document.getElementById('auth-zone');
        if (data.authenticated) {
            currentUsername  = data.user.username;
            zone.textContent = data.user.nickname;
            zone.style.color = '#059669';
        } else {
            currentUsername = 'guest';
            zone.innerHTML  = '<a href="/" style="color:#34d399;font-weight:700;">로그인</a>';
        }
    } catch {
        currentUsername = 'guest';
    }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
    await checkAuth(); // username 확정 후 stats 로드
    loadStats();
    renderDurationSlider();
    renderModeButtons();
    renderTimer();
    renderDots();
    renderStats();
}

init();
