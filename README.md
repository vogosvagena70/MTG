# MTG Practice Draft

A web app for Magic: The Gathering booster drafts, then building a 40-card deck from your pool. Draft with friends in rooms (share a room code, bots fill any empty seats, optional pick timer), or practice on your own against bots.

## Requirements

- Node 18 or newer

## Getting started

```
npm install
npm run dev
```

Open http://localhost:5173 (not 3001: the server only provides the Socket.IO API and has no web page).

To try multiplayer locally, open http://localhost:5173 in two browser windows: create a room in one and join with its code in the other.

## Scripts

- `npm test` runs the server and client test suites.
- `npm run typecheck` type-checks all workspaces.

## Deploy to Render (free)

1. Create an empty GitHub repository and push this project to it:
   `git remote add origin https://github.com/<you>/<repo>.git` then `git push -u origin master`.
2. On https://render.com, sign in with GitHub, choose **New → Blueprint**, and pick the repository.
   Render reads `render.yaml` and creates a free web service called `mtg-draft`.
3. Wait for the first build to finish (a few minutes), then open the `https://mtg-draft-….onrender.com` URL.
   Share that URL with friends; room invite links use it automatically.

Things to know about the free plan (check Render's current terms, they change):
- The service sleeps after about 15 minutes without visitors. The next visit takes about a minute to wake it.
- Rooms live in memory: a restart or redeploy ends any draft in progress.
- The Scryfall card cache is on temporary disk, so after a restart the first draft of each set re-downloads it.

To check a production build locally: `npm run build`, then `NODE_ENV=production PORT=4100 npm start`
(in Git Bash), and open http://localhost:4100.

## Card data

Card data comes from Scryfall and is cached in `server/.cache/<set>.json`. Delete a file to refresh that set. Brand-new sets that Scryfall has not yet tagged as booster cards use a broader paper-cards query.

## Battles

After a multiplayer draft, build and save your deck, then challenge another player who has saved theirs from the room panel on the deckbuilder screen. The challenged player has 60 seconds to accept.

The table is a free-play tabletop: players enforce the rules themselves.

- Drag cards between your hand, battlefield and graveyard; drop on the battlefield to place a card where you want it.
- Double-click a battlefield card, or hover it and press `T`, to tap or untap it.
- Right-click any of your cards for a menu (To hand, To battlefield, To graveyard, To top of library).
- Click your library to view it; right-click it to draw or shuffle. Use the strip for life, Untap all, Mechanics and Concede.
- Click a graveyard pile to browse it; the log panel shows recent actions.
- After a game ends, choose Back to room and challenge again for a rematch.

## Status

Practice decks are not used for battles yet.
