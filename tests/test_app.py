import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.db as db
import app.main as main
from app.fees import fee_for


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DATA_DIR', tmp_path)
    monkeypatch.setattr(db, 'DB_FILE', tmp_path / 'test.sqlite3')
    monkeypatch.setattr(main, 'DATA_DIR', tmp_path)
    with TestClient(main.app) as c:
        yield c


def register(client, email, role):
    res=client.post('/api/register',json={
        'email':email,'password':'ABcd4!valid-password',
        'name':'Тестовый пользователь','city':'Казань','role':role,
    })
    assert res.status_code==201, res.text
    csrf=client.get('/api/me').json()['csrf']
    return {'X-CSRF-Token':csrf}


def create_job(client, csrf):
    res=client.post('/api/jobs',headers=csrf,json={
        'title':'Плиточные работы в ванной',
        'description':'Требуется облицевать стены ванной плиткой.',
        'category':'Ванная и плитка','city':'Казань','budget':100000,
        'phone':'+7 999 123 45 67','items':[{'label':'Облицовка плиткой','unit':'м²','quantity':18,'note':''}]
    })
    assert res.status_code==201,res.text
    return res.json()['id']


def test_fee_boundaries_are_continuous():
    assert fee_for(1)==100
    assert fee_for(5000)==100
    assert fee_for(5001)==100
    assert fee_for(50_000)==775
    assert fee_for(50_001)==775
    assert fee_for(500_000)==5275
    assert fee_for(500_001)==5275
    assert fee_for(1_000_000)==7775
    with pytest.raises(ValueError): fee_for(-1)
    with pytest.raises(ValueError): fee_for(True)


def test_public_job_hides_contacts_and_requires_csrf(client):
    owner_csrf=register(client,'owner@example.ru','customer')
    job_id=create_job(client,owner_csrf)
    public=client.get('/api/jobs').json()
    assert len(public['jobs'])==1
    assert 'phone' not in str(public)
    anonymous=TestClient(main.app)
    assert '999' not in str(anonymous.get(f'/api/jobs/{job_id}').json())
    res=client.post('/api/jobs',json={})
    assert res.status_code==403
    assert client.get('/api/jobs/999').status_code==404


def test_offer_selection_and_contact_lock(tmp_path,monkeypatch):
    monkeypatch.setattr(db,'DATA_DIR',tmp_path)
    monkeypatch.setattr(db,'DB_FILE',tmp_path/'test.sqlite3')
    monkeypatch.setattr(main,'DATA_DIR',tmp_path)
    with TestClient(main.app) as owner, TestClient(main.app) as worker:
        owner_csrf=register(owner,'owner2@example.ru','customer')
        job_id=create_job(owner,owner_csrf)
        worker_csrf=register(worker,'worker@example.ru','contractor')
        offer=worker.post(f'/api/jobs/{job_id}/offers',headers=worker_csrf,
                          json={'amount':50000,'days':14,'note':'Работа без материалов'})
        assert offer.status_code==201,offer.text
        assert offer.json()['fee_preview']==775
        offer_id=offer.json()['id']
        assert worker.post(f'/api/jobs/{job_id}/offers',headers=worker_csrf,json={'amount':50000,'days':14}).status_code==409
        assert worker.post(f'/api/jobs/{job_id}/select/{offer_id}',headers=worker_csrf).status_code==403
        assert owner.get(f'/api/jobs/{job_id}').json()['offers'][0]['amount']==50000
        picked=owner.post(f'/api/jobs/{job_id}/select/{offer_id}',headers=owner_csrf)
        assert picked.status_code==200,picked.text
        assert worker.get(f'/api/jobs/{job_id}/contact').status_code==402
        assert worker.get(f'/api/jobs/{job_id}/fee').json()=={'fee':775,'payment_enabled':False}
        assert owner.get(f'/api/jobs/{job_id}/contact').status_code==403
        assert owner.post(f'/api/jobs/{job_id}/reopen',headers=owner_csrf).status_code==200
        assert worker.get(f'/api/jobs/{job_id}/contact').status_code==403


def test_public_text_rejects_phone_and_links(client):
    csrf=register(client,'owner3@example.ru','customer')
    payload={'title':'Мастер по ремонту квартиры','description':'Пишите на номер +7 999 111 22 33, нужно сделать ремонт',
             'category':'Ремонт квартиры','city':'Казань','phone':'+7 999 444 33 22'}
    assert client.post('/api/jobs',headers=csrf,json=payload).status_code==422
    payload['description']='Нужно качественно обновить отделку двух комнат'
    payload['title']='Посетите https://example.com'
    assert client.post('/api/jobs',headers=csrf,json=payload).status_code==422


def test_photo_format_and_access(client):
    csrf=register(client,'owner4@example.ru','customer')
    job_id=create_job(client,csrf)
    invalid=client.post(f'/api/jobs/{job_id}/photos',headers=csrf,files={'upload':('bad.png',b'not an image','image/png')})
    assert invalid.status_code==422
    image=Image.new('RGB',(40,40),'white');buf=io.BytesIO();image.save(buf,format='PNG')
    good=client.post(f'/api/jobs/{job_id}/photos',headers=csrf,files={'upload':('good.png',buf.getvalue(),'image/png')})
    assert good.status_code==201,good.text
    pid=good.json()['photo_id']
    assert client.get(f'/api/photos/{pid}').headers['content-type']=='image/webp'
    visitor=TestClient(main.app)
    assert visitor.get(f'/api/photos/{pid}').status_code==401


def test_owner_can_cancel_or_complete(tmp_path,monkeypatch):
    monkeypatch.setattr(db,'DATA_DIR',tmp_path)
    monkeypatch.setattr(db,'DB_FILE',tmp_path/'test.sqlite3')
    monkeypatch.setattr(main,'DATA_DIR',tmp_path)
    with TestClient(main.app) as owner, TestClient(main.app) as worker:
        owner_csrf=register(owner,'owner5@example.ru','customer')
        job_id=create_job(owner,owner_csrf)
        assert owner.post(f'/api/jobs/{job_id}/complete',headers=owner_csrf).status_code==409
        assert owner.post(f'/api/jobs/{job_id}/cancel',headers=owner_csrf).status_code==200
        assert owner.post(f'/api/jobs/{job_id}/cancel',headers=owner_csrf).status_code==409
        job2=create_job(owner,owner_csrf)
        worker_csrf=register(worker,'worker5@example.ru','contractor')
        offer=worker.post(f'/api/jobs/{job2}/offers',headers=worker_csrf,json={'amount':10000,'days':2})
        assert offer.status_code==201
        assert owner.post(f'/api/jobs/{job2}/select/{offer.json()["id"]}',headers=owner_csrf).status_code==200
        assert owner.post(f'/api/jobs/{job2}/complete',headers=owner_csrf).status_code==200
        assert worker.get(f'/api/jobs/{job2}/contact').status_code==402
