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
  wolf: "M7 27Q3 8 7 5Q11 3 21 15Q30 12 39 15Q49 3 53 5Q57 8 53 27Q61 39 49 48Q41 57 30 57Q19 57 11 48Q-1 39 7 27Z",
  hawk: "M5 31 9 16 22 9 44 11 56 5 51 23 55 37 43 49 30 56 13 48Z",
  octopus: "M12 33C4 3 55 2 48 32Q63 33 58 44T48 43Q49 60 39 58Q34 56 35 46Q30 64 24 55L24 46Q15 63 10 52L14 43Q0 51 2 41Q3 35 12 33Z",
  lion: "M30 2 41 7 51 6 54 16 59 24 56 34 58 45 48 49 40 57 30 55 20 58 12 50 3 45 5 34 1 24 7 16 10 7 21 8Z",
  canary: "M7 38Q4 12 25 11Q29 6 38 7L36 13Q53 17 54 34Q55 54 30 55Q11 55 7 38Z",
  eagle: "M4 28 9 13 24 5 42 7 55 18 56 38 48 49 38 47 31 57 24 49 13 51 8 42Z",
};
const faces = {
  owl: "M10 31Q13 17 29 28Q45 17 50 31Q52 46 30 51Q8 46 10 31Z",
  wolf: "M8 35Q13 21 23 24Q27 25 30 31Q33 25 37 24Q47 21 52 35Q50 51 30 54Q10 51 8 35Z",
  hawk: "M9 30Q18 16 30 25Q43 15 52 29L45 42 33 50 30 41 22 47 14 41Z",
  octopus: "M13 30Q12 14 30 13Q48 14 47 30Q43 40 30 39Q17 40 13 30Z",
  lion: "M13 24Q12 15 21 15L30 21 39 15Q48 15 47 24L47 39 39 48 30 53 21 48 13 39Z",
  canary: "M11 35Q12 23 28 20Q45 18 49 34Q45 50 30 52Q15 51 11 35Z",
  eagle: "M8 30 14 17Q24 11 34 13L49 19 53 34 45 46 37 42 32 53 22 46 15 49Z",
};
const ns = "http://www.w3.org/2000/svg";
function shape(tag, props) {
  const node = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  return node;
}
const details = {
  wolf: "M9 9 18 18 11 24ZM51 9 42 18 49 24Z",
  hawk: "M14 17Q27 9 43 15L49 12 44 20Q30 15 14 17Z",
  octopus: "M13 45a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Zm11 2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Zm12 0a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Zm11-2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z",
  lion: "M9 20 14 25 11 29ZM51 20 46 25 49 29ZM13 44l7 1-2 5Zm34 0-7 1 2 5Z",
  canary: "M11 24Q18 12 33 13L29 18Q18 18 11 24Z",
  eagle: "M9 21Q18 7 34 10Q46 11 51 22Q35 13 9 21Z",
};
const ink = "#172033";
const line = { fill: "none", stroke: ink, "stroke-width": 2.2, "stroke-linecap": "round" };

function avatar(id, state = "idle", animated = false) {
  const [, accent, face] = animals[id];
  const svg = shape("svg", {
    viewBox: "0 0 60 60", "aria-hidden": "true", focusable: "false",
    "data-animal": id, "data-expression": state,
    class: animated ? "mascot-art is-animated" : "mascot-art",
  });
  const head = shape("g", { class: "mascot-head" });
  const pending = state === "pending" || state === "danger";
  const worried = state === "denied";
  const happy = state === "allowed" || state === "greeting";
  svg.append(head);
  head.append(shape("path", { d: outlines[id], fill: face, stroke: "#ffffff42", "stroke-width": .7 }));
  head.append(shape("path", { d: faces[id], fill: accent }));
  if (details[id]) head.append(shape("path", { d: details[id], fill: id === "wolf" ? "#3c475c" : "#fff9e790" }));
  for (const x of [21, 39]) {
    const socket = shape("g", { class: "mascot-eye" });
    if (pending || worried) {
      const outer = x < 30 ? x - 5 : x + 5;
      const inner = x < 30 ? x + 4 : x - 4;
      const brow = worried || state === "danger"
        ? `M${outer} 23Q${x} 21 ${inner} 17`
        : `M${x - 4} 20q4-3 8 0`;
      head.append(shape("path", { ...line, d: brow }));
    }
    if (happy) {
      socket.append(shape("path", { ...line, d: `M${x - 4} 30q4-7 8 0` }));
    } else {
      const wide = id === "wolf" || id === "owl";
      socket.append(shape("ellipse", { cx: x, cy: 29.5, rx: wide ? 7 : 5.4, ry: pending ? 7.1 : 5.9, fill: "#fff9ee" }));
      const eye = shape("g", { "data-mascot-pupil": "", transform: pending ? "translate(1.7 1.2)" : worried ? "translate(0 1.6)" : "translate(0 0)" });
      eye.append(shape("ellipse", { cx: x, cy: 29, rx: pending ? 2.7 : 3.1, ry: pending ? 4.2 : 3.5, fill: ink }));
      eye.append(shape("circle", { cx: x - 1, cy: 27.5, r: 1.05, fill: "#fff9ee" }));
      socket.append(eye);
    }
    head.append(socket);
  }
  if (id === "wolf" || id === "lion") {
    head.append(shape("path", { d: "M15 36Q30 42 45 36Q42 49 30 51Q18 49 15 36Z", fill: "#f4e9da" }));
    head.append(shape("ellipse", { cx: 30, cy: 39, rx: 4.5, ry: 2.7, fill: ink }));
    if (pending) head.append(shape("ellipse", { cx: 30, cy: 45, rx: 2.5, ry: 2.8, fill: ink }));
    else head.append(shape("path", { ...line, d: worried ? "M26 47Q30 42 34 47" : happy ? "M25 43Q30 50 35 43" : "M27 44h6" }));
  } else if (id === "octopus") {
    if (pending) head.append(shape("ellipse", { cx: 30, cy: 36.5, rx: 2.6, ry: 3.3, fill: ink }));
    else head.append(shape("path", { ...line, d: worried ? "M26 39Q30 33 34 39" : "M26 36Q30 41 34 36" }));
  } else {
    const hooked = id === "hawk" || id === "eagle";
    const beak = hooked ? "M21 36Q32 31 40 37Q40 44 33 47L34 42 25 43Z" : "M22 37Q30 32 38 37L30 46Z";
    head.append(shape("path", { d: beak, fill: "#f3ad54" }));
    if (pending) head.append(shape("ellipse", { cx: 30, cy: 39.6, rx: 2.4, ry: 2.6, fill: ink }));
    else if (worried) head.append(shape("path", { ...line, d: "M26 41Q30 37 34 41" }));
  }
  return svg;
}

const motion = matchMedia("(prefers-reduced-motion: reduce)");
function gaze(container, x, y) {
  const move = motion.matches ? "translate(0 0)" : `translate(${x} ${y})`;
  for (const pupil of container.querySelectorAll("[data-mascot-pupil]")) {
    pupil.setAttribute("transform", move);
  }
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
window.NobetciThemes = { animals, avatar, gaze, read, save };
})();
