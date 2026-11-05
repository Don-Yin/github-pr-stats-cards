<div align="center">

# github-pr-stats-cards

Show the pull requests you got merged into other people's repositories.

[![Marketplace](https://img.shields.io/badge/Marketplace-GitHub%20PR%20Stats%20Cards-2ea44f?logo=github)](https://github.com/marketplace/actions/github-pr-stats-cards)
[![CI](https://github.com/Don-Yin/github-pr-stats-cards/actions/workflows/ci.yml/badge.svg)](https://github.com/Don-Yin/github-pr-stats-cards/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Don-Yin/github-pr-stats-cards)](https://github.com/Don-Yin/github-pr-stats-cards/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<img src="assets/hero.png" alt="The wide card in a desktop browser and the narrow card on a phone" width="100%">

<sub>[live on my profile](https://github.com/Don-Yin)</sub>

</div>

## Features

- **Other people's repositories only.** Private repositories and your own are skipped, so the card shows outside contributions.
- **Fits every screen.** A two-column card for desktop and a one-column card for phones, switched by `<picture>`.
- **Light and dark.** The card follows the reader's colour scheme.
- **Click a repository.** Optionally, each repository links to itself, still from one SVG download.
- **Self-contained SVGs.** Avatars are embedded, so the cards load with no extra requests.
- **Runs in your own workflow.** No hosted service and no shared rate limit; the default workflow token is enough.

## Reading the card

<img src="assets/anatomy.png" alt="One card with callouts for the owner avatar, owner and repository name, repository stars and merged pull requests" width="640">

Repositories are sorted by your merged pull requests, then by stars. Star colour runs from grey to gold on a log scale across the repositories on your card.

## Usage

`.github/workflows/pr-stats-cards.yml` in your profile repository:

```yaml
name: PR stats cards
on:
  workflow_dispatch:
  schedule:
    - cron: "17 3 * * *"
permissions:
  contents: write
jobs:
  cards:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: Don-Yin/github-pr-stats-cards@v1
        with:
          user: ${{ github.repository_owner }}
      - run: |
          git add pr-stats-*.svg
          git diff --cached --quiet && exit 0
          git -c user.name="$GITHUB_ACTOR" -c user.email="$GITHUB_ACTOR@users.noreply.github.com" commit -m "Update PR stats cards"
          git push
```

Then in your README:

```html
<picture>
  <source media="(max-width: 600px)" srcset="pr-stats-narrow.svg">
  <img src="pr-stats-wide.svg" alt="Merged Contributions">
</picture>
```

To make the desktop card smaller, give the `<img>` a pixel width, such as `width="400"`. A percentage width also shrinks the phone card, which then no longer fills the screen.

### Clickable repositories

GitHub drops image maps, so one image can only have one link. To link every repository, put these markers in your README where the cards go:

```html
<!-- pr-stats:start -->
<!-- pr-stats:end -->
```

and let the action fill them in:

```yaml
      - uses: Don-Yin/github-pr-stats-cards@v1
        with:
          user: ${{ github.repository_owner }}
          readme: README.md
          dir: metrics
      - run: |
          git add README.md metrics/pr-stats-*.svg
          # then commit and push as above
```

The action writes one image link per repository, two per row on desktop and one on phones. Every link shows its own region of the same SVG through a `#view` fragment, so the browser downloads one file per layout.

| Input | Default | |
| --- | --- | --- |
| `user` | required | GitHub username |
| `token` | `github.token` | Public read access is enough |
| `limit` | `0` | Show only the top N repositories; `0` shows every repository |
| `readme` | | README to rewrite between the markers, one link per repository; empty keeps the single card |
| `dir` | `.` | Folder for the SVG files |

| Output | |
| --- | --- |
| `wide` | Path to the wide SVG |
| `narrow` | Path to the narrow SVG |

Run locally: `INPUT_USER=you INPUT_TOKEN="$(gh auth token)" node index.mjs`

Regenerate the README images: `INPUT_USER=you INPUT_TOKEN="$(gh auth token)" node scripts/make-assets.mjs` (needs `rsvg-convert`)
