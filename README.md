# BTI Speed-to-Lead — Desktop App

Download the latest Windows installer:

**[⬇ Download BTI Speed-to-Lead](https://github.com/jathtech/bti-crm-releases/releases/latest/download/BTI-Speed-to-Lead-Setup.exe)**

Run the installer, choose **Connect to an existing system**, and enter the web app URL and admin key you were given.

The app's interface updates automatically from the BTI backend — you only need this installer once per computer.

---

## Behavioral Style Snapshot

A mobile-friendly, forced-ranking (ipsative) DISC-style self-assessment: 10 screens of four words each, ranked 4 → 1 by drag or tap, scored into four dimensions (D, I, S, C) that always total 100.

- App: [`style-snapshot/index.html`](style-snapshot/index.html) — a single self-contained page, no build step or backend.
- **Live now, no sign-in:** <https://raw.githack.com/jathtech/bti-crm-releases/ccr-0b129759-cj3skq/style-snapshot/index.html> (a CDN mirror of this repo's file). The QR in [`style-snapshot/qr/qr-live.png`](style-snapshot/qr/qr-live.png) points at a pinned copy of the same file.
- **GitHub Pages (permanent address):** enable it once under *Settings → Pages → Build and deployment → Source: GitHub Actions*. The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) then deploys on every push to `main` or this branch, and the app is served at <https://jathtech.github.io/bti-crm-releases/style-snapshot/> (QR: [`style-snapshot/qr/qr-github-pages.png`](style-snapshot/qr/qr-github-pages.png)).
- Claude artifact copy (viewers need a Claude login): <https://claude.ai/artifact/KuwfSYrKBGfCD6btFoi5oj> (QR: [`style-snapshot/qr/qr-claude-artifact.png`](style-snapshot/qr/qr-claude-artifact.png)).

The page's Share panel shows a QR code for whatever address it is being viewed at.
