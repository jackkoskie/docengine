---
title: Bad figures
short: bad-figures
group: operations
version: "1.0"
effectiveDate: 2024-01-15
---

[602.60] # Section

[602.60(1)] Figures follow.

![](images/a.svg){#fig:a}

![Duplicate key](images/a.svg){#fig:a}

![No key](images/a.svg)

![Wrong format](images/a.gif){#fig:gif}

![Missing file](images/missing.svg){#fig:missing}

See [[fig:a]], [[fig:gif]] and [[fig:missing]].
