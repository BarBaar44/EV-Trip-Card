# EV Trip Card

One Lovelace card for [Home-Assistant-EV-Scheduler](https://github.com/BarBaar44/Home-Assistant-EV-Scheduler-): see the charging plan, book a trip, move or cancel it.

* **Status:** battery, car charge limit, and the plan published to evcc ("85% by Tue 07:15").
* **Banner:** messages from `sensor.tesla_trip_form_status`, with Dismiss.
* **Plan a trip:** search, pick a result, set the time, Schedule. The Search button works on phones too, because the card reads the text from its own field instead of an `input_text` helper.
* **Upcoming trips:** Move or Cancel per trip. Hidden when there are none.

The card calls the pyscript services directly (`search_destination`, `schedule_manual_trip`, `reschedule_manual_trip`, `cancel_manual_trip`, `clear_trip_destination`, `clear_trip_form_status`, `set_trip_form_status`). The person who taps Schedule is the organizer, same as the dashboard script.

## Install

HACS > three dots > Custom repositories > add `https://github.com/BarBaar44/ev-trip-card`, type **Dashboard**. Install, then reload the browser.

## Use

```yaml
type: custom:ev-trip-card
```

All options are optional:

| Option | Default |
|---|---|
| `title` | `Trips and charging` |
| `soc_entity` | `sensor.calimero_battery_level` |
| `charge_limit_entity` | `number.calimero_charge_limit` |
| `charging_entity` | `sensor.calimero_charging` |
| `required_soc_entity` | `input_number.next_trip_required_soc` |
| `deadline_entity` | `input_datetime.next_trip_deadline` |
| `limit_raised_entity` | `input_boolean.evcc_car_limit_raised` |
| `status_entity` | `sensor.tesla_trip_form_status` |
| `results_entity` | `sensor.manual_trip_destination_results` |
| `trips_entity` | `sensor.manual_trip_options` |
| `show_arrive_by` | `false` (turn on once the backend has `arrive_by`) |
| `show_status` | `true` |
| `show_manage` | `true` |

## Not needed with this card

`input_text.manual_trip_location`, the "search on Enter" automation, `input_datetime.manual_trip_datetime`, `input_select.manual_trip_destination` display and the submit, cancel and reschedule scripts. The pyscript apps still write some of these helpers, so leave them in place.

## Licence

MIT
