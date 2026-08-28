# latches/ — the checkpoint tables

**Kind:** registers — one table per walk point, rows corrected in place.

**Holds:** the consultation checkpoints a session walks at fixed moments:
`planning.md` at plan assembly, `closing.md` at session close. Each row is a
hook: a work-shape condition, one authority to consult, one owed act.

**Live question (per row):** should a session still check this here? A row
answers to whether its authority still exists and its shape still occurs —
never to how often it fires; a row firing hard in a period whose work is its
shape is the system working.

**Reader and moment:** every session, at the walk points, polling each row
against the work at hand. The walk leaves its attestation in the work
product it governs (a diagnosis report, a pull-request description) — the
attestation proves the walk happened, not that the consultation was honest;
that residue is permanent.

**Discipline:** hooks may overlap freely across rows, but each owed act has
exactly one owning row — two rows owing the same act is a merge waiting to
happen, and the merge is performed, not deferred.

**Retirement:** a row retires on mootness or when its consulted authority
dissolves or is superseded — with the row following the successor pointer or
leaving with the authority.
