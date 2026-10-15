# Practice (F2)

Home for dictation practice facts that ranking decisions consume.

`dictation-facts.ts` assembles a read-only snapshot of the current attempt: whether dictation is open, whether this attempt stayed in dictation, whether the answer was seen, whether the word is fully hidden, and whether the active list is the ranking book. It does not decide to collect or remove a word.

The typing `Word` component stays where it is. On a mistake or on finish it reads those facts, asks `@/features/ranking` for a decision, then collects or passes the remove decision into the existing word-record transaction.
