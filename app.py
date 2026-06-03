import os
import uuid
import sqlite3
import json
import requests
from flask import Flask, render_template, jsonify, request, Response, send_file, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
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
def set_charset(response):
    """Ensure all responses include UTF-8 charset in Content-Type header"""
    if 'Content-Type' in response.headers:
        response.headers['Content-Type'] = response.headers['Content-Type'].replace(
            'charset=iso-8859-1', 'charset=utf-8'
        )
        if 'charset' not in response.headers['Content-Type']:
            response.headers['Content-Type'] += '; charset=utf-8'
    return response

# Configure upload directory
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True) 
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

DB_FILENAME = os.path.join(BASE_DIR, 'study_bunny.db')

def is_admin(username):
    """
    Check if the user is an admin.
    Admin account: username == 'admin'
    """
    return username == 'admin'

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
        datetime.now().strftime("%Y.%m.%d %H:%M"),
    ))

with app.app_context():
    init_db()

def fetch_all_feeds():
    conn = get_db_connection()
    feeds = conn.execute('''
        SELECT p.*, COUNT(c.id) AS comment_count
        FROM posts p
        LEFT JOIN comments c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY p.id DESC
    ''').fetchall()
    conn.close()
    return [dict(feed) for feed in feeds]

@app.route('/api/feeds')
def get_feeds():
    """
    Retrieve all posts with their comment counts.
    """
    return jsonify(fetch_all_feeds())

@app.route('/api/feeds', methods=['POST'])
def create_feed():
    """
    Create a new post.
    """
    username = request.form.get('username')
    if not username:
        return jsonify({"message": "fail", "reason": "로그인 후 글을 작성해주세요."}), 401

    VALID_CATEGORIES = {'공부기록', '질문', '꿀팁', '잡담'}
    category = request.form.get('category', '잡담')
    if category not in VALID_CATEGORIES:
        category = '잡담'

    title = (request.form.get('title') or '').strip()
    content = (request.form.get('content') or '').strip()
    nickname = (request.form.get('nickname') or '익명의 클로버').strip()
    profile_url = request.form.get('profile_url', '')
    image_url = ''

    if not title or not content:
        return jsonify({"message": "fail", "reason": "제목과 내용을 모두 입력해주세요."}), 400

    if 'image' in request.files:
        file = request.files['image']
        if file.filename != '':
            ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
            filename = f"{uuid.uuid4().hex}.{ext}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            image_url = f"/static/uploads/{filename}"

    date_str = datetime.now().strftime("%Y.%m.%d %H:%M")
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO posts (category, username, nickname, profile_url, title, content, date, image_url, views, likes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    ''', (category, username, nickname, profile_url, title, content, date_str, image_url))
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

    comments = conn.execute('SELECT * FROM comments WHERE post_id = ? ORDER BY id ASC', (post_id,)).fetchall()
    post_dict = dict(post)
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
    username = data.get('username')
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
    ''', (post_id, username, user['nickname'], user['profile_url'], data.get('content'), datetime.now().strftime("%Y.%m.%d %H:%M")))
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
    username = data.get('username')
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
                 (post_id, username, datetime.now().strftime("%Y.%m.%d %H:%M")))

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
    username = data.get('username')
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
    
    username = request.form.get('username')
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
    image_url = current_post['image_url'] if current_post else ""

    if 'image' in request.files:
        file = request.files['image']
        if file.filename != '':
            ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
            filename = f"{uuid.uuid4().hex}.{ext}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            image_url = f"/static/uploads/{filename}"

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
    username = data.get('username')
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
                 (content, datetime.now().strftime("%Y.%m.%d %H:%M"), comment_id))
    conn.commit()
    conn.close()
    return jsonify({"message": "success"}), 200

@app.route('/api/comments/<int:comment_id>', methods=['DELETE'])
def delete_comment(comment_id):
    """
    Delete a specific comment.
    """
    data = request.get_json() or {}
    username = data.get('username')
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

@app.route('/blog')
def blog_list():
    """
    Render the blog list page with all articles.
    """
    articles = [
        {
            'id': 1,
            'title': '효과적인 공부 계획을 세우는 5가지 방법',
            'subtitle': '공부를 잘하는 학생들의 공통점인 체계적인 공부 계획을 세우는 방법을 알아봅시다.',
            'category': '공부 기법',
            'file': 'adsense_content_01.html'
        },
        {
            'id': 2,
            'title': '집중력이 흐르는 공부 환경 만드는 법',
            'subtitle': '과학적으로 증명된 5가지 환경 조성 방법을 실천해보세요.',
            'category': '공부 환경',
            'file': 'adsense_content_02.html'
        },
        {
            'id': 3,
            'title': '잘 잊혀지지 않는 기억력',
            'subtitle': '신경과학 기반 공부 기법 3가지로 기억력을 향상시키세요.',
            'category': '학습 기법',
            'file': 'adsense_content_03.html'
        },
        {
            'id': 4,
            'title': '시험 불안감을 이겨내는 심리 전략',
            'subtitle': '시험 시즌을 슬기롭게 보내는 4가지 심리 전략을 배워봅시다.',
            'category': '심리 관리',
            'file': 'adsense_content_04.html'
        },
        {
            'id': 5,
            'title': '온라인 학습이 미래 교육이 되는 이유',
            'subtitle': '효율적인 온라인 공부법과 활용 전략을 소개합니다.',
            'category': '온라인 교육',
            'file': 'adsense_content_05.html'
        },
        {
            'id': 6,
            'title': '과목마다 다른 공부법',
            'subtitle': '수학, 과학, 국어 각 과목의 특성에 맞는 학습 방법을 배워봅시다.',
            'category': '학습 전략',
            'file': 'adsense_content_06.html'
        },
        {
            'id': 7,
            'title': '공부 동기가 떨어졌을 때',
            'subtitle': '동기를 되찾는 7가지 방법으로 다시 시작하세요.',
            'category': '동기 관리',
            'file': 'adsense_content_07.html'
        },
        {
            'id': 8,
            'title': '독서가 공부 능력을 높이는 이유',
            'subtitle': '읽기 능력과 학력의 관계를 이해하고 독서 습관을 들이세요.',
            'category': '독서와 학습',
            'file': 'adsense_content_08.html'
        },
        {
            'id': 9,
            'title': '혼자보다 함께 - 효과적인 그룹 스터디 운영',
            'subtitle': '협력 학습의 효과와 그룹 스터디 운영 방법을 배워봅시다.',
            'category': '협력 학습',
            'file': 'adsense_content_09.html'
        },
        {
            'id': 10,
            'title': '공부 습관이 인생을 바꾼다',
            'subtitle': '30일 안에 공부 습관을 형성하는 체계적인 방법을 소개합니다.',
            'category': '습관 형성',
            'file': 'adsense_content_10.html'
        },
        {
            'id': 11,
            'title': "전교 1등은 알고 있는 '내가 모르는 것'의 비밀",
            'subtitle': '메타인지 능력을 기르는 3가지 방법으로 착각적 인지를 깨부수고 공부 효율을 극대화해보세요.',
            'category': '학습 기법',
            'file': 'adsense_content_11.html'
        },
        {
            'id': 12,
            'title': "공부할 때 스마트폰 유혹을 이기는 '디지털 디톡스'",
            'subtitle': '집중력을 파괴하는 디지털 유혹의 과학적 원리와 의지력이 필요 없는 실전 차단 전략',
            'category': '공부 환경',
            'file': 'adsense_content_12.html'
        },
        {
            'id': 13,
            'title': "잠을 줄이면 성적이 떨어지는 이유",
            'subtitle': '뇌과학이 증명한 수면과 기억의 상관관계 및 학습 효율을 극대화하는 최적의 수면 전략',
            'category': '피로 관리',
            'file': 'adsense_content_13.html'
        },
        {
            'id': 14,
            'title': '공부 슬럼프와 번아웃을 극복하는 방법',
            'subtitle': '무기력에서 벗어나 시동을 거는 5분 규칙과 뇌과학 기반의 능동적 휴식 전략',
            'category': '심리 관리',
            'file': 'adsense_content_14.html'
        },
        {
            'id': 15,
            'title': '시험 당일 포텐을 터뜨리는 실전 시뮬레이션',
            'subtitle': '실력을 200% 발휘하는 마지막 필살기 및 3단계 시험지 운영 법칙',
            'category': '시험 실전',
            'file': 'adsense_content_15.html'
        },
    ]
    return render_template('blog_list.html', articles=articles)

@app.route('/blog/<int:article_id>')
def blog_detail(article_id):
    """
    Render a detailed blog article page.
    """
    articles = {
        1: 'adsense_content_01.html',
        2: 'adsense_content_02.html',
        3: 'adsense_content_03.html',
        4: 'adsense_content_04.html',
        5: 'adsense_content_05.html',
        6: 'adsense_content_06.html',
        7: 'adsense_content_07.html',
        8: 'adsense_content_08.html',
        9: 'adsense_content_09.html',
        10: 'adsense_content_10.html',
        11: 'adsense_content_11.html',
        12: 'adsense_content_12.html',
        13: 'adsense_content_13.html',
        14: 'adsense_content_14.html',
        15: 'adsense_content_15.html',
    }
    
    if article_id not in articles:
        return '글을 찾을 수 없습니다', 404
    
    return render_template(f'blog/{articles[article_id]}', article_id=article_id)

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
    Return a dynamic sitemap including static pages and posts.
    """
    conn = get_db_connection()
    posts = conn.execute('SELECT id FROM posts').fetchall()
    conn.close()

    urls = [
        f"{request.url_root.rstrip('/')}/",
        f"{request.url_root.rstrip('/')}/about",
        f"{request.url_root.rstrip('/')}/privacy",
        f"{request.url_root.rstrip('/')}/terms",
        f"{request.url_root.rstrip('/')}/contact"
    ]
    for post in posts:
        urls.append(f"{request.url_root.rstrip('/')}/post/{post['id']}")

    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url in urls:
        xml.append('  <url>')
        xml.append(f'    <loc>{url}</loc>')
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
def get_all_users():
    """
    Get all registered users - admin only.
    """
    # Check admin permission
    username = request.args.get('username')
    if not username or not is_admin(username):
        return jsonify({
            "message": "fail",
            "reason": "관리자 권한이 필요합니다."
        }), 403
    
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
    data = request.get_json() or {}
    if data.get('username') != username:
        return jsonify({"message": "fail", "reason": "잘못된 요청입니다."}), 400

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
    data = request.get_json() or {}
    if data.get('username') != username:
        return jsonify({"message": "fail", "reason": "잘못된 요청입니다."}), 400

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
    username = request.form.get('username')
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
            ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
            filename = f"profile_{uuid.uuid4().hex}.{ext}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            new_profile_url = f"/static/uploads/{filename}"

    conn.execute('UPDATE users SET nickname = ?, profile_url = ? WHERE username = ?',
                 (new_nickname, new_profile_url, username))
    conn.execute('UPDATE posts SET nickname = ?, profile_url = ? WHERE username = ?',
                 (new_nickname, new_profile_url, username))
    conn.execute('UPDATE comments SET nickname = ?, profile_url = ? WHERE username = ?',
                 (new_nickname, new_profile_url, username))
    conn.commit()
    conn.close()

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
            ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
            filename = f"profile_{uuid.uuid4().hex}.{ext}"
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
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
    username = data.get('username')
    
    if not username:
        return jsonify({"message": "fail", "reason": "아이디가 필요합니다."}), 400
    
    conn = get_db_connection()
    
    # Check if user exists
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"message": "fail", "reason": "존재하지 않는 사용자입니다."}), 404
    
    try:
        # Delete user's posts and related data
        posts = conn.execute('SELECT id FROM posts WHERE username = ?', (username,)).fetchall()
        for post in posts:
            post_id = post['id']
            conn.execute('DELETE FROM comments WHERE post_id = ?', (post_id,))
            conn.execute('DELETE FROM post_likes WHERE post_id = ?', (post_id,))
            conn.execute('DELETE FROM notifications WHERE post_id = ?', (post_id,))
        
        conn.execute('DELETE FROM posts WHERE username = ?', (username,))
        
        # Delete user's comments
        conn.execute('DELETE FROM comments WHERE username = ?', (username,))
        
        # Delete user's post_likes
        conn.execute('DELETE FROM post_likes WHERE username = ?', (username,))
        
        # Delete notifications related to user
        conn.execute('DELETE FROM notifications WHERE recipient_username = ? OR actor_username = ?', (username, username))
        
        # Delete user account
        conn.execute('DELETE FROM users WHERE username = ?', (username,))
        
        conn.commit()
        conn.close()
        
        return jsonify({"message": "success"}), 200
    except Exception as e:
        conn.rollback()
        conn.close()
        print(f"Error deleting account: {e}")
        return jsonify({"message": "fail", "reason": f"탈퇴 처리 중 오류가 발생했습니다: {str(e)}"}), 500


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
              datetime.now().strftime("%Y.%m.%d %H:%M:%S")))
        conn.commit()
        conn.close()
        return jsonify({"message": "success"}), 200
    except Exception as e:
        conn.close()
        print(f"Error creating report: {str(e)}")
        return jsonify({"message": "fail", "reason": "신고 처리 중 오류가 발생했습니다."}), 500


@app.route('/api/admin/reports', methods=['GET'])
def get_reports():
    """
    Get all reports - admin only.
    """
    # Check admin permission
    username = request.args.get('username')
    if not username or not is_admin(username):
        return jsonify({
            "message": "fail",
            "reason": "관리자 권한이 필요합니다."
        }), 403
    
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
def update_report_status(report_id):
    """
    Update report status - admin only.
    """
    data = request.get_json() or {}
    username = data.get('username')
    status = data.get('status')  # 'resolved', 'dismissed', etc.
    
    # Check admin permission
    if not username or not is_admin(username):
        return jsonify({
            "message": "fail",
            "reason": "관리자 권한이 필요합니다."
        }), 403
    
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
    
    data = request.get_json()
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
    
    profile_url = "https://placehold.co/100x100/6ee7b7/ffffff?text=Clover"
    
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
            datetime.now().strftime("%Y.%m.%d %H:%M:%S")
        ))
        conn.commit()
        conn.close()
        
        # 세션에서 임시 정보 삭제
        del session['temp_google_info']
        
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

@app.route('/ads.txt')
def ads():
    return send_file('ads.txt')

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)