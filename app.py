import os
import re
import uuid
import sqlite3
from functools import wraps
from PIL import Image
from flask import Flask, render_template, jsonify, request, Response, send_file, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timezone, timedelta
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Configure UTF-8 encoding for emoji and unicode characters
app.config['JSON_AS_ASCII'] = False
app.config['JSON_SORT_KEYS'] = False

# Session configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-for-session-management-change-in-production')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_PERMANENT'] = False

# Google OAuth2 configuration
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', 'YOUR_GOOGLE_CLIENT_ID_HERE')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', 'YOUR_GOOGLE_CLIENT_SECRET_HERE')
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', 'http://localhost:5000/auth/google/callback')

@app.after_request
def set_response_headers(response):
    """
    1) Ensure all responses include UTF-8 charset.
    2) Set appropriate Cache-Control headers to prevent stale static assets.
       - HTML pages: no-store (always fetch fresh)
       - CSS / JS:   no-cache (must revalidate with server every time)
       - Images / fonts with versioned URL: cache for 7 days
    """
    # --- UTF-8 charset ---
    if 'Content-Type' in response.headers:
        response.headers['Content-Type'] = response.headers['Content-Type'].replace(
            'charset=iso-8859-1', 'charset=utf-8'
        )
        if 'charset' not in response.headers['Content-Type']:
            response.headers['Content-Type'] += '; charset=utf-8'

    # --- Cache-Control ---
    content_type = response.headers.get('Content-Type', '')
    path = request.path

    if 'text/html' in content_type:
        # HTML은 절대 캐시하지 않음 (항상 최신 페이지 표시)
        response.headers['Cache-Control'] = 'no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    elif path.startswith('/static/') and (path.endswith('.css') or path.endswith('.js')):
        # CSS / JS: 브라우저가 매번 서버에 확인 (ETag/Last-Modified 기반 304 활용)
        response.headers['Cache-Control'] = 'no-cache, must-revalidate'
    elif path.startswith('/static/'):
        # 이미지·폰트 등 기타 정적 파일: ?v= 버전 쿼리로 관리되므로 7일 캐시 허용
        response.headers['Cache-Control'] = 'public, max-age=604800'

    return response

@app.context_processor
def override_url_for():
    """
    Auto-cache busting for static files by appending the file's last modified timestamp as a query parameter.
    """
    return dict(url_for=dated_url_for)

def dated_url_for(endpoint, **values):
    if endpoint == 'static':
        filename = values.get('filename', None)
        if filename:
            file_path = os.path.join(app.root_path, endpoint, filename)
            try:
                # Append the file modification timestamp
                values['v'] = int(os.stat(file_path).st_mtime)
            except OSError:
                pass
    return url_for(endpoint, **values)

# Configure upload directory
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# 이미지 업로드 최적화 설정
DEFAULT_IMAGE_QUALITY = 80
POST_IMAGE_MAX_SIZE = (800, 800)
PROFILE_IMAGE_MAX_SIZE = (128, 128)
MAX_UPLOAD_SIZE = 5 * 1024 * 1024  # 5MB


def optimize_image_file(file_storage, filename, max_size=(800, 800), quality=80):
    """Save an uploaded image as optimized WebP and resize it to the given max_size."""
    try:
        file_storage.stream.seek(0)
        image = Image.open(file_storage.stream)
    except Exception:
        return None

    if image.mode not in ('RGB', 'RGBA'):
        image = image.convert('RGB')

    image.thumbnail(max_size, Image.LANCZOS)

    output_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    image.save(output_path, format='WEBP', quality=quality, optimize=True)
    return output_path


def make_webp_filename(prefix='image'):
    return f"{prefix}_{uuid.uuid4().hex}.webp"

def get_korean_time():
    """한국 시간(KST)을 반환 (UTC+9)"""
    kst = timezone(timedelta(hours=9))
    return datetime.now(kst)

# PWA 파일 경로
@app.route('/manifest.json')
def manifest():
    return send_file(os.path.join(app.static_folder, 'manifest.json'), mimetype='application/json')

@app.route('/service-worker.js')
def service_worker():
    return send_file(os.path.join(app.static_folder, 'service-worker.js'), mimetype='application/javascript')

DB_FILENAME = os.path.join(BASE_DIR, 'study_bunny.db')

def is_admin(username):
    return bool(username) and username == 'admin'

def get_current_user():
    """
    Get authenticated user from session.
    Returns username if user is logged in, None otherwise.
    """
    return session.get('username')

def require_auth(f):
    """
    Decorator to require authentication.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not get_current_user():
            return jsonify({"message": "fail", "reason": "인증이 필요합니다."}), 401
        return f(*args, **kwargs)
    return decorated_function

def require_admin(f):
    """
    Decorator to require admin privileges.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        username = get_current_user()
        if not username or not is_admin(username):
            return jsonify({"message": "fail", "reason": "관리자 권한이 필요합니다."}), 403
        return f(*args, **kwargs)
    return decorated_function

def get_db_connection():
    """
    Establish and return a connection to the SQLite database.
    """
    conn = sqlite3.connect(DB_FILENAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """
    Initialize the database with necessary tables.
    Migration code removed — assumes a fresh DB file.
    category values: '공부기록' (공부 인증 탭) | '질문','꿀팁','잡담' (커뮤니티 탭)
    """
    conn = get_db_connection()

    # ── posts ─────────────────────────────────────────────────
    conn.execute('''
        CREATE TABLE IF NOT EXISTS posts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            category    TEXT NOT NULL DEFAULT '잡담'
                            CHECK(category IN ('공부기록','질문','꿀팁','잡담')),
            username    TEXT NOT NULL,
            nickname    TEXT NOT NULL DEFAULT '익명의 클로버',
            profile_url TEXT,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            date        TEXT NOT NULL,
            image_url   TEXT DEFAULT '',
            views       INTEGER NOT NULL DEFAULT 0,
            likes       INTEGER NOT NULL DEFAULT 0
        )
    ''')

    # ── comments ──────────────────────────────────────────────
    conn.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id     INTEGER NOT NULL,
            username    TEXT NOT NULL,
            nickname    TEXT NOT NULL,
            profile_url TEXT,
            content     TEXT NOT NULL,
            date        TEXT NOT NULL,
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
        )
    ''')

    # ── post_likes ────────────────────────────────────────────
    conn.execute('''
        CREATE TABLE IF NOT EXISTS post_likes (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id  INTEGER NOT NULL,
            username TEXT NOT NULL,
            date     TEXT NOT NULL,
            UNIQUE(post_id, username),
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
        )
    ''')

    # ── users ─────────────────────────────────────────────────
    # login_method: 'local' | 'google'
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username     TEXT PRIMARY KEY,
            password     TEXT NOT NULL,
            email        TEXT UNIQUE,
            google_id    TEXT UNIQUE,
            nickname     TEXT,
            profile_url  TEXT,
            login_method TEXT NOT NULL DEFAULT 'local',
            created_at   TEXT
        )
    ''')

    # ── notifications ─────────────────────────────────────────
    # type: 'comment' | 'like'
    conn.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_username  TEXT NOT NULL,
            actor_username      TEXT NOT NULL,
            actor_nickname      TEXT,
            type                TEXT NOT NULL CHECK(type IN ('comment','like')),
            post_id             INTEGER NOT NULL,
            post_title          TEXT,
            comment_id          INTEGER,
            message             TEXT NOT NULL,
            is_read             INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL,
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
        )
    ''')

    # ── reports ───────────────────────────────────────────────
    # target_type: 'post' | 'comment'
    # status: 'pending' | 'resolved' | 'dismissed'
    conn.execute('''
        CREATE TABLE IF NOT EXISTS reports (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_username TEXT NOT NULL,
            target_type       TEXT NOT NULL CHECK(target_type IN ('post','comment')),
            target_id         INTEGER NOT NULL,
            post_id           INTEGER,
            target_username   TEXT,
            reason            TEXT NOT NULL,
            description       TEXT,
            created_at        TEXT NOT NULL,
            status            TEXT NOT NULL DEFAULT 'pending'
                                  CHECK(status IN ('pending','resolved','dismissed')),
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
        )
    ''')

    # ── post_images ───────────────────────────────────────────
    conn.execute('''
        CREATE TABLE IF NOT EXISTS post_images (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id    INTEGER NOT NULL,
            image_url  TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
        )
    ''')

    # ── focus_records ─────────────────────────────────────────
    conn.execute('''
        CREATE TABLE IF NOT EXISTS focus_records (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            username       TEXT NOT NULL,
            date           TEXT NOT NULL,
            total_seconds  INTEGER NOT NULL DEFAULT 0,
            sessions       INTEGER NOT NULL DEFAULT 0,
            UNIQUE(username, date)
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_focus_date ON focus_records(date, total_seconds DESC)')

    # ── indexes ───────────────────────────────────────────────
    conn.execute('CREATE INDEX IF NOT EXISTS idx_posts_category  ON posts(category)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_posts_username  ON posts(username)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_posts_date      ON posts(date DESC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_likes_post      ON post_likes(post_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_likes_username  ON post_likes(username)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_username, is_read, id DESC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_post_images     ON post_images(post_id, sort_order)')

    conn.commit()
    conn.close()


def create_notification(conn, recipient_username, actor_username, actor_nickname, ntype, post_id, post_title, comment_id=None):
    """
    Create an in-app notification for the post author (skip self-actions).
    """
    if not recipient_username or recipient_username == actor_username:
        return

    title_preview = (post_title or '게시글')[:40]
    if len(post_title or '') > 40:
        title_preview += '…'

    if ntype == 'comment':
        message = f'{actor_nickname}님이 「{title_preview}」에 댓글을 남겼어요'
    elif ntype == 'like':
        message = f'{actor_nickname}님이 「{title_preview}」에 좋아요를 눌렀어요'
    else:
        return

    conn.execute('''
        INSERT INTO notifications (
            recipient_username, actor_username, actor_nickname,
            type, post_id, post_title, comment_id, message, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ''', (
        recipient_username,
        actor_username,
        actor_nickname,
        ntype,
        post_id,
        post_title,
        comment_id,
        message,
        get_korean_time().strftime("%Y.%m.%d %H:%M"),
    ))

@app.template_filter('render_content')
def render_content_filter(text):
    """[focus:sessions:totalSec] 마커를 스타일 배지 HTML로 변환 후 줄바꿈 처리."""
    def to_badge(m):
        sessions  = int(m.group(1))
        total_sec = int(m.group(2))
        h  = total_sec // 3600
        mn = (total_sec % 3600) // 60
        time_str = (f"{h}시간 {mn}분" if h > 0 and mn > 0
                    else f"{h}시간" if h > 0
                    else f"{mn}분")
        return (
            f'<div class="focus-badge-block">'
            f'<span class="focus-badge-icon">🍅</span>'
            f'<div class="focus-badge-info">'
            f'<span class="focus-badge-label">오늘의 집중 기록</span>'
            f'<span class="focus-badge-value">{time_str} · {sessions}세션</span>'
            f'</div></div>'
        )
    # 글 맨 앞에 위치한 마커만 변환 (중간에 직접 입력한 경우 배지로 렌더링하지 않음)
    text = re.sub(r'^\[focus:(\d+):(\d+)\]\n?', to_badge, text)
    text = text.replace('\n', '<br>')
    return text


@app.template_filter('strip_focus')
def strip_focus_filter(text):
    """목록 미리보기용: [focus:N:N] 마커를 완전히 제거."""
    if not text:
        return text
    return re.sub(r'\[focus:\d+:\d+\]\n?', '', text)

with app.app_context():
    init_db()

def fetch_all_feeds(limit=200, offset=0):
    conn = get_db_connection()
    feeds = conn.execute('''
        SELECT p.*, COUNT(c.id) AS comment_count
        FROM posts p
        LEFT JOIN comments c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?
    ''', (limit, offset)).fetchall()
    feed_list = [dict(f) for f in feeds]

    if feed_list:
        post_ids = [f['id'] for f in feed_list]
        placeholders = ','.join(['?' for _ in post_ids])
        img_rows = conn.execute(
            f'SELECT post_id, image_url FROM post_images WHERE post_id IN ({placeholders}) ORDER BY post_id, sort_order',
            post_ids
        ).fetchall()
        imgs_by_post = {}
        for row in img_rows:
            imgs_by_post.setdefault(row['post_id'], []).append(row['image_url'])
        for f in feed_list:
            if f['id'] in imgs_by_post:
                f['images'] = imgs_by_post[f['id']]
            elif f.get('image_url'):
                f['images'] = [f['image_url']]
            else:
                f['images'] = []

    conn.close()
    return feed_list

@app.route('/api/feeds')
def get_feeds():
    """
    Retrieve posts with comment counts. Supports ?page= and ?per_page= for pagination.
    """
    try:
        per_page = min(int(request.args.get('per_page', 50)), 100)
        page = max(int(request.args.get('page', 1)), 1)
    except ValueError:
        per_page, page = 50, 1
    offset = (page - 1) * per_page
    return jsonify(fetch_all_feeds(limit=per_page, offset=offset))

@app.route('/api/feeds', methods=['POST'])
def create_feed():
    """
    Create a new post.
    """
    username = get_current_user()
    if not username:
        return jsonify({"message": "fail", "reason": "로그인 후 글을 작성해주세요."}), 401

    VALID_CATEGORIES = {'공부기록', '질문', '꿀팁', '잡담'}
    category = request.form.get('category', '잡담')
    if category not in VALID_CATEGORIES:
        category = '잡담'

    title = (request.form.get('title') or '').strip()
    content = (request.form.get('content') or '').strip()
    image_url = ''

    if not title or not content:
        return jsonify({"message": "fail", "reason": "제목과 내용을 모두 입력해주세요."}), 400

    image_urls = []
    files = request.files.getlist('images')
    if not files or (len(files) == 1 and files[0].filename == ''):
        single = request.files.get('image')
        files = [single] if single and single.filename != '' else []
    for file in files[:5]:
        if not file or file.filename == '':
            continue
        file.seek(0, os.SEEK_END)
        if file.tell() > MAX_UPLOAD_SIZE:
            return jsonify({"message": "fail", "reason": "이미지 파일은 5MB 이하만 업로드 가능합니다."}), 400
        file.seek(0)
        filename = make_webp_filename('post')
        optimized_path = optimize_image_file(file, filename, max_size=POST_IMAGE_MAX_SIZE, quality=DEFAULT_IMAGE_QUALITY)
        if optimized_path:
            image_urls.append(f"/static/uploads/{filename}")
    image_url = image_urls[0] if image_urls else ''

    date_str = get_korean_time().strftime("%Y.%m.%d %H:%M")
    conn = get_db_connection()
    user = conn.execute('SELECT nickname, profile_url FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"message": "fail", "reason": "잘못된 사용자 정보입니다."}), 401

    cursor = conn.execute('''
        INSERT INTO posts (category, username, nickname, profile_url, title, content, date, image_url, views, likes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    ''', (category, username, user['nickname'], user['profile_url'], title, content, date_str, image_url))
    post_id = cursor.lastrowid
    for i, url in enumerate(image_urls):
        conn.execute('INSERT INTO post_images (post_id, image_url, sort_order) VALUES (?, ?, ?)', (post_id, url, i))
    conn.commit()
    conn.close()
    return jsonify({"message": "success"}), 201


@app.route('/')
def index():
    """
    Render the main index page with server-side feed data.
    """
    feeds = fetch_all_feeds()
    return render_template('index.html', feeds=feeds)

@app.route('/post/<int:post_id>')
def post_detail(post_id):
    """
    Render the detailed post page with server-side post data.
    """
    conn = get_db_connection()
    conn.execute('UPDATE posts SET views = views + 1 WHERE id = ?', (post_id,))
    conn.commit()

    post = conn.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
    if post is None:
        conn.close()
        return "글을 찾을 수 없습니다.", 404

    img_rows = conn.execute('SELECT image_url FROM post_images WHERE post_id = ? ORDER BY sort_order', (post_id,)).fetchall()
    comments = conn.execute('SELECT * FROM comments WHERE post_id = ? ORDER BY id ASC', (post_id,)).fetchall()
    post_dict = dict(post)
    if img_rows:
        post_dict['images'] = [r['image_url'] for r in img_rows]
    elif post_dict.get('image_url'):
        post_dict['images'] = [post_dict['image_url']]
    else:
        post_dict['images'] = []
    post_dict['comments'] = [dict(row) for row in comments]
    post_dict['comment_count'] = len(post_dict['comments'])
    conn.close()

    return render_template('post.html', post=post_dict, post_id=post_id)

@app.route('/api/feeds/<int:post_id>')
def get_single_feed(post_id):
    """
    Retrieve details for a single post, optionally without incrementing the view count.
    """
    conn = get_db_connection()
    no_count = request.args.get('nocount') == '1'
    if not no_count:
        conn.execute('UPDATE posts SET views = views + 1 WHERE id = ?', (post_id,))
        conn.commit()
        
    post = conn.execute('SELECT * FROM posts WHERE id = ?', (post_id,)).fetchone()
    
    if post is None:
        conn.close()
        return jsonify({"error": "글을 찾을 수 없습니다."}), 404
        
    post_dict = dict(post)
    
    username = request.args.get('username')
    if username:
        liked = conn.execute('SELECT 1 FROM post_likes WHERE post_id = ? AND username = ?', (post_id, username)).fetchone()
        post_dict['liked_by_current_user'] = bool(liked)
        post_dict['is_author'] = (post_dict.get('username') == username)
    else:
        post_dict['liked_by_current_user'] = False
        post_dict['is_author'] = False
    
    img_rows = conn.execute('SELECT image_url FROM post_images WHERE post_id = ? ORDER BY sort_order', (post_id,)).fetchall()
    if img_rows:
        post_dict['images'] = [r['image_url'] for r in img_rows]
    elif post_dict.get('image_url'):
        post_dict['images'] = [post_dict['image_url']]
    else:
        post_dict['images'] = []

    comments = conn.execute('SELECT * FROM comments WHERE post_id = ? ORDER BY id ASC', (post_id,)).fetchall()
    post_dict['comments'] = [dict(row) for row in comments]
    post_dict['comment_count'] = len(post_dict['comments'])

    conn.close()
    return jsonify(post_dict)

@app.route('/api/feeds/<int:post_id>/comments', methods=['POST'])
def add_comment(post_id):
    """
    Add a comment to a specific post.
    """
    data = request.get_json() or {}
    username = get_current_user()
    if not username:
        return jsonify({"message": "fail", "reason": "로그인 후 댓글 작성이 가능합니다."}), 401

    conn = get_db_connection()
    user = conn.execute('SELECT nickname, profile_url FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"message": "fail", "reason": "잘못된 사용자 정보입니다."}), 401

    post = conn.execute('SELECT username, title FROM posts WHERE id = ?', (post_id,)).fetchone()
    if post is None:
        conn.close()
        return jsonify({"message": "fail", "reason": "글을 찾을 수 없습니다."}), 404

    cursor = conn.execute('''
        INSERT INTO comments (post_id, username, nickname, profile_url, content, date)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (post_id, username, user['nickname'], user['profile_url'], data.get('content'), get_korean_time().strftime("%Y.%m.%d %H:%M")))
    comment_id = cursor.lastrowid

    create_notification(
        conn,
        post['username'],
        username,
        user['nickname'],
        'comment',
        post_id,
        post['title'],
        comment_id,
    )

    conn.commit()
    conn.close()
    return jsonify({"message": "success"}), 201

@app.route('/api/feeds/<int:post_id>/like', methods=['POST'])
def like_post(post_id):
    """
    Toggle like status for a specific post.
    """
    data = request.get_json() or {}
    username = get_current_user()
    if not username:
        return jsonify({"message": "fail", "reason": "로그인 후 좋아요 해주세요."}), 401

    conn = get_db_connection()
    existing = conn.execute('SELECT 1 FROM post_likes WHERE post_id = ? AND username = ?', (post_id, username)).fetchone()
    if existing:
        conn.close()
        return jsonify({"message": "fail", "reason": "이미 좋아요를 누르셨습니다."}), 400

    post = conn.execute('SELECT username, title FROM posts WHERE id = ?', (post_id,)).fetchone()
    if post is None:
        conn.close()
        return jsonify({"message": "fail", "reason": "글을 찾을 수 없습니다."}), 404

    liker = conn.execute('SELECT nickname FROM users WHERE username = ?', (username,)).fetchone()
    actor_nickname = liker['nickname'] if liker else username

    conn.execute('INSERT INTO post_likes (post_id, username, date) VALUES (?, ?, ?)',
                 (post_id, username, get_korean_time().strftime("%Y.%m.%d %H:%M")))

    create_notification(
        conn,
        post['username'],
        username,
        actor_nickname,
        'like',
        post_id,
        post['title'],
    )
    conn.execute('UPDATE posts SET likes = likes + 1 WHERE id = ?', (post_id,))
    conn.commit()

    updated_likes = conn.execute('SELECT likes FROM posts WHERE id = ?', (post_id,)).fetchone()['likes']
    conn.close()
    return jsonify({"message": "success", "likes": updated_likes}), 200

@app.route('/api/feeds/<int:post_id>', methods=['DELETE'])
def delete_post(post_id):
    """
    Delete a specific post and its associated comments.
    """
    data = request.get_json() or {}
    username = get_current_user()
    if not username:
        return jsonify({"message": "fail", "reason": "로그인 후 삭제할 수 있습니다."}), 401

    conn = get_db_connection()
    post = conn.execute('SELECT username FROM posts WHERE id = ?', (post_id,)).fetchone()
    if post is None:
        conn.close()
        return jsonify({"message": "fail", "reason": "글을 찾을 수 없습니다."}), 404
    if post['username'] != username and not is_admin(username):
        conn.close()
        return jsonify({"message": "fail", "reason": "작성자만 삭제할 수 있습니다."}), 403

    conn.execute('DELETE FROM notifications WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM comments WHERE post_id = ?', (post_id,))
    conn.execute('DELETE FROM posts WHERE id = ?', (post_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "success"}), 200

@app.route('/api/feeds/<int:post_id>', methods=['PUT'])
def update_post(post_id):
    """
    Update a specific post's details including category, title, content, and image.
    """
    conn = get_db_connection()

    username = get_current_user()
    if not username:
        conn.close()
        return jsonify({"message": "fail", "reason": "로그인 후 수정할 수 있습니다."}), 401

    post_check = conn.execute('SELECT username FROM posts WHERE id = ?', (post_id,)).fetchone()
    if not post_check:
        conn.close()
        return jsonify({"message": "fail", "reason": "글을 찾을 수 없습니다."}), 404
    if post_check['username'] != username and not is_admin(username):
        conn.close()
        return jsonify({"message": "fail", "reason": "작성자만 수정할 수 있습니다."}), 403

    VALID_CATEGORIES = {'공부기록', '질문', '꿀팁', '잡담'}
    category = request.form.get('category', '잡담')
    if category not in VALID_CATEGORIES:
        category = '잡담'

    title = (request.form.get('title') or '').strip()
    content = (request.form.get('content') or '').strip()

    if not title or not content:
        conn.close()
        return jsonify({"message": "fail", "reason": "제목과 내용을 모두 입력해주세요."}), 400

    current_post = conn.execute('SELECT image_url FROM posts WHERE id = ?', (post_id,)).fetchone()
    existing_imgs = conn.execute('SELECT image_url FROM post_images WHERE post_id = ? ORDER BY sort_order', (post_id,)).fetchall()

    kept_images = request.form.getlist('kept_images')
    new_files = [f for f in request.files.getlist('images') if f and f.filename != '']
    if not new_files:
        single = request.files.get('image')
        if single and single.filename != '':
            new_files = [single]

    # If neither kept_images nor new_files sent, preserve existing images (backward compat)
    form_keys = set(request.form.keys())
    client_sent_image_data = 'kept_images' in form_keys or bool(new_files)

    if not client_sent_image_data:
        if existing_imgs:
            image_urls = [r['image_url'] for r in existing_imgs]
        elif current_post and current_post['image_url']:
            image_urls = [current_post['image_url']]
        else:
            image_urls = []
    else:
        image_urls = list(kept_images)
        for file in new_files[:max(0, 5 - len(image_urls))]:
            file.seek(0, os.SEEK_END)
            if file.tell() > MAX_UPLOAD_SIZE:
                conn.close()
                return jsonify({"message": "fail", "reason": "이미지 파일은 5MB 이하만 업로드 가능합니다."}), 400
            file.seek(0)
            filename = make_webp_filename('post')
            optimized_path = optimize_image_file(file, filename, max_size=POST_IMAGE_MAX_SIZE, quality=DEFAULT_IMAGE_QUALITY)
            if optimized_path:
                image_urls.append(f"/static/uploads/{filename}")

    conn.execute('DELETE FROM post_images WHERE post_id = ?', (post_id,))
    for i, url in enumerate(image_urls[:5]):
        conn.execute('INSERT INTO post_images (post_id, image_url, sort_order) VALUES (?, ?, ?)', (post_id, url, i))

    image_url = image_urls[0] if image_urls else ''

    conn.execute('''
        UPDATE posts
        SET category = ?, title = ?, content = ?, image_url = ?
        WHERE id = ?
    ''', (category, title, content, image_url, post_id))

    conn.commit()
    conn.close()

    return jsonify({"message": "success"}), 200


@app.route('/api/comments/<int:comment_id>', methods=['PUT'])
def update_comment(comment_id):
    """
    Update a specific comment's content.
    """
    data = request.get_json() or {}
    username = get_current_user()
    content = data.get('content', '').strip()
    if not username or not content:
        return jsonify({"message": "fail", "reason": "댓글 내용을 입력하고 로그인해주세요."}), 400

    conn = get_db_connection()
    comment = conn.execute('SELECT username FROM comments WHERE id = ?', (comment_id,)).fetchone()
    if comment is None:
        conn.close()
        return jsonify({"message": "fail", "reason": "댓글을 찾을 수 없습니다."}), 404
    if comment['username'] != username and not is_admin(username):
        conn.close()
        return jsonify({"message": "fail", "reason": "작성자만 댓글을 수정할 수 있습니다."}), 403

    conn.execute('UPDATE comments SET content = ?, date = ? WHERE id = ?',
                 (content, get_korean_time().strftime("%Y.%m.%d %H:%M"), comment_id))
    conn.commit()
    conn.close()
    return jsonify({"message": "success"}), 200

@app.route('/api/comments/<int:comment_id>', methods=['DELETE'])
def delete_comment(comment_id):
    """
    Delete a specific comment.
    """
    data = request.get_json() or {}
    username = get_current_user()
    if not username:
        return jsonify({"message": "fail", "reason": "로그인 후 삭제할 수 있습니다."}), 401

    conn = get_db_connection()
    comment = conn.execute('SELECT username FROM comments WHERE id = ?', (comment_id,)).fetchone()
    if comment is None:
        conn.close()
        return jsonify({"message": "fail", "reason": "댓글을 찾을 수 없습니다."}), 404
    if comment['username'] != username and not is_admin(username):
        conn.close()
        return jsonify({"message": "fail", "reason": "작성자만 댓글을 삭제할 수 있습니다."}), 403

    conn.execute('DELETE FROM comments WHERE id = ?', (comment_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "success"}), 200

@app.route('/about')
def about_page():
    """
    Render the about page.
    """
    return render_template('about.html')

@app.route('/privacy')
def privacy_page():
    """
    Render the privacy policy page.
    """
    return render_template('privacy.html')

@app.route('/terms')
def terms_page():
    """
    Render the terms page.
    """
    return render_template('terms.html')

@app.route('/contact')
def contact_page():
    """
    Render the contact information page.
    """
    return render_template('contact.html')

BLOG_ARTICLES = [
    {'id': 1,  'title': '효과적인 공부 계획을 세우는 5가지 방법',                'subtitle': '공부를 잘하는 학생들의 공통점인 체계적인 공부 계획을 세우는 방법을 알아봅시다.',              'category': '공부 기법',  'file': 'adsense_content_01.html'},
    {'id': 2,  'title': '집중력이 흐르는 공부 환경 만드는 법',                  'subtitle': '과학적으로 증명된 5가지 환경 조성 방법을 실천해보세요.',                                    'category': '공부 환경',  'file': 'adsense_content_02.html'},
    {'id': 3,  'title': '잘 잊혀지지 않는 기억력',                             'subtitle': '신경과학 기반 공부 기법 3가지로 기억력을 향상시키세요.',                                      'category': '학습 기법',  'file': 'adsense_content_03.html'},
    {'id': 4,  'title': '시험 불안감을 이겨내는 심리 전략',                     'subtitle': '시험 시즌을 슬기롭게 보내는 4가지 심리 전략을 배워봅시다.',                                   'category': '심리 관리',  'file': 'adsense_content_04.html'},
    {'id': 5,  'title': '온라인 학습이 미래 교육이 되는 이유',                  'subtitle': '효율적인 온라인 공부법과 활용 전략을 소개합니다.',                                            'category': '온라인 교육', 'file': 'adsense_content_05.html'},
    {'id': 6,  'title': '과목마다 다른 공부법',                                'subtitle': '수학, 과학, 국어 각 과목의 특성에 맞는 학습 방법을 배워봅시다.',                              'category': '학습 전략',  'file': 'adsense_content_06.html'},
    {'id': 7,  'title': '공부 동기가 떨어졌을 때',                             'subtitle': '동기를 되찾는 7가지 방법으로 다시 시작하세요.',                                               'category': '동기 관리',  'file': 'adsense_content_07.html'},
    {'id': 8,  'title': '독서가 공부 능력을 높이는 이유',                       'subtitle': '읽기 능력과 학력의 관계를 이해하고 독서 습관을 들이세요.',                                     'category': '독서와 학습', 'file': 'adsense_content_08.html'},
    {'id': 9,  'title': '혼자보다 함께 - 효과적인 그룹 스터디 운영',            'subtitle': '협력 학습의 효과와 그룹 스터디 운영 방법을 배워봅시다.',                                      'category': '협력 학습',  'file': 'adsense_content_09.html'},
    {'id': 10, 'title': '공부 습관이 인생을 바꾼다',                            'subtitle': '30일 안에 공부 습관을 형성하는 체계적인 방법을 소개합니다.',                                  'category': '습관 형성',  'file': 'adsense_content_10.html'},
    {'id': 11, 'title': "전교 1등은 알고 있는 '내가 모르는 것'의 비밀",         'subtitle': '메타인지 능력을 기르는 3가지 방법으로 착각적 인지를 깨부수고 공부 효율을 극대화해보세요.',       'category': '학습 기법',  'file': 'adsense_content_11.html'},
    {'id': 12, 'title': "공부할 때 스마트폰 유혹을 이기는 '디지털 디톡스'",     'subtitle': '집중력을 파괴하는 디지털 유혹의 과학적 원리와 의지력이 필요 없는 실전 차단 전략',              'category': '공부 환경',  'file': 'adsense_content_12.html'},
    {'id': 13, 'title': "잠을 줄이면 성적이 떨어지는 이유",                     'subtitle': '뇌과학이 증명한 수면과 기억의 상관관계 및 학습 효율을 극대화하는 최적의 수면 전략',             'category': '피로 관리',  'file': 'adsense_content_13.html'},
    {'id': 14, 'title': '공부 슬럼프와 번아웃을 극복하는 방법',                 'subtitle': '무기력에서 벗어나 시동을 거는 5분 규칙과 뇌과학 기반의 능동적 휴식 전략',                     'category': '심리 관리',  'file': 'adsense_content_14.html'},
    {'id': 15, 'title': '시험 당일 포텐을 터뜨리는 실전 시뮬레이션',            'subtitle': '실력을 200% 발휘하는 마지막 필살기 및 3단계 시험지 운영 법칙',                               'category': '시험 실전',  'file': 'adsense_content_15.html'},
]
_BLOG_ARTICLE_MAP = {a['id']: a['file'] for a in BLOG_ARTICLES}


@app.route('/blog')
def blog_list():
    return render_template('blog_list.html', articles=BLOG_ARTICLES)

@app.route('/blog/<int:article_id>')
def blog_detail(article_id):
    if article_id not in _BLOG_ARTICLE_MAP:
        return '글을 찾을 수 없습니다', 404
    return render_template(f'blog/{_BLOG_ARTICLE_MAP[article_id]}', article_id=article_id)

@app.route('/robots.txt')
def robots_txt():
    """
    Return robots.txt for search engine crawlers.
    """
    content = "User-agent: *\nAllow: /\nSitemap: https://cloverstudy.net/sitemap.xml\n"
    return Response(content, mimetype='text/plain')

@app.route('/sitemap.xml')
def sitemap_xml():
    """
    Return a dynamic sitemap including static pages, blog pages, and posts.
    """
    conn = get_db_connection()
    posts = conn.execute('SELECT id, date FROM posts').fetchall()
    conn.close()

    base_url = request.url_root.rstrip('/')
    today = datetime.utcnow().strftime('%Y-%m-%d')

    def format_lastmod(date_str):
        try:
            return datetime.strptime(date_str, '%Y.%m.%d %H:%M').strftime('%Y-%m-%d')
        except Exception:
            return today

    urls = [
        {
            'loc': f'{base_url}/',
            'changefreq': 'daily',
            'priority': '1.0',
            'lastmod': today
        },
        {
            'loc': f'{base_url}/about',
            'changefreq': 'weekly',
            'priority': '0.8',
            'lastmod': today
        },
        {
            'loc': f'{base_url}/privacy',
            'changefreq': 'monthly',
            'priority': '0.6',
            'lastmod': today
        },
        {
            'loc': f'{base_url}/terms',
            'changefreq': 'monthly',
            'priority': '0.6',
            'lastmod': today
        },
        {
            'loc': f'{base_url}/contact',
            'changefreq': 'monthly',
            'priority': '0.5',
            'lastmod': today
        },
        {
            'loc': f'{base_url}/blog',
            'changefreq': 'weekly',
            'priority': '0.8',
            'lastmod': today
        }
    ]

    for article_id in range(1, 16):
        urls.append({
            'loc': f'{base_url}/blog/{article_id}',
            'changefreq': 'monthly',
            'priority': '0.7',
            'lastmod': today
        })

    for post in posts:
        urls.append({
            'loc': f"{base_url}/post/{post['id']}",
            'changefreq': 'weekly',
            'priority': '0.7',
            'lastmod': format_lastmod(post['date'])
        })

    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for item in urls:
        xml.append('  <url>')
        xml.append(f"    <loc>{item['loc']}</loc>")
        xml.append(f"    <lastmod>{item['lastmod']}</lastmod>")
        xml.append(f"    <changefreq>{item['changefreq']}</changefreq>")
        xml.append(f"    <priority>{item['priority']}</priority>")
        xml.append('  </url>')
    xml.append('</urlset>')

    return Response('\n'.join(xml), mimetype='application/xml')

@app.route('/naver533fa9763ba8f1b885c965f5941ccf6f.html')
def naver_verification():
    """
    Return the Naver site verification file.
    """
    return render_template('naver533fa9763ba8f1b885c965f5941ccf6f.html')

def fetch_mypage_data(username, include_liked=True):
    """
    Load profile and posts for a user. Liked posts can be deferred for faster first paint.
    """
    conn = get_db_connection()

    user = conn.execute(
        'SELECT username, nickname, profile_url FROM users WHERE username = ?',
        (username,),
    ).fetchone()
    if not user:
        conn.close()
        return None

    my_posts = conn.execute('''
        SELECT p.*, COUNT(c.id) AS comment_count
        FROM posts p
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE p.username = ?
        GROUP BY p.id
        ORDER BY p.id DESC
    ''', (username,)).fetchall()

    liked_posts = []
    if include_liked:
        liked_posts = conn.execute('''
            SELECT p.*, COUNT(c.id) AS comment_count
            FROM post_likes pl
            JOIN posts p ON pl.post_id = p.id
            LEFT JOIN comments c ON p.id = c.post_id
            WHERE pl.username = ?
            GROUP BY p.id
            ORDER BY pl.id DESC
        ''', (username,)).fetchall()

    conn.close()
    return {
        "user": dict(user),
        "my_posts": [dict(p) for p in my_posts],
        "liked_posts": [dict(p) for p in liked_posts],
    }


@app.route('/mypage')
def mypage():
    """
    Render My Page with server-side profile and post list when ?user= is present.
    """
    username = request.args.get('user')
    page_data = None
    if username:
        page_data = fetch_mypage_data(username, include_liked=False)
        if page_data is None:
            return "사용자를 찾을 수 없습니다.", 404
    return render_template('mypage.html', page_data=page_data, target_username=username)


@app.route('/admin')
def admin_page():
    """
    Render Admin Page - only accessible by admin.
    """
    return render_template('admin.html')


@app.route('/login')
def login_page():
    """
    Render login page.
    """
    return render_template('login.html', google_client_id=GOOGLE_CLIENT_ID)


@app.route('/signup')
def signup_page():
    """
    Render signup page (추가 정보 입력 페이지).
    구글 인증 후에만 접근 가능합니다.
    """
    return render_template('signup.html')


@app.route('/api/admin/users', methods=['GET'])
@require_admin
def get_all_users():
    """
    Get all registered users - admin only.
    Server-side session 기반 권한 검증 (보안 강화)
    """
    
    try:
        conn = get_db_connection()
        
        # Get all users
        users = conn.execute('''
            SELECT username, nickname, profile_url
            FROM users
            ORDER BY username
        ''').fetchall()
        
        conn.close()
        
        return jsonify({
            "users": [dict(u) for u in users]
        }), 200
    except Exception as e:
        print(f"Error in get_all_users: {str(e)}")
        return jsonify({
            "error": "Failed to fetch users",
            "detail": str(e)
        }), 500


@app.route('/api/mypage/<username>')
def get_mypage_data(username):
    """
    Retrieve user profile, their posts, and posts they liked.
    """
    data = fetch_mypage_data(username, include_liked=True)
    if data is None:
        return jsonify({"error": "사용자를 찾을 수 없습니다."}), 404
    return jsonify(data)


@app.route('/api/mypage/<username>/liked')
def get_mypage_liked(username):
    """
    Retrieve only liked posts (loaded when the user opens the liked tab).
    """
    conn = get_db_connection()
    user = conn.execute('SELECT username FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "사용자를 찾을 수 없습니다."}), 404

    liked_posts = conn.execute('''
        SELECT p.*, COUNT(c.id) AS comment_count
        FROM post_likes pl
        JOIN posts p ON pl.post_id = p.id
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE pl.username = ?
        GROUP BY p.id
        ORDER BY pl.id DESC
    ''', (username,)).fetchall()
    conn.close()
    return jsonify({"liked_posts": [dict(p) for p in liked_posts]})


@app.route('/api/notifications/<username>')
def get_notifications(username):
    """
    List recent notifications for a user.
    """
    conn = get_db_connection()
    user = conn.execute('SELECT username FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "사용자를 찾을 수 없습니다."}), 404

    rows = conn.execute('''
        SELECT * FROM notifications
        WHERE recipient_username = ?
        ORDER BY id DESC
        LIMIT 50
    ''', (username,)).fetchall()
    unread = conn.execute(
        'SELECT COUNT(*) AS cnt FROM notifications WHERE recipient_username = ? AND is_read = 0',
        (username,),
    ).fetchone()['cnt']
    conn.close()
    return jsonify({
        "notifications": [dict(row) for row in rows],
        "unread_count": unread,
    })


@app.route('/api/notifications/<username>/<int:notification_id>/read', methods=['POST'])
def mark_notification_read(username, notification_id):
    """
    Mark a single notification as read.
    """
    if get_current_user() != username:
        return jsonify({"message": "fail", "reason": "잘못된 요청입니다."}), 403

    conn = get_db_connection()
    conn.execute(
        'UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_username = ?',
        (notification_id, username),
    )
    unread = conn.execute(
        'SELECT COUNT(*) AS cnt FROM notifications WHERE recipient_username = ? AND is_read = 0',
        (username,),
    ).fetchone()['cnt']
    conn.commit()
    conn.close()
    return jsonify({"message": "success", "unread_count": unread})


@app.route('/api/notifications/<username>/read-all', methods=['POST'])
def mark_all_notifications_read(username):
    """
    Mark all notifications as read for a user.
    """
    if get_current_user() != username:
        return jsonify({"message": "fail", "reason": "잘못된 요청입니다."}), 403

    conn = get_db_connection()
    conn.execute(
        'UPDATE notifications SET is_read = 1 WHERE recipient_username = ?',
        (username,),
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "success", "unread_count": 0})


@app.route('/api/profile', methods=['PUT'])
def update_profile():
    """
    Update user nickname and/or profile image.
    Also cascades updates to all posts authored by the user.
    """
    username = get_current_user()
    if not username:
        return jsonify({"message": "fail", "reason": "로그인이 필요합니다."}), 401

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"message": "fail", "reason": "사용자를 찾을 수 없습니다."}), 404

    new_nickname = request.form.get('nickname', user['nickname'])
    new_profile_url = user['profile_url']

    if 'profile_image' in request.files:
        file = request.files['profile_image']
        if file.filename != '':
            file.seek(0, os.SEEK_END)
            if file.tell() > MAX_UPLOAD_SIZE:
                conn.close()
                return jsonify({"message": "fail", "reason": "이미지 파일은 5MB 이하만 업로드 가능합니다."}), 400
            file.seek(0)
            filename = make_webp_filename('profile')
            optimized_path = optimize_image_file(file, filename, max_size=PROFILE_IMAGE_MAX_SIZE, quality=DEFAULT_IMAGE_QUALITY)
            if optimized_path:
                new_profile_url = f"/static/uploads/{filename}"

    conn.execute('UPDATE users SET nickname = ?, profile_url = ? WHERE username = ?',
                 (new_nickname, new_profile_url, username))
    conn.execute('UPDATE posts SET nickname = ?, profile_url = ? WHERE username = ?',
                 (new_nickname, new_profile_url, username))
    conn.execute('UPDATE comments SET nickname = ?, profile_url = ? WHERE username = ?',
                 (new_nickname, new_profile_url, username))
    conn.commit()
    conn.close()

    session['nickname'] = new_nickname
    session['profile_url'] = new_profile_url

    return jsonify({
        "message": "success",
        "user": {
            "username": username,
            "nickname": new_nickname,
            "profile_url": new_profile_url,
            "is_admin": is_admin(username)
        }
    }), 200

@app.route('/component/form')
def get_form_component():
    """
    Return the form component HTML template.
    """
    return render_template('form.html')

@app.route('/api/signup', methods=['POST'])
def signup():
    """
    Handle user registration.
    """
    username = request.form.get('username')
    password = request.form.get('password')
    nickname = request.form.get('nickname', '새로운 클로버')
    
    profile_url = "https://placehold.co/100x100/6ee7b7/ffffff?text=Clover"
    
    # Handle profile image upload
    if 'profile_image' in request.files:
        file = request.files['profile_image']
        if file.filename != '':
            file.seek(0, os.SEEK_END)
            if file.tell() > MAX_UPLOAD_SIZE:
                return jsonify({"message": "fail", "reason": "이미지 파일은 5MB 이하만 업로드 가능합니다."}), 400
            file.seek(0)
            filename = make_webp_filename('profile')
            optimized_path = optimize_image_file(file, filename, max_size=PROFILE_IMAGE_MAX_SIZE, quality=DEFAULT_IMAGE_QUALITY)
            if optimized_path:
                profile_url = f"/static/uploads/{filename}"

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    if user:
        conn.close()
        return jsonify({"message": "fail", "reason": "이미 존재하는 아이디입니다."}), 400
        
    hashed_password = generate_password_hash(password)
        
    conn.execute('INSERT INTO users (username, password, nickname, profile_url) VALUES (?, ?, ?, ?)',
                 (username, hashed_password, nickname, profile_url))
    conn.commit()
    conn.close()
    
    return jsonify({"message": "success"}), 200


@app.route('/api/user/delete', methods=['DELETE'])
def delete_account():
    """
    Delete user account and all associated data.
    """
    data = request.get_json() or {}
    username = get_current_user()

    if not username:
        return jsonify({"message": "fail", "reason": "로그인이 필요합니다."}), 401

    conn = get_db_connection()

    # Check if user exists
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"message": "fail", "reason": "존재하지 않는 사용자입니다."}), 404
    
    try:
        # posts 삭제 시 ON DELETE CASCADE로 comments/post_likes/notifications/reports 자동 삭제
        conn.execute('DELETE FROM posts WHERE username = ?', (username,))
        # 다른 사람 글에 단 댓글·좋아요, 수신/발신 알림도 삭제
        conn.execute('DELETE FROM comments WHERE username = ?', (username,))
        conn.execute('DELETE FROM post_likes WHERE username = ?', (username,))
        conn.execute('DELETE FROM notifications WHERE recipient_username = ? OR actor_username = ?', (username, username))
        conn.execute('DELETE FROM users WHERE username = ?', (username,))
        conn.commit()
        conn.close()
        session.clear()
        return jsonify({"message": "success"}), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        print(f"Error deleting account: {e}")
        return jsonify({"message": "fail", "reason": "탈퇴 처리 중 오류가 발생했습니다."}), 500


@app.route('/api/reports', methods=['POST'])
def create_report():
    """
    Create a report for a post or comment.
    """
    data = request.get_json() or {}
    reporter_username = data.get('reporter_username')
    target_type = data.get('target_type')  # 'post' or 'comment'
    target_id = data.get('target_id')
    post_id = data.get('post_id')
    target_username = data.get('target_username')
    reason = data.get('reason')
    description = data.get('description', '')
    
    if not all([reporter_username, target_type, target_id, reason]):
        return jsonify({"message": "fail", "reason": "필수 정보가 누락되었습니다."}), 400
    
    if target_type not in ['post', 'comment']:
        return jsonify({"message": "fail", "reason": "잘못된 신고 타입입니다."}), 400
    
    conn = get_db_connection()
    
    # Check if already reported
    existing = conn.execute('''
        SELECT id FROM reports 
        WHERE reporter_username = ? AND target_type = ? AND target_id = ? AND status = 'pending'
    ''', (reporter_username, target_type, target_id)).fetchone()
    
    if existing:
        conn.close()
        return jsonify({"message": "fail", "reason": "이미 이 항목을 신고했습니다."}), 400
    
    try:
        conn.execute('''
            INSERT INTO reports 
            (reporter_username, target_type, target_id, post_id, target_username, reason, description, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        ''', (reporter_username, target_type, target_id, post_id, target_username, reason, description, 
              get_korean_time().strftime("%Y.%m.%d %H:%M:%S")))
        conn.commit()
        conn.close()
        return jsonify({"message": "success"}), 200
    except Exception as e:
        conn.close()
        print(f"Error creating report: {str(e)}")
        return jsonify({"message": "fail", "reason": "신고 처리 중 오류가 발생했습니다."}), 500


@app.route('/api/admin/reports', methods=['GET'])
@require_admin
def get_reports():
    """
    Get all reports - admin only.
    Server-side session 기반 권한 검증 (보안 강화)
    """
    
    status = request.args.get('status', 'pending')
    
    conn = get_db_connection()
    
    reports = conn.execute('''
        SELECT 
            reports.*,
            c.content as comment_content
        FROM reports
        LEFT JOIN comments c ON reports.target_type = 'comment' AND reports.target_id = c.id
        WHERE reports.status = ?
        ORDER BY reports.created_at DESC
    ''', (status,)).fetchall()
    
    conn.close()
    
    return jsonify({
        "reports": [dict(r) for r in reports]
    }), 200


@app.route('/api/admin/reports/<int:report_id>', methods=['PUT'])
@require_admin
def update_report_status(report_id):
    """
    Update report status - admin only.
    Server-side session 기반 권한 검증 (보안 강화)
    """
    data = request.get_json() or {}
    status = data.get('status')  # 'resolved', 'dismissed', etc.
    
    if not status:
        return jsonify({"message": "fail", "reason": "상태 정보가 필요합니다."}), 400
    
    conn = get_db_connection()
    
    conn.execute('UPDATE reports SET status = ? WHERE id = ?', (status, report_id))
    conn.commit()
    conn.close()
    
    return jsonify({"message": "success"}), 200

@app.route('/api/login', methods=['POST'])
def login():
    """
    Handle user login - 경로 A: username/password 로그인
    Server-side session에 사용자 정보 저장 (보안 강화)
    """
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({"message": "fail", "reason": "아이디와 비밀번호를 입력해주세요."}), 400
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()
    
    if user and check_password_hash(user['password'], password):
        # 로그인 성공: 세션에 사용자 정보 저장
        session['username'] = user['username']
        session['nickname'] = user['nickname']
        session['profile_url'] = user['profile_url']
        session['login_method'] = user['login_method']
        session.permanent = False
        
        return jsonify({
            "message": "success",
            "user": {
                "username": user['username'],
                "nickname": user['nickname'],
                "profile_url": user['profile_url'],
                "is_admin": is_admin(user['username']),
                "login_method": "local"
            }
        }), 200
    else:
        return jsonify({"message": "fail", "reason": "아이디 또는 비밀번호가 틀렸습니다."}), 401


@app.route('/auth/google/init-signup', methods=['POST'])
def init_google_signup():
    """
    회원가입 시작: 구글 인증 필요 상태를 클라이언트에 알림
    클라이언트는 이 응답을 받고 구글 로그인을 진행함
    """
    return jsonify({
        "message": "success",
        "next_step": "google_auth",
        "google_client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": url_for('google_auth_callback', _external=True)
    }), 200


@app.route('/auth/google/callback', methods=['POST'])
def google_auth_callback():
    """
    구글 인증 콜백: 클라이언트에서 google token을 받아서 검증
    회원가입 또는 로그인 경로로 분기
    """
    data = request.get_json()
    id_token_str = data.get('id_token')
    
    if not id_token_str:
        return jsonify({"message": "fail", "reason": "토큰이 없습니다."}), 400
    
    try:
        # 구글 토큰 검증
        idinfo = id_token.verify_oauth2_token(
            id_token_str, 
            google_requests.Request(), 
            GOOGLE_CLIENT_ID
        )
        
        google_id = idinfo.get('sub')
        email = idinfo.get('email')
        
        if not google_id or not email:
            return jsonify({"message": "fail", "reason": "구글 인증 정보가 불완전합니다."}), 400
        
        conn = get_db_connection()
        
        # 기존 사용자 확인 (구글 ID로)
        existing_user = conn.execute(
            'SELECT * FROM users WHERE google_id = ?', 
            (google_id,)
        ).fetchone()
        
        conn.close()
        
        if existing_user:
            # 경로 B: 기존 사용자 로그인 (비밀번호 입력 없음)
            # 세션에 사용자 정보 저장 (보안 강화)
            session['username'] = existing_user['username']
            session['nickname'] = existing_user['nickname']
            session['profile_url'] = existing_user['profile_url']
            session['login_method'] = existing_user['login_method']
            session.permanent = False
            
            return jsonify({
                "message": "success",
                "action": "login",
                "user": {
                    "username": existing_user['username'],
                    "nickname": existing_user['nickname'],
                    "profile_url": existing_user['profile_url'],
                    "is_admin": is_admin(existing_user['username']),
                    "login_method": "google"
                }
            }), 200
        else:
            # 새로운 사용자: 회원가입 프로세스로 진행
            # 세션에 임시 저장
            session['temp_google_info'] = {
                'google_id': google_id,
                'email': email
            }
            session.permanent = False
            
            return jsonify({
                "message": "success",
                "action": "signup",
                "email": email,
                "message_detail": "추가 정보를 입력해주세요."
            }), 200
    
    except ValueError as e:
        # 토큰 검증 실패
        print(f"Token verification failed: {str(e)}")
        return jsonify({"message": "fail", "reason": "구글 인증 실패: 토큰이 유효하지 않습니다."}), 400
    except Exception as e:
        print(f"Google auth error: {str(e)}")
        return jsonify({"message": "fail", "reason": "구글 인증 중 오류가 발생했습니다."}), 500


@app.route('/auth/google/complete-signup', methods=['POST'])
def complete_google_signup():
    """
    구글 회원가입 완료: 임시 세션의 구글 정보 + 사용자 입력정보를 DB에 저장
    """
    # 세션에서 임시 구글 정보 확인
    if 'temp_google_info' not in session:
        return jsonify({"message": "fail", "reason": "세션이 만료되었습니다. 다시 시도해주세요."}), 400
    
    temp_info = session.get('temp_google_info')
    google_id = temp_info.get('google_id')
    email = temp_info.get('email')
    
    data = request.form
    username = data.get('username')
    password = data.get('password')
    nickname = data.get('nickname', '새로운 클로버')
    
    if not all([username, password]):
        return jsonify({"message": "fail", "reason": "아이디와 비밀번호를 입력해주세요."}), 400
    
    # 아이디 중복 확인
    conn = get_db_connection()
    
    # username 중복 확인
    existing_username = conn.execute(
        'SELECT username FROM users WHERE username = ?', 
        (username,)
    ).fetchone()
    
    if existing_username:
        conn.close()
        return jsonify({"message": "fail", "reason": "이미 존재하는 아이디입니다."}), 400
    
    # 비밀번호 해싱
    hashed_password = generate_password_hash(password)
    
    # 프로필 이미지 처리
    profile_url = "https://placehold.co/100x100/6ee7b7/ffffff?text=Clover"
    
    if 'profile_image' in request.files:
        file = request.files['profile_image']
        if file and file.filename:
            # 파일 크기 확인
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            
            if file_size <= MAX_UPLOAD_SIZE:
                # 이미지 최적화 및 저장
                filename = make_webp_filename('profile')
                optimized_path = optimize_image_file(file, filename, PROFILE_IMAGE_MAX_SIZE, DEFAULT_IMAGE_QUALITY)
                
                if optimized_path:
                    # URL 경로로 변환 (DB에 저장할 경로)
                    profile_url = f"/static/uploads/{os.path.basename(optimized_path)}"
    
    try:
        conn.execute('''
            INSERT INTO users (
                username, password, email, google_id, nickname, profile_url, 
                login_method, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            username,
            hashed_password,
            email,
            google_id,
            nickname,
            profile_url,
            'google',
            get_korean_time().strftime("%Y.%m.%d %H:%M:%S")
        ))
        conn.commit()
        conn.close()
        
        # 세션에서 임시 정보 삭제
        del session['temp_google_info']
        
        # 회원가입 완료: 세션에 사용자 정보 저장 (보안 강화)
        session['username'] = username
        session['nickname'] = nickname
        session['profile_url'] = profile_url
        session['login_method'] = 'google'
        session.permanent = False
        
        return jsonify({
            "message": "success",
            "user": {
                "username": username,
                "nickname": nickname,
                "profile_url": profile_url,
                "is_admin": False,
                "login_method": "google"
            }
        }), 201
    
    except Exception as e:
        conn.close()
        print(f"Error in complete_google_signup: {str(e)}")
        return jsonify({"message": "fail", "reason": "회원가입 중 오류가 발생했습니다."}), 500

@app.route('/api/logout', methods=['POST'])
def logout():
    """
    Handle user logout - clear session.
    """
    username = get_current_user()
    if username:
        session.clear()
        return jsonify({
            "message": "success",
            "reason": "로그아웃되었습니다."
        }), 200
    else:
        return jsonify({
            "message": "fail",
            "reason": "인증되지 않은 사용자입니다."
        }), 401

@app.route('/api/auth/check', methods=['GET'])
def check_auth():
    """
    Check if user is authenticated and get current user info.
    Reads from session — no DB query needed.
    """
    username = get_current_user()
    if username:
        return jsonify({
            "authenticated": True,
            "user": {
                "username": username,
                "nickname": session.get('nickname'),
                "profile_url": session.get('profile_url'),
                "is_admin": is_admin(username)
            }
        }), 200
    return jsonify({"authenticated": False}), 200

@app.route('/timer')
def timer_page():
    return render_template('timer.html')

@app.route('/api/streak/<username>')
def get_streak_data(username):
    """공부기록 게시글 날짜 목록 반환 (잔디 캘린더용)"""
    conn = get_db_connection()
    posts = conn.execute(
        "SELECT date FROM posts WHERE username = ? AND category = '공부기록'",
        (username,)
    ).fetchall()
    conn.close()

    study_dates = set()
    for post in posts:
        try:
            date_part = (post['date'] or '').split(' ')[0]  # '2026.06.07'
            if len(date_part) >= 10:
                study_dates.add(date_part.replace('.', '-'))  # '2026-06-07'
        except Exception:
            pass

    return jsonify({'study_dates': sorted(study_dates)})

@app.route('/api/focus/sync', methods=['POST'])
def sync_focus():
    """포모도로 집중 시간을 서버에 동기화 (로그인 사용자만)"""
    if 'username' not in session:
        return jsonify({'error': 'unauthorized'}), 401

    data = request.get_json(silent=True) or {}
    total_seconds = data.get('total_seconds', 0)
    sessions      = data.get('sessions', 0)

    try:
        total_seconds = int(total_seconds)
        sessions      = int(sessions)
    except (ValueError, TypeError):
        return jsonify({'error': 'invalid data'}), 400

    if total_seconds < 0 or sessions < 0:
        return jsonify({'error': 'invalid data'}), 400

    username = session['username']
    kst = timezone(timedelta(hours=9))
    today = datetime.now(kst).strftime('%Y-%m-%d')

    conn = get_db_connection()
    conn.execute('''
        INSERT INTO focus_records (username, date, total_seconds, sessions)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username, date) DO UPDATE SET
            total_seconds = MAX(total_seconds, excluded.total_seconds),
            sessions      = MAX(sessions,      excluded.sessions)
    ''', (username, today, total_seconds, sessions))
    conn.commit()
    conn.close()

    return jsonify({'ok': True})


@app.route('/api/focus/leaderboard')
def focus_leaderboard():
    """오늘의 집중 시간 Top3 + 현재 유저 순위 반환"""
    kst = timezone(timedelta(hours=9))
    today = datetime.now(kst).strftime('%Y-%m-%d')

    current_username = session.get('username')

    conn = get_db_connection()

    # Top 3
    top5_rows = conn.execute('''
        SELECT fr.username, u.nickname, u.profile_url, fr.total_seconds, fr.sessions
        FROM focus_records fr
        JOIN users u ON u.username = fr.username
        WHERE fr.date = ?
        ORDER BY fr.total_seconds DESC
        LIMIT 3
    ''', (today,)).fetchall()

    top5 = [
        {
            'rank': i + 1,
            'username': row['username'],
            'nickname': row['nickname'],
            'profile_url': row['profile_url'],
            'total_seconds': row['total_seconds'],
            'sessions': row['sessions'],
        }
        for i, row in enumerate(top5_rows)
    ]

    # 내 순위 (Top5 밖일 경우)
    my_rank = None
    my_record = None
    if current_username:
        rank_row = conn.execute('''
            SELECT COUNT(*) + 1 AS rank
            FROM focus_records
            WHERE date = ? AND total_seconds > (
                SELECT COALESCE(total_seconds, 0)
                FROM focus_records WHERE username = ? AND date = ?
            )
        ''', (today, current_username, today)).fetchone()

        me_row = conn.execute('''
            SELECT fr.username, u.nickname, u.profile_url, fr.total_seconds, fr.sessions
            FROM focus_records fr
            JOIN users u ON u.username = fr.username
            WHERE fr.username = ? AND fr.date = ?
        ''', (current_username, today)).fetchone()

        if me_row:
            my_rank = rank_row['rank'] if rank_row else None
            my_record = {
                'rank': my_rank,
                'username': me_row['username'],
                'nickname': me_row['nickname'],
                'profile_url': me_row['profile_url'],
                'total_seconds': me_row['total_seconds'],
                'sessions': me_row['sessions'],
            }

    conn.close()

    in_top5 = any(r['username'] == current_username for r in top5)

    return jsonify({
        'top5': top5,
        'my_record': my_record if not in_top5 else None,
        'in_top5': in_top5,
        'current_username': current_username,
    })  # top5 key 이름은 하위 호환 유지


@app.route('/ads.txt')
def ads():
    return send_file('ads.txt')

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)