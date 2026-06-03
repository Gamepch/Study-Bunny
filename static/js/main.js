/**
 * Global State Variables
 */
let allFeeds = []; 
let currentCategory = '전체'; 
let currentSort = 'latest';
let currentUser = null;
let currentAuthMode = 'login'; // 'login' or 'signup'

const FEED_CONTAINER_CLASS = 'm-4 bg-white rounded-3xl shadow-sm border border-emerald-100 overflow-hidden';

document.addEventListener('DOMContentLoaded', () => {
    checkLoginStatus();
    if (typeof initNotifications === 'function') initNotifications();
    if (window.__INITIAL_FEEDS__ && Array.isArray(window.__INITIAL_FEEDS__)) {
        allFeeds = window.__INITIAL_FEEDS__;
        updateCategoryTabs(currentCategory);
    } else {
        fetchFeeds();
    }
    loadFormComponent();
    initCategoryTabScroll();
});

function initCategoryTabScroll() {
    const scrollWrapper = document.getElementById('category-tab-scroll');
    if (!scrollWrapper) return;

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    scrollWrapper.addEventListener('mousedown', (event) => {
        isDown = true;
        scrollWrapper.classList.add('cursor-grabbing');
        startX = event.pageX - scrollWrapper.offsetLeft;
        scrollLeft = scrollWrapper.scrollLeft;
    });

    scrollWrapper.addEventListener('mouseleave', () => {
        isDown = false;
        scrollWrapper.classList.remove('cursor-grabbing');
    });

    scrollWrapper.addEventListener('mouseup', () => {
        isDown = false;
        scrollWrapper.classList.remove('cursor-grabbing');
    });

    scrollWrapper.addEventListener('mousemove', (event) => {
        if (!isDown) return;
        event.preventDefault();
        const x = event.pageX - scrollWrapper.offsetLeft;
        const walk = (x - startX) * 1.5;
        scrollWrapper.scrollLeft = scrollLeft - walk;
    });

    scrollWrapper.addEventListener('touchstart', (event) => {
        startX = event.touches[0].pageX - scrollWrapper.offsetLeft;
        scrollLeft = scrollWrapper.scrollLeft;
    });

    scrollWrapper.addEventListener('touchmove', (event) => {
        const x = event.touches[0].pageX - scrollWrapper.offsetLeft;
        const walk = (x - startX) * 1.5;
        scrollWrapper.scrollLeft = scrollLeft - walk;
    });
}

/**
 * Fetch all posts from the server.
 */
function fetchFeeds() {
    fetch('/api/feeds')
        .then(response => response.json())
        .then(data => {
            allFeeds = data;
            filterCategory(currentCategory);
        })
        .catch(error => console.error('Data loading error:', error));
}

/**
 * Render the list of posts onto the feed container.
 * @param {Array} feeds - Array of post objects to render.
 */
function renderFeeds(feeds) {
    const feedContainer = document.getElementById('feed-container');
    if (!feedContainer) return;
    feedContainer.className = FEED_CONTAINER_CLASS;
    feedContainer.innerHTML = ''; 

    if (!feeds || feeds.length === 0) {
        feedContainer.innerHTML = `
            <div class="text-center py-12 text-gray-400 text-xs font-medium">
                <span class="text-2xl block mb-2">🍀</span>
                아직 이 카테고리에 작성된 글이 없어요.<br>
                첫 번째 공부 기록을 남겨보세요!
            </div>`;
        return;
    }

    feeds.forEach((feed, index) => {
        const thumbnailHTML = feed.image_url 
            ? `<div class="flex items-center justify-center self-center ml-3 shrink-0">
                   <div class="w-16 h-16 rounded-xl overflow-hidden bg-emerald-50 border border-emerald-100 shadow-sm">
                       <img src="${feed.image_url}" alt="썸네일" class="w-full h-full aspect-square object-cover">
                   </div>
               </div>`
            : '';
        const borderClass = index !== feeds.length - 1 ? 'border-b border-emerald-50' : '';

        const listItemHTML = `
            <div onclick="location.href='/post/${feed.id}'" class="${borderClass} p-4 flex justify-between items-start hover:bg-emerald-50/30 transition-colors cursor-pointer">
                <div class="flex-1 min-w-0">
                    <span class="inline-block text-[10px] font-bold bg-emerald-50 text-emerald-500 px-2 py-0.5 rounded-md mb-1">
                        ${feed.category || '공부기록'}
                    </span>

                    <h2 class="text-[15px] font-bold text-gray-800 mb-1 truncate">
                        ${feed.title}
                        <span class="text-emerald-500 text-xs ml-1">[${feed.comment_count || 0}]</span>
                    </h2>
                    <p class="text-xs text-gray-500 mb-2 truncate">${feed.content}</p>
                    <div class="flex items-center text-[11px] text-gray-400 space-x-2">
                        <div class="flex items-center">
                            <img src="${feed.profile_url || 'https://placehold.co/100x100/ffb6c1/ffffff?text=Me'}" alt="프로필" class="w-4 h-4 rounded-full mr-1 object-cover">
                            <a href="/mypage?user=${feed.username}" class="font-medium text-gray-600 hover:text-emerald-500 hover:underline" onclick="event.stopPropagation()">${feed.nickname}</a>
                        </div>
                        <span>|</span>
                        <span>${feed.date}</span>
                        <span>|</span>
                        <span>조회 ${feed.views || 0}</span>
                    </div>
                </div>
                ${thumbnailHTML}
            </div>
        `;
        feedContainer.innerHTML += listItemHTML;
    });
}

/**
 * Load the shared form component for writing posts.
 */
function loadFormComponent() {
    fetch('/component/form')
        .then(res => res.text())
        .then(html => {
            const container = document.getElementById('form-container');
            if (container) {
                container.innerHTML = html;
                document.getElementById('modal-image-input').onchange = previewImage;
                document.getElementById('modal-preview-remove-btn').onclick = removeImage;
            }
        });
}

/**
 * Preview image in the form modal.
 */
function previewImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('modal-preview-img').src = e.target.result;
            document.getElementById('modal-preview-container').classList.remove('hidden');
        }
        reader.readAsDataURL(file);
    }
}

/**
 * Remove image from the form modal preview.
 */
function removeImage() {
    document.getElementById('modal-image-input').value = "";
    document.getElementById('modal-preview-img').src = "";
    document.getElementById('modal-preview-container').classList.add('hidden');
}

/**
 * Save draft to localStorage.
 */
function saveDraft() {
    const category = document.getElementById('modal-category').value;
    const title = document.getElementById('modal-title-input').value;
    const content = document.getElementById('modal-content-input').value;
    const imageInput = document.getElementById('modal-image-input');
    
    const draft = {
        category: category,
        title: title,
        content: content,
        imageData: null
    };
    
    // Save image as base64 if exists
    if (imageInput.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            draft.imageData = e.target.result;
            localStorage.setItem('clover_draft', JSON.stringify(draft));
            alert('임시저장되었습니다! 💾');
        };
        reader.readAsDataURL(imageInput.files[0]);
    } else {
        localStorage.setItem('clover_draft', JSON.stringify(draft));
        alert('임시저장되었습니다! 💾');
    }
}

/**
 * Load draft from localStorage.
 */
function loadDraft() {
    const draftData = localStorage.getItem('clover_draft');
    if (!draftData) return;
    
    try {
        const draft = JSON.parse(draftData);
        document.getElementById('modal-category').value = draft.category || '공부기록';
        document.getElementById('modal-title-input').value = draft.title || '';
        document.getElementById('modal-content-input').value = draft.content || '';
        
        // Load image if exists
        if (draft.imageData) {
            document.getElementById('modal-preview-img').src = draft.imageData;
            document.getElementById('modal-preview-container').classList.remove('hidden');
        }
    } catch (e) {
        console.error('Draft load error:', e);
    }
}

/**
 * Clear draft from localStorage.
 */
function clearDraft() {
    localStorage.removeItem('clover_draft');
}

/**
 * Toggle the post creation modal.
 */
function toggleWriteModal() {
    const modal = document.getElementById('write-modal');
    if (!modal) return;

    if (modal.classList.contains('hidden') && !currentUser) {
        alert("글을 작성하려면 먼저 로그인해주세요! 🍀");
        openAuthModal('login');
        return;
    }

    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        // Load draft if exists, otherwise initialize with defaults
        const hasDraft = localStorage.getItem('clover_draft');
        if (hasDraft) {
            loadDraft();
        } else {
            document.getElementById('modal-category').value = '공부기록';
            document.getElementById('modal-title-input').value = '';
            document.getElementById('modal-content-input').value = '';
            removeImage();
        }
    }
}

/**
 * Open the write modal to create a new post, loading form if necessary.
 */
function openWriteModalForCreate() {
    if (!currentUser) {
        alert("글을 작성하려면 먼저 로그인해주세요! 🍀");
        openAuthModal('login');
        return;
    }

    const modal = document.getElementById('write-modal');
    if (!modal) return;

    if (!document.getElementById('modal-category')) {
        loadFormComponent();
        setTimeout(() => {
            if (document.getElementById('modal-category')) {
                const hasDraft = localStorage.getItem('clover_draft');
                if (hasDraft) {
                    loadDraft();
                } else {
                    document.getElementById('modal-category').value = '공부기록';
                    document.getElementById('modal-title-input').value = '';
                    document.getElementById('modal-content-input').value = '';
                    removeImage();
                }
            }
            modal.classList.remove('hidden');
        }, 120);
        return;
    }

    const hasDraft = localStorage.getItem('clover_draft');
    if (hasDraft) {
        loadDraft();
    } else {
        document.getElementById('modal-category').value = '공부기록';
        document.getElementById('modal-title-input').value = '';
        document.getElementById('modal-content-input').value = '';
        removeImage();
    }
    modal.classList.remove('hidden');
}

/**
 * Submit the new post to the server.
 */
function submitPost() {
    if (!currentUser) {
        alert("글을 작성하려면 먼저 로그인해주세요! 🍀");
        openAuthModal('login');
        return;
    }

    const category = document.getElementById('modal-category').value;
    const title = document.getElementById('modal-title-input').value;
    const content = document.getElementById('modal-content-input').value;
    const imageFile = document.getElementById('modal-image-input').files[0];

    if (!title.trim() || !content.trim()) {
        alert("제목과 내용을 모두 입력해주세요! 🍀");
        return;
    }

    const formData = new FormData();
    formData.append('category', category);
    formData.append('title', title);
    formData.append('content', content);
    formData.append('nickname', currentUser.nickname);
    formData.append('profile_url', currentUser.profile_url);
    formData.append('username', currentUser.username);

    if (imageFile) {
        formData.append('image', imageFile);
    }

    fetch('/api/feeds', { method: 'POST', body: formData })
        .then(res => {
            if (!res.ok) throw new Error("Server Error (500)");
            return res.json();
        })
        .then(data => {
            if (data.message === "success") {
                alert("새 공부 기록이 등록되었습니다! 🎉");
                clearDraft();
                toggleWriteModal();
                fetchFeeds();
            }
        })
        .catch(err => {
            console.error("Post Submission Error:", err);
            alert("글 작성 중 문제가 발생했어요. F12를 눌러 콘솔창을 확인해주세요!");
        });
}

/**
 * Highlight the active category tab without re-rendering feeds.
 * @param {string} category - The category to select.
 */
function updateCategoryTabs(category) {
    currentCategory = category;

    const tabs = document.querySelectorAll('.category-tab');
    tabs.forEach(tab => {
        tab.classList.remove('active-tab');
        tab.classList.add('inactive-tab');
    });

    const selectedTab = document.getElementById(`tab-${category}`);
    if (selectedTab) {
        selectedTab.classList.remove('inactive-tab');
        selectedTab.classList.add('active-tab');
    }
}

/**
 * Filter posts by category and highlight active tab.
 * @param {string} category - The category to filter by.
 */
function filterCategory(category) {
    updateCategoryTabs(category);
    searchFeeds();
}

/**
 * Filter and render posts based on current category and search keyword.
 */
function searchFeeds() {
    const searchInput = document.getElementById('search-input');
    const keyword = searchInput.value.toLowerCase().trim();

    let filteredData = allFeeds;
    
    if (currentCategory && !currentCategory.includes('전체')) {
        filteredData = allFeeds.filter(post => {
            if (!post.category) return false;
            const match1 = post.category.toLowerCase().includes(currentCategory.toLowerCase());
            const match2 = currentCategory.toLowerCase().includes(post.category.toLowerCase());
            return match1 || match2;
        });
    }

    if (keyword !== "") {
        filteredData = filteredData.filter(post => {
            const titleMatch = post.title ? post.title.toLowerCase().includes(keyword) : false;
            const contentMatch = post.content ? post.content.toLowerCase().includes(keyword) : false;
            return titleMatch || contentMatch;
        });
    }

    renderFeeds(filteredData);
}

/**
 * Check localStorage for saved user authentication.
 */
function checkLoginStatus() {
    const savedUser = localStorage.getItem('clover_study_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            renderAuthZone(true);
        } catch (e) {
            currentUser = null;
            localStorage.removeItem('clover_study_user');
            renderAuthZone(false);
        }
    } else {
        currentUser = null;
        renderAuthZone(false);
    }
}

/**
 * Render authentication UI component in the header.
 * @param {boolean} isLoggedIn - True if user is authenticated.
 */
function renderAuthZone(isLoggedIn) {
    const authZone = document.getElementById('auth-zone'); // index.html에 정의된 인증 영역 ID
    if (!authZone) return;

    if (isLoggedIn && currentUser) {
        // [수정] 로그인 성공 시: 프로필 이미지 + 닉네임 + 마이페이지 버튼 + 로그아웃 버튼 표시
        authZone.innerHTML = `
            <div class="flex items-center space-x-2">
                ${typeof notificationBellButtonHtml === 'function' ? notificationBellButtonHtml() : ''}
                <button onclick="location.href='/mypage?user=${encodeURIComponent(currentUser.username)}'" class="text-xs bg-emerald-100 text-emerald-500 px-3 py-1.5 rounded-xl font-bold hover:bg-emerald-200 transition-all">
                    마이페이지 🍀
                </button>
                <button onclick="handleLogout()" class="text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-xl font-bold hover:bg-gray-200 transition-all">
                    로그아웃
                </button>
            </div>
        `;
        if (typeof refreshNotificationBadge === 'function') refreshNotificationBadge();
    } else {
        // 로그인 안 되어 있을 때
        authZone.innerHTML = `
            <button onclick="location.href='/login'" class="text-sm bg-emerald-400 text-white px-4 py-2 rounded-xl font-bold hover:bg-emerald-500 transition-all shadow-md shadow-emerald-100">
                로그인 / 회원가입
            </button>
        `;
    }
}

/**
 * Handle user logout logic.
 */
function handleLogout() {
    if (confirm("로그아웃 하시겠어요? 🍀")) {
        localStorage.removeItem('clover_study_user');
        currentUser = null;
        alert("로그아웃 되었습니다!");
        location.reload();
    }
}

/**
 * Open authentication modal.
 * @param {string} mode - 'login' or 'signup'.
 */
function openAuthModal(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    switchAuthTab(mode);
}

/**
 * Close authentication modal and reset inputs.
 */
function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    
    const username = document.getElementById('auth-username');
    const password = document.getElementById('auth-password');
    const nickname = document.getElementById('auth-nickname');
    const profileImage = document.getElementById('auth-profile-image');
    const profilePreview = document.getElementById('auth-profile-preview');
    
    if (username) username.value = '';
    if (password) password.value = '';
    if (nickname) nickname.value = '';
    if (profileImage) profileImage.value = '';
    if (profilePreview) profilePreview.classList.add('hidden');
}

/**
 * Preview profile image in the auth modal.
 */
function previewAuthProfileImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('auth-profile-preview-img').src = e.target.result;
            document.getElementById('auth-profile-preview').classList.remove('hidden');
        }
        reader.readAsDataURL(file);
    }
}

/**
 * Switch tabs between login and signup within the auth modal.
 * @param {string} mode - 'login' or 'signup'.
 */
function switchAuthTab(mode) {
    currentAuthMode = mode;
    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    const nicknameInput = document.getElementById('auth-nickname');
    const profileUploadContainer = document.getElementById('profile-upload-container');
    const submitBtn = document.getElementById('auth-submit-btn');

    if (loginTab) loginTab.className = mode === 'login' ? "text-emerald-400 border-b-2 border-emerald-400 pb-2 px-2" : "text-gray-400 pb-2 px-2";
    if (signupTab) signupTab.className = mode === 'signup' ? "text-emerald-400 border-b-2 border-emerald-400 pb-2 px-2" : "text-gray-400 pb-2 px-2";
    if (nicknameInput) {
        if (mode === 'login') nicknameInput.classList.add('hidden');
        else nicknameInput.classList.remove('hidden');
    }
    if (profileUploadContainer) {
        if (mode === 'login') profileUploadContainer.classList.add('hidden');
        else profileUploadContainer.classList.remove('hidden');
    }
    if (submitBtn) submitBtn.innerText = mode === 'login' ? "로그인하기" : "가입 완료하기 ✨";
}

/**
 * Handle submission of the authentication form for both login and signup.
 */
function handleAuthSubmit() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const nickname = document.getElementById('auth-nickname').value.trim();

    if (!username || !password) {
        alert("아이디와 비밀번호를 모두 입력해주세요!");
        return;
    }

    if (currentAuthMode === 'signup') {
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);
        if (nickname) formData.append('nickname', nickname);
        
        const profileImageInput = document.getElementById('auth-profile-image');
        if (profileImageInput && profileImageInput.files[0]) {
            formData.append('profile_image', profileImageInput.files[0]);
        }

        fetch('/api/signup', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json().then(data => ({ status: res.status, body: data })))
        .then(res => {
            if (res.status === 200) {
                alert("Clover Study 회원이 되신 것을 축하합니다! 🍀🎉 로그인 해주세요.");
                switchAuthTab('login');
            } else {
                alert(res.body.reason || "회원가입에 실패했습니다.");
            }
        })
        .catch(err => console.error("Signup Error:", err));

    } else {
        fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        })
        .then(res => res.json().then(data => ({ status: res.status, body: data })))
        .then(res => {
            if (res.status === 200) {
                localStorage.setItem('clover_study_user', JSON.stringify(res.body.user));
                currentUser = res.body.user;
                alert(`${currentUser.nickname}님, 반가워요! 오늘도 열공해봐요! 🐾`);
                closeAuthModal();
                renderAuthZone(true);
                location.reload();
            } else {
                alert(res.body.reason || "아이디 또는 비밀번호를 다시 확인해주세요.");
            }
        })
        .catch(err => console.error("Login Error:", err));
    }
}