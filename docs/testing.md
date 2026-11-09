# Local testing with two tabs

1. Run `npm run dev` at the root (starts the API on `:3000` and Vite on `:5173`).
2. Open `http://localhost:5173` in two tabs.
3. Each tab has its own **name and GM/Player view** (stored in `sessionStorage`). The last used value becomes the default for new tabs.
   - Tab 1: change the view to **GM** in Combat/Map.
   - Tab 2: change to **Player** and change the name in the header field.
4. What to check across tabs:
   - Sheets created/edited, Hope, HP and Stress appear in the other tab.
   - Fear, spotlight, countdowns, quick PCs, adversaries and damage sync in Combat.
   - Scenes, tokens (including drag), fog and pings sync on the Map.
   - Rolls appear in the shared log; Duality with Fear automatically adds 1 Fear to the GM.
   - Dropping the network/server shows `offline`; when it returns, sockets reconnect and queued messages are sent.

## Automated checks

```bash
npm run typecheck
npm run test        # data rules (duality, notation, critical, max dice)
npm run build
```

Two-tab flows, synchronization, offline/reconnection and automatic Fear were validated with Playwright + Chrome during development. Queued messages (rolls and documents) are sent when sockets return.
