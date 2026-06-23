# PressureSense 🌤️

A simple, accessible app that tracks **barometric pressure and weather** to help
people with **vestibular issues, vertigo, and migraine** understand how the
weather affects how they feel — and prepare ahead of pressure swings.

It runs in any browser, works on **phone, tablet, and desktop**, and can be
**installed to a home screen** like a native app (it's a Progressive Web App).

## What it does

- **Now** — current barometric pressure with a trend arrow, plus how much it's
  changed over the last 3 / 6 / 24 hours. Rapid changes (especially falling
  pressure) are the usual trigger, so those are front and center.
- **Forecast** — the next 48 hours of pressure, with a heads-up banner when a
  notable drop or rise is coming so you can rest or medicate ahead of time.
- **Log** — record how you feel (severity + symptoms + notes). Each entry is
  stamped with the pressure at that moment.
- **Trends** — your logged symptoms plotted against pressure, plus a plain-language
  summary of your personal patterns. Export everything to CSV to share with a clinician.

Your health log stays **on your own device** (browser localStorage) — nothing is
uploaded to any server.

> ⚕️ PressureSense is a wellness and self-tracking tool, **not a medical device**
> and not a substitute for professional medical advice.

## Tech

- Plain HTML/CSS/JavaScript — **no build step, no dependencies, no backend**.
- Weather data from [Open-Meteo](https://open-meteo.com) (free, no API key),
  fetched directly in the browser.
- Installable + offline-capable via a web manifest and service worker.

## Run it locally

Because it uses a service worker, serve it over HTTP (not `file://`):

```bash
# from the project folder, pick any one:
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

## Put it online (free) — so she can use it from any device

This repo includes a GitHub Actions workflow that publishes to **GitHub Pages**:

1. Push to the `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment** and set
   **Source: GitHub Actions** (one-time).
3. The site goes live at `https://<your-username>.github.io/Barometric-Pressure/`.

Open that URL on a phone and use the browser's **"Add to Home Screen"** to install it.

## Icons

App icons are generated with `node scripts/make-icons.js` (no dependencies).
Re-run it if you change the design.

## Roadmap toward the app stores

- Wrap the PWA with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
  (Android / Play Store) or [Capacitor](https://capacitorjs.com) (iOS + Android).
- Push notifications for incoming pressure swings.
- Note on monetization: Open-Meteo's free tier is for non-commercial use. Before
  running ads, move to their commercial plan or another paid weather provider.
