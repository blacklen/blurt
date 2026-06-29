#!/usr/bin/env python3
"""Grow worker/public/prompts.json up to a target count using Gemini.

Usage:
    GEMINI_KEY=your_key python3 worker/gen_prompts.py            # default target 1000
    GEMINI_KEY=your_key python3 worker/gen_prompts.py 1000 20    # target, batch size

Calls Gemini in batches, validates the schema, dedupes against existing prompts
(and within the run), and appends. Safe to re-run — it only adds what's missing.
The key is read from the environment; it is never written anywhere.
"""
import json, os, sys, time, urllib.request, re

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'public', 'prompts.json')
KEY = os.environ.get('GEMINI_KEY')
MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
BATCH = int(sys.argv[2]) if len(sys.argv) > 2 else 20

CATS = ['work', 'daily', 'social', 'opinion', 'story']
KEYS = {'cat', 'kind', 'text', 'sample', 'chunk', 'note'}


def norm(s):
    return re.sub(r'\s+', ' ', (s or '').strip().lower())


def gemini(prompt):
    url = (f'https://generativelanguage.googleapis.com/v1beta/models/'
           f'{MODEL}:generateContent?key={KEY}')
    body = json.dumps({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'responseMimeType': 'application/json'},
    }).encode()
    req = urllib.request.Request(url, data=body,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    return data['candidates'][0]['content']['parts'][0]['text']


def make_prompt(n, avoid):
    avoid_line = ''
    if avoid:
        avoid_line = ('Do NOT repeat any of these existing prompt texts:\n- '
                      + '\n- '.join(avoid[-40:]) + '\n')
    return f"""Generate {n} DISTINCT practice prompts for a Vietnamese software developer in Hanoi training spoken English fluency.
Spread them across categories: {', '.join(CATS)}.
Mix both kinds:
- "vn": a natural everyday Vietnamese sentence for the learner to express in English.
- "sit": a short English-described situation for the learner to react to.
Be specific and varied — real dev work, daily life, friends, opinions, short stories. Local Hanoi flavor welcome, sometimes funny. Avoid generic textbook lines.
{avoid_line}Reply with ONLY a JSON array of {n} objects, each exactly:
{{"cat":"work|daily|social|opinion|story","kind":"vn|sit","text":"the prompt","sample":"a natural native answer, 1-2 sentences","chunk":"the single most reusable multi-word phrase from sample","note":"short coaching tip, max 20 words"}}"""


def valid(p):
    return (isinstance(p, dict) and set(p.keys()) == KEYS
            and p['cat'] in CATS and p['kind'] in ('vn', 'sit')
            and all(isinstance(p[k], str) and p[k].strip() for k in KEYS))


def main():
    if not KEY:
        sys.exit('Set GEMINI_KEY in the environment first.')
    data = json.load(open(PATH, encoding='utf-8'))
    seen = {norm(p['text']) for p in data}
    print(f'start: {len(data)} prompts; target {TARGET}')
    stale = 0
    while len(data) < TARGET and stale < 8:
        try:
            raw = gemini(make_prompt(BATCH, [p['text'] for p in data]))
            batch = json.loads(raw)
        except Exception as e:
            print('  batch failed:', e); time.sleep(2); stale += 1; continue
        added = 0
        for p in batch if isinstance(batch, list) else []:
            if valid(p) and norm(p['text']) not in seen:
                seen.add(norm(p['text']))
                data.append({k: p[k].strip() for k in
                             ['cat', 'kind', 'text', 'sample', 'chunk', 'note']})
                added += 1
                if len(data) >= TARGET:
                    break
        stale = 0 if added else stale + 1
        print(f'  +{added} -> {len(data)}')
        open(PATH, 'w', encoding='utf-8').write(
            json.dumps(data, indent=1, ensure_ascii=False) + '\n')
        time.sleep(1)  # be gentle on rate limits
    print(f'done: {len(data)} prompts written to {PATH}')


if __name__ == '__main__':
    main()
