"""Podryadi API. No payment bypass: gateway must be configured before contact release."""
import hashlib
import hmac
import io
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from PIL import Image, UnidentifiedImageError

from .db import DATA_DIR, connect, init_db, transaction
from .fees import fee_for

ROOT = Path(__file__).resolve().parent
COOKIE_NAME = 'pd_session'
COOKIE_SECURE = os.environ.get('PODRYADI_COOKIE_SECURE', 'false').lower() == 'true'
MAX_IMAGE = 5 * 1024 * 1024
CATEGORIES = ('Ремонт квартиры','Ванная и плитка','Электрика','Сантехника','Отопление','Кровля','Фасад','Другое')
PHONE_PATTERN = re.compile(r'(?<!\w)(?:\+?7|8)[\s\-()]*(?:\d[\s\-()]*){10}(?!\w)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:https?://|t\.me/|wa\.me/)', re.I)


def clean_public(value: str):
    if PHONE_PATTERN.search(value):
        raise ValueError('Контакты и ссылки нельзя указывать в публичном тексте')
    return value.strip()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title='Подряди API', lifespan=lifespan, docs_url=None, redoc_url=None)


class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=10, max_length=128)

    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Укажите корректный email')
        return value


class Registration(Credentials):
    name: str = Field(min_length=2, max_length=80)
    role: str
    city: str = Field(min_length=2, max_length=70)


class Profile(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    city: str = Field(min_length=2, max_length=70)
    specialties: str = Field(default='', max_length=220)
    about: str = Field(default='', max_length=900)

    @field_validator('specialties', 'about')
    @classmethod
    def no_contacts(cls, value):
        return clean_public(value)


class Item(BaseModel):
    label: str = Field(min_length=2, max_length=160)
    unit: str = Field(min_length=1, max_length=12)
    quantity: float = Field(gt=0, le=1000000)
    note: str = Field(default='', max_length=240)

    @field_validator('label', 'note')
    @classmethod
    def no_contacts(cls, value):
        return clean_public(value)


class JobCreate(BaseModel):
    title: str = Field(min_length=6, max_length=140)
    description: str = Field(min_length=15, max_length=4000)
    city: str = Field(min_length=2, max_length=70)
    category: str
    budget: int | None = Field(default=None, gt=0, le=1000000000)
    start_when: str = Field(default='По договорённости', max_length=70)
    phone: str = Field(min_length=10, max_length=25)
    items: list[Item] = Field(default_factory=list, max_length=40)

    @field_validator('title', 'description', 'start_when')
    @classmethod
    def no_contacts(cls, value):
        return clean_public(value)


class OfferCreate(BaseModel):
    amount: int = Field(gt=0, le=1000000000)
    days: int = Field(ge=1, le=365)
    note: str = Field(default='', max_length=1500)

    @field_validator('note')
    @classmethod
    def no_contacts(cls, value):
        return clean_public(value)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 260_000).hex()
    return f'{salt}:{digest}'


def verify_password(password, hashed):
    try:
        salt, _ = hashed.split(':', 1)
        return hmac.compare_digest(password_hash(password, salt), hashed)
    except (ValueError, TypeError):
        return False


def load_user(request: Request):
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        return None
    with connect() as db:
        result = db.execute('''SELECT u.id,u.email,u.role,u.display_name,u.city,u.specialties,u.about,s.csrf
         FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.token_hash=? AND s.expires_at>?''', (hashlib.sha256(raw.encode()).hexdigest(), int(time.time()))).fetchone()
        return dict(result) if result else None


def require_user(request: Request):
    result = load_user(request)
    if not result:
        raise HTTPException(401, 'Войдите в аккаунт')
    return result


def csrf(request: Request, user=Depends(require_user)):
    if request.headers.get('X-CSRF-Token') != user['csrf']:
        raise HTTPException(403, 'Ошибка проверки запроса')
    return user


def role_required(user, expected):
    if user['role'] != expected:
        raise HTTPException(403, 'Недостаточно прав для этой операции')


def issue_session(response: Response, user_id: int):
    token, csrf_token = secrets.token_urlsafe(36), secrets.token_urlsafe(24)
    with transaction() as db:
        db.execute('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)',
                   (hashlib.sha256(token.encode()).hexdigest(), user_id, csrf_token, int(time.time()) + 86400*14))
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=COOKIE_SECURE,
                        samesite='lax', max_age=86400*14, path='/')


def public_user(user):
    return {k: user[k] for k in ('id','email','role','display_name','city','specialties','about')}


def record_event(db, job_id, user_id, action, detail=''):
    db.execute('INSERT INTO job_events(job_id,actor_id,action,detail) VALUES (?,?,?,?)', (job_id,user_id,action,detail))


@app.get('/api/health')
def health():
    return {'status':'ok','service':'podryadi'}


@app.get('/api/config')
def config():
    return {'payments_enabled':False,'test_mode':True,'categories':CATEGORIES}


@app.post('/api/register', status_code=201)
def register(payload: Registration, response: Response):
    if payload.role not in ('customer','contractor'):
        raise HTTPException(422, 'Неверный тип аккаунта')
    try:
        with transaction() as db:
            cur = db.execute('INSERT INTO users(email,password_hash,role,display_name,city) VALUES (?,?,?,?,?)',
                             (payload.email,password_hash(payload.password),payload.role,payload.name.strip(),payload.city.strip()))
            user_id = cur.lastrowid
    except Exception as exc:
        if 'UNIQUE constraint failed' in str(exc):
            raise HTTPException(409,'Email уже зарегистрирован')
        raise
    issue_session(response,user_id)
    return {'ok':True}


@app.post('/api/login')
def login(payload: Credentials, response: Response):
    now = int(time.time())
    with connect() as db:
        attempt = db.execute('SELECT count,last_at FROM login_attempts WHERE email=?', (payload.email,)).fetchone()
        if attempt and attempt['count'] >= 7 and now-attempt['last_at'] < 900:
            raise HTTPException(429,'Слишком много попыток. Повторите через 15 минут')
        user = db.execute('SELECT id,password_hash FROM users WHERE email=?',(payload.email,)).fetchone()
    if not user or not verify_password(payload.password,user['password_hash']):
        with transaction() as db:
            db.execute('''INSERT INTO login_attempts(email,count,last_at) VALUES(?,1,?)
               ON CONFLICT(email) DO UPDATE SET count=CASE WHEN ?-last_at>900 THEN 1 ELSE count+1 END,last_at=?''', (payload.email,now,now,now))
        raise HTTPException(401,'Неверный email или пароль')
    with transaction() as db:
        db.execute('DELETE FROM login_attempts WHERE email=?',(payload.email,))
    issue_session(response,user['id'])
    return {'ok':True}


@app.get('/api/me')
def me(request: Request):
    user=load_user(request)
    return {'user':public_user(user) if user else None,'csrf':user['csrf'] if user else None}


@app.post('/api/logout')
def logout(request: Request, response: Response, user=Depends(csrf)):
    token=request.cookies.get(COOKIE_NAME,'')
    with transaction() as db:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie(COOKIE_NAME,path='/')
    return {'ok':True}


@app.patch('/api/profile')
def update_profile(payload: Profile, user=Depends(csrf)):
    with transaction() as db:
        db.execute('UPDATE users SET display_name=?,city=?,specialties=?,about=? WHERE id=?',
                   (payload.name.strip(),payload.city.strip(),payload.specialties,payload.about,user['id']))
    return {'ok':True}


def job_dict(job):
    return {k:job[k] for k in ('id','customer_id','title','description','category','city','budget','start_when','status','created_at')}


@app.get('/api/jobs')
def list_jobs(city: str='', category: str='', q: str='', offset:int=0, limit:int=20):
    limit=max(1,min(40,limit)); offset=max(0,offset)
    clauses=["j.status='open'"]; args=[]
    if city: clauses.append('j.city LIKE ?');args.append(f'%{city[:70]}%')
    if category: clauses.append('j.category=?');args.append(category[:80])
    if q: clauses.append('(j.title LIKE ? OR j.description LIKE ?)');args.extend((f'%{q[:100]}%',f'%{q[:100]}%'))
    where=' AND '.join(clauses)
    with connect() as db:
        rows=db.execute(f'''SELECT j.*,(SELECT count(*) FROM work_items i WHERE i.job_id=j.id) item_count
           FROM jobs j WHERE {where} ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?''', (*args,limit,offset)).fetchall()
    return {'jobs':[job_dict(r)|{'item_count':r['item_count']} for r in rows]}


@app.post('/api/jobs',status_code=201)
def create_job(payload: JobCreate, user=Depends(csrf)):
    role_required(user,'customer')
    if payload.category not in CATEGORIES:
        raise HTTPException(422,'Выберите категорию')
    if not re.fullmatch(r'\+?[\d ()-]{10,25}',payload.phone) or len(re.sub(r'\D','',payload.phone)) < 10:
        raise HTTPException(422,'Укажите корректный телефон')
    with transaction() as db:
        cur=db.execute('INSERT INTO jobs(customer_id,title,description,category,city,budget,start_when) VALUES (?,?,?,?,?,?,?)',
                       (user['id'],payload.title,payload.description,payload.category,payload.city.strip(),payload.budget,payload.start_when))
        jid=cur.lastrowid
        db.execute('INSERT INTO job_contacts(job_id,phone) VALUES (?,?)',(jid,payload.phone.strip()))
        for i,item in enumerate(payload.items):
            db.execute('INSERT INTO work_items(job_id,label,unit,quantity,note,ordinal) VALUES (?,?,?,?,?,?)',
                       (jid,item.label,item.unit,item.quantity,item.note,i))
        record_event(db,jid,user['id'],'created')
    return {'id':jid}


@app.get('/api/jobs/{job_id}')
def job_detail(job_id: int, request: Request):
    user=load_user(request)
    with connect() as db:
        job=db.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not job: raise HTTPException(404,'Заказ не найден')
        owner=bool(user and user['id']==job['customer_id'])
        if job['status']!='open' and not owner:
            my_offer=db.execute('SELECT id FROM offers WHERE job_id=? AND contractor_id=?',(job_id,user['id'] if user else -1)).fetchone()
            if not my_offer: raise HTTPException(404,'Заказ недоступен')
        items=[dict(r) for r in db.execute('SELECT label,unit,quantity,note FROM work_items WHERE job_id=? ORDER BY ordinal',(job_id,)).fetchall()]
        photos=[r['id'] for r in db.execute('SELECT id FROM photos WHERE job_id=?',(job_id,)).fetchall()]
        offers=[]
        if owner:
            offers=[dict(r) for r in db.execute('''SELECT o.id,o.amount,o.days,o.note,o.status,o.created_at,u.display_name contractor_name,u.city contractor_city,u.specialties
                 FROM offers o JOIN users u ON u.id=o.contractor_id WHERE o.job_id=? ORDER BY o.amount''',(job_id,))]
        elif user:
            offers=[dict(r) for r in db.execute('SELECT id,amount,days,note,status,created_at FROM offers WHERE job_id=? AND contractor_id=?',(job_id,user['id']))]
        result=job_dict(job)|{'items':items,'photo_ids':photos,'offers':offers,'selected_offer_id':job['selected_offer_id'] if owner else None,'is_owner':owner}
        if owner:
            c=db.execute('SELECT phone,email FROM job_contacts WHERE job_id=?',(job_id,)).fetchone()
            result['own_contact']=dict(c)
        return result


@app.get('/api/my-jobs')
def my_jobs(user=Depends(require_user)):
    role_required(user,'customer')
    with connect() as db:
        return {'jobs':[job_dict(r) for r in db.execute('SELECT * FROM jobs WHERE customer_id=? ORDER BY id DESC',(user['id'],))]}


@app.get('/api/my-offers')
def my_offers(user=Depends(require_user)):
    role_required(user,'contractor')
    with connect() as db:
        return {'offers':[dict(r) for r in db.execute('''SELECT o.id,o.job_id,o.amount,o.days,o.note,o.status,j.title,j.city,j.category,j.status job_status
         FROM offers o JOIN jobs j ON j.id=o.job_id WHERE o.contractor_id=? ORDER BY o.id DESC''',(user['id'],))]}


@app.post('/api/jobs/{job_id}/offers',status_code=201)
def submit_offer(job_id: int, payload: OfferCreate, user=Depends(csrf)):
    role_required(user,'contractor')
    with transaction() as db:
        job=db.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not job: raise HTTPException(404,'Заказ не найден')
        if job['status']!='open': raise HTTPException(409,'Приём предложений завершён')
        if job['customer_id']==user['id']: raise HTTPException(403,'Нельзя ответить на свой заказ')
        existing=db.execute('SELECT id FROM offers WHERE job_id=? AND contractor_id=?',(job_id,user['id'])).fetchone()
        if existing: raise HTTPException(409,'Вы уже отправили предложение')
        cur=db.execute('INSERT INTO offers(job_id,contractor_id,amount,days,note) VALUES (?,?,?,?,?)',
                       (job_id,user['id'],payload.amount,payload.days,payload.note))
    return {'id':cur.lastrowid,'fee_preview':fee_for(payload.amount)}


@app.post('/api/jobs/{job_id}/select/{offer_id}')
def select_offer(job_id:int,offer_id:int,user=Depends(csrf)):
    role_required(user,'customer')
    with transaction() as db:
        job=db.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not job or job['customer_id']!=user['id']: raise HTTPException(404,'Ваш заказ не найден')
        if job['status']!='open': raise HTTPException(409,'Заказ не принимает предложения')
        offer=db.execute('SELECT * FROM offers WHERE id=? AND job_id=? AND status=?',(offer_id,job_id,'submitted')).fetchone()
        if not offer: raise HTTPException(409,'Предложение недоступно')
        db.execute('UPDATE jobs SET status=?,selected_offer_id=? WHERE id=?',('selected',offer_id,job_id))
        db.execute('UPDATE offers SET status=CASE WHEN id=? THEN ? ELSE ? END WHERE job_id=? AND status=?',
                   (offer_id,'selected','rejected',job_id,'submitted'))
        record_event(db,job_id,user['id'],'selected',str(offer_id))
    return {'ok':True}


@app.post('/api/jobs/{job_id}/reopen')
def reopen(job_id:int,user=Depends(csrf)):
    role_required(user,'customer')
    with transaction() as db:
        job=db.execute('SELECT * FROM jobs WHERE id=? AND customer_id=?',(job_id,user['id'])).fetchone()
        if not job: raise HTTPException(404,'Ваш заказ не найден')
        if job['status']!='selected':raise HTTPException(409,'Нельзя открыть этот заказ повторно')
        db.execute('UPDATE jobs SET status=?,selected_offer_id=NULL WHERE id=?',('open',job_id))
        db.execute("UPDATE offers SET status='submitted' WHERE job_id=? AND status IN ('selected','rejected')",(job_id,))
        record_event(db,job_id,user['id'],'reopened')
    return {'ok':True}


@app.post('/api/jobs/{job_id}/cancel')
def cancel_job(job_id:int,user=Depends(csrf)):
    role_required(user,'customer')
    with transaction() as db:
        job=db.execute('SELECT customer_id,status FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not job or job['customer_id']!=user['id']:
            raise HTTPException(404,'Ваш заказ не найден')
        if job['status'] not in ('open','selected'):
            raise HTTPException(409,'Заказ уже завершён или отменён')
        db.execute("UPDATE jobs SET status='cancelled' WHERE id=?",(job_id,))
        record_event(db,job_id,user['id'],'cancelled')
    return {'ok':True}


@app.post('/api/jobs/{job_id}/complete')
def complete_job(job_id:int,user=Depends(csrf)):
    role_required(user,'customer')
    with transaction() as db:
        job=db.execute('SELECT customer_id,status FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not job or job['customer_id']!=user['id']:
            raise HTTPException(404,'Ваш заказ не найден')
        if job['status']!='selected':
            raise HTTPException(409,'Сначала выберите исполнителя')
        db.execute("UPDATE jobs SET status='completed' WHERE id=?",(job_id,))
        record_event(db,job_id,user['id'],'completed')
    return {'ok':True}


@app.get('/api/jobs/{job_id}/contact')
def guarded_contact(job_id:int,user=Depends(require_user)):
    # Intentionally disabled until production payment integration with authenticated webhooks.
    with connect() as db:
        job=db.execute('SELECT selected_offer_id FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not job: raise HTTPException(404,'Заказ не найден')
        offer=db.execute('SELECT contractor_id,amount FROM offers WHERE id=?',(job['selected_offer_id'],)).fetchone() if job['selected_offer_id'] else None
        if not offer or offer['contractor_id'] != user['id']:
            raise HTTPException(403,'Контакты доступны только выбранному исполнителю')
    raise HTTPException(402,'Оплата контактов ещё не подключена')


@app.get('/api/jobs/{job_id}/fee')
def get_fee(job_id:int,user=Depends(require_user)):
    with connect() as db:
        j=db.execute('SELECT selected_offer_id FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not j:raise HTTPException(404,'Заказ не найден')
        o=db.execute('SELECT amount,contractor_id FROM offers WHERE id=?',(j['selected_offer_id'],)).fetchone() if j['selected_offer_id'] else None
        if not o or o['contractor_id']!=user['id']: raise HTTPException(403,'Только для выбранного исполнителя')
        return {'fee':fee_for(o['amount']),'payment_enabled':False}


@app.post('/api/jobs/{job_id}/photos',status_code=201)
async def add_photo(job_id:int,upload: UploadFile=File(...),user=Depends(csrf)):
    role_required(user,'customer')
    with connect() as db:
        job=db.execute('SELECT customer_id,status FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not job or job['customer_id']!=user['id']:raise HTTPException(404,'Заказ не найден')
        if job['status']!='open':raise HTTPException(409,'Фото можно добавлять только в открытую заявку')
        count=db.execute('SELECT count(*) count FROM photos WHERE job_id=?',(job_id,)).fetchone()['count']
        if count>=5:raise HTTPException(422,'Можно загрузить не более 5 фотографий')
    content=await upload.read(MAX_IMAGE+1)
    if len(content)>MAX_IMAGE:raise HTTPException(413,'Фото больше 5 МБ')
    try:
        im=Image.open(io.BytesIO(content));im.verify()
        im=Image.open(io.BytesIO(content))
        if im.format not in ('JPEG','PNG','WEBP') or im.width*im.height>24_000_000:
            raise HTTPException(422,'Неподдерживаемый формат или размер фото')
        im=im.convert('RGB'); im.thumbnail((1800,1800))
    except (UnidentifiedImageError,OSError,ValueError):
        raise HTTPException(422,'Невозможно прочитать фотографию')
    directory=DATA_DIR/'uploads';directory.mkdir(parents=True,exist_ok=True)
    filename=f'{uuid.uuid4().hex}.webp'
    im.save(directory/filename,format='WEBP',quality=82)  # strips original EXIF
    try:
        with transaction() as db:
            if db.execute('SELECT count(*) count FROM photos WHERE job_id=?',(job_id,)).fetchone()['count']>=5:
                raise HTTPException(422,'Можно загрузить не более 5 фотографий')
            cur=db.execute('INSERT INTO photos(job_id,filename) VALUES (?,?)',(job_id,filename))
            pid=cur.lastrowid
    except Exception:
        (directory/filename).unlink(missing_ok=True)
        raise
    return {'photo_id':pid}


@app.get('/api/photos/{photo_id}')
def serve_photo(photo_id:int,user=Depends(require_user)):
    with connect() as db:
        p=db.execute('SELECT p.filename,j.status,j.customer_id FROM photos p JOIN jobs j ON j.id=p.job_id WHERE p.id=?',(photo_id,)).fetchone()
        if not p:raise HTTPException(404,'Фото не найдено')
        if p['customer_id']!=user['id'] and p['status']!='open':
            raise HTTPException(403,'Фото закрыто')
        f=DATA_DIR/'uploads'/p['filename']
        if not f.exists():raise HTTPException(404,'Фото не найдено')
        return FileResponse(f,media_type='image/webp',headers={'Cache-Control':'private, no-store'})


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse({'error':exc.detail},status_code=exc.status_code)


@app.get('/{path:path}',include_in_schema=False)
def frontend(path:str):
    if path.startswith('api/') or path.startswith('data/'):
        raise HTTPException(404,'Не найдено')
    file=ROOT/'static'/path
    if file.is_file() and file.resolve().is_relative_to((ROOT/'static').resolve()):
        return FileResponse(file)
    return FileResponse(ROOT/'static'/'index.html')
