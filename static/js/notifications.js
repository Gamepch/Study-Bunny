/**
 * In-app notifications (comments, likes on my posts).
 */

/**
 * Get current logged-in user from server session.
 */
async function getNotificationUser() {
    try {
        const response = await fetch('/api/auth/check');
        const data = await response.json();
        return data.authenticated ? data.user : null;
    } catch (e) {
        console.error('Auth check error:', e);
        return null;
    }
}

function notificationBellButtonHtml() {
    return `
        <button type="button" class="notification-bell-btn relative p-2 rounded-xl text-emerald-500 hover:bg-emerald-50 transition-colors" onclick="openNotificationsModal()" title="알림" aria-label="알림">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span class="notification-badge hidden" style="position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; background-color: #ef4444; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold; line-height: 1;">0</span>
        </button>
    `;
}

async function mountNotificationBell(containerId) {
    // 'notification-bell-container'에만 버튼을 추가
    let el = document.getElementById('notification-bell-container');
    
    if (!el) {
        // notification-bell-container가 없으면 containerId 사용
        el = document.getElementById(containerId);
    }
    
    if (!el) return;
    
    // 이미 버튼이 있으면 반환 (중복 생성 방지)
    if (el.querySelector('.notification-bell-btn')) return;
    
    const user = await getNotificationUser();
    if (!user) return;
    
    // insertAdjacentHTML로 추가 (기존 내용 유지)
    el.insertAdjacentHTML('beforeend', notificationBellButtonHtml());
}

async function initNotifications() {
    const user = await getNotificationUser();
    if (!user) return;
    
    // 알림 버튼 마운트는 renderAuthZone()에서 이미 처리됨
    // initNotifications()에서는 배지만 업데이트
    refreshNotificationBadge();
}

function updateNotificationBadge(count) {
    const badges = document.querySelectorAll('.notification-badge');
    if (!badges || badges.length === 0) return;
    badges.forEach(badge => {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.classList.remove('hidden');
            badge.style.display = 'flex';
        } else {
            badge.classList.add('hidden');
            badge.style.display = 'none';
        }
    });
}

async function refreshNotificationBadge() {
    const user = await getNotificationUser();
    if (!user) return;

    fetch(`/api/notifications/${encodeURIComponent(user.username)}`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => updateNotificationBadge(data.unread_count || 0))
        .catch(() => {});
}

function openNotificationsModal() {
    // 비동기 처리 필요
    getNotificationUser().then(user => {
        if (!user) {
            alert('알림을 보려면 로그인해주세요! 🍀');
            if (typeof openAuthModal === 'function') openAuthModal('login');
            return;
        }
        const modal = document.getElementById('notifications-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        loadNotificationsList();
    });
}

function closeNotificationsModal() {
    const modal = document.getElementById('notifications-modal');
    if (modal) modal.classList.add('hidden');
}

function loadNotificationsList() {
    getNotificationUser().then(user => {
        const list = document.getElementById('notifications-list');
        if (!user || !list) return;
        list.innerHTML = `<div class="text-center text-emerald-300 text-xs py-10">불러오는 중... 🍀</div>`;
        
        fetch(`/api/notifications/${encodeURIComponent(user.username)}`)
            .then(res => {
                if (!res.ok) throw new Error('load failed');
                return res.json();
            })
            .then(data => {
                updateNotificationBadge(data.unread_count || 0);
                renderNotificationsList(data.notifications || []);
            })
            .catch(error => {
                console.error('Load notifications error:', error);
                list.innerHTML = `<div class="text-center text-red-400 text-xs py-10">알림을 불러오지 못했어요. 😢</div>`;
            });
    });
}

function renderNotificationsList(notifications) {
    const list = document.getElementById('notifications-list');
    if (!list) return;

    if (!notifications.length) {
        list.innerHTML = `
            <div class="text-center text-gray-400 text-xs py-12">
                <span class="text-2xl block mb-2">🔔</span>
                아직 새 알림이 없어요.
            </div>`;
        return;
    }

    list.innerHTML = notifications.map(item => {
        const isUnread = !item.is_read;
        const unreadClass = isUnread ? 'bg-emerald-50/80 border-emerald-100' : 'bg-white';
        const icon = item.type === 'like' ? '❤️' : '💬';
        return `
            <button type="button" onclick="openNotificationTarget(${item.id}, ${item.post_id})"
                class="w-full text-left p-3 rounded-xl border border-emerald-50 shadow-sm ${unreadClass} hover:bg-emerald-50/50 transition-colors overflow-hidden">
                <div class="flex items-start gap-3">
                    <span class="text-lg shrink-0 mt-0.5">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-gray-700 leading-snug break-words whitespace-normal">${escapeNotificationHtml(item.message)}</p>
                        <p class="text-[10px] text-gray-400 mt-1">${item.created_at}</p>
                    </div>
                    ${isUnread ? '<span class="w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-2"></span>' : ''}
                </div>
            </button>
        `;
    }).join('');
}

function escapeNotificationHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function openNotificationTarget(notificationId, postId) {
    getNotificationUser().then(user => {
        if (!user) {
            window.location.href = `/post/${postId}`;
            return;
        }

        fetch(`/api/notifications/${encodeURIComponent(user.username)}/${notificationId}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username }),
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && typeof data.unread_count === 'number') {
                    updateNotificationBadge(data.unread_count);
                }
            })
            .finally(() => {
                closeNotificationsModal();
                window.location.href = `/post/${postId}`;
            });
    });
}

function markAllNotificationsRead() {
    getNotificationUser().then(user => {
        if (!user) return;

        fetch(`/api/notifications/${encodeURIComponent(user.username)}/read-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username }),
        })
            .then(res => res.json())
            .then(() => {
                updateNotificationBadge(0);
                loadNotificationsList();
            })
            .catch(() => alert('처리에 실패했습니다.'));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initNotifications();
});
