/*
 * EV Trip Card
 * One Lovelace card for the EV trip planner: charging plan, form banner,
 * destination search, schedule, move, cancel.
 *
 * Talks only to the EV trip planner contract, version 1 (CONTRACT.md):
 * four sensors and seven services, implemented by the EV Trip Planner
 * integration (domain ev_trip_planner) from Home-Assistant-EV-Scheduler.
 * The retired pyscript backend was removed in 0.3.0.
 *
 * The typed text, the picked destination and the date live in the card's
 * own DOM and go straight to the services, so the phone problem where a
 * dashboard button never receives freshly typed text does not apply.
 *
 * Times: the backend reads naive wall time in Home Assistant's time zone,
 * so every time shown or entered here is in that zone, not the browser's.
 *
 * https://github.com/BarBaar44/ev-trip-card  (MIT)
 */

const VERSION = "0.3.0";

const DEFAULTS = {
  title: "Trips and charging",
  backend: "integration",
  // Car side, read only.
  soc_entity: "sensor.calimero_battery_level",
  charge_limit_entity: "number.calimero_charge_limit",
  charging_entity: "sensor.calimero_charging",
  limit_raised_entity: "input_boolean.evcc_car_limit_raised",
  // Contract v1.
  plan_entity: "sensor.ev_trip_planner_plan",
  trips_entity: "sensor.ev_trip_planner_trips",
  search_entity: "sensor.ev_trip_planner_search",
  status_entity: "sensor.ev_trip_planner_status",
  show_status: true,
  show_manage: true,
  show_arrive_by: true,
};

// Contract service name -> [domain, service] per backend.
const BACKENDS = {
  integration: (name) => ["ev_trip_planner", name],
};

const BANNER_LEVELS = ["info", "success", "warning", "error"];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hasValue(stateObj) {
  return stateObj && !["unknown", "unavailable", ""].includes(stateObj.state);
}

class EvTripCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._selected = 0; // index into the search results
    this._resultsKey = null;
    this._tripsKey = null;
    this._statusKey = null;
    this._row = null; // { uid, mode: "move" | "cancel" } open in the trip list
    this._busy = false;
    this._awaitReset = 0; // token of the schedule call waiting for a reset
    this._arriveBy = false;
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    const merged = { ...DEFAULTS, ...(config || {}) };
    if (merged.backend === "pyscript") {
      throw new Error(
        "backend: pyscript was removed in 0.3.0; install the EV Trip Planner integration and drop the backend line",
      );
    }
    if (!BACKENDS[merged.backend]) {
      throw new Error(`backend must be one of: ${Object.keys(BACKENDS).join(", ")}`);
    }
    this._config = merged;
    if (this._built) {
      this._built = false;
      this._resultsKey = this._tripsKey = this._statusKey = null;
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
  // Time, in Home Assistant's time zone
  // ------------------------------------------------------------------
  get _tz() {
    return (this._hass && this._hass.config && this._hass.config.time_zone) || undefined;
  }

  // Date -> "YYYY-MM-DDTHH:MM" wall time in HA's zone (datetime-local format).
  _wall(date) {
    const parts = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: this._tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .forEach((p) => (parts[p.type] = p.value));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  _nextWholeHour() {
    return this._wall(new Date(Date.now() + 3600 * 1000)).slice(0, 14) + "00";
  }

  // Wall time strings of equal format compare correctly as strings.
  _isFuture(wallValue) {
    return Boolean(wallValue) && wallValue > this._wall(new Date());
  }

  _fmt(date) {
    const lang = (this._hass && this._hass.locale && this._hass.locale.language) || undefined;
    try {
      return date.toLocaleString(lang, {
        timeZone: this._tz,
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
  // Static skeleton, built once so inputs keep focus and typed text
  // ------------------------------------------------------------------
  _build() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="header">${esc(c.title)}</div>

        <div class="status" id="status" ${c.show_status ? "" : "hidden"}></div>

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
              <input id="when" type="datetime-local" aria-label="Date and time" />
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
      manage: $("manage"),
      trips: $("trips"),
    };
    this._el.when.value = this._nextWholeHour();

    $("search-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      this._search();
    });
    $("dismiss").addEventListener("click", () => this._call("clear_status", {}));
    $("clear").addEventListener("click", () => this._clear());
    $("schedule").addEventListener("click", () => this._schedule());

    this._el.results.addEventListener("change", (ev) => {
      if (ev.target.name === "dest") this._selected = Number(ev.target.value);
    });

    this._el.mode.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-mode]");
      if (btn) this._setArriveBy(btn.dataset.mode === "arrive");
    });

    this._el.trips.addEventListener("click", (ev) => this._tripAction(ev));

    this._built = true;
  }

  _setArriveBy(on) {
    this._arriveBy = on;
    this._el.mode
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("on", (b.dataset.mode === "arrive") === on));
  }

  // ------------------------------------------------------------------
  // Per-update rendering of the dynamic parts only
  // ------------------------------------------------------------------
  _update() {
    const c = this._config;
    const s = this._hass.states;
    if (c.show_status) this._renderStatus(s);
    this._renderBanner(s[c.status_entity]);
    this._renderResults(s[c.search_entity]);
    if (c.show_manage) this._renderTrips(s[c.trips_entity]);
  }

  _renderStatus(s) {
    const c = this._config;
    const soc = s[c.soc_entity];
    const limit = s[c.charge_limit_entity];
    const charging = s[c.charging_entity];
    const raised = s[c.limit_raised_entity];
    const plan = s[c.plan_entity];

    const socText = hasValue(soc) ? `${Math.round(Number(soc.state))}%` : "?";
    const limitText = hasValue(limit) ? `${Math.round(Number(limit.state))}%` : "?";
    const chargingText = hasValue(charging) ? charging.state : "";
    const raisedOn = raised && raised.state === "on";

    let planText = "Plan not known yet";
    let planLabel = "needed for the next trip";
    let planMuted = true;
    if (hasValue(plan)) {
      const a = plan.attributes;
      const when = a.deadline ? new Date(a.deadline) : null;
      if (a.kind === "trip" && when) {
        planText = `${Math.ceil(Number(plan.state))}% by ${this._fmt(when)}`;
        const km = a.km != null ? ` (${Math.round(a.km)} km)` : "";
        planLabel = `needed for ${a.place || "the next trip"}${km}`;
        planMuted = false;
      } else if (a.kind === "floor" && when) {
        planText = `${Math.ceil(Number(plan.state))}% by ${this._fmt(when)}`;
        planLabel = "battery floor, no trip needs more";
        planMuted = false;
      } else {
        planText = "No trips planned";
      }
    }

    const key = JSON.stringify([socText, limitText, chargingText, raisedOn, planText, planLabel]);
    if (key === this._statusKey) return;
    this._statusKey = key;

    const badge = raisedOn ? `<span class="badge">raised for trip</span>` : "";
    this._el.status.innerHTML = `
      <div class="stat">
        <div class="stat-value">${esc(socText)}</div>
        <div class="stat-label">battery${chargingText ? ` · ${esc(chargingText)}` : ""}</div>
      </div>
      <div class="stat">
        <div class="stat-value">${esc(limitText)}</div>
        <div class="stat-label">charge limit ${badge}</div>
      </div>
      <div class="stat wide">
        <div class="stat-value ${planMuted ? "muted" : ""}">${esc(planText)}</div>
        <div class="stat-label">${esc(planLabel)}</div>
      </div>
    `;
  }

  _renderBanner(stateObj) {
    const level = stateObj ? stateObj.state : "ok";
    const show = BANNER_LEVELS.includes(level);
    this._el.banner.hidden = !show;
    if (!show) return;
    this._el.banner.className = `banner ${level}`;
    this._el.bannerText.textContent = stateObj.attributes.message || "";
  }

  _results() {
    const st = this._hass.states[this._config.search_entity];
    if (!st || st.state !== "results") return [];
    return Array.isArray(st.attributes.results) ? st.attributes.results : [];
  }

  _renderResults(stateObj) {
    const results = this._results();
    const searchState = stateObj ? stateObj.state : "idle";

    // The backend clears the search after a trip is accepted. That is the
    // signal to clear this card's own fields too.
    if (this._awaitReset && searchState === "idle") {
      this._awaitReset = 0;
      this._resetForm();
    }

    const key = JSON.stringify([searchState, results]);
    if (key === this._resultsKey) return;
    this._resultsKey = key;

    if (this._selected >= results.length) this._selected = 0;
    const has = results.length > 0;
    this._el.results.hidden = !has;
    this._el.details.hidden = !has;
    this._el.results.innerHTML = results
      .map((r, i) => {
        const km = r.km != null ? `${Math.round(r.km)} km` : "";
        const warn = r.warning ? `<span class="warn">⚠ ${esc(r.warning)}</span>` : "";
        return `
        <label class="result">
          <input type="radio" name="dest" value="${i}" ${i === this._selected ? "checked" : ""} />
          <span class="result-main">
            <span class="result-place">${esc(r.place)}</span>
            <span class="result-meta">${esc(km)} ${warn}</span>
          </span>
        </label>`;
      })
      .join("");
  }

  _trips() {
    const st = this._hass.states[this._config.trips_entity];
    const trips = st && st.attributes.trips;
    return Array.isArray(trips) ? trips : [];
  }

  _renderTrips() {
    const trips = this._trips();
    if (this._row && !trips.some((t) => t.uid === this._row.uid)) this._row = null;
    const key = JSON.stringify([trips, this._row]);
    if (key === this._tripsKey) return;
    this._tripsKey = key;

    this._el.manage.hidden = trips.length === 0;
    this._el.trips.innerHTML = trips
      .map((t) => {
        const start = new Date(t.start);
        const mode = this._row && this._row.uid === t.uid ? this._row.mode : null;
        const tags = [
          t.time_is === "arrival" ? "arrive by" : "leave",
          t.one_way ? "one way" : "",
        ]
          .filter(Boolean)
          .map((x) => `<span class="tag">${esc(x)}</span>`)
          .join("");
        let extra = "";
        if (mode === "move") {
          extra = `
            <div class="row sub">
              <input type="datetime-local" class="move-when" value="${esc(this._wall(start))}"
                     aria-label="New date and time" />
              <button class="primary" data-act="move-save" type="button">Save</button>
            </div>`;
        } else if (mode === "cancel") {
          extra = `
            <div class="row sub confirm">
              <span>Cancel this trip? The invite is withdrawn by email.</span>
              <button class="link" data-act="close" type="button">Keep</button>
              <button class="primary danger" data-act="cancel-yes" type="button">Cancel trip</button>
            </div>`;
        }
        return `
        <div class="trip" data-uid="${esc(t.uid)}">
          <div class="trip-main">
            <div class="trip-place">${esc(t.place)}</div>
            <div class="trip-when">${esc(this._fmt(start))} ${tags}</div>
          </div>
          <div class="trip-actions">
            <button class="link" data-act="${mode === "move" ? "close" : "move"}" type="button">
              ${mode === "move" ? "Close" : "Move"}</button>
            <button class="link danger" data-act="cancel" type="button">Cancel</button>
          </div>
          ${extra}
        </div>`;
      })
      .join("");
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  async _call(name, data) {
    const [domain, service] = BACKENDS[this._config.backend](name);
    try {
      await this._hass.callService(domain, service, data);
      return true;
    } catch (err) {
      this._localBanner("error", `${domain}.${service} failed: ${err.message || err}`);
      return false;
    }
  }

  // For mistakes caught in the card itself: the shared banner, so every
  // open dashboard shows it. Shown locally if even that call fails.
  _localBanner(level, message) {
    const [domain, service] = BACKENDS[this._config.backend]("set_status");
    this._hass.callService(domain, service, { level, message }).catch(() => {
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
    this._selected = 0;
    this._resultsKey = null;
    this._setBusy(true);
    await this._call("search", { query });
    this._setBusy(false);
  }

  async _schedule() {
    if (this._busy) return;
    const pick = this._results()[this._selected];
    if (!pick || !pick.geo) {
      this._localBanner("warning", "Search for a destination and pick one from the list first.");
      return;
    }
    const when = this._el.when.value;
    if (!this._isFuture(when)) {
      this._localBanner("warning", "Pick a date and time in the future.");
      return;
    }

    const data = {
      start: `${when}:00`,
      place: pick.place,
      location: pick.location,
      geo: pick.geo,
      user_id: this._hass.user.id,
      one_way: this._el.oneway.checked,
      arrive_by: this._config.show_arrive_by && this._arriveBy,
    };

    // A rejected trip leaves the search in place, so the form stays filled
    // for a correction. An accepted one clears the search, which clears the
    // form in _renderResults. Stop waiting after a while.
    const token = Date.now();
    this._awaitReset = token;
    this._setBusy(true);
    const ok = await this._call("schedule", data);
    this._setBusy(false);
    if (!ok && this._awaitReset === token) this._awaitReset = 0;
    setTimeout(() => {
      if (this._awaitReset === token) this._awaitReset = 0;
    }, 30000);
  }

  async _clear() {
    this._resetForm();
    await this._call("clear_search", {});
  }

  _resetForm() {
    this._el.query.value = "";
    this._el.when.value = this._nextWholeHour();
    this._el.oneway.checked = false;
    this._setArriveBy(false);
    this._selected = 0;
  }

  _openRow(uid, mode) {
    this._row = mode ? { uid, mode } : null;
    this._tripsKey = null;
    this._renderTrips();
  }

  async _tripAction(ev) {
    const btn = ev.target.closest("button[data-act]");
    if (!btn || this._busy) return;
    const row = btn.closest(".trip");
    const uid = row.dataset.uid;
    const act = btn.dataset.act;

    if (act === "move" || act === "cancel") return this._openRow(uid, act);
    if (act === "close") return this._openRow(uid, null);

    if (act === "cancel-yes") {
      this._setBusy(true);
      await this._call("cancel", { uid });
      this._setBusy(false);
      this._openRow(uid, null);
      return;
    }

    if (act === "move-save") {
      const value = row.querySelector(".move-when").value;
      if (!this._isFuture(value)) {
        this._localBanner("warning", "Pick a new date and time in the future.");
        return;
      }
      this._setBusy(true);
      const ok = await this._call("move", { uid, start: `${value}:00` });
      this._setBusy(false);
      if (ok) this._openRow(uid, null);
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
  button.primary.danger {
    background: var(--error-color, #db4437); border-color: var(--error-color, #db4437);
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
  .result-main { display: flex; flex-direction: column; min-width: 0; }
  .result-meta { font-size: 0.85rem; color: var(--secondary-text-color); }
  .warn { color: var(--warning-color, #ffa600); }

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
  .tag {
    display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 8px;
    font-size: 0.75rem; border: 1px solid var(--divider-color);
  }
  .trip .sub { flex-basis: 100%; margin-top: 4px; }
  .confirm { flex-wrap: wrap; color: var(--primary-text-color); font-size: 0.95rem; }
  .confirm span { flex: 1 1 100%; }
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
