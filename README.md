# Reap Capital Dashboard

Static portfolio dashboard for GitHub Pages. The site reads directly from Supabase using `@supabase/supabase-js` and a read-only anon key.

## Pages

- **Main Dashboard**: global portfolio value, cash/invested split, Sharpe/Beta, combined holdings, latest trade.
- **Analytics & Graphs**: last 30 days of portfolio equity and daily metrics for all strategies. Strategy toggles use already-fetched data and do not issue new API calls.
- **Ledger & Holdings**: raw current positions and paginated trades with a strategy filter.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Required environment values:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-read-only-anon-key
```

For GitHub Pages, add those as build-time variables or repository/environment secrets exposed to the Pages build.

The app also supports a runtime `config.json` at the site root:

```json
{
  "supabaseUrl": "https://your-project-ref.supabase.co",
  "supabaseAnonKey": "your-read-only-anon-key"
}
```

Supabase RLS should allow read-only `select` access for:

- `assets`
- `strategies`
- `trades`
- `current_positions`
- `portfolio_equity`
- `daily_metrics`

## Build

```bash
npm run build
```

The static artifact is emitted to `dist/`.
