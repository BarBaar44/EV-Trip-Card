/*
 * EV Trip Card
 * One Lovelace card for the Home-Assistant-EV-Scheduler pyscript apps:
 * charging status, form banner, destination search, schedule, move, cancel.
 *
 * The card keeps the typed text, the picked destination and the date in
 * its own DOM and passes them straight to the pyscript services. Nothing
 * goes through input_text / input_select / input_datetime helpers, so the
 * phone problem where a dashboard button never receives freshly typed text
 * does not apply here.
 *
 * https://github.com/BarBaar44/ev-trip-card  (MIT)
 */

const VERSION = "0.1.1";

const DEFAULTS = {
  title: "Trips and charging",
  soc_entity: "sensor.calimero_battery_level",
  charge_limit_entity: "number.calimero_charge_limit",
  charging_entity: "sensor.calimero_charging",
  required_soc_entity: "input_number.next_trip_required_soc",
  deadline_entity: "input_datetime.next_trip_deadline",
  limit_raised_entity: "input_boolean.evcc_car_limit_raised",
  status_entity: "sensor.tesla_trip_form_status",
  results_entity: "sensor.manual_trip_destination_results",
  trips_entity: "sensor.manual_trip_options",
  // Off until the deployed pyscript accepts arrive_by. Leave-at trips never
  // send the parameter, so they work on the older backend either way.
  show_arrive_by: false,
  show_status: true,
  show_manage: true,
};

const STATUS_LEVELS = ["info", "success", "warning", "error"];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// datetime-local wants "YYYY-MM-DDTHH:MM" in local wall time.
function toLocalInput(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function nextWholeHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

// pyscript's _parse_local treats a naive string as local wall time.
function toServiceDatetime(inputValue) {
  return `${inputValue}:00`;
}

function hasValue(stateObj) {
  return stateObj && !["unknown", "unavailable", ""].includes(stateObj.state);
}

class EvTripCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._selected = null; // destination label picked in this card
    this._resultsKey = null; // JSON of the last rendered results mapping
    this._tripsKey = null;
    this._moving = null; // trip label whose Move row is open
    this._busy = false;
    this._awaitReset = false; // set after a schedule call, cleared on reset
    this._arriveBy = false;
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...(config || {}) };
    if (this._built) {
      this._built = false;
      this._resultsKey = null;
      this._tripsKey = null;
      this._build();
      if (this._hass) this._update();
    }
  }

  getCardSize() {
    return 8;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this._update();
  }

  // ------------------------------------------------------------------
  // Static skeleton, built once so inputs keep focus and typed text
  // ------------------------------------------------------------------
  _build() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="header">${esc(c.title)}</div>

        <div class="section status" id="status" ${c.show_status ? "" : "hidden"}></div>

        <div class="banner" id="banner" hidden>
          <span class="banner-text" id="banner-text"></span>
          <button class="link" id="dismiss" type="button">Dismiss</button>
        </div>

        <div class="section">
          <div class="label">Plan a trip</div>
          <form id="search-form" class="row" autocomplete="off">
            <input id="query" type="search" enterkeyhint="search"
                   placeholder="Address, place or business with town" />
            <button id="search-btn" type="submit">Search</button>
          </form>

          <div id="results" class="results" hidden></div>

          <div id="details" hidden>
            <div class="seg" id="mode" ${c.show_arrive_by ? "" : "hidden"}>
              <button type="button" data-mode="leave" class="on">Leave at</button>
              <button type="button" data-mode="arrive">Arrive by</button>
            </div>
            <div class="row">
              <input id="when" type="datetime-local" />
            </div>
            <label class="check">
              <input id="oneway" type="checkbox" /> One way
            </label>
            <div class="row end">
              <button class="link" id="clear" type="button">Clear</button>
              <button class="primary" id="schedule" type="button">Schedule trip</button>
            </div>
          </div>
        </div>

        <div class="section" id="manage" hidden>
          <div class="label">Upcoming trips</div>
          <div id="trips"></div>
        </div>
      </ha-card>
    `;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      status: $("status"),
      banner: $("banner"),
      bannerText: $("banner-text"),
      query: $("query"),
      results: $("results"),
      details: $("details"),
      mode: $("mode"),
      when: $("when"),
      oneway: $("oneway"),
      schedule: $("schedule"),
      manage: $("manage"),
      trips: $("trips"),
    };
    this._el.when.value = toLocalInput(nextWholeHour());

    $("search-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      this._search();
    });
    $("dismiss").addEventListener("click", () =>
      this._call("clear_trip_form_status", {})
    );
    $("clear").addEventListener("click", () => this._clear());
    this._el.schedule.addEventListener("click", () => this._schedule());

    this._el.results.addEventListener("change", (ev) => {
      if (ev.target.name === "dest") this._selected = ev.target.value;
    });

    this._el.mode.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-mode]");
      if (!btn) return;
      this._arriveBy = btn.dataset.mode === "arrive";
      this._el.mode
        .querySelectorAll("button")
        .forEach((b) => b.classList.toggle("on", b === btn));
    });

    this._el.trips.addEventListener("click", (ev) => this._tripAction(ev));

    this._built = true;
  }

  // ------------------------------------------------------------------
  // Per-update rendering of the dynamic parts only
  // ------------------------------------------------------------------
  _update() {
    const c = this._config;
    const s = this._hass.states;

    if (c.show_status) this._renderStatus(s);
    this._renderBanner(s[c.status_entity]);
    this._renderResults(s[c.results_entity]);
    if (c.show_manage) this._renderTrips(s[c.trips_entity]);
  }

  _renderStatus(s) {
    const c = this._config;
    const soc = s[c.soc_entity];
    const limit = s[c.charge_limit_entity];
    const charging = s[c.charging_entity];
    const req = s[c.required_soc_entity];
    const deadline = s[c.deadline_entity];
    const raised = s[c.limit_raised_entity];

    const socText = hasValue(soc) ? `${Math.round(Number(soc.state))}%` : "?";
    const limitText = hasValue(limit) ? `${Math.round(Number(limit.state))}%` : "?";
    const chargingText = hasValue(charging) ? charging.state : "";

    let plan = "No trips planned";
    let planClass = "muted";
    if (hasValue(req) && hasValue(deadline)) {
      const reqSoc = Number(req.state);
      const ts = deadline.attributes.timestamp;
      const when = ts ? new Date(ts * 1000) : null;
      const idle =
        !(reqSoc > 0) || !when || when.getFullYear() >= 2098;
      if (!idle) {
        plan = `${Math.ceil(reqSoc)}% by ${this._fmtDate(when)}`;
        planClass = "";
      }
    }

    const raisedBadge =
      raised && raised.state === "on"
        ? `<span class="badge">limit raised for trip</span>`
        : "";

    this._el.status.innerHTML = `
      <div class="stat">
        <div class="stat-value">${esc(socText)}</div>
        <div class="stat-label">battery${chargingText ? ` · ${esc(chargingText)}` : ""}</div>
      </div>
      <div class="stat">
        <div class="stat-value">${esc(limitText)}</div>
        <div class="stat-label">charge limit ${raisedBadge}</div>
      </div>
      <div class="stat wide">
        <div class="stat-value ${planClass}">${esc(plan)}</div>
        <div class="stat-label">needed for next trip</div>
      </div>
    `;
  }

  _renderBanner(stateObj) {
    const level = stateObj ? stateObj.state : "ok";
    const show = STATUS_LEVELS.includes(level);
    this._el.banner.hidden = !show;
    if (!show) return;
    this._el.banner.className = `banner ${level}`;
    this._el.bannerText.textContent = stateObj.attributes.message || "";
  }

  _renderResults(stateObj) {
    const mapping = (stateObj && stateObj.attributes.mapping) || {};
    const labels = Object.keys(mapping);
    const key = JSON.stringify(labels);

    // pyscript resets the results after a trip is accepted. That is the
    // signal to clear this card's own fields too.
    if (this._awaitReset && labels.length === 0) {
      this._awaitReset = false;
      this._resetForm();
    }

    if (key === this._resultsKey) return;
    this._resultsKey = key;

    if (!labels.includes(this._selected)) this._selected = labels[0] || null;

    this._el.results.hidden = labels.length === 0;
    this._el.details.hidden = labels.length === 0;
    this._el.results.innerHTML = labels
      .map(
        (label) => `
        <label class="result">
          <input type="radio" name="dest" value="${esc(label)}"
                 ${label === this._selected ? "checked" : ""} />
          <span>${esc(label)}</span>
        </label>`
      )
      .join("");
  }

  _renderTrips(stateObj) {
    const mapping = (stateObj && stateObj.attributes.mapping) || {};
    const labels = Object.keys(mapping);
    const key = JSON.stringify(labels) + "|" + (this._moving || "");
    if (key === this._tripsKey) return;
    this._tripsKey = key;

    if (this._moving && !labels.includes(this._moving)) this._moving = null;

    this._el.manage.hidden = labels.length === 0;
    this._el.trips.innerHTML = labels
      .map((label) => {
        const { when, place } = this._splitTripLabel(label);
        const moving = label === this._moving;
        const defaultMove = when ? toLocalInput(when) : toLocalInput(nextWholeHour());
        return `
        <div class="trip" data-label="${esc(label)}">
          <div class="trip-main">
            <div class="trip-place">${esc(place)}</div>
            <div class="trip-when">${esc(when ? this._fmtDate(when) : "")}</div>
          </div>
          <div class="trip-actions">
            <button class="link" data-act="move" type="button">${moving ? "Close" : "Move"}</button>
            <button class="link danger" data-act="cancel" type="button">Cancel</button>
          </div>
          ${
            moving
              ? `<div class="row move">
                   <input type="datetime-local" class="move-when" value="${defaultMove}" />
                   <button class="primary" data-act="move-save" type="button">Save</button>
                 </div>`
              : ""
          }
        </div>`;
      })
      .join("");
  }

  // pyscript label: "YYYY-MM-DD HH:MM — Location"
  _splitTripLabel(label) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) — (.*)$/.exec(label);
    if (!m) return { when: null, place: label };
    const when = new Date(`${m[1]}T${m[2]}:00`);
    return { when: isNaN(when) ? null : when, place: m[3] };
  }

  _fmtDate(date) {
    const lang = (this._hass && this._hass.locale && this._hass.locale.language) || undefined;
    try {
      return date.toLocaleString(lang, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return date.toString();
    }
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  async _call(service, data) {
    try {
      await this._hass.callService("pyscript", service, data);
      return true;
    } catch (err) {
      this._localBanner("error", `${service} failed: ${err.message || err}`);
      return false;
    }
  }

  // For mistakes caught in the card itself. Goes to the same banner the
  // backend uses, with source "form" so housekeeping won't auto clear it.
  _localBanner(level, message) {
    this._hass
      .callService("pyscript", "set_trip_form_status", {
        level,
        message,
        source: "form",
      })
      .catch(() => {
        this._el.banner.hidden = false;
        this._el.banner.className = `banner ${level}`;
        this._el.bannerText.textContent = message;
      });
  }

  _setBusy(busy) {
    this._busy = busy;
    this.shadowRoot
      .querySelectorAll("button.primary, #search-btn")
      .forEach((b) => (b.disabled = busy));
  }

  async _search() {
    if (this._busy) return;
    const query = this._el.query.value.trim();
    if (query.length < 3) {
      this._localBanner("warning", "Type at least three characters, then search.");
      return;
    }
    this._el.query.blur(); // closes the phone keyboard
    this._selected = null;
    this._resultsKey = null;
    this._setBusy(true);
    await this._call("search_destination", { query });
    this._setBusy(false);
  }

  async _schedule() {
    if (this._busy) return;
    const c = this._config;
    const mapping =
      (this._hass.states[c.results_entity] || { attributes: {} }).attributes.mapping || {};
    const entry = mapping[this._selected];
    if (!entry || !entry.geo) {
      this._localBanner("warning", "Search for a destination and pick one from the list first.");
      return;
    }
    const whenValue = this._el.when.value;
    if (!whenValue || new Date(whenValue) <= new Date()) {
      this._localBanner("warning", "Pick a date and time in the future.");
      return;
    }

    const data = {
      trip_datetime: toServiceDatetime(whenValue),
      location: entry.display,
      display_name: entry.short,
      geo: entry.geo,
      one_way: this._el.oneway.checked,
      organizer_name: this._hass.user.id,
    };
    // Only sent when used, so leave-at trips work on a backend that does
    // not know the parameter yet.
    if (c.show_arrive_by && this._arriveBy) data.arrive_by = true;

    this._setBusy(true);
    this._awaitReset = true;
    const ok = await this._call("schedule_manual_trip", data);
    this._setBusy(false);
    if (!ok) this._awaitReset = false;
    // Rejected trips leave the results in place, so the form stays filled
    // for a correction. Accepted ones reset the results, which clears the
    // form via _renderResults. Give up waiting after a while.
    setTimeout(() => (this._awaitReset = false), 30000);
  }

  async _clear() {
    this._resetForm();
    await this._call("clear_trip_destination", {});
  }

  _resetForm() {
    this._el.query.value = "";
    this._el.when.value = toLocalInput(nextWholeHour());
    this._el.oneway.checked = false;
    this._selected = null;
  }

  async _tripAction(ev) {
    const btn = ev.target.closest("button[data-act]");
    if (!btn || this._busy) return;
    const row = btn.closest(".trip");
    const label = row.dataset.label;
    const act = btn.dataset.act;

    if (act === "move") {
      this._moving = this._moving === label ? null : label;
      this._tripsKey = null;
      this._renderTrips(this._hass.states[this._config.trips_entity]);
      return;
    }

    if (act === "cancel") {
      const { place } = this._splitTripLabel(label);
      if (!confirm(`Cancel the trip to ${place}? The invite is withdrawn by email.`)) return;
      this._setBusy(true);
      await this._call("cancel_manual_trip", { selection: label });
      this._setBusy(false);
      return;
    }

    if (act === "move-save") {
      const value = row.querySelector(".move-when").value;
      if (!value || new Date(value) <= new Date()) {
        this._localBanner("warning", "Pick a new date and time in the future.");
        return;
      }
      this._setBusy(true);
      const ok = await this._call("reschedule_manual_trip", {
        selection: label,
        new_datetime: toServiceDatetime(value),
      });
      this._setBusy(false);
      if (ok) {
        this._moving = null;
        this._tripsKey = null;
        this._renderTrips(this._hass.states[this._config.trips_entity]);
      }
    }
  }
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 16px; }
  [hidden] { display: none !important; }
  .header {
    font-size: 1.25rem; font-weight: 500; margin-bottom: 12px;
    color: var(--primary-text-color);
  }
  .section { margin-top: 16px; }
  .section:first-of-type { margin-top: 0; }
  .label {
    font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--secondary-text-color); margin-bottom: 8px;
  }
  .status { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .stat.wide { grid-column: 1 / -1; }
  .stat-value { font-size: 1.3rem; font-weight: 500; color: var(--primary-text-color); }
  .stat-value.muted { color: var(--secondary-text-color); font-weight: 400; font-size: 1rem; }
  .stat-label { font-size: 0.85rem; color: var(--secondary-text-color); }
  .badge {
    display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 8px;
    font-size: 0.75rem; background: var(--warning-color, #ff9800); color: #fff;
  }

  .banner {
    display: flex; align-items: center; gap: 8px; margin-top: 16px;
    padding: 10px 12px; border-radius: 8px; font-size: 0.95rem;
    border-left: 4px solid var(--banner-color);
    background: color-mix(in srgb, var(--banner-color) 12%, transparent);
    color: var(--primary-text-color);
  }
  .banner-text { flex: 1; }
  .banner.info { --banner-color: var(--info-color, #039be5); }
  .banner.success { --banner-color: var(--success-color, #43a047); }
  .banner.warning { --banner-color: var(--warning-color, #ffa600); }
  .banner.error { --banner-color: var(--error-color, #db4437); }

  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .row.end { justify-content: flex-end; }
  input[type="search"], input[type="datetime-local"] {
    flex: 1; min-width: 0; box-sizing: border-box; padding: 10px 12px;
    font: inherit; font-size: 16px; /* 16px stops iOS zooming in */
    color: var(--primary-text-color);
    background: var(--input-fill-color, var(--secondary-background-color));
    border: 1px solid var(--divider-color); border-radius: 8px;
  }
  input:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; }
  #search-form { margin-top: 0; }

  button {
    font: inherit; cursor: pointer; border-radius: 8px; padding: 10px 14px;
    border: 1px solid var(--divider-color);
    background: var(--secondary-background-color); color: var(--primary-text-color);
  }
  button:disabled { opacity: 0.5; cursor: default; }
  button.primary {
    background: var(--primary-color); color: var(--text-primary-color, #fff);
    border-color: var(--primary-color);
  }
  button.link {
    background: none; border: none; padding: 6px 8px; color: var(--primary-color);
  }
  button.link.danger { color: var(--error-color, #db4437); }

  .results {
    margin-top: 8px; border: 1px solid var(--divider-color); border-radius: 8px;
    overflow: hidden;
  }
  .result {
    display: flex; gap: 10px; align-items: center; padding: 10px 12px;
    border-top: 1px solid var(--divider-color); cursor: pointer;
    color: var(--primary-text-color);
  }
  .result:first-child { border-top: none; }
  .result input { margin: 0; accent-color: var(--primary-color); }

  .seg {
    display: inline-flex; margin-top: 12px; border: 1px solid var(--divider-color);
    border-radius: 8px; overflow: hidden;
  }
  .seg button { border: none; border-radius: 0; background: none; }
  .seg button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }

  .check {
    display: flex; gap: 8px; align-items: center; margin-top: 10px;
    color: var(--primary-text-color);
  }
  .check input { accent-color: var(--primary-color); }

  .trip {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
    padding: 8px 0; border-top: 1px solid var(--divider-color);
  }
  .trip:first-child { border-top: none; }
  .trip-main { flex: 1; min-width: 0; }
  .trip-place {
    color: var(--primary-text-color); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .trip-when { font-size: 0.85rem; color: var(--secondary-text-color); }
  .trip .move { flex-basis: 100%; margin-top: 4px; }
`;

customElements.define("ev-trip-card", EvTripCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ev-trip-card",
  name: "EV Trip Card",
  description: "Plan, move and cancel EV trips and see the charging plan.",
  documentationURL: "https://github.com/BarBaar44/ev-trip-card",
});

console.info(`%c EV-TRIP-CARD %c ${VERSION} `, "background:#03a9f4;color:#fff", "");
