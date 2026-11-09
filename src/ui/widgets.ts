import { Bridge, type IslandMedia, type IslandWeather } from "../core/bridge";
import { WEATHER_CITIES } from "../core/island-widgets";
import { State } from "../core/state";
import { getLang, getPlatform } from "../i18n/core";
import { h } from "./dom";

const local = (tr: string, en: string) => getLang() === "tr" ? tr : en;

export function widgetHeight(): number {
  return (State.settings.islandMedia && getPlatform() === "windows") || State.settings.islandWeatherCity ? 68 : 0;
}

export function buildWidgets(view: "overview" | "empty") {
  const weatherLabel = h("strong");
  const weatherValue = h("span");
  const weather = h("div", { class: "island-widget", hidden: true }, weatherLabel, weatherValue);
  const mediaLabel = h("strong");
  const mediaValue = h("span");
  const media = h("div", { class: "island-widget", hidden: true }, mediaLabel, mediaValue);
  const el = h("div", { class: "island-widgets", hidden: true }, weather, media);
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
    el.hidden = !city && !mediaOn;
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
