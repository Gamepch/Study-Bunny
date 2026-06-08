// ── Constants ────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 90;

const MODE_CONFIG = {
    focus:     { label: '집중',      color: '#34d399', track: '#d1fae5', shadow: 'rgba(52,211,153,0.3)',  bgFrom: '#F0FFF4', bgTo: '#E6FFFA' },
    short:     { label: '짧은 휴식', color: '#38bdf8', track: '#e0f2fe', shadow: 'rgba(56,189,248,0.3)',  bgFrom: '#F0F9FF', bgTo: '#E0F2FE' },
    long:      { label: '긴 휴식',   color: '#a78bfa', track: '#ede9fe', shadow: 'rgba(167,139,250,0.3)', bgFrom: '#FAF5FF', bgTo: '#EDE9FE' },
    stopwatch: { label: '스톱워치',  color: '#f59e0b', track: '#fef3c7', shadow: 'rgba(245,158,11,0.3)',  bgFrom: '#FFFBEB', bgTo: '#FEF3C7' },
};

const LS_DUR = 'pomodoro_focus_dur';

// ── State ────────────────────────────────────────────────────
let currentUsername  = 'guest';
let mainTab          = 'pomodoro'; // 'pomodoro' | 'stopwatch'
let mode             = 'focus';    // 'focus' | 'short' | 'long' | 'stopwatch'
let selectedFocusMin = parseInt(localStorage.getItem(LS_DUR) || '25');
let totalTime        = selectedFocusMin * 60;
let timeLeft         = totalTime;
let isRunning        = false;
let sessionInCycle   = 0;
let swRecordedSec    = 0;

// Precision timing (RAF + delta)
let rafId            = null;
let startEpoch       = null;
let timeLeftAtStart  = null;
let lastDisplayedSec = -1;

// ── RAF Engine ────────────────────────────────────────────────
function rafTick(now) {
    if (!isRunning) return;

    const elapsed = (now - startEpoch) / 1000;
    let cur;

    if (mode === 'stopwatch') {
        cur = timeLeftAtStart + Math.floor(elapsed);
    } else {
        cur = timeLeftAtStart - Math.floor(elapsed);
        if (cur <= 0) {
            timeLeft = 0;
            _stopEngine();
            renderTimer();
            onSessionComplete();
            return;
        }
    }

    if (cur !== lastDisplayedSec) {
        timeLeft         = cur;
        lastDisplayedSec = cur;
        renderTimer();
        if (timeLeft % 30 === 0) saveTimerState();
    }

    rafId = requestAnimationFrame(rafTick);
}

function _stopEngine() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    startEpoch      = null;
    timeLeftAtStart = null;
}

// ── Persistence ───────────────────────────────────────────────
function saveTimerState() {
    localStorage.setItem(lsKey('timer_mode'),     mode);
    localStorage.setItem(lsKey('timer_main_tab'), mainTab);
    if (isRunning) {
        localStorage.setItem(lsKey('timer_started_at'),          String(Date.now()));
        localStorage.setItem(lsKey('timer_time_left_at_start'),  String(timeLeft));
        localStorage.removeItem(lsKey('timer_paused_at'));
    } else {
        localStorage.setItem(lsKey('timer_paused_at'), String(timeLeft));
        localStorage.removeItem(lsKey('timer_started_at'));
        localStorage.removeItem(lsKey('timer_time_left_at_start'));
    }
    if (mode === 'stopwatch') {
        localStorage.setItem(lsKey('timer_sw_recorded'), String(swRecordedSec));
    }
}

function clearTimerState() {
    ['timer_mode','timer_main_tab','timer_started_at','timer_time_left_at_start','timer_paused_at','timer_sw_recorded']
        .forEach(k => localStorage.removeItem(lsKey(k)));
}

function restoreTimerState() {
    const savedMode = localStorage.getItem(lsKey('timer_mode'));
    if (!savedMode || !MODE_CONFIG[savedMode]) return false;

    const startedAt = localStorage.getItem(lsKey('timer_started_at'));
    const tlAtStart = localStorage.getItem(lsKey('timer_time_left_at_start'));
    const pausedAt  = localStorage.getItem(lsKey('timer_paused_at'));

    mode    = savedMode;
    mainTab = localStorage.getItem(lsKey('timer_main_tab')) ||
              (mode === 'stopwatch' ? 'stopwatch' : 'pomodoro');

    if (mode === 'stopwatch') {
        totalTime     = 0;
        swRecordedSec = parseInt(localStorage.getItem(lsKey('timer_sw_recorded')) || '0');
        if (startedAt && tlAtStart !== null) {
            const elapsed = Math.floor((Date.now() - parseInt(startedAt)) / 1000);
            timeLeft = parseInt(tlAtStart) + elapsed;
            return 'resume';
        } else if (pausedAt !== null) {
            timeLeft = parseInt(pausedAt);
            return 'paused';
        }
        return false;
    }

    if (mode === 'focus')      totalTime = selectedFocusMin * 60;
    else if (mode === 'short') totalTime = 5  * 60;
    else                       totalTime = 15 * 60;

    if (startedAt && tlAtStart) {
        const elapsed   = Math.floor((Date.now() - parseInt(startedAt)) / 1000);
        const remaining = parseInt(tlAtStart) - elapsed;
        if (remaining > 0) {
            timeLeft  = remaining;
            isRunning = false;
            return 'resume';
        }
        clearTimerState();
        recordFocusSession(totalTime);
        timeLeft = totalTime;
        return 'completed';
    } else if (pausedAt !== null) {
        timeLeft  = parseInt(pausedAt);
        isRunning = false;
        return 'paused';
    }
    return false;
}

function lsKey(k) { return `pomodoro_${currentUsername}_${k}`; }

// ── Helpers ──────────────────────────────────────────────────
function getTodayStr() { return new Date().toLocaleDateString('ko-KR'); }

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

function recordFocusSession(durationSec, advanceCycle = true) {
    localStorage.setItem(lsKey('sessions'), String(getSessions() + 1));
    localStorage.setItem(lsKey('total'),    String(getTotalSec()  + durationSec));
    if (advanceCycle) {
        sessionInCycle = (sessionInCycle + 1) % 4;
        localStorage.setItem(lsKey('cycle'), String(sessionInCycle));
    }
    const histKey = lsKey('history');
    const today   = getTodayISO();
    let hist = {};
    try { hist = JSON.parse(localStorage.getItem(histKey) || '{}'); } catch {}
    if (!hist[today]) hist[today] = { sessions: 0, totalSec: 0 };
    hist[today].sessions += 1;
    hist[today].totalSec += durationSec;
    const keys = Object.keys(hist).sort();
    if (keys.length > 365) keys.slice(0, keys.length - 365).forEach(k => delete hist[k]);
    localStorage.setItem(histKey, JSON.stringify(hist));
    syncFocusToServer();
}

async function syncFocusToServer() {
    if (currentUsername === 'guest') return;
    try {
        await fetch('/api/focus/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ total_seconds: getTotalSec() }),
        });
    } catch {}
}

function fmtMMSS(sec) {
    if (sec >= 3600) {
        const h = String(Math.floor(sec / 3600)).padStart(2, '0');
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }
    return `${String(Math.floor(sec / 60)).padStart(2,'0')}:${String(sec % 60).padStart(2,'0')}`;
}

function fmtDuration(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0)           return `${h}시간`;
    return `${m}분`;
}

function getPhaseLabelText() {
    if (mainTab === 'stopwatch') return '⏱ 스톱워치';
    if (mode === 'short')        return '☕ 짧은 휴식';
    if (mode === 'long')         return '😴 긴 휴식';
    return `⚡ ${sessionInCycle + 1}회차 집중`;
}

// ── Dynamic Theme ─────────────────────────────────────────────
function updateTheme() {
    const cfg = MODE_CONFIG[mode];
    document.body.style.background = `linear-gradient(135deg, ${cfg.bgFrom} 0%, ${cfg.bgTo} 100%)`;
    const statBox = document.getElementById('stat-box');
    if (statBox) statBox.style.background = cfg.bgFrom;
    const statTime = document.getElementById('stat-total-time');
    if (statTime) statTime.style.color = cfg.color;
    const sliderLabel = document.getElementById('slider-label');
    if (sliderLabel) sliderLabel.style.color = cfg.color;
    const slider = document.getElementById('duration-slider');
    if (slider) slider.style.accentColor = cfg.color;
}

// ── Render ───────────────────────────────────────────────────
function renderTimer() {
    const display    = document.getElementById('time-display');
    const ring       = document.getElementById('progress-ring');
    const trackRing  = document.getElementById('track-ring');
    const modeLabel  = document.getElementById('mode-label');
    const startBtn   = document.getElementById('start-btn');
    const container  = document.getElementById('timer-container');
    const pauseBadge = document.getElementById('paused-badge');
    const cfg        = MODE_CONFIG[mode];

    const timeStr          = fmtMMSS(timeLeft);
    display.textContent    = timeStr;
    display.style.fontSize = timeLeft >= 3600 ? '2.5rem' : '';
    document.title         = isRunning
        ? `${timeStr} | Clover 타이머 🍀`
        : '포모도로 타이머 | Clover Study 🍀';

    const hasProgress = mode === 'stopwatch' ? timeLeft > 0 : timeLeft < totalTime;
    const showPaused  = !isRunning && hasProgress;
    container.classList.toggle('timer-paused', showPaused);
    if (pauseBadge) pauseBadge.style.display = showPaused ? 'block' : 'none';

    let progress;
    if (mode === 'stopwatch') {
        const cycle = 25 * 60;
        progress = timeLeft === 0 ? 1 : (timeLeft % cycle) / cycle || 1;
    } else {
        progress = totalTime > 0 ? timeLeft / totalTime : 1;
    }
    ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);
    ring.style.stroke           = cfg.color;
    trackRing.style.stroke      = cfg.track;

    modeLabel.textContent = getPhaseLabelText();
    modeLabel.style.color = cfg.color;

    if (isRunning) {
        startBtn.innerHTML        = '<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
        startBtn.style.background = '#f87171';
        startBtn.style.boxShadow  = '0 10px 24px rgba(248,113,113,0.28)';
    } else {
        startBtn.innerHTML        = '<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
        startBtn.style.background = cfg.color;
        startBtn.style.boxShadow  = `0 10px 24px ${cfg.shadow}`;
    }
}

function renderDots() {
    const wrapper = document.getElementById('session-dots-wrapper');
    const dots    = document.querySelectorAll('#session-dots .dot');
    if (wrapper) wrapper.style.display = mainTab === 'stopwatch' ? 'none' : '';
    dots.forEach((d, i) => {
        if (i < sessionInCycle) {
            d.style.background = MODE_CONFIG['focus'].color;
            d.style.transform  = 'scale(1.25)';
        } else {
            d.style.background = '#e5e7eb';
            d.style.transform  = 'scale(1)';
        }
    });
}

function renderStats() {
    document.getElementById('stat-total-time').textContent = fmtDuration(getTotalSec());
}

function renderTabButtons() {
    const isPomo  = mainTab === 'pomodoro';
    const cfg     = MODE_CONFIG[mode];
    const btnPomo = document.getElementById('tab-btn-pomodoro');
    const btnSw   = document.getElementById('tab-btn-stopwatch');

    if (btnPomo) {
        btnPomo.style.background    = isPomo ? '#fff' : '';
        btnPomo.style.color         = isPomo ? cfg.color : '#9ca3af';
        btnPomo.style.boxShadow     = isPomo ? '0 2px 8px rgba(0,0,0,0.1)' : '';
        // Lock inactive tab while running
        const lockPomo              = isRunning && !isPomo;
        btnPomo.style.opacity       = lockPomo ? '0.4' : '';
        btnPomo.style.cursor        = lockPomo ? 'not-allowed' : '';
        btnPomo.style.pointerEvents = lockPomo ? 'none' : '';
    }
    if (btnSw) {
        const swColor               = MODE_CONFIG['stopwatch'].color;
        btnSw.style.background      = !isPomo ? '#fff' : '';
        btnSw.style.color           = !isPomo ? swColor : '#9ca3af';
        btnSw.style.boxShadow       = !isPomo ? '0 2px 8px rgba(0,0,0,0.1)' : '';
        const lockSw                = isRunning && isPomo;
        btnSw.style.opacity         = lockSw ? '0.4' : '';
        btnSw.style.cursor          = lockSw ? 'not-allowed' : '';
        btnSw.style.pointerEvents   = lockSw ? 'none' : '';
    }

    const durSel = document.getElementById('focus-duration-selector');
    if (durSel) durSel.style.display = (isPomo && mode === 'focus') ? '' : 'none';

    const skipEl = document.getElementById('skip-row');
    if (skipEl) skipEl.style.display = isPomo ? '' : 'none';

    const hintEl = document.getElementById('autoflow-hint');
    if (hintEl) hintEl.style.display = isPomo ? '' : 'none';
}

function renderDurationSlider() {
    const slider = document.getElementById('duration-slider');
    const label  = document.getElementById('slider-label');
    if (!slider) return;
    const cfg = MODE_CONFIG[mode];
    slider.value      = selectedFocusMin;
    label.textContent = `${selectedFocusMin}분`;
    label.style.color = cfg.color;
    const pct = ((selectedFocusMin - 1) / 59) * 100;
    slider.style.background = `linear-gradient(to right, ${cfg.color} ${pct}%, #e5e7eb ${pct}%)`;
}

function renderAll() {
    updateTheme();
    renderTabButtons();
    renderTimer();
    renderDots();
    renderStats();
    renderDurationSlider();
}

// ── Tab Switch ────────────────────────────────────────────────
function setTab(newTab) {
    if (newTab === mainTab) return;
    if (isRunning) {
        showWarning('⛔ 타이머 실행 중', '먼저 타이머를 정지해주세요');
        shakeTabBar();
        return;
    }
    // Flush any unrecorded stopwatch time before leaving
    if (mode === 'stopwatch' && timeLeft > swRecordedSec) {
        recordFocusSession(timeLeft - swRecordedSec, false);
        renderStats();
    }
    mainTab       = newTab;
    swRecordedSec = 0;
    if (newTab === 'stopwatch') {
        mode      = 'stopwatch';
        totalTime = 0;
        timeLeft  = 0;
    } else {
        mode      = 'focus';
        totalTime = selectedFocusMin * 60;
        timeLeft  = totalTime;
    }
    clearTimerState();
    saveTimerState();
    renderAll();
}

// ── Internal Phase Switch (auto-flow) ─────────────────────────
function _switchPomoPhase(newPhase, autoStart) {
    mode = newPhase;
    if (mode === 'focus')      totalTime = selectedFocusMin * 60;
    else if (mode === 'short') totalTime = 5  * 60;
    else                       totalTime = 15 * 60;
    timeLeft = totalTime;
    clearTimerState();
    saveTimerState();
    renderAll();
    if (autoStart) startTimer();
}

// ── Slider ───────────────────────────────────────────────────
function onSliderInput(val) {
    const min    = parseInt(val);
    const label  = document.getElementById('slider-label');
    const slider = document.getElementById('duration-slider');
    const cfg    = MODE_CONFIG[mode];
    label.textContent = `${min}분`;
    const pct = ((min - 1) / 59) * 100;
    slider.style.background = `linear-gradient(to right, ${cfg.color} ${pct}%, #e5e7eb ${pct}%)`;
}

function onSliderChange(val) {
    const min = parseInt(val);
    if (isRunning) {
        showWarning('⛔ 타이머 실행 중', '정지 후에 시간을 변경할 수 있어요');
        renderDurationSlider();
        return;
    }
    if (mode === 'focus' && timeLeft < totalTime) {
        if (!confirm('타이머가 일시정지 중이에요. 시간을 바꾸면 초기화됩니다. 계속할까요?')) {
            renderDurationSlider();
            return;
        }
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
function toggleTimer() { isRunning ? pauseTimer() : startTimer(); }

function startTimer() {
    requestNotifPermission();
    isRunning        = true;
    startEpoch       = performance.now();
    timeLeftAtStart  = timeLeft;
    lastDisplayedSec = timeLeft;
    rafId            = requestAnimationFrame(rafTick);
    saveTimerState();
    renderTimer();
    renderTabButtons();
}

function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    if (startEpoch !== null) {
        const elapsed = (performance.now() - startEpoch) / 1000;
        timeLeft = mode === 'stopwatch'
            ? timeLeftAtStart + Math.floor(elapsed)
            : Math.max(0, timeLeftAtStart - Math.floor(elapsed));
    }
    _stopEngine();
    if (mode === 'stopwatch' && timeLeft > swRecordedSec) {
        const delta   = timeLeft - swRecordedSec;
        swRecordedSec = timeLeft;
        recordFocusSession(delta, false);
        renderStats();
    }
    saveTimerState();
    renderTimer();
    renderTabButtons();
}

function resetTimer() {
    if (mode === 'stopwatch' && timeLeft > 0) {
        if (!confirm('스톱워치를 초기화할까요?\n기록된 시간은 통계에 저장됩니다.')) return;
    }
    pauseTimer();
    timeLeft      = mode !== 'stopwatch' ? totalTime : 0;
    swRecordedSec = 0;
    clearTimerState();
    renderTimer();
}

function skipSession() {
    if (mainTab !== 'pomodoro') return;
    pauseTimer();
    if (mode === 'focus') {
        _switchPomoPhase(sessionInCycle === 3 ? 'long' : 'short', false);
    } else {
        _switchPomoPhase('focus', false);
    }
}

// ── Session Complete (Auto-Flow Engine) ───────────────────────
function onSessionComplete() {
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    isRunning = false;
    renderTabButtons();

    if (mainTab === 'stopwatch') return;

    if (mode === 'focus') {
        recordFocusSession(totalTime); // advances sessionInCycle
        renderStats();
        renderDots();

        const total       = getTotalSec();
        const toLong      = sessionInCycle === 0; // wrapped → 4th session done
        const nextPhase   = toLong ? 'long' : 'short';
        const breakLabel  = toLong ? '긴 휴식 15분' : '짧은 휴식 5분';

        showToast('🎉', `${selectedFocusMin}분 집중 완료!`,
                  `오늘 총 ${fmtDuration(total)} · ${breakLabel} 자동 시작 ▶`);
        sendNotification(`🎉 집중 완료!`, `${breakLabel}이 시작됩니다.`);
        setTimeout(() => _switchPomoPhase(nextPhase, true), 900);

    } else if (mode === 'short') {
        showToast('🚀', '휴식 끝!', '다시 집중 자동 시작 ▶');
        sendNotification('🚀 휴식 종료!', '집중 모드로 자동 전환됩니다.');
        setTimeout(() => _switchPomoPhase('focus', true), 900);

    } else { // long break
        showToast('🌟', '사이클 완료!', '4회 집중 완주! 새 사이클을 시작해보세요 👏');
        sendNotification('🌟 사이클 완료!', '수고하셨습니다! 새 사이클을 시작해보세요.');
        setTimeout(() => _switchPomoPhase('focus', false), 900); // don't auto-start after long break
    }
}

// ── Toast / Warning ───────────────────────────────────────────
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

let warnTimeout = null;
function showWarning(title, body) {
    const el = document.getElementById('warn-toast');
    if (!el) return;
    document.getElementById('warn-title').textContent = title;
    document.getElementById('warn-body').textContent  = body;
    el.classList.remove('hidden', 'opacity-0', '-translate-y-2');
    clearTimeout(warnTimeout);
    warnTimeout = setTimeout(() => {
        el.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => el.classList.add('hidden'), 300);
    }, 2500);
}

function shakeTabBar() {
    const el = document.getElementById('tab-bar');
    if (!el) return;
    el.classList.add('shake-anim');
    setTimeout(() => el.classList.remove('shake-anim'), 500);
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

// ── Visibility Recovery ───────────────────────────────────────
document.addEventListener('visibilitychange', () => {
    if (document.hidden || !isRunning || startEpoch === null) return;
    const elapsed = (performance.now() - startEpoch) / 1000;
    if (mode === 'stopwatch') {
        timeLeft = timeLeftAtStart + Math.floor(elapsed);
    } else {
        timeLeft = Math.max(0, timeLeftAtStart - Math.floor(elapsed));
        if (timeLeft <= 0) {
            timeLeft = 0;
            _stopEngine();
            isRunning = false;
            renderTimer();
            onSessionComplete();
            return;
        }
    }
    lastDisplayedSec = timeLeft;
    renderTimer();
});

// ── Page Leave Warning ────────────────────────────────────────
window.addEventListener('beforeunload', e => {
    if (isRunning) { e.preventDefault(); e.returnValue = ''; }
});

// ── Keyboard ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeToast();
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

// ── Init ─────────────────────────────────────────────────────
async function init() {
    await checkAuth();
    loadStats();
    const restored = restoreTimerState();
    if (restored === 'resume') {
        renderAll();
        startTimer();
    } else {
        if (restored === 'completed') renderDots();
        renderAll();
    }
}

init();
