# EV Trip Card

One Lovelace card for [Home-Assistant-EV-Scheduler](https://github.com/BarBaar44/Home-Assistant-EV-Scheduler): see the charging plan, book a trip, move or cancel it.

* **Status:** battery level and charging state, a bar with the plan's target and the car's charge limit, and what the plan asks in words ("Charge to 85% by tomorrow 07:15, for Delft · 120 km", "Ready for Delft", or the battery floor). The car's picture sits lower right.
* **Banner:** the planner's messages, with Dismiss.
* **Plan a trip:** search, pick a result, choose *Leave at* or *Arrive by*, set the time, Schedule. Search works from the phone keyboard and the button alike, because the card reads its own text field.
* **Upcoming trips:** Move or Cancel per trip, cancel confirmed inline. Hidden when there are none.

The card talks to the **EV trip planner contract** only: four sensors and seven services, described in [CONTRACT.md](CONTRACT.md). Two backends implement it: the EV Trip Planner integration (current) and the retired pyscript apps. Switching is one config line. The person who taps Schedule is the one the trip is booked for.

All times are shown and entered in Home Assistant's time zone, not the phone's.

## Install

HACS > three dots > Custom repositories > add `https://github.com/BarBaar44/ev-trip-card`, type **Dashboard**. Install, then reload the browser.

The backend is the EV Trip Planner integration from [Home-Assistant-EV-Scheduler](https://github.com/BarBaar44/Home-Assistant-EV-Scheduler). The default `backend` is still `pyscript` for older setups, so set `backend: integration`.

## Use

```yaml
type: custom:ev-trip-card
backend: integration
```

All options are optional:

| Option | Default |
|---|---|
| `title` | `Trips and charging` |
| `backend` | `pyscript` (or `integration`) |
| `soc_entity` | `sensor.calimero_battery_level` |
| `charge_limit_entity` | `number.calimero_charge_limit` |
| `charging_entity` | `sensor.calimero_charging` |
| `limit_raised_entity` | `input_boolean.evcc_car_limit_raised` |
| `plan_entity` | `sensor.ev_trip_planner_plan` |
| `trips_entity` | `sensor.ev_trip_planner_trips` |
| `search_entity` | `sensor.ev_trip_planner_search` |
| `status_entity` | `sensor.ev_trip_planner_status` |
| `image` | none: a plain car outline. Any URL, e.g. `/local/calimero.png` from `/config/www` |
| `show_arrive_by` | `true` |
| `show_status` | `true` |
| `show_manage` | `true` |

## Replaces the old UI dashboard

From pyscript contract version 1 (7 Oct 2026) the apps no longer use the old form helpers, so these can be deleted in HA: `input_text.manual_trip_location`, `input_boolean.manual_trip_one_way`, `input_datetime.manual_trip_datetime`, `input_select.manual_trip_destination`, `input_select.manual_trip_to_cancel`, the submit, move, cancel and search scripts, and the "search on Enter" automation. With the integration the three `next_trip_*` helpers can go too: the evcc automation reads `sensor.ev_trip_planner_plan` instead.

## Licence

MIT
