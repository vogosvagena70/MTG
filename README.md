# MTG Practice Draft

A web app for practicing Magic: The Gathering booster drafts against bots, then building a 40-card deck from your pool.

## Requirements

- Node 18 or newer

## Getting started

```
npm install
npm run dev
```

Open http://localhost:5173 (not 3001: the server only provides the Socket.IO API and has no web page).

## Scripts

- `npm test` runs the server and client test suites.
- `npm run typecheck` type-checks all workspaces.

## Card data

Card data comes from Scryfall and is cached in `server/.cache/<set>.json`. Delete a file to refresh that set. Brand-new sets that Scryfall has not yet tagged as booster cards use a broader paper-cards query.

## Status

Practice decks are not used for battles yet.
