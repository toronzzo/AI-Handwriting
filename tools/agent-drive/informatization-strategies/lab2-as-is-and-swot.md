# Lab 2 — Netflix: Strategic Position & Current IT Situation

Company: Netflix, Inc.  
Course: Informatization strategies 26/27 (eNauczanie)  
Depends on: Lab 1 (mission, strategy, resources, role of IT) + Zinchenko SAM analysis (DONE)

---

## 1. Current role of IT (Strategic Alignment Model) — DONE (Zinchenko)

**Position:** IT making a change and development of the organization (highest, cumulative level).

Summary already in the Google Doc (Zinchenko notes): DVD→streaming, global Open Connect/AWS platform, data-driven originals, ads hybrid, live/games/podcasts. Technology shapes strategy; it does not only support it.

---

## 2. AS-IS situation of the IT function (Temirlan)

### 2.1 Scope of the IT / Technology organization

Netflix does not treat “IT” as a classic back-office department. Technology is the product delivery system. Roughly ~3,000 of ~16,000 employees work in product/technology. Co-CEO Greg Peters owns product & technology; CTO Elizabeth Stone leads engineering. Culture: Freedom & Responsibility, context-not-control, heavy A/B testing and chaos engineering.

AS-IS IT therefore covers:

| Layer | What exists today |
|---|---|
| Customer-facing product | Playback, UI, recommendations, search, profiles, password-sharing / household controls, games client |
| Content & media pipeline | Ingest, encoding/transcoding (many language tracks & device profiles), packaging, DRM |
| Distribution | Proprietary Open Connect CDN (appliances inside ISP networks worldwide) |
| Live operations | Growing live stack (multi-camera, graphics, low latency); dedicated live ops centres planned/opening |
| Advertising tech | SSAI, targeting, measurement, Netflix Ads Suite / programmatic |
| Data & ML | Viewing behaviour pipelines, personalization models, experimentation platform |
| Cloud platform | AWS-centric microservices; thousands of independently deployable services |
| Corporate / enterprise IT | Billing for 325M+ memberships, finance, HR, internal tools (functional-support layer) |

### 2.2 IT architecture (AS-IS)

**Style:** Cloud-native microservices on AWS, not a monolithic on-prem ERP-centric estate.

**Core architectural building blocks:**

1. **Edge / delivery** — Open Connect appliances at ISP PoPs; adaptive bitrate; custom codecs for 4K HDR and peak concurrency (e.g. tens of millions of concurrent viewers on major live events).
2. **Control plane / microservices** — Independently deployable services for catalogue, membership, playback authorization, personalization, ads, games sessions, etc. Enables high deployment frequency and regional feature rollout.
3. **Data platform** — Large-scale behavioural and content metadata stores feeding ML recommendation and business analytics; experimentation (A/B) is a first-class architectural concern.
4. **Media processing** — Heavy batch/stream encoding pipelines to support 50+ languages and thousands of device profiles per title.
5. **Live path (emerging AS-IS)** — Separate real-time origin/encoding/latency path on top of the existing stack; still maturing vs VOD maturity.
6. **Enterprise systems** — Subscription billing, finance/HR — present but strategically secondary to the product stack.

**Implication for strategy:** Architecture is already aligned with “IT as change driver,” but live + ads + games stretch the same platform into new non-functional requirements (latency, reliability, regional rights, advertiser SLAs).

### 2.3 Security & resilience (AS-IS)

Publicly emphasized strengths:

- Scale and redundancy of Open Connect + AWS elasticity for VOD.
- Chaos engineering culture (failure injection as normal practice).
- DRM / content-protection controls for licensed and original titles.
- Device / household / IP signals used for account integrity (password-sharing crackdown).

Known or typical residual risks for this AS-IS (to feed SWOT / Lab 3):

- Concentration risk on AWS as primary cloud.
- Live events raise availability and latency stakes vs classic VOD.
- Large PII / viewing-history surface → privacy and regulatory exposure (GDPR and equivalents).
- Content piracy and account abuse remain ongoing security/business problems.
- **Lab 3 management news (for later update):** internal assessment finds inadequate backup & disaster recovery for many critical systems; key-person risk (IT Architect long absence).

### 2.4 Processes & governance (AS-IS)

- Decentralized product teams with “informed captain” decision rights.
- Continuous delivery / high change rate rather than waterfall release trains.
- Data-driven product decisions (completion, churn, engagement metrics).
- Tech spend on the order of ~8% of revenue (per group notes) — investment intensity consistent with a tech-led firm.
- Open engineering communication (Netflix Tech Blog / OSS) — knowledge sharing is institutionalised.

### 2.5 AS-IS summary (3–4 sentences for the report)

As of 2025–2026, Netflix’s IT function is a product-engineering organisation, not a support cost centre. The AS-IS architecture is AWS-based microservices plus a proprietary CDN (Open Connect), with mature VOD and personalization capabilities and rapidly growing live, advertising, and gaming stacks. Security and resilience practices are strong for streaming at scale, but new formats (live) and enterprise continuity (backup/DR) are the areas where the current situation is least complete. Overall, the AS-IS state already matches the Strategic Alignment Model position “IT making change and development,” because technology continuously opens new business models rather than only automating existing ones.

---

## 3. IT SWOT analysis (Matias) — base version (Lab 2)

Minimum 3 items per perspective. Grounded in Lab 1 facts + AS-IS above.  
*(Lab 3 will extend this with Management Board news — see next file / section.)*

### Strengths (S)

1. **Proprietary Open Connect CDN** — Lower per-bit cost and high playback quality vs competitors that buy third-party CDN capacity; hard to replicate at Netflix’s ISP footprint.
2. **Personalization / AI-ML engine** — ~80% of viewing driven by recommendations; major retention driver and competitive moat.
3. **Microservices + AWS elasticity** — High deployment velocity and ability to scale for peaks; supports continuous product experimentation.
4. **Engineering culture & talent density** — Chaos engineering, A/B platform, Freedom & Responsibility; ~3,000 tech staff; technology represented at co-CEO level (Greg Peters).
5. **Tech-enabled efficiency** — ~$2.82M revenue per employee; software substitutes for physical distribution assets.

### Weaknesses (W)

1. **Heavy dependency on AWS** — Platform concentration risk; outages or pricing shifts propagate directly into the consumer product.
2. **Live streaming stack still immature vs VOD** — Live requires different latency, failover, and ops skills; company is still building dedicated live operations capacity.
3. **Complexity of a multi-format platform** — Same organisation now runs VOD, live sports, ads, and cloud games — increases architectural and operational complexity.
4. **Enterprise / continuity hygiene can lag product engineering** — Classic back-office and DR practices are not the brand’s public strength (to be reinforced by Lab 3 news).
5. **Key-person / specialist dependency in architecture roles** — High autonomy culture increases impact when critical architects are unavailable (Lab 3).

### Opportunities (O)

1. **Advertising technology scale-up** — Ads Suite / programmatic path toward ~$3B ad revenue (2026 target) — IT can create a second profit engine.
2. **Live events & sports** — 200+ live events; live urgency reduces piracy and lifts ads; IT capability becomes a growth lever.
3. **Cloud gaming & interactive formats** — Reuse streaming infrastructure for games; deepen engagement and differentiation.
4. **Cheaper storage / advanced analytics** *(Lab 3 news — fold into updated SWOT)* — Lower storage cost makes deeper historical analytics and new data products economically feasible.
5. **GenAI across production/ops** — Group notes cite GenAI across ~300 projects — opportunity to cut cost and speed content/ops workflows.

### Threats (T)

1. **Competitors with deep tech + content budgets** — Disney, Amazon, Apple competing in streaming and live sports; can buy CDN/cloud capacity even if they lack Open Connect.
2. **Cybersecurity, privacy, and regulation** — Large personal dataset; breaches or stricter rules raise cost and reputational risk.
3. **Content cost inflation & rights complexity** — Live rights (e.g. WWE-scale deals) raise the cost of failure for IT reliability.
4. **Piracy and account sharing workarounds** — Ongoing revenue leakage; technological controls can be circumvented or create UX backlash.
5. **Market introduction of expensive sales-support systems** *(Lab 3)* — If rivals adopt first, comparative advantage gap may widen.

### Lab 2 SWOT conclusion (short)

Netflix’s IT strengths dominate in distribution, personalization, and change velocity — consistent with SAM level “IT driving change.” Weaknesses cluster around concentration risk, live/ops maturity, and continuity. Strategy should **use strengths to capture live/ads/games opportunities while closing resilience and dependency gaps** (sets up Lab 3 strategic choice: typically a maxi-maxi / SO strategy with targeted WT fixes).

---

## 4. What Lab 3 needs next (after this Lab 2 block)

From Instructions tab — only after Lab 2:

| Item | Owner | Status |
|---|---|---|
| Update SWOT with Management Board news | Matias (+ group check) | Draft in `lab3-swot-update-and-outline.md` |
| IT vision & mission | Zinchenko | Open |
| Future SAM role (change or not) | Zinchenko | Open |
| Strategic choice (maxi-max, etc.) | Zinchenko | Open |
| IT BSC (4 perspectives) | Zinchenko | Open |
| TO-BE: vision, architecture, service params | Temirlan | Open |
| TO-BE: delivery methods / projects | Matias | Open |
| IT costs & security TO-BE | Mykyta Dovhaliuk | Open |
| Action plan ≥8 SMART actions + KPIs | Matias (+ group) | Open |
| Full Report 1 + later presentation | Mykyta Dovhaliuk | Open |
