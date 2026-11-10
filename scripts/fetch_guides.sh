#!/bin/sh
# Download public Blitzy Project Guides (requires the GitHub CLI for listing).
# Sources: every repo in github.com/Blitzy-Sandbox and github.com/blitzy-public-samples,
# on the default branch and every blitzy-* branch. Output: guides/<owner>_<repo>__<branch>.md
set -e
mkdir -p guides
{ gh api --paginate "orgs/Blitzy-Sandbox/repos?per_page=100" --jq '.[] | "\(.full_name) \(.default_branch)"'
  gh api --paginate "users/blitzy-public-samples/repos?per_page=100" --jq '.[] | "\(.full_name) \(.default_branch)"'; } > guides/targets.txt
awk '{print $1}' guides/targets.txt | while read r; do
  gh api "repos/$r/branches?per_page=100" --jq '.[].name' | grep '^blitzy-' | sed "s#^#$r #" || true
done >> guides/targets.txt
sort -u guides/targets.txt | while read r b; do
  out="guides/$(echo "${r}__${b}" | tr '/' '_').md"
  for p in "blitzy/documentation/Project%20Guide.md" "docs/project-guide.md" "blitzy-docs/project-guide.md"; do
    if curl -sf -o "$out" "https://raw.githubusercontent.com/$r/$b/$p"; then break; fi
    rm -f "$out"
  done
done
python3 scripts/extract_corpus.py guides data/guides.json
