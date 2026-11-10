import { Bridge, type IslandMedia, type IslandWeather } from "../core/bridge";
import { WEATHER_CITIES } from "../core/island-widgets";
import { State } from "../core/state";
import { getLang, getPlatform } from "../i18n/core";
import { h } from "./dom";

const local = (tr: string, en: string) => getLang() === "tr" ? tr : en;
const MEDIA_ICONS = {
  previous: "M4 4h2v12H4zm3 6 9-6v12z",
  play: "M6 3.5v13l11-6.5z",
  pause: "M5 4h4v12H5zm6 0h4v12h-4z",
  next: "M4 4l9 6-9 6zm10 0h2v12h-2z",
} as const;
const DASHBOARD_TABS = [
  ["media", "Medya ve odak", "Media & focus", "♫"],
  ["calendar", "Takvim", "Calendar", "▦"],
  ["weather", "Hava durumu", "Weather", "☀"],
] as const;

function mediaIcon(name: keyof typeof MEDIA_ICONS): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", MEDIA_ICONS[name]);
  svg.append(path);
  return svg;
}

export function widgetHeight(): number {
  return 144;
}

export function compactWidgetSummary(redraw: () => void) {
  let city = "";
  let temperature: number | undefined;
  let track = "";
  let weatherAfter = 0;
  let mediaAfter = 0;
  let timer: number | undefined;

  return () => {
    if (State.mode !== "compact") return "";
    if (timer === undefined) {
      timer = window.setTimeout(() => {
        timer = undefined;
        if (State.mode === "compact") redraw();
      }, 5_000);
    }
    const now = Date.now();
    const settings = State.settings;
    if (city !== settings.islandWeatherCity) {
      city = settings.islandWeatherCity;
      temperature = undefined;
      weatherAfter = 0;
    }
    if (city && now >= weatherAfter) {
      const requestedCity = city;
      weatherAfter = now + 60_000;
      void Bridge.islandWeather(requestedCity).then((result) => {
        if (city !== requestedCity) return;
        temperature = result?.temperature;
        if (result) weatherAfter = Date.now() + 600_000;
        redraw();
      });
    }
    const mediaOn = settings.islandMedia && getPlatform() === "windows";
    if (!mediaOn) track = "";
    else if (now >= mediaAfter) {
      mediaAfter = now + 5_000;
      void Bridge.islandMedia().then((result) => {
        if (State.mode !== "compact" || !State.settings.islandMedia) return;
        track = result?.playing ? result.title : "";
        redraw();
      });
    }
    const date = new Intl.DateTimeFormat(getLang(), { weekday: "short", day: "numeric", month: "short" }).format(now);
    const weather = temperature === undefined ? "" : `${Math.round(temperature)} °C`;
    const summaries = [date, weather, track && `♪ ${track}`].filter(Boolean);
    return summaries[Math.floor(now / 5_000) % summaries.length];
  };
}

function buildCalendar() {
  const caption = h("strong", { class: "island-calendar-month", "aria-live": "polite" });
  const headings = h("tr");
  const dates = h("tr");
  const table = h("table", { class: "island-calendar-table", "aria-label": local("Haftalık takvim", "Weekly calendar") },
    h("thead", {}, headings), h("tbody", {}, dates));
  let offset = 0;
  let lastKey = "";
  const refresh = () => {
    const today = new Date();
    const key = `${getLang()}/${today.toDateString()}/${offset}`;
    if (key === lastKey) return;
    lastKey = key;
    const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7 + offset * 7, 12);
    const month = new Intl.DateTimeFormat(getLang(), { month: "long", year: "numeric" });
    const weekday = new Intl.DateTimeFormat(getLang(), { weekday: "short" });
    const full = new Intl.DateTimeFormat(getLang(), { dateStyle: "full" });
    caption.textContent = month.format(first);
    const week = Array.from({ length: 7 }, (_, index) =>
      new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12));
    headings.replaceChildren(...week.map((date) => h("th", { scope: "col", text: weekday.format(date) })));
    dates.replaceChildren(...week.map((date) => {
      const current = date.toDateString() === today.toDateString();
      return h("td", {
        "aria-current": current ? "date" : undefined,
        title: full.format(date),
      }, h("span", { text: String(date.getDate()) }));
    }));
  };
  const move = (step: number, label: string) => h("button", {
    type: "button", class: "island-calendar-button", title: label, "aria-label": label,
    text: step < 0 ? "‹" : "›", onclick: () => { offset += step; refresh(); },
  });
  const header = h("div", { class: "island-calendar-head" }, caption,
    move(-1, local("Önceki hafta", "Previous week")), move(1, local("Sonraki hafta", "Next week")));
  return { el: h("div", { class: "island-calendar" }, header, table), refresh };
}

let focusRemaining = 25 * 60_000;
let focusUntil = 0;

export function buildWidgets(view: "overview" | "empty", openSettings: (tab: string) => void) {
  const label = (tr: string, en: string) => h("span", { class: "island-card-label", text: local(tr, en) });
  const value = () => h("strong", { class: "island-card-value" });
  const focusTime = value();
  const focusToggle = h("button", { type: "button", class: "island-card-action" });
  const focusReset = h("button", {
    type: "button", class: "island-focus-reset", text: "↺",
    title: local("Sayacı sıfırla", "Reset timer"), "aria-label": local("Sayacı sıfırla", "Reset timer"),
  });
  const focus = h("div", { class: "island-card island-card-focus" },
    label("Odak", "Focus"), focusToggle, focusTime, focusReset);

  function refreshFocus() {
    if (focusUntil && Date.now() >= focusUntil) {
      focusUntil = 0;
      focusRemaining = 0;
    }
    const remaining = Math.ceil((focusUntil ? focusUntil - Date.now() : focusRemaining) / 1_000);
    const clock = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    if (focusTime.textContent !== clock) focusTime.textContent = clock;
    const action = focusUntil ? local("Sayacı duraklat", "Pause timer") : local("Sayacı başlat", "Start timer");
    focusToggle.textContent = focusUntil ? "Ⅱ" : "▶";
    focusToggle.title = action;
    focusToggle.setAttribute("aria-label", action);
  }

  focusToggle.addEventListener("click", () => {
    if (focusUntil) {
      focusRemaining = Math.max(0, focusUntil - Date.now());
      focusUntil = 0;
    } else {
      if (focusRemaining === 0) focusRemaining = 25 * 60_000;
      focusUntil = Date.now() + focusRemaining;
    }
    refreshFocus();
  });
  focusReset.addEventListener("click", () => {
    focusRemaining = 25 * 60_000;
    focusUntil = 0;
    refreshFocus();
  });
  const weatherCity = h("td");
  const weatherTemperature = h("td", { class: "island-weather-temperature" });
  const weatherCondition = h("span", { role: "status" });
  const weatherRow = (title: string, cell: HTMLTableCellElement) =>
    h("tr", {}, h("th", { scope: "row", text: title }), cell);
  const weatherTable = h("table", { class: "island-weather-table", "aria-label": local("Güncel hava durumu", "Current weather") },
    h("tbody", {},
      weatherRow(local("Şehir", "City"), weatherCity),
      weatherRow(local("Sıcaklık", "Temperature"), weatherTemperature),
      weatherRow(local("Durum", "Conditions"), h("td", {}, weatherCondition))));
  const weatherSetup = h("div", { class: "island-weather-setup" },
    h("span", { text: local("Hava durumunu görmek için bir şehir seç.", "Choose a city to see its weather.") }),
    h("button", { type: "button", class: "btn btn-small", text: local("Şehir seç", "Choose city"),
      onclick: () => openSettings("genel") }));
  const weatherData = h("div", { class: "island-weather-data", hidden: true },
    weatherTable, h("small", { class: "island-weather-source", text: "Open-Meteo" }));
  const weather = h("div", { class: "island-weather" }, weatherData, weatherSetup);
  const mediaHeading = label("Müzik", "Music");
  const equalizer = h("span", { class: "media-equalizer", "aria-hidden": "true" },
    h("i"), h("i"), h("i"), h("i"));
  const artwork = h("img", { class: "media-artwork", alt: "", hidden: true });
  artwork.addEventListener("error", () => { artwork.hidden = true; });
  const cover = h("div", { class: "media-cover", "aria-hidden": "true" }, artwork, equalizer);
  const mediaLabel = value();
  const mediaValue = h("span", { class: "island-card-hint" });
  const mediaSetup = h("button", {
    type: "button", class: "island-card-action", text: "♪", title: local("Medya ayarları", "Media settings"),
    "aria-label": local("Medya ayarları", "Media settings"), onclick: () => openSettings("genel"),
  });
  const media = h("div", { class: "island-card island-card-media" },
    cover, h("div", { class: "media-track" }, mediaHeading, mediaLabel, mediaValue), mediaSetup);
  const home = h("div", { class: "island-dashboard-media" }, media, focus);
  const calendar = buildCalendar();
  const panels = [home, calendar.el, weather].map((content, i) => {
    const id = `${view}-${DASHBOARD_TABS[i][0]}`;
    return h("div", { class: "island-dashboard-page", role: "tabpanel", id: `${id}-panel`, tabindex: 0, "aria-labelledby": `${id}-tab` },
      h("div", { class: "island-dashboard-content" }, content));
  });
  const viewport = h("div", { class: "island-widget-slides" }, ...panels);
  const tabs = DASHBOARD_TABS.map(([key, tr, en, icon], i) => {
    const id = `${view}-${key}`;
    return h("button", { type: "button", class: "island-widget-tab", role: "tab", id: `${id}-tab`,
      "aria-controls": `${id}-panel`, onclick: () => selectPage(i) },
      h("span", { "aria-hidden": "true", text: icon }), local(tr, en));
  });
  const navigation = h("div", { class: "island-widget-tabs", role: "tablist",
    "aria-label": local("Ada kartları", "Island cards") }, ...tabs);
  const el = h("div", { class: "island-widgets", hidden: true }, navigation, viewport);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let activePage = 0;
  let scrollTimer: number | undefined;

  function markPage(index: number) {
    if (index !== activePage && panels[activePage].contains(document.activeElement)) {
      tabs[index].focus({ preventScroll: true });
    }
    activePage = index;
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.tabIndex = active ? 0 : -1;
      tab.setAttribute("aria-selected", String(active));
      panels[i].inert = !active;
      panels[i].dataset.active = String(active);
    });
  }

  function selectPage(index: number) {
    markPage(index);
    viewport.scrollTo({
      top: index * viewport.clientHeight,
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });
  }

  markPage(0);
  navigation.addEventListener("keydown", (event) => {
    let index: number;
    switch (event.key) {
      case "ArrowLeft": index = (activePage + tabs.length - 1) % tabs.length; break;
      case "ArrowRight": index = (activePage + 1) % tabs.length; break;
      case "Home": index = 0; break;
      case "End": index = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectPage(index);
    tabs[index].focus({ preventScroll: true });
  });
  viewport.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      if (!viewport.clientHeight) return;
      const index = Math.max(0, Math.min(panels.length - 1, Math.round(viewport.scrollTop / viewport.clientHeight)));
      if (index !== activePage) markPage(index);
    }, 100);
  }, { passive: true });
  // Step through one card per touch swipe. Wheel and trackpad scrolling still use native snap.
  let swipeStart: Touch | undefined;
  viewport.addEventListener("touchstart", (event) => {
    swipeStart = event.touches.length === 1 ? event.touches[0] : undefined;
  }, { passive: true });
  viewport.addEventListener("touchcancel", () => { swipeStart = undefined; }, { passive: true });
  viewport.addEventListener("touchend", (event) => {
    const start = swipeStart;
    swipeStart = undefined;
    const end = event.changedTouches[0];
    if (!start || !end || end.identifier !== start.identifier) return;
    const dy = start.clientY - end.clientY;
    if (Math.abs(dy) < 26 || Math.abs(dy) <= Math.abs(start.clientX - end.clientX)) return;
    event.preventDefault();
    const index = activePage + Math.sign(dy);
    if (index >= 0 && index < panels.length) selectPage(index);
  }, { passive: false });
  let currentMedia: IslandMedia | null = null;
  let city = "";
  let weatherAt = 0;
  let mediaAt = 0;
  let busy = false;
  let weatherVersion = 0;
  let mediaVersion = 0;
  let wake: number | undefined;
  let mediaEnabled: boolean | undefined;

  const action = (glyph: keyof typeof MEDIA_ICONS, label: string, name: "previous" | "toggle" | "next") => {
    const button = h("button", {
      type: "button", class: name === "toggle" ? "media-button media-toggle" : "media-button",
      title: label, "aria-label": label,
    }, mediaIcon(glyph));
    button.addEventListener("click", async () => {
      if (!currentMedia || busy) return;
      const source = currentMedia.source;
      busy = true;
      mediaVersion++;
      controls.setAttribute("aria-busy", "true");
      let ok = false;
      try {
        ok = Boolean(await Bridge.islandMediaControl(source, name));
        if (!ok && currentMedia?.source === source) {
          mediaValue.textContent = local("Medya komutu uygulanamadı", "Media command unavailable");
        }
      } finally {
        busy = false;
        controls.removeAttribute("aria-busy");
        mediaAt = ok ? 0 : Date.now() + 2_000;
        refresh();
      }
    });
    return button;
  };
  const back = action("previous", local("Önceki parça", "Previous track"), "previous");
  const play = action("play", local("Oynat", "Play"), "toggle");
  const next = action("next", local("Sonraki parça", "Next track"), "next");
  const controls = h("div", { class: "island-media-buttons", hidden: true }, back, play, next);
  media.append(controls);

  function drawMedia(result: IslandMedia | null) {
    currentMedia = result;
    const spotify = result?.source.toLowerCase().includes("spotify") ?? false;
    media.classList.toggle("is-spotify", spotify);
    media.classList.toggle("is-playing", result?.playing ?? false);
    const provider = spotify ? "Spotify" : local("Müzik", "Music");
    const playback = result?.playing ? local("Çalıyor", "Playing") : local("Duraklatıldı", "Paused");
    mediaHeading.textContent = result ? `${provider} · ${playback}` : provider;
    mediaLabel.textContent = result?.title || local("Şimdi çalan", "Now playing");
    mediaLabel.title = result?.title || "";
    mediaValue.textContent = result?.artist || (result ? "" : local("Etkin medya bulunamadı", "No active media"));
    mediaValue.title = result?.artist || "";
    if (result?.artwork) {
      if (artwork.getAttribute("src") !== result.artwork) {
        artwork.src = result.artwork;
        artwork.hidden = false;
      }
    } else {
      artwork.hidden = true;
      artwork.removeAttribute("src");
    }
    if (play.dataset.playing !== String(Boolean(result?.playing))) {
      play.dataset.playing = String(Boolean(result?.playing));
      play.replaceChildren(mediaIcon(result?.playing ? "pause" : "play"));
    }
    const playLabel = result?.playing ? local("Duraklat", "Pause") : local("Oynat", "Play");
    play.title = playLabel;
    play.setAttribute("aria-label", playLabel);
    back.disabled = !result?.canPrevious;
    play.disabled = !result?.canToggle;
    next.disabled = !result?.canNext;
    controls.hidden = !result;
  }

  function drawWeather(result: IslandWeather | null) {
    const code = result?.code;
    const condition = code === 0 ? local("Açık", "Clear")
      : code !== undefined && code <= 3 ? local("Bulutlu", "Cloudy")
      : code !== undefined && code <= 48 ? local("Sisli", "Foggy")
      : code !== undefined && ((code >= 71 && code <= 77) || code === 85 || code === 86) ? local("Kar", "Snow")
      : code !== undefined && code >= 95 ? local("Fırtına", "Thunderstorm")
      : local("Yağışlı", "Precipitation");
    weatherTemperature.textContent = result ? `${Math.round(result.temperature)} °C` : "—";
    weatherCondition.textContent = result ? condition : local("Veri alınamadı", "Weather unavailable");
  }

  function refresh() {
    const nextCity = State.settings.islandWeatherCity;
    const mediaOn = State.settings.islandMedia && getPlatform() === "windows";
    if (city !== nextCity) {
      city = nextCity;
      weatherAt = 0;
      weatherVersion++;
      weatherCity.textContent = WEATHER_CITIES[city as keyof typeof WEATHER_CITIES] ?? "—";
      weatherTemperature.textContent = "—";
      weatherCondition.textContent = local("Yükleniyor…", "Loading…");
    }
    weatherData.hidden = !city;
    weatherSetup.hidden = !!city;
    if (mediaEnabled !== mediaOn) {
      mediaVersion++;
      mediaAt = 0;
      drawMedia(null);
      mediaEnabled = mediaOn;
      if (!mediaOn) mediaValue.textContent = local("Medya kartını aç", "Enable the media widget");
    }
    calendar.refresh();
    el.dataset.mascotTheme = State.settings.mascotTheme;
    el.hidden = false;
    refreshFocus();
    if (State.mode !== "expanded" || State.view !== view || el.hidden || !el.isConnected) return;
    if (wake === undefined) {
      wake = window.setTimeout(() => {
        wake = undefined;
        refresh();
      }, 1_000);
    }
    const now = Date.now();
    if (city && now >= weatherAt) {
      const version = ++weatherVersion;
      weatherAt = now + 60_000;
      void Bridge.islandWeather(city).then((result) => {
        if (weatherVersion !== version) return;
        drawWeather(result);
        if (result) weatherAt = Date.now() + 600_000;
      });
    }
    if (mediaOn && !busy && now >= mediaAt) {
      const version = ++mediaVersion;
      mediaAt = now + 4_000;
      void Bridge.islandMedia(true).then((result) => {
        if (mediaVersion === version) drawMedia(result);
      });
    }
  }

  return { el, refresh };
}
