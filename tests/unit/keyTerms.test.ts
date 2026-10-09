import { describe, expect, it } from "vitest";
import { agreeOnKeyTerms, agreeOnReportTerms, isDistinctive, keyTermsIn, shouting } from "../../src/core/keyTerms.js";

const MEASURED = [
  {
    question: "how do I reset my password?",
    answer: "Open Settings, then Account, then Reset password. The email takes a minute to arrive.",
    paraphrases: ["I forgot my password, what do I do", "where is the password reset option", "cant log in need to change my password"],
  },
  {
    question: "does the app work offline?",
    answer: "Yes, you can read everything offline. Anything you write syncs the next time you have signal.",
    paraphrases: ["can I use it with no internet", "what happens when I lose signal", "is there an offline mode"],
  },
  {
    question: "how do I change the language?",
    answer: "Settings, then Language. We have English, French and Yoruba so far.",
    paraphrases: ["can I switch it to french", "where do I pick a different language", "is yoruba supported"],
  },
  {
    question: "why is my payment failing at checkout?",
    answer: "Cards issued outside Nigeria are declined at the moment. Use a transfer instead while we fix it.",
    paraphrases: ["my card keeps getting declined when I pay", "checkout wont accept my payment", "payment error at the end of the order"],
  },
  {
    question: "how do I invite someone to my team?",
    answer: "Team, then Invite, then paste their email. They get a link that lasts seven days.",
    paraphrases: ["how can I add a colleague", "where do I send a team invitation", "want to bring someone onto my workspace"],
  },
] as const;

describe("a distinctive term is one the common-word list does not hold", () => {
  it("counts tickers, networks, devices, versions and rare words", () => {
    for (const surface of ["SUI", "sol", "usdc", "testnet", "mainnet", "android", "ios", "v2.3", "2.4", "yoruba", "walrus"]) {
      expect(isDistinctive(surface)).toBe(true);
    }
  });

  it("does not count the ordinary words a support question is made of", () => {
    for (const surface of ["how", "the", "password", "reset", "payment", "checkout", "language", "team", "offline", "network", "token", "wallet", "version"]) {
      expect(isDistinctive(surface)).toBe(false);
    }
  });

  it("reads a version with or without its v, and keeps the surface spelling for a reply", () => {
    expect(keyTermsIn("is v2.3 broken").map((key) => key.term)).toEqual(["2.3"]);
    expect(keyTermsIn("is 2.3 broken").map((key) => key.term)).toEqual(["2.3"]);
    expect(keyTermsIn("how do I get testnet SUI?").map((key) => key.surface)).toEqual(["testnet", "SUI"]);
  });
});

describe("two questions that differ by one key term are not the same question", () => {
  const cases = [
    { name: "SUI against SOL", stored: "how do I get testnet SUI?", asked: "how do I get testnet SOL?", answer: "Use the faucet and wait a minute.", agree: false },
    { name: "USDC against USDT", stored: "how do I bridge USDC?", asked: "how do I bridge USDT?", answer: "Open the bridge and pick the chain.", agree: false },
    { name: "mainnet against testnet", stored: "how do I get mainnet SUI?", asked: "how do I get testnet SUI?", answer: "Buy it on an exchange.", agree: false },
    { name: "android against ios", stored: "android login fails", asked: "ios login fails", answer: "Clear the cache and sign in again.", agree: false },
    { name: "v2.3 against v2.4", stored: "is v2.3 affected?", asked: "is v2.4 affected?", answer: "Only the earlier build is affected.", agree: false },
    { name: "the same terms in a different order", stored: "how do I get testnet SUI?", asked: "where do I get SUI on testnet", answer: "Use the faucet and wait a minute.", agree: true },
  ] as const;

  for (const probe of cases) {
    it(`${probe.agree ? "matches" : "refuses"} ${probe.name}`, () => {
      expect(agreeOnKeyTerms(probe.asked, probe.stored, probe.answer).agree).toBe(probe.agree);
    });
  }

  it("names the term on each side so the member can be asked which they meant", () => {
    const verdict = agreeOnKeyTerms("how do I get testnet SOL?", "how do I get testnet SUI?", "Use the faucet.");
    expect(verdict.onlyStored.map((key) => key.surface)).toEqual(["SUI"]);
    expect(verdict.onlyAsked.map((key) => key.surface)).toEqual(["SOL"]);
  });

  it("accepts a term the stored answer names even when the stored question does not", () => {
    expect(agreeOnKeyTerms("is yoruba supported", "how do I change the language?", "Settings, then Language. We have English, French and Yoruba so far.").agree).toBe(true);
  });

  it("keeps every one of the 15 paraphrases measured in run 4bd0e04c", () => {
    const verdicts = MEASURED.flatMap((pair) => pair.paraphrases.map((paraphrase) => agreeOnKeyTerms(paraphrase, pair.question, pair.answer).agree));
    expect(verdicts).toHaveLength(15);
    expect(verdicts.filter((agree) => agree)).toHaveLength(15);
  });
});

describe("a bug report is merged only when it names the same things", () => {
  it("refuses to merge an ios report into an android item", () => {
    expect(agreeOnReportTerms("ios login fails", "android login fails on 2.3").agree).toBe(false);
  });

  it("merges a shorter report that names nothing the item does not", () => {
    expect(agreeOnReportTerms("I also cannot log in on android", "android login fails on 2.3").agree).toBe(true);
    expect(agreeOnReportTerms("I cannot log in either", "android login fails on 2.3").agree).toBe(true);
  });
});

describe("a ticker is caught even when it is spelled like an ordinary word", () => {
  it("refuses NEAR against LINK, which a word list alone let through", () => {
    expect(agreeOnKeyTerms("how do I get testnet LINK?", "how do I get testnet NEAR?", "Use the faucet and paste your wallet.").agree).toBe(false);
    expect(agreeOnKeyTerms("how do I get testnet link?", "how do I get testnet near?", "Use the faucet and paste your wallet.").agree).toBe(false);
  });

  it("treats a capitalised short token as distinctive even when the word is common", () => {
    expect(isDistinctive("ONE")).toBe(true);
    expect(isDistinctive("TIME")).toBe(true);
    expect(isDistinctive("one")).toBe(false);
    expect(agreeOnKeyTerms("how do I stake GAS?", "how do I stake ONE?", "Open the staking page.").agree).toBe(false);
  });

  it("reads a dollar-prefixed ticker as the ticker", () => {
    expect(keyTermsIn("how do I buy $SUI?").map((key) => key.term)).toEqual(["sui"]);
    expect(agreeOnKeyTerms("how do I buy $SOL?", "how do I buy $SUI?", "Use any exchange.").agree).toBe(false);
  });

  it("ignores the capital-letter rule in a message that is shouted, so no word becomes a ticker", () => {
    expect(shouting("I CANNOT LOG IN AT ALL")).toBe(true);
    expect(keyTermsIn("I CANNOT LOG IN AT ALL")).toEqual([]);
    expect(agreeOnKeyTerms("I CANNOT LOG IN AT ALL", "I cannot log in", "Clear the cache and try again.").agree).toBe(true);
  });

  it("does not make the ordinary words of a support question distinctive", () => {
    for (const surface of ["team", "send", "test", "time", "data", "work", "step", "top"]) {
      expect(isDistinctive(surface)).toBe(false);
    }
  });
});
