# FamilyFi

FamilyFi is a family finance app. Couples send money into a shared family wallet and allocate it to labelled pots (rent, school fees, groceries). Fake money only: this is a sandbox demo from Hearth Labs, not a bank.

## Money rules
- Money is stored as whole kobo (integers, never decimals).
- Balances are calculated from ledger entries, never stored.
- Every transfer is double-entry, so its entries sum to zero.

## How we work
- Show a plan before any code.
- Stop after each numbered step and wait for a go-ahead.
- Explain each file in plain words.
- Commit only at points the owner approves.
- Work only inside this folder. Never put secrets in the repository. .env files stay out of Git.
- This Next.js version has breaking changes from older ones. Before writing Next.js code, check the docs in node_modules/next/dist/docs/, and say so in the plan.
