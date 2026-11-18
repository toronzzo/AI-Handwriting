# Temirlan — Presentation crib (8 min group)

**Deck:** [Netflix_Presentation1](https://docs.google.com/presentation/d/1ElUMx8jYmL5dgDYF_gtVq1Y_fF7dR7OYgQHZAOYDD6k/edit)  
**Your block:** “What the future of IT will look like” · **~100 seconds** · **2 slides (9–10)**  
**Rule:** Do not retell the whole report. Only important points for managers.

## Speaking order (from responsibilities PDF)

| Speaker | Topic | Slides (short deck) | Time |
|---|---|---|---|
| Mykyta Dovhaliuk | Who we are + current IT role (+ short AS-IS) | 2–4 | ~100s |
| Mykyta Zinchenko | SWOT + Board → Maxi-Max → mission/vision → future SAM | 5–8 | ~100s |
| **Temirlan** | **TO-BE: org/architecture + services/security/costs** | **9–10** | **~100s** |
| Matias | IT BSC + Action Plan | 11–12 | ~100s |
| (anyone) | Closing recommendation | 13–14 | leftover |

Use the **first 14 slides** in the live talk. Slides 15–28 are duplicates / denser backups — do not present all 28 in 8 minutes.

---

## Your two slides (speak these)

### Slide 9 — TO-BE · Organisation and architecture  
**Title on slide:** Keep the engine. Fix the weak points.

**Say (~50–55 s):**

> After the Board news, the target for IT is clear: keep what already wins — AWS, Open Connect, data and ML — and upgrade live and advertising reliability. At the same time we protect the company: recovery by design, and no single architect. So we grow live, ads and AI without making the platform fragile. Competences we keep: CDN, personalisation, microservices. Competences we add: live SRE, disaster recovery, deeper analytics, sales-support option, and dual ownership of critical architecture.

**Point at the three columns while speaking:** KEEP → UPGRADE → PROTECT.

### Slide 10 — TO-BE · Services, security and costs  
**Title on slide:** Make reliability measurable.

**Say (~45–50 s):**

> Targets make this concrete. Video stays at 99.9% availability. For critical systems we want recovery in four hours or less, data loss of at most one hour, and quarterly restore drills. Security and governance: every critical system backed up, supplier checks, clearer incident communication. On cost: we invest in continuity, but we keep cloud efficiency and Open Connect savings — reliability is funded, not improvisation.

**Hand off to Matias:** “Matias will show how we measure this with the Balanced Scorecard and the 18-month action plan.”

---

## If Dovhaliuk skips the AS-IS slide

Add **one sentence** before slide 9 (or on slide 9 as “was → will be”):

> Today the platform is strong at scale — AWS plus Open Connect — but thin on backup, disaster recovery and architecture succession. That is exactly what TO-BE fixes.

Do **not** list the full AS-IS table unless asked.

---

## Your detailed ownership (from responsibilities PDF)

Cover in speech only as bullets on slides 9–10 (already there). Do **not** open extra slides for each:

1. Target vision of the IT organisation → KEEP / UPGRADE / PROTECT story  
2. IT architecture → AWS + Open Connect stay; live/ads/analytics/resilience layers  
3. IT service parameters → 99.9%, RTO ≤ 4h, RPO ≤ 1h, quarterly drills  
4. Method of IT deliveries → one line only if asked: “continuous delivery for product; programme layer for DR and cross-team work” (Matias also owns delivery in report; keep short)  
5. IT costs → “invest in continuity; keep ~8% cloud efficiency / Open Connect savings”  
6. Information security → backups, supplier checks, incident communication  

---

## Practice checklist

- [ ] Time yourself: slides 9+10 in **90–110 seconds**  
- [ ] Memorise the three words: **Keep / Upgrade / Protect**  
- [ ] Memorise four numbers: **99.9% · 4h · 1h · quarterly**  
- [ ] One handoff sentence to Matias  
- [ ] If Q&A: Board news → DR + architect deputies; growth only after safeguards  

## Likely questions (short answers)

**Q: Why not leave AWS?**  
A: Switching cost is high; we keep AWS for scale, add contingency and multi-region tests, and reduce single-person architecture risk.

**Q: What is “sales-support system”?**  
A: Board opportunity — expensive market tool that can lift advertising/sales; evaluate buy vs build after DR foundations.

**Q: Who owns DR?**  
A: Platform reliability programme in the action plan (A1); Temirlan describes the TO-BE target, Matias shows the SMART actions.
