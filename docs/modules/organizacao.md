# Organização

Second functional structure of HFM. It answers where the company is and how it is
divided, so that everything the fleet modules will later record has somewhere to
be recorded *about*.

Two screens today:

- **Operações** — the eight operations, their headcount, how many of those people
  can actually sign in, and the work locations each spans.
- **Estados e cidades** — the IBGE list of 27 federative units and 5 571
  municipalities, read-only, and the link between a work location and a real
  municipality.

## 1. Why the IBGE list is in the database

A work location used to be a name and nothing else. The imported base contains
`Belém Do Pará`, `Brasilia` and `Goiania`: three spellings, not three places. No
report could group by state, no screen could put a pin on a map, and every new
geographic field would have invented its own spelling of the same city.

`public.states` and `public.cities` fix that by being the single answer to "which
city is this". Both are keyed by the IBGE code itself:

```
states.id   smallint   11..53          the UF code
cities.id   integer    7 digits        the municipality code
```

A surrogate uuid would allow two rows to claim the same municipality, which is
precisely the failure the table exists to prevent. The first two digits of a
municipality code are its UF code, and that is a check constraint rather than a
convention:

```sql
constraint cities_state_prefix_check check (id / 100000 = state_id)
```

so a municipality filed under the wrong state cannot be written at all, by any
import, ever.

### Platform data, not tenant data

There is one Brazil. Neither table has an `organization_id`: every organization
reads the same rows, any signed-in user may read them, and only the service role
may write them. `anon` gets nothing, in line with every other table in the schema.

### The one row that is not a municipality

Fernando de Noronha (2605459) carries an IBGE code but is a state district of
Pernambuco. It is the only `is_municipality = false` row, which is why the column
exists and why the count is 5 571 rather than the 5 570 municipalities usually
quoted.

## 2. Work locations

`work_locations.city_id` is a nullable FK to `public.cities`. It was backfilled in
two deterministic passes — exact name, then the name qualified by its state — and
each pass links only when exactly one municipality matches. Eighteen of the
nineteen existing locations resolved.

The nineteenth is `Campo Grande`, and it is still NULL. There are two Campo
Grandes, and attaching the location to the larger one because it is the larger one
is exactly the inference the column was added to eliminate. The screen shows it as
**a definir** rather than guessing.

## 3. Searching 5 571 municipalities

People type `goiania`, not `Goiânia`. `ILIKE` on the stored name answers neither,
so the search goes through `public.search_cities`, which filters on
`private.normalize_label(name)` — casefolded and accent-free — and is backed by a
GIN trigram index on exactly that expression.

```sql
search_cities(p_state_id smallint, p_query text, p_limit int, p_offset int)
```

`SECURITY INVOKER`, so the reference-data policies still apply; the page limit is
clamped inside the function rather than trusted from the caller; and the total
count rides back on every row, so a page of results costs one round trip.

`public.state_summary` and `public.operation_summary` are both
`security_invoker = true` views. That matters for operations: a person scoped to
two operations sees two rows, not eight with the others zeroed — a zero is still a
disclosure that the operation exists.

## 4. The footprint of an operation

An operation used to be a name and nothing else. "Last Mille MG" has people in
Contagem, Uberlândia and Juiz de Fora; "Redespacho - Belém" has people in Pará.
Nothing in the schema said so, so nothing could be planned, filtered or measured
by place.

Two levels, because that is how the operation is described: the states it covers
and, inside each state, the municipalities. The second level is not derived from
the first — an operation can cover a state before anyone decides which cities,
and that half-built state is a real thing to record.

```
operations ──< operation_states ──< operation_cities >── cities
```

### Integrity by structure, not by trigger

Three things have to be true, and all three are composite foreign keys:

| Guarantee | How |
| --- | --- |
| the city belongs to the state it is filed under | `(city_id, state_id) → cities (id, state_id)` |
| the state belongs to the operation it is filed under | `(organization_id, operation_id, state_id) → operation_states` |
| both belong to the organization owning the operation | `organization_id` is part of the two keys above |

A wrong row is not rejected by application code at write time: it **cannot be
represented**. Filing Uberlândia under Pará, or Salvador under an operation that
does not cover Bahia, fails at the database — both were tested.

Removing a state takes its municipalities with it (`on delete cascade`), and the
screen says how many before confirming. These are links, not records: there is no
`deleted_at`, what was removed is gone, and the audit trail is its history.

### Reading

`public.operation_geography` returns one municipality per row with its state and
how many people are assigned there — `security_invoker`, so operation scopes
still decide what comes back and the headcount is counted under the caller's own
visibility of the directory. It is the difference between "Last Mille MG has 101
people", which is a number, and "53 in Contagem, 11 in Juiz de Fora, 11 in
Uberlândia", which is an operation.

### A derived starting point, not an invented one

The structure was born populated: every current assignment names an operation and
a work location, and a work location now names a municipality. The backfill read
exactly that and nothing more. Locations whose city is still unresolved
contributed nothing.

## 5. Navigation

The sidebar is two groups. **Organização** is what the company is; **Módulos
futuros** is what the product will do with it, and every entry there is still a
placeholder. Keeping the placeholders visibly apart is deliberate: mixed in with
working modules they made the product look finished and made the screens that do
work hard to find.

Colaboradores and Usuários are one entry and one module. They are the same 143
people seen from two sides — the employee record and the HFM account — and
splitting them would produce two screens arguing about who someone is.

## 6. Reviewing the screens without a database

Both screens sit behind a session, which makes them impossible to look at from an
environment that cannot reach Supabase. `/dev/preview-organizacao` renders the
same components against fixed data. It is gated exactly like the design-system
page — present only in development or in a build made with
`NEXT_PUBLIC_ENABLE_DEV_PAGES=1` — and the accessibility suite uses it to check
both screens in light and dark without credentials.

## 7. Loading the reference data elsewhere

`supabase/migrations/20260918192400_ibge_states_and_cities.sql` carries the whole
list, so `supabase db push` reproduces it. The linked project was loaded by a
one-shot Edge Function instead, and the result was verified by SHA-256 over
`(código, nome, DDD, latitude, longitude)` against the same dataset, then by
per-state counts against IBGE's published figures. That function has since been
emptied: it answered to any holder of the publishable key, and the publishable key
ships in the browser bundle, so a dormant service-role write path was not worth
keeping for a job that runs once.
