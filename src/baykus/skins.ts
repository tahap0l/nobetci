// Mascot skins for the character engine (owl.ts).
//
// The engine owns all movement — springs, moods, emotes, hops, wing waves,
// blinks, particles — and a skin only says what the character looks like: a
// palette with the owl's colour slots plus a few shape choices (ears, face
// markings, muzzle, limbs, feet, tail). Every mascot therefore moves exactly
// like the owl. Original artwork; nothing is imported.

import type { MascotTheme } from "../core/mascot-theme";

export const OWL_COLORS = {
  headTop: "#6E4428",
  headBottom: "#8E5C36",
  bodyTop: "#7C4D2D",
  bodyBottom: "#C08952",
  belly: "#D8AC72",
  bellyMark: "#9B683B",
  wing: "#5E3921",
  wingTip: "#7A4B2B",
  wingEdge: "#A87647",
  tuftInner: "#4A2B17",
  disc: "#F3E3C6",
  discRim: "#A9753F",
  lid: "#D9BE93",
  line: "#34200F",
  irisRim: "#2A170B",
  iris: "#F7B52F",
  irisAmber: "#FF9116",
  irisRed: "#FF4550",
  pupil: "#140B05",
  beak: "#DE8C45",
  beakDark: "#8A4A1E",
  mouth: "#3A1B0C",
  feet: "#D7934C",
  blush: "#FF8FA6",
} as const;

/** The owl's colour slots, plus the markings other mascots need. */
export type Palette = Record<keyof typeof OWL_COLORS, string> & {
  /** Dark marking: the wolf's blaze, a raptor's cap and brow, the lion's mane. */
  mark: string;
  /** Light marking: the wolf's cheeks, the hawk's throat, the eagle's crown, the octopus's spots. */
  shade: string;
  /** Snout patch and nose (wolf, lion). */
  muzzle: string;
  nose: string;
};

export interface Skin {
  colors: Palette;
  /** What sits where the owl's ear tufts are; all of them follow the `tuft` pose. */
  ears: "tufts" | "pointed" | "round" | "crest" | "none";
  mane: boolean;
  /** Eye patch: radius, rim width, and the owl's heart-shaped chin. */
  disc: { r: number; rim: number; chin: boolean };
  marks: "none" | "blaze" | "cap" | "crown" | "spots";
  brow: boolean;
  muzzle: "beak" | "hooked" | "snout" | "jowls" | "smile";
  belly: "chevrons" | "plain" | "none";
  feet: "talons" | "paws" | "tentacles";
  limbs: "wings" | "arms" | "tentacles";
  tail: "none" | "bushy" | "tuft" | "fan";
  /** Resting cheek blush, 0..1. */
  blush: number;
}

const shared = {
  irisAmber: OWL_COLORS.irisAmber,
  irisRed: OWL_COLORS.irisRed,
  blush: OWL_COLORS.blush,
} as const;

export const SKINS: Record<MascotTheme, Skin> = {
  owl: {
    colors: { ...OWL_COLORS, mark: OWL_COLORS.tuftInner, shade: OWL_COLORS.disc, muzzle: OWL_COLORS.disc, nose: OWL_COLORS.line },
    ears: "tufts",
    mane: false,
    disc: { r: 16.6, rim: 1.8, chin: true },
    marks: "none",
    brow: false,
    muzzle: "beak",
    belly: "chevrons",
    feet: "talons",
    limbs: "wings",
    tail: "none",
    blush: 0,
  },
  wolf: {
    colors: {
      ...shared,
      headTop: "#7B8799", headBottom: "#8D99A9", bodyTop: "#7B8799", bodyBottom: "#A6B0BD",
      belly: "#F4EFE7", bellyMark: "#C9CFD8", wing: "#687484", wingTip: "#8D99A9", wingEdge: "#B9C2CE",
      tuftInner: "#566273", disc: "#FFF8EC", discRim: "#566273", lid: "#B7C0CC", line: "#1D2129",
      irisRim: "#1A1E27", iris: "#F7B52F", pupil: "#12141A", beak: "#1D2129", beakDark: "#12141A",
      mouth: "#3A1B1F", feet: "#F4EFE7", mark: "#566273", shade: "#F4EFE7", muzzle: "#FFFFFF", nose: "#1D2129",
    },
    ears: "pointed",
    mane: false,
    disc: { r: 14.2, rim: 1.3, chin: false },
    marks: "blaze",
    brow: false,
    muzzle: "snout",
    belly: "plain",
    feet: "paws",
    limbs: "arms",
    tail: "bushy",
    blush: 0,
  },
  hawk: {
    colors: {
      ...shared,
      headTop: "#8A4F2E", headBottom: "#A9653C", bodyTop: "#8F5532", bodyBottom: "#C08454",
      belly: "#F3E3C6", bellyMark: "#A9653C", wing: "#6E3E22", wingTip: "#8A4F2E", wingEdge: "#C08454",
      tuftInner: "#4A2B17", disc: "#FFF6DF", discRim: "#6E3E22", lid: "#C98A5E", line: "#24130A",
      irisRim: "#24130A", iris: "#F7B52F", pupil: "#140B05", beak: "#F2B544", beakDark: "#4A2C17",
      mouth: "#3A1B0C", feet: "#F2B544", mark: "#6E3E22", shade: "#F3E3C6", muzzle: "#F3E3C6", nose: "#4A2C17",
    },
    ears: "none",
    mane: false,
    disc: { r: 14.2, rim: 1.3, chin: false },
    marks: "cap",
    brow: true,
    muzzle: "hooked",
    belly: "chevrons",
    feet: "talons",
    limbs: "wings",
    tail: "fan",
    blush: 0,
  },
  octopus: {
    colors: {
      ...shared,
      headTop: "#A06CCB", headBottom: "#A775D2", bodyTop: "#9C6AC8", bodyBottom: "#B487DC",
      belly: "#C8A2EA", bellyMark: "#8F5EBB", wing: "#8F5EBB", wingTip: "#A775D2", wingEdge: "#C8A2EA",
      tuftInner: "#7A4DA6", disc: "#FFFAF2", discRim: "#7A4DA6", lid: "#B487DC", line: "#1F1433",
      irisRim: "#1F1433", iris: "#5B3A8C", pupil: "#120A20", beak: "#1F1433", beakDark: "#1F1433",
      mouth: "#3A1B45", feet: "#61DDCB", mark: "#7A4DA6", shade: "#C8A2EA", muzzle: "#C8A2EA", nose: "#1F1433",
    },
    ears: "none",
    mane: false,
    disc: { r: 14.2, rim: 1.3, chin: false },
    marks: "spots",
    brow: false,
    muzzle: "smile",
    belly: "none",
    feet: "tentacles",
    limbs: "tentacles",
    tail: "none",
    blush: 0.7,
  },
  lion: {
    colors: {
      ...shared,
      headTop: "#EDB050", headBottom: "#F2B95C", bodyTop: "#E3A548", bodyBottom: "#F2C678",
      belly: "#FBEBCB", bellyMark: "#DDB26B", wing: "#D4933A", wingTip: "#EDB050", wingEdge: "#FBD896",
      tuftInner: "#8E4A16", disc: "#FFF8EC", discRim: "#B4631F", lid: "#E9A84A", line: "#2A1608",
      irisRim: "#2A1608", iris: "#F7B52F", pupil: "#140B05", beak: "#5A2E14", beakDark: "#3A1B0C",
      mouth: "#3A1B0C", feet: "#FBEBCB", mark: "#B4631F", shade: "#8E4A16", muzzle: "#FBEBCB", nose: "#5A2E14",
    },
    ears: "round",
    mane: true,
    disc: { r: 13.4, rim: 1.3, chin: false },
    marks: "none",
    brow: false,
    muzzle: "jowls",
    belly: "plain",
    feet: "paws",
    limbs: "arms",
    tail: "tuft",
    blush: 0,
  },
  canary: {
    colors: {
      ...shared,
      headTop: "#F4D03C", headBottom: "#F8DC55", bodyTop: "#F3CE3A", bodyBottom: "#F9E06C",
      belly: "#FCEB95", bellyMark: "#E9C440", wing: "#E0AE2A", wingTip: "#EFC53A", wingEdge: "#FBE98A",
      tuftInner: "#E0AE2A", disc: "#FFFBEA", discRim: "#D2A024", lid: "#F3CE3A", line: "#2B2208",
      irisRim: "#2B2208", iris: "#7A5220", pupil: "#140B05", beak: "#EE8E3A", beakDark: "#C96A1E",
      mouth: "#5A2A10", feet: "#EE8E3A", mark: "#E0AE2A", shade: "#FCEB95", muzzle: "#FCEB95", nose: "#C96A1E",
    },
    ears: "crest",
    mane: false,
    disc: { r: 14.2, rim: 1.3, chin: false },
    marks: "none",
    brow: false,
    muzzle: "beak",
    belly: "plain",
    feet: "talons",
    limbs: "wings",
    tail: "fan",
    blush: 0.8,
  },
  eagle: {
    colors: {
      ...shared,
      headTop: "#FBF8F0", headBottom: "#EDE8DC", bodyTop: "#34405A", bodyBottom: "#4C5A7A",
      belly: "#5D6C8E", bellyMark: "#8A99BA", wing: "#273044", wingTip: "#3A4560", wingEdge: "#7384A8",
      tuftInner: "#B9B3A4", disc: "#FFFBEF", discRim: "#B9B3A4", lid: "#DAD5C8", line: "#161B27",
      irisRim: "#161B27", iris: "#F7C93A", pupil: "#140B05", beak: "#F5B82E", beakDark: "#C98A1C",
      mouth: "#3A1B0C", feet: "#F5B82E", mark: "#3A4560", shade: "#D3DDEA", muzzle: "#EDE8DC", nose: "#C98A1C",
    },
    ears: "none",
    mane: false,
    disc: { r: 14.2, rim: 1.3, chin: false },
    marks: "crown",
    brow: true,
    muzzle: "hooked",
    belly: "chevrons",
    feet: "talons",
    limbs: "wings",
    tail: "fan",
    blush: 0,
  },
};
