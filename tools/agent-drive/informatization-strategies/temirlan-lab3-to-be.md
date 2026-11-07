# Lab 3 — IT TO-BE analysis (Temirlan Ospanov)

Underline alignment between business goals and IT goals.  
Business direction (from Lab 1): global entertainment platform — live events/sports, ads growth, games, IP franchises, personalisation at scale, high operating margin.  
SAM (Zinchenko): remain at “IT making change and development,” with stronger resilience so that change is sustainable.  
Board news folded into TO-BE: cheaper storage → analytics; sales-support system opportunity; fix backup/DR; cover Architect absence.

---

## 1. Target vision of the IT organisation

### 1.1 Vision statement
IT at Netflix will remain the engine of business-model change (live, ads, games, analytics-led decisions) while becoming a **continuously recoverable and succession-safe platform**: no single outage mode and no single person can stop strategic delivery.

### 1.2 Current competences to keep
- Open Connect / global delivery excellence  
- Personalisation and experimentation (A/B)  
- AWS microservices velocity  
- Media encode / multi-language packaging  
- Chaos engineering culture  

### 1.3 New / upgraded competence areas (TO-BE)
| Competence | Why (business alignment) | Expected skill level (18–24 months) |
| --- | --- | --- |
| Live SRE & real-time media ops | Live sports/events = strategic pillar | High — equal to VOD ops for tier-1 events |
| Backup, DR & continuity engineering | Board: inadequate DR; live/ads raise cost of downtime | High — tested restores, clear RTO/RPO |
| Advanced analytics / historical data platform | Cheaper storage makes deep history economical | High — self-serve analytics for content, churn, ads |
| Ads & commercial systems (incl. sales-support) | Ad revenue growth; market sales-support advantage | Medium–high — integrated with playback/ads stack |
| Architecture succession & documentation | Architect long absence | Medium–high — ≥2 people can decide on critical designs |
| Privacy / regulatory engineering | Global membership data | High — continuous controls, not only audits |

### 1.4 Organisation / skills shape
- Keep decentralised product teams, but add a thin **platform continuity** capability (DR, architecture review board with deputies).  
- Hire/train live SRE, analytics engineers, continuity specialists; pair them with existing CDN/ML experts.  
- Expected skill level: senior distributed-systems baseline across product teams; specialists for live, DR, and commercial systems.

**Alignment:** Business wants multi-format growth and monetisation; IT organisation TO-BE supplies the people and skills for live reliability, ads/sales tooling, and analytics — without abandoning the change-driver culture.

---

## 2. IT architecture (TO-BE)

### 2.1 Target principles
1. Keep **AWS microservices + Open Connect** as the core.  
2. Treat **live**, **ads**, and **games** as first-class paths with explicit SLOs — not afterthoughts on VOD.  
3. Add a **resilience tier**: backup, restore automation, multi-AZ/region strategy for systems classified critical.  
4. Expand the **analytics lake/warehouse** to retain longer history (enabled by lower storage cost).  
5. Introduce a **sales-support / commercial systems** layer (buy or build-equivalent) integrated with ads and membership data.  
6. Reduce key-person risk: architecture decision records (ADRs), diagrams, and dual ownership for critical domains.

### 2.2 Target technology / systems map

| Domain | TO-BE technologies / systems |
| --- | --- |
| Delivery | Open Connect + adaptive bitrate + live low-latency origin |
| Application | AWS microservices; independent deploy; regional feature flags |
| Data / ML | Extended historical store; feature store; recommendation + ads models; advanced analytics workbench |
| Live | Dedicated live encode/switch/graphics pipeline; live ops centres tooling |
| Advertising | Ads Suite, SSAI, measurement; optional new sales-support system for commercial advantage |
| Continuity | Automated backups, tested restore, documented RTO/RPO per critical service; chaos **and** restore drills |
| Enterprise | Billing / finance / HR kept reliable; integrated identity where needed |
| Governance | ADR repo; architecture deputies; critical-system register |

### 2.3 Alignment with business goals
| Business goal | IT architecture response |
| --- | --- |
| Live sports / events | Mature live path + ops centres + live SLOs |
| Ad revenue growth | Ads stack scale + sales-support system decision/implementation |
| Better content & retention decisions | Longer historical analytics + ML |
| Margin / efficiency | Keep Open Connect and automation; avoid duplicate fragile systems |
| Trust / continuity | DR tier closes Board-identified gap |

---

## 3. IT service parameters (TO-BE)

Target parameters of services and communication with main stakeholders.

### 3.1 Member-facing services
| Parameter | Target (illustrative TO-BE) |
| --- | --- |
| VOD playback startup | Keep sub-3-second class experience for majority of sessions |
| VOD availability (tier-1 regions) | ≥ 99.9% monthly |
| Live tier-1 events | Explicit latency and availability SLO published per event class; rebuffer and failed-start budgets defined |
| Personalisation relevance | Maintain high recommendation take-rate; monitor churn contribution |
| Incident communication | Public status + rapid mitigation playbooks for major outages |

### 3.2 Continuity parameters (new emphasis)
| Parameter | Target |
| --- | --- |
| Critical-system inventory | 100% classified within 3 months |
| Backup coverage | 100% of critical systems |
| RPO (tier-1) | ≤ 1 hour (or tighter where business requires) |
| RTO (tier-1) | ≤ 4 hours |
| Restore drills | ≥ quarterly, success logged |
| Architecture coverage | ≥ 2 named owners for each critical domain |

### 3.3 Stakeholder service parameters & communication

| Stakeholder | Service parameters | Communication channel / cadence |
| --- | --- | --- |
| Members | Playback, personalisation, live quality | In-app quality, status page on major incidents |
| Content / studio | Encode readiness, delivery windows | Operational dashboards; release calendars |
| Advertisers / sales | Inventory availability, measurement accuracy, sales-support tooling SLA | Ads Suite portals; sales ops reviews |
| Business leadership | Capability roadmap, risk (DR), live/ads KPIs | Monthly IT–business review; Board risk register updates |
| Product engineering teams | Platform APIs, deploy safety, shared data services | Internal SLOs; ADR reviews |
| ISPs | Open Connect capacity & support | Partner engineering forums |

### 3.4 Alignment note
Service parameters turn strategy into measurable IT commitments: growth formats (live/ads) get explicit quality targets, and Board risks (DR, Architect absence) get explicit continuity and ownership parameters — so IT goals stay tied to business goals rather than floating as “more technology.”

---

## 4. Short TO-BE conclusion (for Final Report)

The TO-BE IT organisation keeps Netflix’s change-driving strengths (CDN, ML, microservices) and adds live reliability, advanced analytics, commercial/sales-support capability, and tested disaster recovery with architecture succession. Target architecture stays AWS + Open Connect–centred but adds resilience and analytics tiers. Service parameters give members, advertisers, content partners and leadership clear quality and continuity commitments aligned with the 2025–2026 business strategy.

---

*Author: Temirlan Ospanov*  
*Note: Security policy depth and IT budget split belong to Mykyta Dovhaliuk; SWOT/action plan to Matias; SAM/BSC to Zinchenko.*
