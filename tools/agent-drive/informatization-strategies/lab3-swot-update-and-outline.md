# Lab 3 — SWOT update + outline for Final Report 1

## A. Management Board news → SWOT mapping

| News | SWOT placement | Why |
|---|---|---|
| Storage cost fell → advanced analytics & more historical data now economical | **Opportunity (new/stronger O)** | Turns a cost barrier into a feasible data/AI investment; reinforces personalization and content-decision moats. |
| Expensive new sales-support IT system on the market; big comparative advantage | **Opportunity** if Netflix buys/builds equivalent; **Threat** if competitors adopt first | Classic “make-or-buy / race” item — must appear in both O and T until a decision is made. |
| Inadequate backup & disaster recovery for most critical systems | **Weakness (new/critical W)** and elevates **Threat** of prolonged disruption | Directly revises AS-IS security/resilience picture; not a minor ops footnote. |
| IT Architect absent long-term after accident | **Weakness** (key-person / knowledge gap) and **Threat** (delivery delay on architecture-heavy programmes) | Especially painful in a decentralised “informed captain” culture if architecture ownership was concentrated. |

### Does this change our understanding of the company?

Yes — partially.

- **Strategic identity unchanged:** Netflix remains tech-led; SAM position “IT making change and development” still holds for the product/platform story (Open Connect, recommendations, live/ads/games).
- **Maturity picture changes:** We previously overstated continuity maturity. AS-IS is “excellent at product velocity and scale,” but **weaker at classic IT continuity (backup/DR) and succession for critical architecture roles**.
- **Strategy implication:** Lab 2 suggested an aggressive SO (maxi-maxi) push into live/ads/analytics. After the news, the rational choice shifts toward **SO growth with mandatory WT remediation** — i.e. still offensive on analytics/sales-support opportunity, but only with parallel DR hardening and architecture-knowledge redundancy. Pure maxi-maxi without fixing DR would be reckless given the Board’s own risk disclosure.

---

## B. Updated IT SWOT (Lab 3 version)

### Strengths (unchanged core + note)

1. Open Connect cost/quality advantage  
2. Recommendation / ML retention engine  
3. Microservices + AWS scale and deploy velocity  
4. Tech leadership at C-suite; strong engineering culture  
5. High revenue-per-employee efficiency  

*(Board news does not remove these strengths.)*

### Weaknesses (updated)

1. AWS concentration risk  
2. Live stack / live ops still catching up to VOD maturity  
3. Multi-format platform complexity (VOD + live + ads + games)  
4. **NEW — Inadequate backup & DR for most critical systems** (Board assessment)  
5. **NEW — Temporary loss of IT Architect** → architecture decision bottleneck and knowledge risk  

### Opportunities (updated)

1. Ads tech scale-up toward multi-billion ad revenue  
2. Live sports/events as engagement + ads + anti-piracy lever  
3. Cloud gaming / interactive reuse of streaming stack  
4. **NEW — Cheap storage enables advanced analytics & longer historical retention**  
5. **NEW — Market sales-support system** that could unlock comparative commercial advantage if adopted (or built as equivalent)  
6. GenAI in production/ops workflows  

### Threats (updated)

1. Big-tech competitors in streaming + live rights  
2. Cyber / privacy / regulatory exposure  
3. Content/live rights cost inflation raises cost of IT failure  
4. Piracy and account-abuse workarounds  
5. **NEW — Competitors adopt the new sales-support system first** → Netflix loses comparative edge  
6. **Amplified — Prolonged outage risk** because DR is inadequate while live/ads raise availability expectations  
7. **Amplified — Delivery slippage** on strategic IT programmes while Architect is absent  

---

## C. Suggested strategic choice (for Zinchenko’s Lab 3 item)

**Recommended: Maxi-maxi (SO) with mini-mini (WT) remediation projects — often labelled a “maxi-maxi + risk containment” or hybrid aggressive strategy.**

Justification in course language:

- **Maxi-maxi (SO):** Use Open Connect + ML strengths + cheaper storage to seize advanced analytics, and evaluate the new sales-support system to strengthen monetisation (ads/sales).
- **Why not pure maxi-maxi:** Board news proves critical WT gaps (DR, key person). Ignoring them threatens the live/ads growth thesis.
- **WT actions that unlock SO:** (1) emergency DR/backup programme for critical systems; (2) architecture documentation + deputy/backup architect; then (3) analytics platform expansion; (4) sales-support system make-or-buy decision.

Alternative labels if the lecturer uses classic SWOT strategies only:

- Primary: **SO (maxi-maxi)**  
- Supporting: **WT (mini-mini)** for continuity and key-person risk  

---

## D. Draft IT vision & mission (starter for Zinchenko)

**IT Mission (present):** Reliably deliver personalised entertainment experiences at global scale — playback, discovery, live, ads, and games — while protecting member data and enabling rapid product change.

**IT Vision (aspirational):** Be the technology platform that makes Netflix the default entertainment layer worldwide: real-time capable, analytically superior, commercially intelligent (ads/sales), and resilient enough that no single outage or person can stop the service.

Alignment with business: business wants “entertain the world” + multi-format growth; IT vision supplies the scale, personalisation, live readiness, and monetisation tech that strategy depends on.

---

## E. Future SAM role (starter)

**Future role:** Remain at **“IT making a change and development of the organisation.”**  
**Change from current?** No level change — but the *content* of change shifts from “invent new formats” alone to “invent formats **and** institutionalise resilience/analytics.”  
Reason: live, ads, games, and advanced analytics still create new business capabilities; fixing DR does not demote IT to functional support — it makes the change-driver role sustainable.

---

## F. IT BSC sketch (4 IT-specific perspectives) — starter for Zinchenko

Classic IT Balanced Scorecard perspectives adapted to IT:

| Perspective | Example objectives | Example KPIs |
|---|---|---|
| **Corporate contribution / business value** | Grow ads & live readiness; support membership growth | Ad revenue; live concurrent viewers; contribution of tech-enabled ARPU |
| **Customer / user orientation** (members + internal business customers) | Playback quality; personalisation relevance; low friction for content/ads teams | Startup time; rebuffer rate; recommendation take-rate; advertiser fill/quality |
| **Operational excellence** | Availability, DR, deploy safety | Service availability %; RTO/RPO for critical systems; failed deploy rate; MTTR |
| **Future orientation / skills & innovation** | Analytics capability; architecture redundancy; talent | % critical systems with tested backups; secondary architects trained; analytics use-cases live; GenAI projects in production |

---

## G. TO-BE bullets (starters)

### Temirlan — Target IT organisation
- Competences: strengthen live SRE, DR/continuity, analytics engineering, ads/sales-support product; keep CDN and ML excellence.
- Skills: raise resilience engineering and data-platform literacy across product teams; formal architecture succession.

### Temirlan — Target architecture
- Keep AWS microservices + Open Connect.
- Add: hardened backup/DR tier for critical services; expanded analytics lake/warehouse exploiting cheaper storage; optional sales-support system integration layer; mature live origin/encoding path.

### Temirlan — Service parameters
- Members: startup <3s, high availability for VOD and defined live SLOs.
- Business stakeholders: self-serve analytics; clear RTO/RPO commitments; ads/sales tooling SLAs.

### Matias — Delivery method
- Agile / continuous delivery for product; dedicated programme for DR remediation; stage-gate for make-or-buy on sales-support system; chaos tests extended to backup restore drills.

### Mykyta D. — Costs & security (placeholders)
- Budget split: (1) run-the-platform, (2) live/ads growth, (3) DR/analytics remediation over 18 months.
- Security TO-BE: tested backups, defined RTO/RPO, reduced key-person risk, continued DRM/privacy controls.

---

## H. IT Action Plan — ≥8 SMART actions / 18 months (Matias) — draft

Cover all four IT BSC perspectives; include KPIs.

1. **DR remediation programme** — Within 6 months, implement and test backups for 100% of systems classified critical; target RPO ≤ 1h / RTO ≤ 4h for tier-1. *(Operational excellence)* KPI: % critical systems with successful restore test.
2. **Architecture continuity** — Within 3 months, appoint deputy architect + document top 20 architectural decisions; knowledge-transfer plan for absent Architect. *(Future orientation)* KPI: docs complete; 2 people able to approve architecture changes.
3. **Advanced analytics platform** — Within 12 months, retain + analyse 24 months of additional historical behavioural data enabled by lower storage cost; ship 5 decision-use cases (content, churn, ads). *(Business value + Customer)* KPI: # use cases in production; storage $/TB.
4. **Sales-support system decision** — Within 4 months, complete make-or-buy/RFP for the new market system; within 14 months, implement or deliver equivalent MVP. *(Business value)* KPI: decision date; time-to-MVP; sales conversion lift.
5. **Live reliability uplift** — Before next major sports season, meet agreed live SLO (e.g. availability/latency targets) for tier-1 live events. *(Customer + Operational)* KPI: live rebuffer %, failed starts, concurrent peak success.
6. **Ads stack scale** — Over 18 months, scale Ads Suite capacity and measurement to support 2026 ad-revenue trajectory. *(Business value)* KPI: ad impressions served; fill rate; revenue.
7. **Security & privacy hardening** — Within 9 months, close top audit findings; continuous control monitoring for member data. *(Operational + Customer)* KPI: open critical findings = 0; incident MTTR.
8. **Chaos + restore drills** — Quarterly game-days including full backup restore, not only instance failure. *(Operational + Future)* KPI: 4 drills/year; mean restore success rate.
9. **(Optional 9th) GenAI ops acceleration** — Within 12 months, productionise GenAI assistants for encoding ops / customer support deflection with human oversight. *(Future + Business)* KPI: hours saved; quality score.

---

## I. Immediate paste order into Google Doc

1. Put **Lab 2 AS-IS** under Temirlan notes → Lab2  
2. Put **Lab 2 base SWOT** under Matias notes → Lab2  
3. Put **Lab 3 updated SWOT + Board mapping** under Matias notes (or Final Report)  
4. Group double-checks SWOT  
5. Zinchenko fills vision/mission, future SAM, strategic choice, IT BSC using section C–F  
6. Temirlan expands TO-BE from section G  
7. Mykyta D. expands costs/security + assembles Final Report 1  
