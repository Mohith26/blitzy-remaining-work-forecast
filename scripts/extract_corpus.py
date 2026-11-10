"""Extract the remaining-work tables from public Blitzy Project Guides.

Input: a directory of Project Guide markdown files downloaded from public GitHub
repos (github.com/Blitzy-Sandbox and github.com/blitzy-public-samples), named
"<owner>_<repo>__<branch>.md" (see scripts/fetch_guides.sh).
Output: data/guides.json with, per guide: source URL, title, completed and
remaining hours from section 1.2, and every row of "Remaining Work Detail".
Exact-duplicate guides (same file content on several branches) are dropped.
Stdlib only.
"""
import hashlib, json, os, re, sys

def parse(text):
    def num(pat):
        m = re.search(pat, text, re.I)
        return float(m.group(1)) if m else None
    completed = num(r'Completed Hours[^|\n]*\|\s*\**\s*([\d.]+)')
    remaining = num(r'\*?\*?Remaining Hours\*?\*?\s*\|\s*\**\s*([\d.]+)')
    tasks = []
    m = re.search(r'#+\s*[\d.]*\s*Remaining Work Detail(.*?)(\n#+ )', text, re.S | re.I)
    if m:
        for line in m.group(1).split('\n'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if len(cells) < 3 or set(cells[0]) <= set('-: '):
                continue
            if cells[0].lower().strip('* ') in ('category', 'task', 'item', 'component'):
                continue
            hours = priority = None
            for c in cells[1:]:
                c2 = c.replace('*', '').strip()
                if hours is None and re.fullmatch(r'\d+(\.\d+)?', c2):
                    hours = float(c2)
                if c2.lower() in ('critical', 'high', 'medium', 'low'):
                    priority = c2.lower()
            name = re.sub(r'\s+', ' ', cells[0].replace('**', '')).strip()
            if hours is not None and hours > 0 and 'total' not in name.lower():
                tasks.append({'task': name[:160], 'hours': hours, 'priority': priority or 'medium'})
    overview = ''
    m = re.search(r'#+\s*1\.1\s*Project Overview\s*\n+(.+?)\n\s*\n', text, re.S)
    if m:
        overview = re.sub(r'\s+', ' ', m.group(1)).strip()[:900]
    title = ''
    for line in text.split('\n')[:40]:
        if line.startswith('# ') and 'executive summary' not in line.lower():
            title = line[2:].strip()
            break
    return completed, remaining, tasks, title, overview

def main(src, out):
    seen, guides = set(), []
    for f in sorted(os.listdir(src)):
        if not f.endswith('.md'):
            continue
        text = open(os.path.join(src, f), errors='ignore').read()
        h = hashlib.md5(text.encode()).hexdigest()
        if h in seen:
            continue
        seen.add(h)
        completed, remaining, tasks, title, overview = parse(text)
        if not tasks or completed is None:
            continue
        owner, rest = f[:-3].split('_', 1)
        repo, branch = rest.split('__', 1)
        guides.append({
            'id': hashlib.md5(f.encode()).hexdigest()[:10],
            'source': f'https://github.com/{owner}/{repo}/tree/{branch}',
            'repo': f'{owner}/{repo}', 'title': title, 'completed_hours': completed,
            'remaining_hours': remaining, 'overview': overview, 'tasks': tasks})
    json.dump({'note': 'Remaining-work tables parsed from public Blitzy Project Guides. Estimates and task names are real; nothing else is inferred.',
               'guides': guides}, open(out, 'w'), indent=0)
    print(len(guides), 'guides,', sum(len(g['tasks']) for g in guides), 'tasks')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'guides', sys.argv[2] if len(sys.argv) > 2 else 'data/guides.json')
