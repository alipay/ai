# Changelog

## 0.3.0

- Add `alipay-enterprise-invoice` as an explicitly selected optional sub Skill for metro scenarios.
- Require metro providers to record an enabled/disabled invoice decision before code generation.
- Extend subskill installation, multi-domain orchestration, integration contracts, shared message routing, and aggregate validation for the invoice domain.
- Bundle and drift-check the invoice Skill ZIP alongside the existing domain Skills.
- Classify rule-factor configuration as scenario-fixed values or enterprise-policy values, while keeping runtime order and merchant data outside configuration ownership.
- Align invoice notification transport selection with the shared scenario message entry and preserve the existing HTTP or WebSocket channel.
- Tighten invoice SDK fallback, RSA2 response verification, SINGLE-rule raw-response mapping, typed success checks, and optional response-field preservation.
- Require complete invoice notification validation, delivery and business idempotency, retry-safe lease refresh, and fail-closed production persistence boundaries.
- Require fail-closed Spring defaults to use conditional `@Bean` factories instead of component-level `@ConditionalOnMissingBean`.
- Require greenfield context tests to load the real application and prove at least one business notification handler or route is registered.

## 0.2.0

- Refine scenario decisions so default funding source, public-payment priority, and project type are inferred first and only ask users when required evidence is missing or conflicting.
- Add project-type inference and existing-project integration contract rules for safer incremental adoption.
- Improve code generation guardrails for SDK preflight, interface evidence, fail-closed integration points, message routing, and aggregate validation.
- Add optional extension installation support while keeping non-selected extensions silent by default.
- Refresh bundled domain Skill ZIP files and validator regression coverage.

## 0.1.0

- Establish the version baseline for the enterprise scenario integration Skill.
- Support single-scenario enterprise-code integration across EC, expense-control, and bill domains.
- Include subskill auto-install, scenario decision rules, code generation guardrails, and aggregate validation.
