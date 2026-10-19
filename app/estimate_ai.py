"""Optional server-only AI draft creator. Never persists, prices or publishes estimates."""
import json
import os
import urllib.error
import urllib.request

PROMPT = """Ты составляешь ЧЕРНОВИК перечня работ, НЕ смету стоимости.
Из русского описания строительства/ремонта выдели расценки короткими профессиональными названиями.
Каждая расценка содержит одну строку Работы и необязательные материалы.
Не придумывай размеры, количество, этаж, наличие лифта или бюджет. При неизвестном количестве ставь null.
Материалы лишь предполагаемые, требуют подтверждения заказчиком; количество материала неизвестно -> null.
Не добавляй цены. Для каждой работы создавай минимальное число нужных позиций, максимум 12.
Вопросы — максимум 4, только влияющие на стоимость. Только JSON по заданной схеме.
"""

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'title': {'type': 'string'},
        'category': {'type': 'string'},
        'floor': {'type': ['integer', 'null']},
        'elevator': {'type': 'string', 'enum': ['yes','no','unknown']},
        'questions': {'type': 'array', 'items': {'type': 'string'}},
        'items': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'properties': {
                'label': {'type': 'string'}, 'unit': {'type': 'string'},
                'quantity': {'type': ['number','null']},
                'materials': {'type': 'array', 'items': {
                    'type': 'object', 'additionalProperties': False,
                    'properties': {'label': {'type': 'string'}, 'unit': {'type': 'string'}, 'quantity': {'type': ['number','null']}},
                    'required': ['label','unit','quantity']
                }}
            }, 'required': ['label','unit','quantity','materials']
        }}
    }, 'required': ['title','category','floor','elevator','questions','items']
}


def generate_draft(source_text: str):
    key=os.environ.get('OPENAI_API_KEY')
    if not key:
        raise RuntimeError('ИИ не подключён. Добавьте ключ API на сервере.')
    data=json.dumps({
        'model': os.getenv('PODRYADI_AI_MODEL','gpt-4.1-mini'),
        'instructions': PROMPT,
        'input': source_text,
        'max_output_tokens': 2600,
        'text': {'format': {'type':'json_schema','name':'estimate_draft','strict':True,'schema':SCHEMA}}
    }, ensure_ascii=False).encode('utf-8')
    request=urllib.request.Request('https://api.openai.com/v1/responses',data=data,
        headers={'Content-Type':'application/json','Authorization':'Bearer '+key},method='POST')
    with urllib.request.urlopen(request,timeout=24) as response:
        body=json.load(response)
    content=''.join(chunk.get('text','') for output in body.get('output',[])
                    for chunk in output.get('content',[]) if chunk.get('type')=='output_text')
    if not content:
        raise RuntimeError('ИИ не сформировал смету. Попробуйте уточнить описание.')
    draft=json.loads(content)
    if not isinstance(draft,dict) or not isinstance(draft.get('items'),list) or not 1<=len(draft['items'])<=12:
        raise ValueError('Не удалось сформировать корректные позиции')
    draft['questions'] = [str(q)[:200] for q in draft.get('questions',[])[:4]]
    result=[]
    for item in draft['items']:
        label=str(item.get('label','')).strip()[:140]
        if len(label)<2: continue
        qty=item.get('quantity')
        if not isinstance(qty,(int,float)) or isinstance(qty,bool) or not 0<qty<=1000000: qty=None
        materials=[]
        for raw in item.get('materials',[])[:8]:
            name=str(raw.get('label','')).strip()[:120]
            if not name: continue
            mq=raw.get('quantity')
            if not isinstance(mq,(int,float)) or isinstance(mq,bool) or not 0<mq<=1000000: mq=None
            materials.append({'label':name,'unit':str(raw.get('unit','шт.'))[:12],'quantity':mq})
        result.append({'label':label,'unit':str(item.get('unit','шт.'))[:12], 'quantity':qty, 'note':'', 'materials':materials})
    if not result: raise ValueError('Не удалось распознать работы')
    title=str(draft.get('title','')).strip()[:140] or 'Ремонтные работы'
    floor=draft.get('floor')
    if not isinstance(floor,int) or isinstance(floor,bool) or not 0<=floor<=200:floor=None
    return {'title':title, 'category':str(draft.get('category','')), 'floor':floor,
            'elevator':draft.get('elevator') if draft.get('elevator') in ['yes','no','unknown'] else 'unknown',
            'questions':draft['questions'], 'items':result, 'source':'ai',
            'disclaimer':'Черновик ИИ: проверьте объёмы и материалы перед публикацией.'}
