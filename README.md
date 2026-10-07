# EV Trip Card

One Lovelace card for [Home-Assistant-EV-Scheduler](https://github.com/BarBaar44/Home-Assistant-EV-Scheduler-): see the charging plan, book a trip, move or cancel it.

* **Status:** battery, car charge limit, and the plan published for the charger ("85% by Tue 07:15, needed for Delft (120 km)", or the battery floor).
* **Banner:** the planner's messages, with Dismiss.
* **Plan a trip:** search, pick a result, choose *Leave at* or *Arrive by*, set the time, Schedule. Search works from the phone keyboard and the button alike, because the card reads its own text field.
* **Upcoming trips:** Move or Cancel per trip, cancel confirmed inline. Hidden when there are none.

The card talks to the **EV trip planner contract** only: four sensors and seven services, described in [CONTRACT.md](CONTRACT.md). Two backends implement it: the pyscript apps (today) and a Home Assistant integration (planned). Switching is one config line. The person who taps Schedule is the one the trip is booked for.

All times are shown and entered in Home Assistant's time zone, not the phone's.

## Install

HACS > three dots > Custom repositories > add `https://github.com/BarBaar44/ev-trip-card`, type **Dashboard**. Install, then reload the browser.

The pyscript backend needs the `trip_scheduler` and `ev_trip_energy` apps that publish contract version 1 (they provide the `pyscript.ev_trip_*` services).

## Use

```yaml
type: custom:ev-trip-card
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
| `show_arrive_by` | `true` |
| `show_status` | `true` |
| `show_manage` | `true` |

## Replaces the old UI dashboard

From pyscript contract version 1 (7 Oct 2026) the apps no longer use the old form helpers, so these can be deleted in HA: `input_text.manual_trip_location`, `input_boolean.manual_trip_one_way`, `input_datetime.manual_trip_datetime`, `input_select.manual_trip_destination`, `input_select.manual_trip_to_cancel`, the submit, move, cancel and search scripts, and the "search on Enter" automation. Keep the `next_trip_*` helpers: the evcc automation reads them.

## Licence

MIT
