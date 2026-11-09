(() => {
const animals = {
  owl: ["Baykuş", "#86bfff", "#5179bd"],
  wolf: ["Kurt", "#c3cfdf", "#728197"],
  hawk: ["Şahin", "#f1aa78", "#ac6242"],
  octopus: ["Ahtapot", "#76e7d7", "#a47be0"],
  lion: ["Aslan", "#ffc575", "#b87532"],
  canary: ["Kanarya", "#f4e66f", "#c7a132"],
  eagle: ["Kartal", "#a5d7ff", "#7c98b8"],
};
const outlines = {
  owl: "M6 27 6 8 21 16 39 16 54 8 54 27Q58 51 30 58Q2 51 6 27Z",
  wolf: "M6 30 5 3 21 15 39 15 55 3 54 30 48 47 30 58 12 47Z",
  hawk: "M5 31 9 16 22 9 44 11 56 5 51 23 55 37 43 49 30 56 13 48Z",
  octopus: "M12 33C4 3 55 2 48 32Q63 33 58 44T48 43Q49 60 39 58Q34 56 35 46Q30 64 24 55L24 46Q15 63 10 52L14 43Q0 51 2 41Q3 35 12 33Z",
  lion: "M30 2 41 7 51 6 54 16 59 24 56 34 58 45 48 49 40 57 30 55 20 58 12 50 3 45 5 34 1 24 7 16 10 7 21 8Z",
  canary: "M7 38Q4 12 25 11Q29 6 38 7L36 13Q53 17 54 34Q55 54 30 55Q11 55 7 38Z",
  eagle: "M4 28 9 13 24 5 42 7 55 18 56 38 48 49 38 47 31 57 24 49 13 51 8 42Z",
};
const ns = "http://www.w3.org/2000/svg";
function shape(tag, props) {
  const node = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  return node;
}
function avatar(id, state = "idle") {
  const [, accent, face] = animals[id];
  const svg = shape("svg", { viewBox: "0 0 60 60", "aria-hidden": "true" });
  svg.append(shape("path", { d: outlines[id], fill: face }));
  svg.append(shape("ellipse", { cx: 30, cy: 33, rx: 20, ry: 16, fill: accent }));
  for (const x of [21, 39]) {
    if (id === "owl") svg.append(shape("circle", { cx: x, cy: 29, r: 8, fill: "#eef4ff" }));
    if (state === "allowed") {
      svg.append(shape("path", { d: `M${x - 4} 30q4-7 8 0`, fill: "none", stroke: "#172033", "stroke-width": 2, "stroke-linecap": "round" }));
    } else {
      svg.append(shape("ellipse", { cx: x, cy: 29, rx: 3.3, ry: state === "pending" ? 5.5 : 3.5, fill: "#172033" }));
    }
  }
  if (id === "wolf" || id === "lion") {
    svg.append(shape("path", { d: "M15 36Q30 42 45 36Q42 49 30 51Q18 49 15 36Z", fill: "#f4e9da" }));
    svg.append(shape("ellipse", { cx: 30, cy: 39, rx: 4.5, ry: 2.7, fill: "#172033" }));
  } else if (id !== "octopus") {
    svg.append(shape("path", { d: id === "hawk" || id === "eagle" ? "M19 34Q32 27 43 35Q43 43 33 47L34 40 24 42Z" : "M21 34Q30 29 39 34L30 46Z", fill: "#a35d29" }));
  }
  return svg;
}

function read() {
  try {
    const saved = localStorage.getItem("nobetci-demo-theme");
    if (Object.hasOwn(animals, saved)) return saved;
  } catch { /* storage is optional */ }
  return "owl";
}
function save(id) {
  try { localStorage.setItem("nobetci-demo-theme", id); } catch { /* storage is optional */ }
}
window.NobetciThemes = { animals, avatar, read, save };
})();
