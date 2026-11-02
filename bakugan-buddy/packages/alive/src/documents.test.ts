import assert from "node:assert/strict";
import test from "node:test";
import { matchDocuments, parseDocumentRequest } from "./documents.ts";

test("document requests are recognised with the right intent", () => {
  assert.deepEqual(parseDocumentRequest("summarize report.pdf"), { kind: "summary", name: "report.pdf" });
  assert.deepEqual(parseDocumentRequest("Summarize the budget doc"), { kind: "summary", name: "budget doc" });
  assert.deepEqual(parseDocumentRequest("read notes.md"), { kind: "read", name: "notes.md" });
  assert.deepEqual(parseDocumentRequest("/doc plan"), { kind: "summary", name: "plan" });
  assert.deepEqual(parseDocumentRequest("what does budget.pdf say about rent"), {
    kind: "question",
    name: "budget.pdf",
    question: "rent",
  });
  assert.deepEqual(parseDocumentRequest("/doc report.pdf about the deadline"), {
    kind: "question",
    name: "report.pdf",
    question: "the deadline",
  });
});

test("ordinary chat is not a document request", () => {
  for (const text of [
    "summarize this conversation",
    "tell me a story",
    "remember the dentist",
    "what did I say about the dentist?",
    "plan my week from my notes",
    "search for bakugan news",
    "",
  ]) {
    assert.equal(parseDocumentRequest(text), null, text);
  }
});

test("file names fuzzy-match what the user typed", () => {
  const names = ["Q3-budget.pdf", "meeting-notes.md", "bakugan-plan.docx", "budget-2025.txt"];
  assert.equal(matchDocuments("Q3-budget.pdf", names)[0].name, "Q3-budget.pdf");
  assert.equal(matchDocuments("q3 budget", names)[0].name, "Q3-budget.pdf");
  assert.equal(matchDocuments("notes", names)[0].name, "meeting-notes.md");
  const budgetHits = matchDocuments("budget", names);
  assert.equal(budgetHits.length, 2, "both budgets are offered so the user can choose");
  assert.deepEqual(matchDocuments("nothing like it", names), []);
  assert.deepEqual(matchDocuments("", names), []);
});

test("an exact name wins outright and a loose name returns every candidate", () => {
  const names = ["budget-notes.md", "budget.pdf"];
  assert.equal(matchDocuments("budget.pdf", names)[0].name, "budget.pdf");
  assert.equal(matchDocuments("budget.PDF", names)[0].name, "budget.pdf");
  // Typing only "budget" is ambiguous: both are returned so the UI can ask.
  assert.deepEqual(
    matchDocuments("budget", names).map((hit) => hit.name).sort(),
    ["budget-notes.md", "budget.pdf"],
  );
});
