---
# yaml-language-server: $schema=../../../schema/frontmatter.schema.json
title: Departure Release (DR) Authority
short: departure-release
group: operations
version: "1.0"
effectiveDate: 2023-06-06
description: When departure release is granted automatically and when it must be coordinated.
required: true
public: true
---

[200.01] # ZXAA Airport
This authority is issued by the Exampleland FIR ([[fig:example-logo]]).

![Example FIR logo](images/example-logo.svg){#fig:example-logo width=30% align=center}

[200.01(1)] Departure release (DR) is automatically granted once confirmation of the active runway is communicated.

[200.01(2)] Should ZXAA_TWR utilize a non-active runway for departure, they must obtain a DR from the position covering ZXAA_APP.

[200.01(3)] A DR request may be verbally processed or through the use of the ExampleSitu release request function. If the Tower prefers ExampleSitu, inform the departure controller so they can be vigilant of requests.

[200.01(4)] Departure release is requested for each aircraft, unless a blanket release applies.

[200.01(4)(a)] A blanket release is issued by ZXAA_APP and remains valid until it is withdrawn.

[200.01(4)(b)] ZXAA_APP withdraws a blanket release when traffic or weather no longer permits it.

[200.01(5)] The following information is exchanged when a DR is requested:

[200.01(5)(a)] the aircraft callsign;

[200.01(5)(b)] the departure runway;

[200.01(5)(c)] the intended heading or route; and

[200.01(5)(d)] any restrictions that apply to the departure.

[200.02] # All other ZXEX Airports

[200.02(1)] All other airports in the Exampleland FIR require prior coordination of a DR.

[200.02(2)] The radar position covering terminal or departure services may authorize blanket DR authority depending on their circumstances.

[200.02(3)] DR requests are processed as described in [[200.01(3)]].

[200.02(4)] Where a DR is refused, the requesting position holds the aircraft until a new request is made.

[200.02(4)(a)] The refusing position states the reason for the refusal when it is not obvious.

[200.02(4)(b)] The refusing position says when the next request may be made, if known.

[200.02(5)] Positions confirm every DR that is exchanged by voice with a readback.

[200.02(6)] Positions tell each other as early as possible when they expect a delay. A delay that is expected to last longer than ten minutes is also passed to the adjacent unit.

[200.02(6)(a)] The adjacent unit is ZXBB_APP.

[200.02(6)(b)] ZXBB_APP may suggest an alternative departure runway.

[200.03] # Exceptions

[200.03(1)] Exceptions are recorded by the Operations Lead.

[200.03(2)] [repealed] Repealed, effective 2025-01-01

[200.03(3)] Any exception to this authority must be agreed in advance by the Operations Lead.
