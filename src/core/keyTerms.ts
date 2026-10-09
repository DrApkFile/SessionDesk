import { COMMON_WORDS, DEVICE_NAMES, NETWORK_NAMES, TICKER_WORDS } from "./tuning.js";
import { expandedContractions } from "./reuseQuery.js";

const COMMON = new Set<string>(COMMON_WORDS);
const NAMED = new Set<string>([...NETWORK_NAMES, ...DEVICE_NAMES, ...TICKER_WORDS]);
const VERSION_SHAPE = /^\d+(?:\.\d+)+$/;
const NUMBER_SHAPE = /^\d+$/;

export interface KeyTerm {
  readonly term: string;
  readonly surface: string;
}

const TICKER_SHAPE = /^\$?[A-Z][A-Z0-9]{1,5}$/;

export function shouting(text: string): boolean {
  return !/[a-z]/.test(text);
}

function surfacesOf(text: string): readonly string[] {
  return expandedContractions(text)
    .replace(/[^A-Za-z0-9.$\-_ ]/g, " ")
    .split(/[\s\-_]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length > 0);
}

function normalised(surface: string): string {
  const lowered = surface.replace(/^\$/, "").toLowerCase();
  const unversioned = lowered.replace(/^v(?=\d)/, "");
  return VERSION_SHAPE.test(unversioned) ? unversioned : lowered;
}

export function isDistinctive(surface: string, inShoutedText = false): boolean {
  if (!inShoutedText && TICKER_SHAPE.test(surface)) return true;
  const term = normalised(surface);
  if (VERSION_SHAPE.test(term) || NUMBER_SHAPE.test(term)) return true;
  if (NAMED.has(term)) return true;
  if (term.length < 2) return false;
  if (!/[a-z]/.test(term)) return false;
  return !COMMON.has(term);
}

export function keyTermsIn(text: string): readonly KeyTerm[] {
  const found = new Map<string, KeyTerm>();
  const inShoutedText = shouting(text);
  for (const surface of surfacesOf(text)) {
    if (!isDistinctive(surface, inShoutedText)) continue;
    const term = normalised(surface);
    if (!found.has(term)) found.set(term, { term, surface });
  }
  return [...found.values()];
}

export interface TermAgreement {
  readonly agree: boolean;
  readonly asked: readonly string[];
  readonly stored: readonly string[];
  readonly onlyAsked: readonly KeyTerm[];
  readonly onlyStored: readonly KeyTerm[];
}

function missingFrom(wanted: readonly KeyTerm[], held: ReadonlySet<string>): readonly KeyTerm[] {
  return wanted.filter((key) => !held.has(key.term));
}

export function agreeOnKeyTerms(askedText: string, storedQuestion: string | null, storedAnswer: string): TermAgreement {
  const asked = keyTermsIn(askedText);
  const storedQuestionTerms = storedQuestion === null ? [] : keyTermsIn(storedQuestion);
  const storedSide = new Set<string>([...storedQuestionTerms, ...keyTermsIn(storedAnswer)].map((key) => key.term));
  const askedSide = new Set<string>(asked.map((key) => key.term));
  const onlyAsked = missingFrom(asked, storedSide);
  const onlyStored = missingFrom(storedQuestionTerms, askedSide);
  return {
    agree: onlyAsked.length === 0 && onlyStored.length === 0,
    asked: asked.map((key) => key.term),
    stored: [...storedSide],
    onlyAsked,
    onlyStored,
  };
}

export function agreeOnReportTerms(askedText: string, storedText: string): TermAgreement {
  const asked = keyTermsIn(askedText);
  const storedSide = new Set<string>(keyTermsIn(storedText).map((key) => key.term));
  const onlyAsked = missingFrom(asked, storedSide);
  return {
    agree: onlyAsked.length === 0,
    asked: asked.map((key) => key.term),
    stored: [...storedSide],
    onlyAsked,
    onlyStored: [],
  };
}
