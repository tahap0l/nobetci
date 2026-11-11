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
// The desktop app's mascot heads (src/baykus/mascot.ts and, for the owl,
// src/baykus/mini.ts), kept in step by hand: flat fills, one dark outline,
// big rimmed eyes. Each lives in a 100 × 100 box.
const dot = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const at = (side, dx) => 50 + side * dx;
const mirror = (points) => points(-1) + points(1);
const amber = "#F7B52F";
const designs = {
  owl: {
    outline: "#1B110A",
    body: [
      ["#8E5C36", mirror((s) => `M${at(s, 12)} 34L${at(s, 33)} 9L${at(s, 40)} 50Z`)],
      ["#8E5C36", "M10 57a40 31 0 1 0 80 0a40 31 0 1 0 -80 0Z"],
    ],
    marks: [
      ["#4A2B17", mirror((s) => `M${at(s, 19)} 33L${at(s, 31)} 18L${at(s, 34)} 38Z`)],
      ["#F3E3C6", dot(31, 54, 19.5) + dot(69, 54, 19.5)],
    ],
    face: [["#DE8C45", "M43.5 63H56.5L50 78Z"]],
    eye: { x: 19, y: 54, r: 14, white: "#F3E3C6", iris: amber, lid: "#D9BE93" },
  },
  wolf: {
    outline: "#1A1E27",
    body: [
      ["#8D99A9", mirror((s) => `M${at(s, 36)} 42L${at(s, 33)} 5L${at(s, 6)} 27Z`)],
      ["#8D99A9", "M50 19C72 19 87 33 90 51L97 63L86 67C80 84 65 93 50 93C35 93 20 84 14 67L3 63L10 51C13 33 28 19 50 19Z"],
    ],
    marks: [
      ["#566273", mirror((s) => `M${at(s, 30)} 31L${at(s, 29)} 14L${at(s, 14)} 27Z`)],
      ["#566273", "M50 19C58 19 65 21 71 24C62 27 55 33 50 43C45 33 38 27 29 24C35 21 42 19 50 19Z"],
      ["#F4EFE7", "M50 47C57 55 72 53 82 60C77 80 63 89 50 89C37 89 23 80 18 60C28 53 43 55 50 47Z"],
    ],
    face: [["#1D2129", "M43 67Q50 63 57 67Q56 74 50 76Q44 74 43 67Z"]],
    lines: "M50 76V80M50 80Q45 86 39 82M50 80Q55 86 61 82",
    eye: { x: 19.5, y: 50, r: 15, white: "#FFF8EC", iris: amber, lid: "#8D99A9" },
  },
  hawk: {
    outline: "#24130A",
    body: [["#A9653C", "M50 11C75 11 89 30 89 52C89 76 71 93 50 93C29 93 11 76 11 52C11 30 25 11 50 11Z"]],
    marks: [
      ["#F3E3C6", "M50 60C60 53 77 55 84 63C79 80 65 89 50 89C35 89 21 80 16 63C23 55 40 53 50 60Z"],
      ["#6E3E22", "M50 11C66 11 79 19 85 32C74 29 60 33 50 45C40 33 26 29 15 32C21 19 34 11 50 11Z"],
    ],
    strokes: ["#A9653C", "M36 80l4 4l4-4M46 84l4 4l4-4M56 80l4 4l4-4"],
    face: [
      ["#6E3E22", mirror((s) => `M${at(s, 37)} 37L${at(s, 4)} 47L${at(s, 4)} 53L${at(s, 34)} 44Z`)],
      ["#F2B544", "M41 62Q50 54 59 62Q60 73 50 83Q40 73 41 62Z"],
      ["#F9D77E", "M43 61Q50 56 57 61Q50 64 43 61Z"],
      ["#4A2C17", "M44.5 72Q50 76 55.5 72Q54 78 50 83Q46 78 44.5 72Z"],
    ],
    eye: { x: 19.5, y: 54, r: 14, white: "#FFF6DF", iris: amber, lid: "#C98A5E" },
  },
  eagle: {
    outline: "#161B27",
    body: [
      ["#3A4560", "M12 72C18 58 82 58 88 72C90 88 72 97 50 97C28 97 10 88 12 72Z"],
      ["#F6F2E8", "M50 9C73 9 87 26 87 48C87 62 81 71 74 78L66 72L60 83L50 76L40 83L34 72L26 78C19 71 13 62 13 48C13 26 27 9 50 9Z"],
    ],
    marks: [["#D3DDEA", "M50 9C65 9 77 16 83 28C71 22 60 23 50 32C40 23 29 22 17 28C23 16 35 9 50 9Z"]],
    face: [
      ["#3A4560", mirror((s) => `M${at(s, 35)} 30L${at(s, 4)} 41L${at(s, 4)} 47L${at(s, 32)} 37Z`)],
      ["#F5B82E", "M39 54Q50 46 61 54Q63 69 50 80Q37 69 39 54Z"],
      ["#FBDD86", "M41 54Q50 48 59 54Q50 58 41 54Z"],
      ["#B9781A", dot(46, 63, 1.4) + dot(54, 63, 1.4)],
    ],
    eye: { x: 19, y: 47, r: 13.5, white: "#FFFBEF", iris: "#F7C93A", lid: "#DAD5C8" },
  },
  canary: {
    outline: "#2B2208",
    body: [
      ["#E2B22E", mirror((s) => `M${at(s, 33)} 52Q${at(s, 47)} 66 ${at(s, 34)} 80Q${at(s, 28)} 66 ${at(s, 33)} 52Z`)],
      ["#F6D643", "M45 20Q43 4 53 3Q50 9 54 14Q60 5 66 9Q59 14 58 22Z"],
      ["#F6D643", "M50 16C73 16 88 33 88 55C88 77 72 92 50 92C28 92 12 77 12 55C12 33 27 16 50 16Z"],
    ],
    marks: [["#FCEB95", "M50 54C64 54 74 62 74 72C74 82 64 88 50 88C36 88 26 82 26 72C26 62 36 54 50 54Z"]],
    face: [
      ["#EE8E3A", "M42 57Q50 53 58 57L50 69Z"],
      ["#C96A1E", "M44.5 61Q50 64 55.5 61L50 69Z"],
    ],
    eye: { x: 19, y: 44, r: 13.5, white: "#FFFBEA", iris: "#7A5220", lid: "#F6D643" },
    blush: [27, 61, 5],
  },
  lion: {
    outline: "#2A1608",
    body: [[
      "#B4631F",
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return dot(Math.round((50 + Math.cos(a) * 34) * 10) / 10, Math.round((53 + Math.sin(a) * 34) * 10) / 10, 12);
      }).join("") + dot(50, 53, 36),
    ]],
    marks: [
      ["#F2B95C", mirror((s) => dot(at(s, 24), 30, 9))],
      ["#8E4A16", mirror((s) => dot(at(s, 24), 30, 4.5))],
      ["#F2B95C", "M50 26C68 26 80 39 80 55C80 72 67 84 50 84C33 84 20 72 20 55C20 39 32 26 50 26Z"],
      ["#FBEBCB", dot(43, 70, 9) + dot(57, 70, 9) + "M40 72H60Q58 83 50 83Q42 83 40 72Z"],
    ],
    face: [["#5A2E14", "M43 62Q50 59 57 62Q56 68 50 71Q44 68 43 62Z"]],
    lines: "M50 71V75M50 75Q46 80 41 77M50 75Q54 80 59 77",
    eye: { x: 15.5, y: 48, r: 12, white: "#FFF8EC", iris: amber, lid: "#F2B95C" },
  },
  octopus: {
    outline: "#1F1433",
    body: [[
      "#A775D2",
      dot(17, 76, 11) + dot(38, 83, 11) + dot(62, 83, 11) + dot(83, 76, 11) +
        "M50 8C75 8 89 27 89 49C89 65 82 76 72 82H28C18 76 11 65 11 49C11 27 25 8 50 8Z",
    ]],
    marks: [
      ["#C8A2EA", dot(29, 22, 4.5) + dot(68, 17, 3.2) + dot(77, 29, 2.4) + dot(38, 14, 2)],
      ["#61DDCB", dot(17, 79, 2.6) + dot(38, 86, 2.6) + dot(62, 86, 2.6) + dot(83, 79, 2.6)],
    ],
    face: [],
    lines: "M44 66Q50 71 56 66",
    eye: { x: 19, y: 45, r: 14, white: "#FFFAF2", iris: "#5B3A8C", lid: "#A775D2" },
    blush: [29, 63, 4.5],
  },
};
const ns = "http://www.w3.org/2000/svg";
function shape(tag, props) {
  const node = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(props)) node.setAttribute(name, value);
  return node;
}
let clips = 0;

function avatar(id, state = "idle", animated = false) {
  const svg = shape("svg", {
    viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false",
    "data-animal": id, "data-expression": state,
    class: animated ? "mascot-art is-animated" : "mascot-art",
  });
  const head = shape("g", { class: "mascot-head" });
  svg.append(head);
  drawDesign(head, designs[id], state);
  return svg;
}

function drawDesign(head, design, state) {
  const pending = state === "pending";
  const danger = state === "danger";
  const worried = state === "denied";
  const happy = state === "allowed" || state === "greeting";
  const round = { "stroke-linejoin": "round", "stroke-linecap": "round" };
  // One outline around the whole silhouette: stroke it, then fill over the inner half.
  head.append(shape("path", {
    d: design.body.map(([, d]) => d).join(""), fill: "none", stroke: design.outline, "stroke-width": 6, ...round,
  }));
  for (const [fill, d] of [...design.body, ...design.marks]) head.append(shape("path", { d, fill }));
  if (design.strokes) {
    head.append(shape("path", { d: design.strokes[1], fill: "none", stroke: design.strokes[0], "stroke-width": 2.2, ...round }));
  }
  if (design.blush) {
    const [x, y, r] = design.blush;
    head.append(shape("path", { d: dot(x, y, r) + dot(100 - x, y, r), fill: "#FF8FA6", opacity: .55 }));
  }
  const { x: dx, y, r, white, lid } = design.eye;
  const stroke = Math.max(2.4, r * .24);
  for (const side of [-1, 1]) {
    const x = 50 + side * dx;
    const socket = shape("g", { class: "mascot-eye" });
    socket.append(shape("circle", { cx: x, cy: y, r, fill: white, stroke: design.outline, "stroke-width": 1.8 }));
    if (happy) {
      socket.append(shape("path", {
        d: `M${x - r * .62} ${y + r * .12}Q${x} ${y - r * .62} ${x + r * .62} ${y + r * .12}`,
        fill: "none", stroke: design.outline, "stroke-width": stroke, ...round,
      }));
    } else {
      const ir = r * (pending ? .8 : .74);
      const reach = r - ir;
      const iy = y + (worried ? reach * .8 : 0);
      const eye = shape("g", { "data-mascot-pupil": "", transform: pending || danger ? `translate(${reach} 0)` : "translate(0 0)" });
      eye.append(shape("circle", {
        cx: x, cy: iy, r: ir, fill: danger ? "#FF4550" : pending ? "#FF9116" : design.eye.iris,
        stroke: "#2A170B", "stroke-width": 1.6,
      }));
      eye.append(shape("circle", { cx: x, cy: iy, r: ir * (danger ? .46 : .6), fill: "#140B05" }));
      eye.append(shape("path", { d: dot(x - ir * .34, iy - ir * .38, ir * .24) + dot(x + ir * .3, iy + ir * .34, ir * .11), fill: "#fff" }));
      socket.append(eye);
      if (danger || worried) {
        // Lids: stern when a request is dangerous, sad when it was denied.
        const slant = (danger ? .7 : -.6) * r * .6 * side;
        const y0 = y - r + .4 * 2 * r;
        const clip = shape("clipPath", { id: `mascot-lid-${++clips}` });
        clip.append(shape("circle", { cx: x, cy: y, r }));
        const cover = shape("g", { "clip-path": `url(#${clip.id})` });
        cover.append(shape("path", {
          d: `M${x - r} ${y - r - 1}H${x + r}V${y0 - slant}L${x - r} ${y0 + slant}Z`, fill: lid,
        }));
        cover.append(shape("path", {
          d: `M${x + r} ${y0 - slant}L${x - r} ${y0 + slant}`, fill: "none", stroke: design.outline, "stroke-width": stroke,
        }));
        socket.append(clip, cover);
      }
    }
    head.append(socket);
  }
  for (const [fill, d] of design.face) head.append(shape("path", { d, fill }));
  if (design.lines) {
    head.append(shape("path", { d: design.lines, fill: "none", stroke: design.outline, "stroke-width": 2.2, ...round }));
  }
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
