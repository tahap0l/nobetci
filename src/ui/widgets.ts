import { Bridge, type IslandMedia, type IslandWeather } from "../core/bridge";
import { WEATHER_CITIES } from "../core/island-widgets";
import { State } from "../core/state";
import { getLang, getPlatform } from "../i18n/core";
import { h } from "./dom";

const local = (tr: string, en: string) => getLang() === "tr" ? tr : en;

export function widgetHeight(): number {
  return 68;
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
  const caption = h("strong");
  const days = h("div", { class: "island-calendar-days" });
  let offset = 0;
  let lastKey = "";
  const refresh = () => {
    const today = new Date();
    const key = `${today.toDateString()}/${offset}`;
    if (key === lastKey) return;
    lastKey = key;
    const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7 + offset * 7, 12);
    const month = new Intl.DateTimeFormat(getLang(), { month: "long", year: "numeric" });
    const weekday = new Intl.DateTimeFormat(getLang(), { weekday: "short" });
    const full = new Intl.DateTimeFormat(getLang(), { dateStyle: "full" });
    caption.textContent = month.format(first);
    days.replaceChildren(...Array.from({ length: 7 }, (_, index) => {
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12);
      return h("span", {
        "data-today": date.toDateString() === today.toDateString() ? "true" : undefined,
        "aria-current": date.toDateString() === today.toDateString() ? "date" : undefined,
        title: full.format(date),
        text: `${weekday.format(date)} ${date.getDate()}`,
      });
    }));
  };
  const move = (step: number, label: string) => h("button", {
    type: "button", class: "btn btn-small", title: label, "aria-label": label,
    text: step < 0 ? "‹" : "›", onclick: () => { offset += step; refresh(); },
  });
  const header = h("div", { class: "island-calendar-head" }, caption,
    move(-1, local("Önceki hafta", "Previous week")), move(1, local("Sonraki hafta", "Next week")));
  return { el: h("div", { class: "island-widget island-calendar" }, header, days), refresh };
}

export function buildWidgets(view: "overview" | "empty") {
  const weatherLabel = h("strong");
  const weatherValue = h("span");
  const weather = h("div", { class: "island-widget", hidden: true }, weatherLabel, weatherValue);
  const mediaLabel = h("strong");
  const mediaValue = h("span");
  const media = h("div", { class: "island-widget", hidden: true }, mediaLabel, mediaValue);
  const calendar = buildCalendar();
  const carousel = h("div", {
    class: "island-widget-slides", tabindex: 0,
    "aria-label": local("Kaydırılabilir ada kartları", "Scrollable island cards"),
  }, calendar.el, weather, media);
  const togglePage = h("button", {
    type: "button", class: "btn btn-small island-widget-page", hidden: true, text: "⇄",
    "aria-label": local("Sonraki ada kartı", "Next island card"),
  });
  togglePage.addEventListener("click", () => {
    if (!carousel.clientWidth) return;
    const count = 1 + Number(!weather.hidden) + Number(!media.hidden);
    const left = ((Math.round(carousel.scrollLeft / carousel.clientWidth) + 1) % count) * carousel.clientWidth;
    carousel.scrollTo({ left, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });
  const el = h("div", { class: "island-widgets", hidden: true }, carousel, togglePage);
  let currentMedia: IslandMedia | null = null;
  let city = "";
  let weatherAt = 0;
  let mediaAt = 0;
  let busy = false;
  let weatherVersion = 0;
  let mediaVersion = 0;
  let wake: number | undefined;

  const action = (glyph: string, label: string, name: "previous" | "toggle" | "next") => {
    const button = h("button", { type: "button", class: "btn btn-small", text: glyph, title: label, "aria-label": label });
    button.addEventListener("click", async () => {
      if (!currentMedia || busy) return;
      busy = true;
      const ok = await Bridge.islandMediaControl(currentMedia.source, name);
      busy = false;
      if (!ok) mediaValue.textContent = local("Medya komutu uygulanamadı", "Media command unavailable");
      mediaAt = Date.now() + 500;
    });
    return button;
  };
  const back = action("‹", local("Önceki parça", "Previous track"), "previous");
  const play = action("⏯", local("Oynat veya duraklat", "Play or pause"), "toggle");
  const next = action("›", local("Sonraki parça", "Next track"), "next");
  const controls = h("div", { class: "island-media-buttons", hidden: true }, back, play, next);
  media.append(controls);

  function drawMedia(result: IslandMedia | null) {
    currentMedia = result;
    mediaLabel.textContent = local("Çalan medya", "Now playing");
    mediaValue.textContent = result
      ? [result.title, result.artist].filter(Boolean).join(" · ")
      : local("Etkin medya bulunamadı", "No active media");
    mediaValue.title = result ? mediaValue.textContent : "";
    play.textContent = result?.playing ? "Ⅱ" : "▶";
    controls.hidden = !result;
  }

  function drawWeather(result: IslandWeather | null) {
    const name = WEATHER_CITIES[city as keyof typeof WEATHER_CITIES];
    weatherLabel.textContent = name ? name + " · Open-Meteo" : "";
    const code = result?.code;
    const condition = code === 0 ? local("Açık", "Clear")
      : code !== undefined && code <= 3 ? local("Bulutlu", "Cloudy")
      : code !== undefined && code <= 48 ? local("Sisli", "Foggy")
      : code !== undefined && ((code >= 71 && code <= 77) || code === 85 || code === 86) ? local("Kar", "Snow")
      : code !== undefined && code >= 95 ? local("Fırtına", "Thunderstorm")
      : local("Yağışlı", "Precipitation");
    weatherValue.textContent = result ? `${Math.round(result.temperature)} °C · ${condition}` : local("Veri alınamadı", "Weather unavailable");
  }

  function refresh() {
    const nextCity = State.settings.islandWeatherCity;
    const mediaOn = State.settings.islandMedia && getPlatform() === "windows";
    if (city !== nextCity) {
      city = nextCity;
      weatherAt = 0;
      weatherVersion++;
      weatherLabel.textContent = (WEATHER_CITIES[city as keyof typeof WEATHER_CITIES] ?? "") + " · Open-Meteo";
      weatherValue.textContent = local("Yükleniyor…", "Loading…");
    }
    weather.hidden = !city;
    if (media.hidden !== !mediaOn) {
      mediaVersion++;
      mediaAt = 0;
      drawMedia(null);
      media.hidden = !mediaOn;
    }
    calendar.refresh();
    el.hidden = false;
    togglePage.hidden = !city && !mediaOn;
    if (State.mode !== "expanded" || State.view !== view || el.hidden || !el.isConnected) return;
    if (wake === undefined) {
      wake = window.setTimeout(() => {
        wake = undefined;
        refresh();
      }, 4_000);
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
      void Bridge.islandMedia().then((result) => {
        if (mediaVersion === version) drawMedia(result);
      });
    }
  }

  return { el, refresh };
}
