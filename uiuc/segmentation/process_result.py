import json

data = json.load(open('result.json'))
classes = dict()
for s in data:
    classes.setdefault(s['label'], [])
    classes[s['label']].append(s['color'])
for k, v in classes.items():
    print('({}) {}'.format(k, 
                          ', '.join([f'<font color={c}>{c}</font>' for c in v])
                         )
         )
