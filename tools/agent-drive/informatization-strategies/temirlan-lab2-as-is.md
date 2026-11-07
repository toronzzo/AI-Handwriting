# Lab 2 — AS-IS situation of the IT function (Temirlan Ospanov)

Company: Netflix, Inc.  
Depends on: Lab 1 (mission, strategy, resources, role of IT) and Zinchenko’s SAM conclusion (IT driving change and organisational development).

---

## 1. Purpose of the AS-IS description

This section describes how IT actually works at Netflix today: organisation and competences, technology architecture, security and resilience, and how the IT function communicates with stakeholders. The picture is the baseline for Lab 3 TO-BE and for the group SWOT.

---

## 2. Organisation and competences (AS-IS)

Netflix does not run IT as a classic cost-centre “support department.” Technology is the delivery system for the product. About 3,000 of ~16,000 employees work in product and engineering. Co-CEO Greg Peters owns product and technology; CTO Elizabeth Stone leads engineering. Culture is Freedom & Responsibility, “context not control,” continuous A/B testing and chaos engineering.

**Current competence areas**

| Area | AS-IS maturity | Notes |
| --- | --- | --- |
| Streaming / playback / Open Connect CDN | High | Core competitive capability |
| Personalisation / ML recommendations | High | ~80% of viewing driven by recommendations |
| Cloud microservices on AWS | High | High deploy frequency, regional rollout |
| Media encode / multi-language packaging | High | Dozens of language tracks and device profiles |
| Advertising technology (SSAI, Ads Suite) | Medium–high / growing | Built largely in-house after 2022 |
| Live events infrastructure & ops | Medium / building | New vs VOD; live ops centres expanding |
| Cloud gaming / interactive | Medium | Reuses streaming path; still secondary to VOD |
| Enterprise IT (billing, finance, HR) | Adequate / functional support | Necessary but not the strategic moat |
| Continuity (backup / DR) | Incomplete (Board signal) | See security subsection — Lab 3 news |

**Skill level (AS-IS):** Very high for distributed systems, CDN, ML and experimentation; rising for live SRE and ad-tech; weaker institutional continuity practices (documented succession, tested restore) relative to product velocity.

---

## 3. IT architecture (AS-IS)

### 3.1 Architectural style
Cloud-native **microservices on AWS**, plus a **proprietary edge CDN (Open Connect)**. Not an on-prem ERP-centric estate. Thousands of independently deployable services support continuous delivery.

### 3.2 Main layers

1. **Edge / delivery** — Open Connect appliances inside ISP networks worldwide; adaptive bitrate; custom codecs for 4K HDR and extreme concurrency (tens of millions of concurrent viewers on major events).
2. **Product control plane** — Microservices for catalogue, membership, playback authorisation, profiles, household/password-sharing controls, search, UI configuration.
3. **Data & ML platform** — Behavioural and content metadata pipelines feeding recommendation models and the experimentation platform.
4. **Media processing** — Ingest, encode/transcode, packaging, DRM for global device and language coverage.
5. **Live path (emerging)** — Real-time origin, encoding, graphics insertion and low-latency delivery on top of the existing stack; less mature than VOD.
6. **Advertising path** — Server-side ad insertion, targeting, measurement, Netflix Ads Suite / programmatic interfaces.
7. **Games path** — Low-latency streamed games sessions reusing much of the video infrastructure.
8. **Enterprise systems** — Subscription billing for 325M+ memberships, finance, HR, internal tools.

### 3.3 Architecture implications
The AS-IS architecture already matches the Strategic Alignment Model position “IT making change and development”: each major business shift (streaming, global launch, originals-from-data, ads, live, games) was enabled by a technology platform change. The main architectural tension today is stretching one platform across **VOD + live + ads + games** without losing reliability.

---

## 4. Security, resilience and risk (AS-IS)

**Present strengths**
- Scale and redundancy of Open Connect + AWS elasticity for VOD.
- Chaos engineering as a normal practice (failure injection).
- DRM / content protection for licensed and original titles.
- Device, household and network signals for account integrity.

**Residual / disclosed risks**
- Concentration on AWS as primary cloud.
- Live events raise availability and latency requirements above classic VOD.
- Large personal and viewing datasets → privacy and regulatory exposure.
- Piracy and account abuse remain ongoing.
- **Management Board news (for SWOT / TO-BE):** internal assessment found **inadequate backup and disaster recovery** for most critical systems; **IT Architect long-term absence** creates key-person risk for architecture decisions.

So AS-IS security is strong for “keep the stream running under normal failure,” but weaker for “recover critical systems after major loss” and for architecture succession.

---

## 5. Processes, governance and stakeholder communication (AS-IS)

- Decentralised product teams with “informed captain” decision rights.
- Continuous delivery rather than long release trains.
- Data-driven product decisions (completion, churn, engagement).
- Technology spend on the order of ~8% of revenue (group notes) — investment intensity of a tech-led firm.
- Public engineering knowledge sharing (Tech Blog / OSS).

**Main stakeholders today**
| Stakeholder | How IT communicates / serves them AS-IS |
| --- | --- |
| Members | Product UX, playback quality, recommendations |
| Content / studio partners | Encoding, rights packaging, delivery readiness |
| Advertisers (ad tier) | Ads Suite, measurement, inventory |
| Business leadership | Metrics, experimentation results, platform capability for new formats |
| ISPs | Open Connect partnership / appliance footprint |
| Internal product teams | APIs, platforms, shared data/ML services |

Formal RTO/RPO commitments and restore drills are **not** a visible AS-IS strength (Board news).

---

## 6. AS-IS summary (for Final Report)

As of 2025–2026, Netflix’s IT function is a product-engineering organisation: AWS microservices, Open Connect CDN, mature VOD and personalisation, and growing live, advertising and gaming stacks. Security and resilience practices are advanced for large-scale streaming, but backup/DR completeness and architecture key-person coverage are weaker than the product narrative suggests. Overall, the AS-IS state supports the SAM conclusion that IT drives organisational change — technology continuously opens new business models — while exposing continuity gaps that Lab 3 TO-BE must close.

---

*Author: Temirlan Ospanov*
