# EV Trip Card (moved)

**This card now ships inside the EV Trip Planner integration:
[Home-Assistant-EV-Scheduler](https://github.com/BarBaar44/Home-Assistant-EV-Scheduler).**
This repository is retired and gets no further updates.

Since integration **0.3.0** the integration serves the card itself and loads
it on every page, with the integration's version. A card that only works
with one integration belongs in that integration's repository, and a
Marketplace (or HACS) repository holds one item of one type. Install the
integration and the card comes with it; there is no Lovelace resource to
add.

[![Open your Home Assistant instance and open a repository inside the Marketplace.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=BarBaar44&repository=Home-Assistant-EV-Scheduler&category=integration)

## Moving over

1. Update EV Trip Planner to 0.3.0 or later (Settings > Marketplace, or
   HACS before Home Assistant 2026.11) and restart.
2. Remove this card's dashboard install (Settings > Marketplace >
   Installed, or HACS) and its Lovelace resource
   `/hacsfiles/ev-trip-card/ev-trip-card.js`.
3. Reload the browser. Your dashboards keep `type: custom:ev-trip-card`
   and every option unchanged. The one new default: `limit_raised_entity`
   is now `binary_sensor.ev_trip_planner_limit_raised`.

If both copies are loaded, whichever loads first wins and the browser
console says so.

The card's options, the contract it talks to and its history are in the
[integration's README](https://github.com/BarBaar44/Home-Assistant-EV-Scheduler#4-dashboard-card)
and [CONTRACT.md](https://github.com/BarBaar44/Home-Assistant-EV-Scheduler/blob/main/CONTRACT.md).

## Licence

MIT
