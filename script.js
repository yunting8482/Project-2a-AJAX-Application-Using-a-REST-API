
/* ==========================================
   RAIL//CITY — LIVE TRAIN TRAFFIC
   Native JavaScript + Digitraffic API
   ========================================== */

"use strict";

// API configuration
const API_BASE = "https://rata.digitraffic.fi/api/v1";

// Get HTML elements
const $ = id => document.getElementById(id);

const stationSelect = $("stationSelect");
const stationSearch = $("stationSearch");
const searchBtn = $("searchBtn");
const refreshBtn = $("refreshBtn");
const stationTitle = $("stationTitle");
const stationSubtitle = $("stationSubtitle");
const statusMessage = $("statusMessage");
const trainResults = $("trainResults");
const suggestionsBox = $("stationSuggestions");

// City Pulse elements
const trafficLevel = $("trafficLevel");
const trafficDescription = $("trafficDescription");
const trafficMeterFill = $("trafficMeterFill");
const hourlyTrains = $("hourlyTrains");
const delayedTrains = $("delayedTrains");
const cancelledTrains = $("cancelledTrains");

// Station Intel elements
const newsStationName = $("newsStationName");
const newsStatus = $("newsStatus");

// Application state
let stations = [];
let currentStation = "HKI";
let currentController = null;
let requestNumber = 0;

// Format times in Finland's local timezone
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Helsinki",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/* ==========================================
   1. FALLBACK STATION DIRECTORY
   ========================================== */

// These stations remain searchable even if
// the station directory API is unavailable.

const FALLBACK_STATIONS = [
  ["Helsinki", "HKI"],
  ["Pasila", "PSL"],
  ["Tampere", "TPE"],
  ["Turku", "TKU"],
  ["Lahti", "LH"],
  ["Oulu", "OL"],
  ["Jyväskylä", "JY"],
  ["Riihimäki", "RI"],
  ["Tikkurila", "TKL"],
  ["Leppävaara", "LPV"],
  ["Espoo", "EPO"],
  ["Kerava", "KE"],
  ["Järvenpää", "JP"],
  ["Hyvinkää", "HY"],
  ["Kouvola", "KV"],
  ["Kuopio", "KUO"],
  ["Joensuu", "JOE"],
  ["Rovaniemi", "ROI"]
].map(([stationName, stationShortCode]) => ({
  stationName,
  stationShortCode
}));

/* ==========================================
   2. SMART STATION SEARCH
   ========================================== */

// Remove accents, hyphens, spaces and punctuation.
// Example: Jyväskylä becomes jyvaskyla.

function normalizeStationName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

// Calculate how different two words are.
// This allows searches with spelling mistakes.

function getEditDistance(a, b) {
  let previous = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  );

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] +
          (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }

    previous = current;
  }

  return previous[b.length];
}

// Return up to five closest station matches.

function getStationSuggestions(input, limit = 5) {
  const query = normalizeStationName(input);

  if (!query) return [];

  return stations
    .map(station => {
      const name = normalizeStationName(
        station.stationName
      );

      const code = normalizeStationName(
        station.stationShortCode
      );

      let score;

      if (query === name || query === code) {
        score = 0;
      } else if (
        name.startsWith(query) ||
        code.startsWith(query)
      ) {
        score = 1;
      } else if (name.includes(query)) {
        score = 2;
      } else {
        score = 3 + getEditDistance(query, name);
      }

      return { station, score, name };
    })
    .filter(item => {
      if (item.score <= 2) return true;

      // Avoid unrelated matches for short inputs.
      if (query.length < 3) return false;

      const distance = item.score - 3;

      const maxDistance = Math.max(
        1,
        Math.floor(
          Math.max(query.length, item.name.length) *
          0.35
        )
      );

      return distance <= maxDistance;
    })
    .sort((a, b) =>
      a.score - b.score ||
      a.station.stationName.localeCompare(
        b.station.stationName,
        "fi"
      )
    )
    .slice(0, limit)
    .map(item => item.station);
}

function findStation(input) {
  return getStationSuggestions(input, 1)[0] || null;
}

function stationName(code) {
  return stations.find(
    station => station.stationShortCode === code
  )?.stationName || code;
}

/* ==========================================
   3. LOAD STATION DIRECTORY
   ========================================== */

async function loadStations() {
  // Start with fallback stations.
  stations = [...FALLBACK_STATIONS];

  try {
    const response = await fetch(
      `${API_BASE}/metadata/stations`
    );

    if (!response.ok) {
      throw new Error(
        `Station directory HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error(
        "Unexpected station directory format"
      );
    }

    // Combine fallback stations with live directory.
    const byCode = new Map(
      FALLBACK_STATIONS.map(station => [
        station.stationShortCode,
        station
      ])
    );

    data
      .filter(station =>
        station.passengerTraffic === true &&
        station.stationShortCode &&
        station.stationName
      )
      .forEach(station => {
        byCode.set(station.stationShortCode, station);
      });

    stations = [...byCode.values()];

  } catch (error) {
    console.warn(
      "Using fallback station directory:",
      error
    );
  }

  populateStationDropdown();
}

/* ==========================================
   4. POPULATE STATION DROPDOWN
   ========================================== */

function populateStationDropdown() {
  if (!stationSelect) return;

  const previous =
    stationSelect.value || currentStation;

  stationSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a station";

  stationSelect.appendChild(placeholder);

  [...stations]
    .sort((a, b) =>
      a.stationName.localeCompare(b.stationName, "fi")
    )
    .forEach(station => {
      const option = document.createElement("option");

      option.value = station.stationShortCode;
      option.textContent = station.stationName;

      stationSelect.appendChild(option);
    });

  stationSelect.value = previous;
}

/* ==========================================
   5. SEARCH SUGGESTION DROPDOWN
   ========================================== */

function hideSuggestions() {
  if (!suggestionsBox) return;

  suggestionsBox.hidden = true;
  suggestionsBox.replaceChildren();
}

// Select a station and load its departures.

function chooseStation(station) {
  if (!station) return;

  if (stationSearch) {
    stationSearch.value = station.stationName;
  }

  if (stationSelect) {
    stationSelect.value = station.stationShortCode;
  }

  hideSuggestions();

  fetchTrains(station.stationShortCode);
}

// Display clickable suggestions as the user types.

function showStationSuggestions() {
  if (!suggestionsBox || !stationSearch) return;

  suggestionsBox.replaceChildren();

  const query = stationSearch.value.trim();

  if (!query) {
    hideSuggestions();
    return;
  }

  const matches = getStationSuggestions(query);

  if (!matches.length) {
    const empty = document.createElement("p");

    empty.className = "suggestion-empty";
    empty.textContent =
      "No close matches. Try a different spelling.";

    suggestionsBox.appendChild(empty);

  } else {
    matches.forEach(station => {
      const button = document.createElement("button");

      button.type = "button";
      button.className = "suggestion-item";
      button.setAttribute("role", "option");

      button.textContent =
        `${station.stationName} (${station.stationShortCode})`;

      button.addEventListener("click", () => {
        chooseStation(station);
      });

      suggestionsBox.appendChild(button);
    });
  }

  suggestionsBox.hidden = false;
}

/* ==========================================
   6. TRAIN TIME AND DESTINATION
   ========================================== */

function formatTime(value) {
  const date = new Date(value);

  return Number.isFinite(date.getTime())
    ? timeFormatter.format(date)
    : "--:--";
}

// Find the train's final destination.

function getDestination(train) {
  const rows = train.timeTableRows || [];

  const last = [...rows]
    .reverse()
    .find(row =>
      row.trainStopping ||
      row.commercialStop
    ) || rows[rows.length - 1];

  return last
    ? stationName(last.stationShortCode)
    : "Unknown";
}

/* ==========================================
   7. TRAIN DELAY STATUS
   ========================================== */

function getTrainStatus(train, departure) {
  if (train.cancelled || departure.cancelled) {
    return {
      text: "CANCELLED",
      className: "cancelled"
    };
  }

  let delay = departure.differenceInMinutes;

  // Calculate delay from estimated departure time.
  if (delay == null && departure.liveEstimateTime) {
    delay = Math.round(
      (
        new Date(departure.liveEstimateTime) -
        new Date(departure.scheduledTime)
      ) / 60000
    );
  }

  if (Number.isFinite(delay) && delay >= 2) {
    return {
      text: `+${delay} MIN`,
      className: "delayed"
    };
  }

  if (Number.isFinite(delay) && delay <= -2) {
    return {
      text: `${delay} MIN`,
      className: ""
    };
  }

  return {
    text: "ON TIME",
    className: ""
  };
}

/* ==========================================
   8. EXTRACT STATION DEPARTURES
   ========================================== */

function getDepartures(trains, stationCode) {
  const results = [];

  trains.forEach(train => {
    if (
      train.trainCategory === "Cargo" ||
      !Array.isArray(train.timeTableRows)
    ) {
      return;
    }

    train.timeTableRows.forEach(departure => {
      if (
        departure.stationShortCode !== stationCode ||
        departure.type !== "DEPARTURE" ||
        departure.trainStopping === false ||
        !departure.scheduledTime
      ) {
        return;
      }

      const scheduled = Date.parse(
        departure.scheduledTime
      );

      const expected = Date.parse(
        departure.liveEstimateTime ||
        departure.scheduledTime
      );

      if (
        !Number.isFinite(scheduled) ||
        !Number.isFinite(expected)
      ) {
        return;
      }

      results.push({
        train,
        departure,
        scheduled,
        expected
      });
    });
  });

  return results;
}

/* ==========================================
   9. CREATE TRAIN TABLE ROW
   ========================================== */

function createTrainRow({ train, departure }) {
  const row = document.createElement("tr");

  const values = [
    formatTime(departure.scheduledTime),

    train.commuterLineID?.trim() ||
      `${train.trainType || "Train"} ${train.trainNumber}`,

    getDestination(train),

    departure.commercialTrack || "—"
  ];

  values.forEach((value, index) => {
    const cell = document.createElement("td");

    if (index === 1) {
      const badge = document.createElement("span");

      badge.className = "train-badge";
      badge.textContent = value;

      cell.appendChild(badge);
    } else {
      cell.textContent = value;
    }

    row.appendChild(cell);
  });

  // Add delay or cancellation status.
  const statusCell = document.createElement("td");

  const status = getTrainStatus(train, departure);

  const badge = document.createElement("span");

  badge.className =
    `status-badge ${status.className}`.trim();

  badge.textContent = status.text;

  statusCell.appendChild(badge);
  row.appendChild(statusCell);

  return row;
}

/* ==========================================
   10. DISPLAY UPCOMING DEPARTURES
   ========================================== */

function displayTrains(trains, stationCode) {
  if (!trainResults) return;

  trainResults.replaceChildren();

  const now = Date.now();

  const departures = getDepartures(
    trains,
    stationCode
  )
    .filter(item => item.expected >= now - 60000)
    .sort((a, b) => a.expected - b.expected)
    .slice(0, 15);

  if (!departures.length) {
    statusMessage.textContent =
      "No upcoming departures returned for this station right now.";

    return;
  }

  const fragment = document.createDocumentFragment();

  departures.forEach(item => {
    fragment.appendChild(createTrainRow(item));
  });

  trainResults.appendChild(fragment);

  statusMessage.textContent =
    `Showing ${departures.length} upcoming departures.`;
}

/* ==========================================
   11. CITY PULSE LOADING STATE
   ========================================== */

function showCityPulseLoading() {
  if (trafficLevel) {
    trafficLevel.textContent = "CALCULATING...";
  }

  if (trafficDescription) {
    trafficDescription.textContent =
      "Checking train activity.";
  }

  if (trafficMeterFill) {
    trafficMeterFill.style.width = "0%";

    trafficMeterFill.setAttribute(
      "aria-valuenow",
      "0"
    );
  }

  [
    hourlyTrains,
    delayedTrains,
    cancelledTrains
  ].forEach(element => {
    if (element) {
      element.textContent = "--";
    }
  });
}

/* ==========================================
   12. CALCULATE CITY PULSE
   ========================================== */

// This measures train movements, not crowding.

function updateCityPulse(trains, stationCode) {
  const now = Date.now();
  const nextHour = now + 3600000;

  const upcoming = getDepartures(
    trains,
    stationCode
  ).filter(item =>
    item.scheduled >= now &&
    item.scheduled < nextHour
  );

  const count = upcoming.length;

  const cancelled = upcoming.filter(item =>
    item.train.cancelled ||
    item.departure.cancelled
  ).length;

  const delayed = upcoming.filter(item =>
    !item.train.cancelled &&
    !item.departure.cancelled &&
    getTrainStatus(
      item.train,
      item.departure
    ).className === "delayed"
  ).length;

  // App-defined activity thresholds.
  const level =
    count < 10
      ? "QUIET TRAFFIC"
      : count < 25
        ? "MODERATE TRAFFIC"
        : "BUSY TRAFFIC";

  const description =
    count < 10
      ? "Fewer departures scheduled in the next hour."
      : count < 25
        ? "A steady flow of departures in the next hour."
        : "Many departures scheduled in the next hour.";

  if (trafficLevel) {
    trafficLevel.textContent = level;
  }

  if (trafficDescription) {
    trafficDescription.textContent = description;
  }

  if (hourlyTrains) {
    hourlyTrains.textContent = count;
  }

  if (delayedTrains) {
    delayedTrains.textContent = delayed;
  }

  if (cancelledTrains) {
    cancelledTrains.textContent = cancelled;
  }

  if (trafficMeterFill) {
    const percent = Math.min(
      100,
      Math.round((count / 50) * 100)
    );

    trafficMeterFill.style.width = `${percent}%`;

    trafficMeterFill.setAttribute(
      "aria-valuenow",
      String(percent)
    );
  }
}

// Display an error when train data is unavailable.

function showCityPulseError() {
  showCityPulseLoading();

  if (trafficLevel) {
    trafficLevel.textContent = "DATA UNAVAILABLE";
  }

  if (trafficDescription) {
    trafficDescription.textContent =
      "Could not retrieve train activity.";
  }
}

/* ==========================================
   13. FETCH LIVE TRAIN DATA
   ========================================== */

// One API request powers departures and City Pulse.

async function fetchTrains(stationCode) {
  if (!stationCode) {
    statusMessage.textContent =
      "Please select a station.";

    return;
  }

  // Cancel any older request.
  if (currentController) {
    currentController.abort();
  }

  const controller = new AbortController();
  const myRequest = ++requestNumber;

  currentController = controller;
  currentStation = stationCode;
  loadStationIntel(stationCode);

  // Update selected station information.
  if (stationTitle) {
    stationTitle.textContent = stationName(stationCode);
  }

  if (stationSubtitle) {
    stationSubtitle.textContent =
      "Live departures • Finland local time";
  }

  if (newsStationName) {
    newsStationName.textContent =
      stationName(stationCode);
  }

  if (newsStatus) {
    newsStatus.textContent =
      "Station announcements are not connected yet.";
  }

  if (statusMessage) {
    statusMessage.textContent =
      "Connecting to the live rail network...";
  }

  if (trainResults) {
    trainResults.replaceChildren();
  }

  showCityPulseLoading();

  if (searchBtn) {
    searchBtn.disabled = true;
  }

  if (refreshBtn) {
    refreshBtn.disabled = true;
  }

  try {
    // Request departures without the extra
    // train_categories filter.
    const params = new URLSearchParams({
      arrived_trains: "0",
      arriving_trains: "0",
      departed_trains: "0",
      departing_trains: "100",
      include_nonstopping: "false"
    });

    const url =
      `${API_BASE}/live-trains/station/` +
      `${encodeURIComponent(stationCode)}?${params}`;

    // AJAX request
    const response = await fetch(url, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Digitraffic HTTP ${response.status}`
      );
    }

    // Save API response as JavaScript data.
    const trains = await response.json();

    if (!Array.isArray(trains)) {
      throw new Error(
        "Unexpected train data format"
      );
    }

    // Ignore outdated requests.
    if (myRequest !== requestNumber) {
      return;
    }

    // Update departure board and City Pulse.
    displayTrains(trains, stationCode);
    updateCityPulse(trains, stationCode);

  } catch (error) {
    if (
      error.name === "AbortError" ||
      myRequest !== requestNumber
    ) {
      return;
    }

    console.error(
      "Digitraffic train request failed:",
      error
    );

    if (statusMessage) {
      statusMessage.textContent =
        `Unable to load live departures (${error.message}). ` +
        "Check your connection and browser console.";
    }

    showCityPulseError();

  } finally {
    if (myRequest === requestNumber) {
      currentController = null;

      if (searchBtn) {
        searchBtn.disabled = false;
      }

      if (refreshBtn) {
        refreshBtn.disabled = false;
      }
    }
  }
}

/* ==========================================
   14. HANDLE STATION SEARCH
   ========================================== */

function handleSearch() {
  const query = stationSearch?.value.trim() || "";

  // Text search takes priority.
  if (query) {
    const matches = getStationSuggestions(query);

    if (!matches.length) {
      if (statusMessage) {
        statusMessage.textContent =
          "No station match. Try another spelling or select from the dropdown.";
      }

      showStationSuggestions();
      return;
    }

    const best = matches[0];
    const normalized = normalizeStationName(query);

    // Open exact matches immediately.
    // For ambiguous fuzzy matches, show suggestions.
    if (
      normalizeStationName(best.stationName) === normalized ||
      normalizeStationName(best.stationShortCode) === normalized ||
      matches.length === 1
    ) {
      chooseStation(best);
    } else {
      showStationSuggestions();

      if (statusMessage) {
        statusMessage.textContent =
          "Choose the correct station from the suggestions.";
      }
    }

    return;
  }

  // Use dropdown if search input is empty.
  if (stationSelect?.value) {
    hideSuggestions();
    fetchTrains(stationSelect.value);

  } else if (statusMessage) {
    statusMessage.textContent =
      "Select or search for a station.";
  }
}

/* ==========================================
   15. DYNAMIC EVENT LISTENERS
   ========================================== */

// Search button
if (searchBtn) {
  searchBtn.addEventListener("click", handleSearch);
}

// Search input
if (stationSearch) {
  stationSearch.addEventListener(
    "input",
    showStationSuggestions
  );

  stationSearch.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSearch();
      }

      if (event.key === "Escape") {
        hideSuggestions();
      }
    }
  );
}

// Station dropdown
if (stationSelect) {
  stationSelect.addEventListener("change", () => {
    if (stationSearch) {
      stationSearch.value = "";
    }

    hideSuggestions();

    if (stationSelect.value) {
      fetchTrains(stationSelect.value);
    }
  });
}

// Refresh button
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    fetchTrains(currentStation);
  });
}

/* ==========================================
   16. INITIALIZE APPLICATION
   ========================================== */

async function initializeApp() {
  // Load passenger station names.
  await loadStations();

  // Show Helsinki by default.
  fetchTrains(currentStation);
}

// Start RAIL//CITY
initializeApp();


/* ==========================================
   RAIL//CITY — STATION INTEL
   Official railway passenger announcements
   ========================================== */

const stationNews = document.getElementById("stationNews");

let newsRequestNumber = 0;

// Extract readable text from a Digitraffic notice.
// Prefer English, but use Finnish or Swedish if needed.
function getNoticeText(notice) {
  const texts = [];

  function collect(value) {
    if (!value || typeof value !== "object") return;

    if (value.text && typeof value.text === "object") {
      const translation =
        value.text.en ||
        value.text.fi ||
        value.text.sv;

      if (typeof translation === "string") {
        texts.push(translation);
      }
    }

    if (Array.isArray(value)) {
      value.forEach(collect);
    } else {
      Object.values(value).forEach(collect);
    }
  }

  collect(notice.video);
  collect(notice.audio);

  return [...new Set(texts)]
    .filter(Boolean)
    .join(" ");
}

// Check whether an announcement belongs
// to the currently selected station.
function noticeMatchesStation(notice, stationCode) {
  const target = stationCode.toUpperCase();

  const stationCodes = [
    ...(Array.isArray(notice.stations)
      ? notice.stations.map(item =>
          typeof item === "string"
            ? item
            : item.stationShortCode ||
              item.station ||
              item.shortCode
        )
      : []),

    notice.stationShortCode,
    notice.station
  ];

  return stationCodes.some(code =>
    typeof code === "string" &&
    code.toUpperCase() === target
  );
}

// Create a safe news card using DOM elements.
function createNewsItem(message) {
  const article = document.createElement("article");
  article.className = "news-item";

  const heading = document.createElement("h4");
  heading.textContent = "OFFICIAL RAILWAY UPDATE";

  const description = document.createElement("p");
  description.textContent = message;

  article.append(heading, description);

  return article;
}

// Fetch currently active announcements.
async function loadStationIntel(stationCode) {
  if (!stationNews || !newsStatus) return;

  const myRequest = ++newsRequestNumber;

  stationNews.replaceChildren();

  newsStatus.textContent =
    "Checking official station announcements...";

  try {
    const url =
      `${API_BASE}/passenger-information/active`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Announcement API HTTP ${response.status}`
      );
    }

    const data = await response.json();

    const notices = Array.isArray(data)
      ? data
      : Array.isArray(data.messages)
        ? data.messages
        : [];

    // Only show notices explicitly associated
    // with the selected station.
    const relevant = notices.filter(notice =>
      noticeMatchesStation(notice, stationCode)
    );

    // Ignore responses from older searches.
    if (myRequest !== newsRequestNumber) return;

    stationNews.replaceChildren();

    const messages = [
      ...new Set(
        relevant
          .map(getNoticeText)
          .filter(Boolean)
      )
    ];

    if (!messages.length) {
      newsStatus.textContent =
        "No station-specific passenger announcements found. " +
        "This does not rule out ongoing construction.";
      return;
    }

    newsStatus.textContent =
      `${messages.length} active announcement(s) found.`;

    messages.slice(0, 5).forEach(message => {
      stationNews.appendChild(
        createNewsItem(message)
      );
    });

  } catch (error) {
    if (myRequest !== newsRequestNumber) return;

    console.error("Station Intel error:", error);

    stationNews.replaceChildren();

    newsStatus.textContent =
      "Official announcements are temporarily unavailable.";
  }
}
